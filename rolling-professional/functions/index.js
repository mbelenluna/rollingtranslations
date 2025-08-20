// index.js — Pair-based pricing + multi-target checkout + full endpoints (v6d + logs)
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const xlsx = require("xlsx");
const fileTypeLib = require("file-type");

// ===== Pair-based rate table =====
const PAIR_BASE_USD = {
  "english->afrikaans": 0.16, "english->albanian": 0.21, "english->amharic": 0.19, "english->arabic": 0.15,
  "english->armenian": 0.15, "english->bengali": 0.19, "english->bosnian": 0.30, "english->bulgarian": 0.21,
  "english->chinese (simplified)": 0.14, "english->chinese (traditional)": 0.14, "english->czech": 0.21,
  "english->danish": 0.21, "english->dari": 0.16, "english->dutch": 0.19, "english->estonian": 0.21,
  "english->farsi": 0.15, "english->finnish": 0.21, "english->french": 0.15, "english->french creole": 0.16,
  "english->greek": 0.21, "english->gujarati": 0.19, "english->hebrew": 0.19, "english->hindi": 0.15,
  "english->hmong": 0.30, "english->hokkien": 0.21, "english->indonesian": 0.15, "english->italian": 0.15,
  "english->japanese": 0.16, "english->korean": 0.15, "english->lao": 0.19, "english->latvian": 0.30,
  "english->lithuanian": 0.21, "english->malay": 0.19, "english->mongolian": 0.21, "english->nepali": 0.21,
  "english->norwegian": 0.19, "english->pashto": 0.15, "english->polish": 0.14,
  "english->portuguese (brazil)": 0.12, "english->portuguese (portugal)": 0.12, "english->punjabi": 0.16,
  "english->romanian": 0.22, "english->russian": 0.15, "english->slovak": 0.19, "english->slovene": 0.19,
  "english->somali": 0.19, "english->spanish (latam)": 0.12, "english->spanish (spain)": 0.12, "english->swahili": 0.19,
  "english->swedish": 0.19, "english->tagalog": 0.14, "english->telugu": 0.19, "english->thai": 0.15,
  "english->turkish": 0.19, "english->ukrainian": 0.16, "english->urdu": 0.16, "english->vietnamese": 0.15,
  "english->zomi": 0.30, "english->zulu": 0.30
};

function norm(s){ return String(s||"").trim().toLowerCase().replace(/\s+/g,' '); }
function normalizeLangName(s) {
  let out = norm(s);
  const aliases = {
    "eenglish": "english", "englisn": "english",
    "gurajati": "gujarati", "gebrew": "hebrew", "noewegian": "norwegian",
    "malaysian": "malay", "hakkien":"hokkien",
    "farsi": "farsi", "persian": "farsi",
    "haitian creole": "french creole",
    // Spanish variants
    "spanish (es)": "spanish (spain)", "spanish (europe)": "spanish (spain)", "spanish (castilian)":"spanish (spain)",
    "spanish (la)":"spanish (latam)","spanish la":"spanish (latam)","spanish latam":"spanish (latam)"
  };
  out = aliases[out] || out;

  // English con región -> 'english'
  if (/^english\b/.test(out)) return "english";

  // Chinese variantes
  if (/^chinese\b/.test(out)){
    if (out.includes("simplified")) return "chinese (simplified)";
    if (out.includes("traditional")) return "chinese (traditional)";
  }

  return out; // conservar paréntesis para Spanish/Portuguese/etc.
}

function pairBaseRateUSD(sourceLang, targetLang) {
  const src = normalizeLangName(sourceLang);
  const tgt = normalizeLangName(targetLang);
  if (src === "english" && tgt !== "english") {
    const base = PAIR_BASE_USD[`english->${tgt}`];
    return base != null ? Number(base) : null;
  } else if (tgt === "english" && src !== "english") {
    const base = PAIR_BASE_USD[`english->${src}`];
    return base != null ? Number(base) + 0.02 : null; // X->English = base + $0.02
  }
  return null; // non-English↔non-English no soportado
}

setGlobalOptions({ region: "us-central1" });

if (!admin.apps.length) {
  admin.initializeApp({ storageBucket: "rolling-crowdsourcing.firebasestorage.app" });
}
const bucket = admin.storage().bucket();

const Stripe = require("stripe");
const sgMail = require("@sendgrid/mail");
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

const CHECKOUT_ORIGIN = process.env.checkout_origin || process.env.CHECKOUT_ORIGIN || "https://mbelenluna.github.io/rolling-portal";
const ALLOWED_ORIGINS = [
  "https://mbelenluna.github.io",
  "https://mbelenluna.github.io/rolling-portal",
  "https://rolling-translations.com",
  "https://www.rolling-translations.com",
];

const MIN_TOTAL_USD = 1.0;
// Fallback legacy para /getQuoteForFile (el precio final lo calcula el front por pares)
function rateForWords(words){ return 0.10; }

function computeAmountCentsForPair(totalWords, rush, certified, subject, sourceLang, targetLang) {
  const w = Number(totalWords || 0);
  let rate = pairBaseRateUSD(sourceLang, targetLang);
  if (rate == null) return { rate: null, amountUsd: 0, amountCents: 0, unsupported: true };
  let totalUsd = w * Number(rate);

  switch ((subject || "").toLowerCase()) {
    case "technical":
    case "marketing": totalUsd *= 1.20; break;
    case "legal":
    case "medical": totalUsd *= 1.25; break;
  }
  switch (rush) {
    case "2bd": totalUsd *= 1.20; break;
    case "h24": totalUsd *= 1.40; break;
  }
  if (certified === "true" || certified === true) totalUsd *= 1.10;

  totalUsd = Math.max(totalUsd, MIN_TOTAL_USD);
  return { rate, amountUsd: totalUsd, amountCents: Math.round(totalUsd * 100) };
}
function computeAmountCentsMulti(totalWords, rush, certified, subject, pairs, fallbackSingle) {
  if (Array.isArray(pairs) && pairs.length > 0) {
    let sum = 0;
    for (const p of pairs) {
      const one = computeAmountCentsForPair(totalWords, rush, certified, subject, p.sourceLang, p.targetLang);
      if (one.unsupported) return { amountCents: 0, unsupported: true };
      sum += one.amountCents;
    }
    return { amountCents: sum, unsupported: false };
  }
  const { sourceLang, targetLang } = fallbackSingle || {};
  const out = computeAmountCentsForPair(totalWords, rush, certified, subject, sourceLang, targetLang);
  return { amountCents: out.amountCents, unsupported: !!out.unsupported };
}

// Wordcount genérico
function countWordsGeneric(text) {
  if (!text) return 0;
  const cleaned = String(text).replace(/[^A-Za-z0-9’'-]+/g, " ");
  const parts = cleaned.trim().split(/\s+/);
  return parts[0] === "" ? 0 : parts.length;
}
async function fileTypeFromBufferSafe(buf) {
  try { return await fileTypeLib.fileTypeFromBuffer(buf); } catch { return null; }
}
async function extractTextFromBuffer(buf, filename) {
  const ft = await fileTypeFromBufferSafe(buf);
  const mime = ft && ft.mime ? ft.mime : "";
  const ext = (filename.split(".").pop() || "").toLowerCase();

  if (mime.startsWith("text/") || ["txt","csv","srt","vtt","md","html","json"].includes(ext)) {
    let text = buf.toString("utf8");
    if (ext==="json") { try { text = JSON.stringify(JSON.parse(text)); } catch {} }
    if (ext==="srt" || ext==="vtt") { text = text.replace(/\d{2}:\d{2}:\d{2}[,\.]\d{3} --> .+\n/g, " "); }
    return text;
  }
  if (mime === "application/pdf" || ext === "pdf") {
    const data = await pdfParse(buf); return data.text || "";
  }
  if (ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const res = await mammoth.extractRawText({ buffer: buf }); return (res && res.value) || "";
  }
  if (["xlsx","xls"].includes(ext) || (mime && (mime.includes("spreadsheetml") || mime.includes("ms-excel")))) {
    const wb = xlsx.read(buf, { type: "buffer" });
    let text = "";
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false });
      for (const row of rows) {
        const line = (row || []).filter(Boolean).join(" ");
        if (line) text += " " + line;
      }
    }
    return text;
  }
  if (ext === "doc") return "";
  return buf.toString("utf8");
}

// ===== 1) Auto-quote HTTP (CORS) =====
exports.getQuoteForFile = onRequest(
  { cors: ALLOWED_ORIGINS, region: "us-central1" },
  async (req, res) => {
    try {
      if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
      const { gsPath, uid } = req.body || {};
      if (!gsPath) return res.status(400).send("Missing gsPath.");
      if (!uid || !gsPath.startsWith(`crowd/uploads/${uid}/`)) return res.status(403).send("Forbidden path.");

      const file = bucket.file(gsPath);
      const [buf] = await file.download();
      const text = await extractTextFromBuffer(buf, gsPath);
      let words = countWordsGeneric(text);

      const scanned = words < 10 && gsPath.toLowerCase().endsWith(".pdf");
      if (scanned) return res.json({ words: 0, scanned: true, rate: null, total: null, note: "Likely scanned PDF (requires OCR)." });

      const rate = rateForWords(words);
      const total = Math.round(Math.max(words * rate, MIN_TOTAL_USD) * 100) / 100;
      return res.json({ words, rate, total, currency: "USD" });
    } catch (err) {
      logger.error("getQuoteForFile error", err);
      return res.status(500).send(err.message || "Internal Server Error");
    }
  }
);

// ===== 2) Stripe Checkout session (multi-target) =====
exports.createCheckoutSession = onRequest(
  { cors: ALLOWED_ORIGINS, region: "us-central1", secrets: [STRIPE_SECRET_KEY] },
  async (req, res) => {
    try {
      if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
      const stripeSecret = STRIPE_SECRET_KEY.value();
      if (!stripeSecret) return res.status(500).json({ error: "Stripe secret key not configured" });
      const stripe = new Stripe(stripeSecret, { apiVersion: "2024-06-20" });

      let {
        requestId, totalWords = 0, email, fullName, description,
        rush, certified, subject, notes,                      // 👈 notes
        sourceLang, targetLang, pairs, successUrl, cancelUrl
      } = req.body || {};
      if (!requestId) return res.status(400).json({ error: "Missing requestId" });

      logger.info("createCheckoutSession:start", {
        requestId,
        wordsClient: Number(totalWords || 0),
        pairsCount: Array.isArray(pairs) ? pairs.length : ((sourceLang && targetLang) ? 1 : 0)
      });

      // Preferimos server si ya existiera algo
      let wordsServer = Number(totalWords || 0);
      try {
        const snap = await admin.firestore().collection("crowdRequests").doc(requestId).get();
        if (snap.exists) {
          const d = snap.data() || {};
          if (Number(d.totalWords) > 0) wordsServer = Number(d.totalWords);
          else if (Number(d.estWords) > 0) wordsServer = Number(d.estWords);
        }
      } catch {}

      const { amountCents, unsupported } =
        computeAmountCentsMulti(wordsServer, rush, certified, subject, pairs, { sourceLang, targetLang });
      logger.info("createCheckoutSession:amount", { requestId, amountCents, unsupported });
      if (unsupported) return res.status(400).json({ error: "Unsupported language pair(s)." });
      if (!(amountCents > 0)) return res.status(400).json({ error: "Invalid amount computed." });

      const amountUsd = amountCents / 100;
      const effRate = wordsServer > 0 ? (amountUsd / wordsServer) : null;
      const arrPairs = Array.isArray(pairs) && pairs.length ? pairs : [{ sourceLang, targetLang }];
      const pairsSummary = arrPairs.map(p => `${p.sourceLang}→${p.targetLang}`).join(", ");

      const origin = (process.env.checkout_origin || process.env.CHECKOUT_ORIGIN || CHECKOUT_ORIGIN).replace(/\/+$/, '');
      const success_url = successUrl || `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}&requestId=${encodeURIComponent(requestId)}`;
      const cancel_url  = cancelUrl  || `${origin}/cancel.html?requestId=${encodeURIComponent(requestId)}`;
      const name = description || "Professional translation";

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: email || undefined,
        line_items: [{
          price_data: { currency: "usd", product_data: { name, description: `Total words: ${wordsServer}` }, unit_amount: amountCents },
          quantity: 1
        }],
        success_url, cancel_url,
        payment_intent_data: {
          description: `${name} — ${wordsServer} words`,
          metadata: {
            requestId,
            totalWords: String(wordsServer),
            rush: String(rush || "standard"),
            certified: String(certified === "true" || certified === true),
            subject: String(subject || "general"),
            pairs: JSON.stringify(arrPairs),
            notes: String(notes || "")
          }
        },
        metadata: {
          requestId,
          totalWords: String(wordsServer),
          pairs: JSON.stringify(arrPairs)
        }
      });

      const humanRush = (r) => r === "h24" ? "24 hours" : (r === "2bd" ? "2 business days" : "Standard");

      await admin.firestore().collection("crowdRequests").doc(requestId).set({
        requestId,
        email: email || null,
        fullName: fullName || null,
        sourceLang: arrPairs[0]?.sourceLang || sourceLang || "—",
        targetLang: (arrPairs.length > 1)
          ? `Multiple (${arrPairs.length}): ${arrPairs.map(p=>p.targetLang).join(", ")}`
          : (arrPairs[0]?.targetLang || targetLang || "—"),
        pairs: arrPairs,
        subject: subject || "general",
        rush: String(rush || "standard"),
        turnaroundLabel: humanRush(String(rush || "standard")), // 👈 label legible
        certified: (certified === "true" || certified === true) ? true : false,
        notes: notes || null,                                    // 👈 guardamos notas
        totalWords: wordsServer,
        estimatedTotal: amountUsd,
        rate: effRate ?? null,
        stripeSessionId: session.id,
        stripeMode: "payment",
        checkoutCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: "pending_payment",
        description: name,
        pairsSummary
      }, { merge: false });

      logger.info("createCheckoutSession:ok", { requestId, sessionId: session.id });
      return res.json({ url: session.url });
    } catch (err) {
      logger.error("createCheckoutSession error", err?.response?.body || err?.message || err);
      return res.status(500).json({ error: err?.message || "Server error" });
    }
  }
);



// ===== 3) Webhook Stripe (email + estado) =====
exports.stripeWebhook = onRequest(
  { region: "us-central1", secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SENDGRID_API_KEY] },
  async (req, res) => {
    try {
      const stripeSecret = STRIPE_SECRET_KEY.value();
      const webhookSecret = STRIPE_WEBHOOK_SECRET.value();
      if (!stripeSecret || !webhookSecret) {
        logger.error("stripeWebhook: secrets missing", { hasStripe: !!stripeSecret, hasWebhook: !!webhookSecret });
        return res.status(500).send("Secrets not configured");
      }

      const stripe = new (require("stripe"))(stripeSecret, { apiVersion: "2024-06-20" });
      const sgMail = require("@sendgrid/mail");
      sgMail.setApiKey(SENDGRID_API_KEY.value());

      logger.info("stripeWebhook: hit", {
        hasSig: !!req.headers["stripe-signature"],
        rawLen: req.rawBody ? req.rawBody.length : null
      });

      const sig = req.headers["stripe-signature"];
      let event;
      try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
        logger.info("stripeWebhook: event parsed", {
          id: event.id, type: event.type, livemode: event.livemode
        });
      } catch (err) {
        logger.error("stripeWebhook: constructEvent failed", {
          message: err.message, stack: err.stack, rawType: typeof req.rawBody
        });
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      const sendConfirmation = async (sessionLike, eventId) => {
        const requestId = sessionLike?.metadata?.requestId || null;
        const amountTotal = typeof sessionLike?.amount_total === "number" ? (sessionLike.amount_total / 100) : null;
        const paymentIntentId = sessionLike?.payment_intent || null;

        const docRef = admin.firestore().collection("crowdRequests").doc(requestId || "unknown");
        let docData = {};
        if (requestId) {
          const snap = await docRef.get();
          if (snap.exists) docData = snap.data() || {};
        }

        if (docData.confirmationEmailSentAt) {
          logger.info("sendConfirmation: already sent, skipping", { requestId, eventId });
          return;
        }

        const clientEmail = docData.email || sessionLike?.customer_details?.email || "";
        const clientName  = docData.fullName || docData.fullname || "Client";
        const totalWords  = Number(docData.totalWords ?? sessionLike?.metadata?.totalWords ?? 0);
        const subject     = String(docData.subject || "general");
        const rushCode    = String(docData.rush || "standard");
        const turnaround  = docData.turnaroundLabel || (rushCode === "h24" ? "24 hours" : (rushCode === "2bd" ? "2 business days" : "Standard"));
        const certified   = docData.certified === true ? "Yes" : "No";
        const notes       = (docData.notes && String(docData.notes).trim()) ? String(docData.notes).trim() : null;

        const pairsList = Array.isArray(docData.pairs) && docData.pairs.length
          ? docData.pairs.map(p => `${p.sourceLang} → ${p.targetLang}`).join("<br>")
          : `${docData.sourceLang || "—"} → ${docData.targetLang || "—"}`;

        const nf = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
        const amountStr = amountTotal != null ? nf.format(amountTotal) :
                          (docData.amountPaid != null ? nf.format(docData.amountPaid) : "—");

        const tableRows = `
          <tr><td style="padding:8px 0;color:#64748b">Order ID</td><td style="padding:8px 0"><b>${requestId || "—"}</b></td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Languages</td><td style="padding:8px 0">${pairsList}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Total words</td><td style="padding:8px 0">${totalWords || "—"}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Amount paid</td><td style="padding:8px 0"><b>${amountStr}</b></td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Turnaround</td><td style="padding:8px 0">${turnaround}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Certification</td><td style="padding:8px 0">${certified}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Subject</td><td style="padding:8px 0">${subject}</td></tr>
          ${notes ? `<tr><td style="padding:8px 0;color:#64748b">Notes</td><td style="padding:8px 0;white-space:pre-wrap">${notes.replace(/</g,"&lt;")}</td></tr>` : ""}
        `;

        const html = `
          <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Inter;">
            <h2 style="margin:0 0 8px 0;">Your order is confirmed ✅</h2>
            <p style="margin:0 0 14px 0;">Thank you for choosing <b>Rolling Translations</b>!</p>
            <table style="border-collapse:collapse;width:100%;max-width:560px">${tableRows}</table>
            <p style="margin:16px 0 8px 0;">We’ll start processing your request and email you with updates shortly.</p>
            <p style="margin:0 0 14px 0;">Questions? <a href="mailto:info@rolling-translations.com">info@rolling-translations.com</a>.</p>
            <p style="margin:18px 0 0 0;color:#64748b;font-size:13px">— Rolling Translations</p>
          </div>
        `;

        const msgs = [];
        if (clientEmail) msgs.push({
          to: clientEmail,
          from: { email: "info@rolling-translations.com", name: "Rolling Translations" },
          subject: `Order ${requestId || sessionLike.id} confirmed — Rolling Translations`,
          html
        });
        msgs.push({
          to: "info@rolling-translations.com",
          from: { email: "info@rolling-translations.com", name: "Rolling Translations" },
          subject: `New paid order — ${requestId || sessionLike.id}`,
          html
        });

        logger.info("sendConfirmation:sending", {
          toClient: !!clientEmail, toInternal: true, amountTotal, paymentIntentId, requestId
        });
        try {
          if (msgs.length) await sgMail.send(msgs);
          logger.info("sendConfirmation:sendgrid success", { count: msgs.length, requestId });
        } catch (e) {
          logger.error("sendConfirmation:sendgrid error", e?.response?.body || e?.message || e);
          throw e;
        }

        if (requestId) {
          await docRef.set({
            status: "paid",
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            paymentIntentId,
            amountPaid: amountTotal != null ? amountTotal : (docData.amountPaid ?? null),
            confirmationEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
            confirmationEmailSessionId: sessionLike.id || null,
            confirmationEmailEventId: eventId || null
          }, { merge: true });
          logger.info("sendConfirmation:firestore updated", { requestId, eventId });
        }
      };

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        logger.info("stripeWebhook:event checkout.session.completed", {
          sessionId: session.id,
          email: session.customer_details?.email || null,
          requestId: session.metadata?.requestId || null
        });
        await sendConfirmation(session, event.id);
      } else {
        logger.info("stripeWebhook:ignored event", { type: event.type });
      }

      res.json({ received: true });
    } catch (err) {
      logger.error("stripeWebhook error", err?.response?.body || err?.message || err);
      return res.status(500).send("Webhook handler error");
    }
  }
);


exports.resendConfirmation = onRequest(
  { region: "us-central1", secrets: [STRIPE_SECRET_KEY, SENDGRID_API_KEY] },
  async (req, res) => {
    try {
      const stripeSecret = STRIPE_SECRET_KEY.value();
      if (!stripeSecret) return res.status(500).send("Stripe secret not configured");
      const stripe = new (require("stripe"))(stripeSecret, { apiVersion: "2024-06-20" });

      const sgMail = require("@sendgrid/mail");
      sgMail.setApiKey(SENDGRID_API_KEY.value());

      const sessionId = req.query.sessionId || req.body?.sessionId;
      const requestIdQ = req.query.requestId || req.body?.requestId;
      logger.info("resendConfirmation:hit", { sessionId: !!sessionId, requestId: requestIdQ || null });
      if (!sessionId && !requestIdQ) return res.status(400).send("Missing sessionId or requestId");

      let session = null;
      if (sessionId) session = await stripe.checkout.sessions.retrieve(sessionId);

      if (!admin.apps.length) admin.initializeApp({ storageBucket: "rolling-crowdsourcing.firebasestorage.app" });
      const db = admin.firestore();

      let requestId = requestIdQ || (session?.metadata?.requestId ?? null);
      let docData = {};
      let docRef = null;

      if (requestId) {
        docRef = db.collection("crowdRequests").doc(requestId);
        const snap = await docRef.get();
        if (snap.exists) docData = snap.data() || {};
      }

      if (docData.confirmationEmailSentAt) {
        logger.info("resendConfirmation:already sent", { requestId });
        return res.status(200).json({ ok: true, alreadySent: true });
      }

      const paid = session ? (session.payment_status === "paid" || session.status === "complete")
                           : (docData?.status === "paid");
      if (!paid) {
        logger.warn("resendConfirmation:not paid", { requestId, sessionId: session?.id || null });
        return res.status(400).send("Not paid yet");
      }

      const clientEmail = docData.email || session?.customer_details?.email || "";
      const clientName  = docData.fullName || docData.fullname || "Client";
      const totalWords  = Number(docData.totalWords ?? session?.metadata?.totalWords ?? 0);
      const subject     = String(docData.subject || "general");
      const rushCode    = String(docData.rush || "standard");
      const turnaround  = docData.turnaroundLabel || (rushCode === "h24" ? "24 hours" : (rushCode === "2bd" ? "2 business days" : "Standard"));
      const certified   = docData.certified === true ? "Yes" : "No";
      const notes       = (docData.notes && String(docData.notes).trim()) ? String(docData.notes).trim() : null;

      const pairsList = Array.isArray(docData.pairs) && docData.pairs.length
        ? docData.pairs.map(p => `${p.sourceLang} → ${p.targetLang}`).join("<br>")
        : `${docData.sourceLang || "—"} → ${docData.targetLang || "—"}`;

      const amountTotal = typeof session?.amount_total === "number" ? (session.amount_total / 100) : (docData.amountPaid ?? docData.estimatedTotal ?? null);
      const nf = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
      const amountStr = amountTotal != null ? nf.format(amountTotal) : "—";

      const tableRows = `
        <tr><td style="padding:8px 0;color:#64748b">Order ID</td><td style="padding:8px 0"><b>${requestId || sessionId}</b></td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Languages</td><td style="padding:8px 0">${pairsList}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Total words</td><td style="padding:8px 0">${totalWords || "—"}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Amount paid</td><td style="padding:8px 0"><b>${amountStr}</b></td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Turnaround</td><td style="padding:8px 0">${turnaround}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Certification</td><td style="padding:8px 0">${certified}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Subject</td><td style="padding:8px 0">${subject}</td></tr>
        ${notes ? `<tr><td style="padding:8px 0;color:#64748b">Notes</td><td style="padding:8px 0;white-space:pre-wrap">${notes.replace(/</g,"&lt;")}</td></tr>` : ""}
      `;

      const html = `
        <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Inter;">
          <h2 style="margin:0 0 8px 0;">Your order is confirmed ✅</h2>
          <p style="margin:0 0 14px 0;">Thank you for choosing <b>Rolling Translations</b>!</p>
          <table style="border-collapse:collapse;width:100%;max-width:560px">${tableRows}</table>
          <p style="margin:16px 0 8px 0;">We’ll start processing your request and email you with updates shortly.</p>
          <p style="margin:0 0 14px 0;">Questions? <a href="mailto:info@rolling-translations.com">info@rolling-translations.com</a>.</p>
          <p style="margin:18px 0 0 0;color:#64748b;font-size:13px">— Rolling Translations</p>
        </div>
      `;

      const msgs = [];
      if (clientEmail) msgs.push({
        to: clientEmail,
        from: { email: "info@rolling-translations.com", name: "Rolling Translations" },
        subject: `Order ${requestId || sessionId} confirmed — Rolling Translations`,
        html
      });
      msgs.push({
        to: "info@rolling-translations.com",
        from: { email: "info@rolling-translations.com", name: "Rolling Translations" },
        subject: `Re-send paid order — ${requestId || sessionId}`,
        html
      });

      logger.info("resendConfirmation:sending", { toClient: !!clientEmail, toInternal: true, requestId, sessionId: session?.id || null });
      try {
        if (msgs.length) await sgMail.send(msgs);
        logger.info("resendConfirmation:sendgrid success", { count: msgs.length, requestId });
      } catch (e) {
        logger.error("resendConfirmation:sendgrid error", e?.response?.body || e?.message || e);
        throw e;
      }

      if (docRef) {
        await docRef.set({
          status: "paid",
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          amountPaid: amountTotal != null ? amountTotal : null,
          confirmationEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
          confirmationEmailSessionId: session?.id || null,
        }, { merge: true });
        logger.info("resendConfirmation:firestore updated", { requestId });
      }

      return res.json({ ok: true });
    } catch (err) {
      logger.error("resendConfirmation error", err?.response?.body || err?.message || err);
      return res.status(500).send("Error resending");
    }
  }
);


// ===== 4) Email on new request =====
exports.emailOnRequestCreated = onDocumentCreated(
  { document: "crowdRequests/{requestId}", region: "us-central1", secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const data = event.data?.data() || {};
    const requestId = event.params.requestId;

    try {
      const clientEmail = data.email || data.clientEmail || "";
      const clientName  = data.fullName || data.fullname || "Client";

      const totalWords  = Number(data.totalWords ?? data.estWords ?? data.words ?? 0);
      const rate        = Number(data.rate ?? 0);
      const estTotal    = typeof data.estimatedTotal === "number" ? Number(data.estimatedTotal) : null;

      const rushCode    = String(data.rush || "standard");
      const turnaround  = data.turnaroundLabel || (rushCode === "h24" ? "24 hours" : (rushCode === "2bd" ? "2 business days" : "Standard"));
      const certified   = data.certified === true ? "Yes" : "No";
      const subject     = String(data.subject || "general");
      const notes       = (data.notes && String(data.notes).trim()) ? String(data.notes).trim() : null;

      const pairsList = Array.isArray(data.pairs) && data.pairs.length
        ? data.pairs.map(p => `${p.sourceLang} → ${p.targetLang}`).join("<br>")
        : `${data.sourceLang || "—"} → ${data.targetLang || "—"}`;

      const nf = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
      const amountStr = estTotal != null ? nf.format(estTotal) : "—";
      const rateStr   = rate ? `$${rate.toFixed(2)}/word` : (estTotal && totalWords ? `$${(estTotal/totalWords).toFixed(2)}/word` : "—");

      const tableRowsCommon = `
        <tr><td style="padding:6px 0;color:#64748b">Order ID</td><td style="padding:6px 0"><b>${requestId}</b></td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Languages</td><td style="padding:6px 0">${pairsList}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Total words</td><td style="padding:6px 0">${totalWords || "—"}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Rate</td><td style="padding:6px 0">${rateStr}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Estimate</td><td style="padding:6px 0"><b>${amountStr}</b></td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Turnaround</td><td style="padding:6px 0">${turnaround}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Certification</td><td style="padding:6px 0">${certified}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Subject</td><td style="padding:6px 0">${subject}</td></tr>
        ${notes ? `<tr><td style="padding:6px 0;color:#64748b">Notes</td><td style="padding:6px 0;white-space:pre-wrap">${notes.replace(/</g,"&lt;")}</td></tr>` : ""}
      `;

      const htmlClient = `
        <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Inter;">
          <h2 style="margin:0 0 10px 0;">We received your request ✅</h2>
          <p style="margin:0 0 12px 0;">Hi ${clientName}, thanks for choosing <b>Rolling Translations</b>!</p>
          <table style="border-collapse:collapse;width:100%;max-width:560px">${tableRowsCommon}</table>
          <p style="margin:14px 0 0 0;">To complete your order, please finish the payment you just started. We'll email you once it's confirmed.</p>
          <p style="margin:14px 0 0 0;">Questions? <a href="mailto:info@rolling-translations.com">info@rolling-translations.com</a>.</p>
          <p style="margin:18px 0 0 0;color:#64748b;font-size:13px">— Rolling Translations</p>
        </div>
      `;

      const htmlInternal = `
        <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Inter;">
          <h3 style="margin:0 0 10px 0;">New crowdsourcing request</h3>
          <table style="border-collapse:collapse;width:100%;max-width:560px">
            <tr><td style="padding:6px 0;color:#64748b">Client</td><td style="padding:6px 0">${clientName} &lt;${clientEmail || "—"}&gt;</td></tr>
            ${tableRowsCommon}
          </table>
        </div>
      `;

      const sgMail = require("@sendgrid/mail");
      sgMail.setApiKey(SENDGRID_API_KEY.value());

      const messages = [];
      if (clientEmail) {
        messages.push({
          to: clientEmail,
          from: { email: "info@rolling-translations.com", name: "Rolling Translations" },
          subject: `We received your request — ${requestId}`,
          html: htmlClient,
        });
      }
      messages.push({
        to: "info@rolling-translations.com",
        from: { email: "info@rolling-translations.com", name: "Rolling Translations" },
        subject: `New crowdsourcing request — ${requestId}`,
        html: htmlInternal,
      });

      if (messages.length) await sgMail.send(messages);
      logger.info("emailOnRequestCreated:sent", { requestId, toClient: !!clientEmail });
    } catch (err) {
      logger.error("emailOnRequestCreated error", err?.response?.body || err?.message || err);
    }
  }
);

// ===== 5) (Opcional) Diagnóstico de secrets — bórralo luego =====
exports.diag = onRequest(
  { region: "us-central1", secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SENDGRID_API_KEY] },
  async (_req, res) => {
    try {
      res.json({
        ok: true,
        hasStripe: !!STRIPE_SECRET_KEY.value(),
        hasWebhook: !!STRIPE_WEBHOOK_SECRET.value(),
        hasSendgrid: !!SENDGRID_API_KEY.value()
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  }
);
