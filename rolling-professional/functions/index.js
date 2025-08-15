const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore"); // si lo usás
const { setGlobalOptions } = require("firebase-functions/v2");
setGlobalOptions({ region: "us-central1" });
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Storage } = require("@google-cloud/storage");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const Stripe = require("stripe");

admin.initializeApp();
const db = admin.firestore();
const storage = new Storage();

// CORS sencillo
const ALLOWED_ORIGINS = [
  "https://mbelenluna.github.io",
  "https://rolling-translations.com",
  "http://localhost:5173",
  "http://localhost:5500"
];
function setCors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Credentials", "true");
  res.set("Access-Control-Allow-Headers", "Content-Type,Stripe-Signature");
  res.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).send("");
}

// Pricing
const PRICING = {
  base: {
    "en>es": { translation: 0.16, certified: 0.20, min_fee: 50 },
    "es>en": { translation: 0.18, certified: 0.22, min_fee: 55 },
    "en>pt": { translation: 0.17, certified: 0.21, min_fee: 50 },
    "pt>en": { translation: 0.18, certified: 0.22, min_fee: 55 }
  },
  multipliers: {
    subject: { general: 1.0, legal: 1.15, medical: 1.25, technical: 1.2, marketing: 1.1 },
    rush: { standard: 1.0, h48: 1.15, h24: 1.35, same_day: 1.6 }
  },
  fees: { cert_fee: 20, format_match_layout: 15 }
};
function pickBaseRate(pair, service = "translation") {
  const p = PRICING.base[pair]; if (!p) return null;
  return p[service] || p.translation || null;
}
function computeAmountCents({ words, pair, service, subject, rush, certified, formatTier }) {
  const base = pickBaseRate(pair, service);
  if (!base) throw new Error(`No base rate for ${pair}/${service}`);
  const subjectMul = PRICING.multipliers.subject[subject] || 1.0;
  const rushMul = PRICING.multipliers.rush[rush] || 1.0;
  const effective = base * subjectMul * rushMul;
  const textCost = Math.max(words * effective, (PRICING.base[pair]?.min_fee || 0));
  const formatFee = (formatTier === "match_layout") ? PRICING.fees.format_match_layout : 0;
  const certFee = certified ? PRICING.fees.cert_fee : 0;
  const subtotal = textCost + formatFee + certFee;
  return { cents: Math.round(subtotal * 100), breakdown: { textCost, formatFee, certFee, subtotal } };
}

// Helpers
async function gcsFileBuffer(gsPath) {
  let bucket = storage.bucket(); // default bucket
  let filePath = gsPath;
  // Si gsPath viniera como "bucket/..." (no es tu caso), separar bucket y ruta:
  if (gsPath.includes("/") && gsPath.split("/")[0].includes(".")) {
    const [bucketName, ...rest] = gsPath.split("/");
    bucket = storage.bucket(bucketName);
    filePath = rest.join("/");
  }
  const file = bucket.file(filePath);
  const [buf] = await file.download();
  return buf;
}
function naiveCount(str) {
  return (str || "").replace(/[\r\n]+/g, " ").trim().split(/\s+/).filter(Boolean).length;
}

// 1) Conteo de palabras
exports.getQuoteForFile = functions.region("us-central1").https.onRequest(async (req, res) => {
  setCors(req, res); if (req.method === "OPTIONS") return;
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    const { gsPath } = req.body || {};
    if (!gsPath) return res.status(400).json({ error: "Missing gsPath" });

    const buf = await gcsFileBuffer(gsPath);
    const lower = gsPath.toLowerCase();
    let words = 0;
    if (lower.endsWith(".docx")) {
      const r = await mammoth.extractRawText({ buffer: buf });
      words = naiveCount(r.value);
    } else if (lower.endsWith(".pdf")) {
      const r = await pdfParse(buf);
      words = naiveCount(r.text);
    } else if (lower.endsWith(".txt")) {
      words = naiveCount(buf.toString("utf8"));
    } else {
      words = Math.round(buf.toString("utf8").length / 5);
    }
    res.json({ words });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// 2) Crear sesión de pago (Stripe)
exports.createProCheckoutSession = functions.region("us-central1").https.onRequest(async (req, res) => {
  setCors(req, res); if (req.method === "OPTIONS") return;
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

    const {
      email, fullName, org, phone,
      sourceLang, targetLang, subject = "general", rush = "standard", certified = false,
      totalWords = 0, fileNames = [], gsPaths = []
    } = req.body || {};

    const pair = `${sourceLang}>${targetLang}`;
    const { cents, breakdown } = computeAmountCents({
      words: Number(totalWords || 0), pair, service: "translation", subject, rush, certified, formatTier: "basic"
    });

    const ref = await db.collection("proRequests").add({
      email, fullName, org, phone, sourceLang, targetLang, subject, rush, certified,
      totalWords: Number(totalWords || 0), files: fileNames, gsPaths, status: "pending_payment",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const origin = "https://rolling-translations.com/rolling-professional"; // cambiá si lo publicás en otro path
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email || undefined,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: "Professional translation", description: `${sourceLang}→${targetLang} — ${subject}/${rush}` },
          unit_amount: cents
        },
        quantity: 1
      }],
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}&requestId=${encodeURIComponent(ref.id)}`,
      cancel_url: `${origin}/cancel.html?requestId=${encodeURIComponent(ref.id)}`,
      payment_intent_data: {
        description: `Pro translation — ${sourceLang}>${targetLang} — ${subject}/${rush}`,
        metadata: { requestId: ref.id, totalWords: String(totalWords) }
      },
      metadata: { requestId: ref.id, totalWords: String(totalWords) }
    });

    await ref.set({ stripeSessionId: session.id, preview: breakdown }, { merge: true });
    res.json({ url: session.url, requestId: ref.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// 3) Webhook de Stripe (usar req.rawBody)
exports.stripeWebhook = functions.region("us-central1").https.onRequest(async (req, res) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
  const sig = req.headers["stripe-signature"];
  const whsec = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, whsec);
  } catch (err) {
    console.error("Webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const requestId = session?.metadata?.requestId;
    if (requestId) {
      await db.collection("proRequests").doc(requestId).set({
        status: "paid",
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        amount_total: session.amount_total,
        currency: session.currency,
        customer_email: session.customer_email
      }, { merge: true });
    }
  }
  res.json({ received: true });
});
