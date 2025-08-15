// functions/index.js — Gen2 (v2) with lazy requires for heavy deps
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");

setGlobalOptions({
  region: "us-central1",
  timeoutSeconds: 120,
  memoryMiB: 512,
});

const admin = require("firebase-admin");
const { Storage } = require("@google-cloud/storage");

admin.initializeApp();
const db = admin.firestore();
const storage = new Storage();

// ---- Secrets (configured in Google Secret Manager) ----
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

// ---- Small helpers ----
function cors(req, res) {
  // Ajustá el origen si querés restringirlo
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-requested-with, stripe-signature");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

function naiveWordCount(text) {
  if (!text) return 0;
  const matches = text.match(/\b[\p{L}\p{N}'-]+\b/gu);
  return matches ? matches.length : 0;
}

// ---- 1) Quote: lee un archivo en GCS y cuenta palabras (lazy require mammoth/pdf-parse) ----
exports.getQuoteForFile = onRequest(async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { gsPath, bucket, name } = req.body || {};
    let bucketName, filePath;

    if (gsPath && typeof gsPath === "string" && gsPath.startsWith("gs://")) {
      const noScheme = gsPath.slice(5);
      const slash = noScheme.indexOf("/");
      bucketName = noScheme.slice(0, slash);
      filePath = noScheme.slice(slash + 1);
    } else if (bucket && name) {
      bucketName = bucket;
      filePath = name;
    } else {
      return res.status(400).json({ error: "Missing gsPath or bucket/name" });
    }

    const [buf] = await storage.bucket(bucketName).file(filePath).download();
    const lower = filePath.toLowerCase();
    let text = "";

    if (lower.endsWith(".docx")) {
      // Lazy load mammoth solo si hace falta
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ buffer: buf });
      text = result.value || "";
    } else if (lower.endsWith(".pdf")) {
      // Lazy load pdf-parse solo si hace falta
      const pdfParse = require("pdf-parse");
      const result = await pdfParse(buf);
      text = result.text || "";
    } else {
      // txt / fallback
      text = buf.toString("utf8");
    }

    const words = naiveWordCount(text);
    res.json({
      bucket: bucketName,
      path: filePath,
      words,
      characters: text.length,
      // Agregá pricing aquí si querés calcular en el backend
    });
  } catch (err) {
    console.error("getQuoteForFile error:", err);
    res.status(500).json({ error: "Internal error", details: String((err && err.message) || err) });
  }
});

// ---- 2) Crea la Stripe Checkout Session ----
exports.createProCheckoutSessionV2 = onRequest(
  { secrets: [STRIPE_SECRET_KEY] },
  async (req, res) => {
    if (cors(req, res)) return;
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    try {
      const Stripe = require("stripe");
      const stripe = new Stripe(STRIPE_SECRET_KEY.value(), { apiVersion: "2024-06-20" });

      const {
        amount,          // entero en centavos (p.ej. 12345)
        currency = "usd",
        requestId,       // id del doc en Firestore para marcar pago en webhook
        customer_email,
        success_url,
        cancel_url,
        description = "Professional Translation Service",
        mode = "payment", // o "subscription" si usás price IDs
        priceId,          // opcional; si viene, ignoramos 'amount'
        quantity = 1,
      } = req.body || {};

      if (!success_url || !cancel_url) {
        return res.status(400).json({ error: "Missing success_url or cancel_url" });
      }

      let sessionParams = {
        mode,
        success_url,
        cancel_url,
        metadata: { requestId: requestId || "" },
      };

      if (customer_email) sessionParams.customer_email = customer_email;

      if (priceId) {
        sessionParams.line_items = [{ price: priceId, quantity }];
      } else {
        if (!(Number.isInteger(amount) && amount > 0)) {
          return res.status(400).json({ error: "Missing/invalid amount (integer cents)" });
        }
        sessionParams.line_items = [{
          price_data: {
            currency,
            product_data: { name: "Translation / Professional Service", description },
            unit_amount: amount
          },
          quantity: 1
        }];
      }

      const session = await stripe.checkout.sessions.create(sessionParams);
      res.json({ id: session.id, url: session.url });
    } catch (err) {
      console.error("createProCheckoutSessionV2 error:", err);
      res.status(500).json({ error: "Internal error", details: String((err && err.message) || err) });
    }
  }
);

// ---- 3) Webhook de Stripe ----
exports.stripeWebhookV2 = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] },
  async (req, res) => {
    // Nada de CORS aquí; Stripe no hace preflight. Solo POST.
    if (req.method !== "POST") {
      return res.status(405).send("Method not allowed");
    }

    try {
      const sig = req.headers["stripe-signature"];
      if (!sig) return res.status(400).send("Missing stripe-signature header");

      const Stripe = require("stripe");
      const stripe = new Stripe(STRIPE_SECRET_KEY.value(), { apiVersion: "2024-06-20" });

      let event;
      try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET.value());
      } catch (err) {
        console.error("Webhook signature verification failed:", err);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        const requestId =
          (session.metadata && session.metadata.requestId) ||
          (session.metadata && session.metadata.request_id) ||
          null;

        if (requestId) {
          await db.collection("proRequests").doc(requestId).set({
            status: "paid",
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            amount_total: session.amount_total || null,
            currency: session.currency || null,
            customer_email: session.customer_email || null,
            session_id: session.id,
          }, { merge: true });
        }
      }

      // Manejá otros tipos si los necesitás.
      res.json({ received: true });
    } catch (err) {
      console.error("stripeWebhookV2 error:", err);
      res.status(500).send("Internal error");
    }
  }
);
