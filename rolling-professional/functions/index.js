// functions/index.js — Gen2 (v2) con CORS estricto + invoker público + lazy requires

const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");

setGlobalOptions({
  region: "us-central1",
  timeoutSeconds: 120,
  memoryMiB: 512,
});

const admin = require("firebase-admin");
// ❌ (quitado del top-level) const { Storage } = require("@google-cloud/storage");

admin.initializeApp();
const db = admin.firestore();

// ---- Secrets (configurados en Secret Manager) ----
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

// ---- CORS helper (permitimos tu sitio y localhost para dev) ----
const ALLOWED_ORIGINS = new Set([
  "https://rolling-translations.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
]);

function applyCors(req, res) {
  const origin = req.headers.origin;
  const allow = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://rolling-translations.com";
  res.set("Access-Control-Allow-Origin", allow);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] ||
      "Content-Type, Authorization, x-requested-with, stripe-signature"
  );
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

function naiveWordCount(text) {
  if (!text) return 0;
  // Unicode-aware: cuenta palabras con letras/números/apóstrofe/guion
  const matches = text.match(/\b[\p{L}\p{N}'-]+\b/gu);
  return matches ? matches.length : 0;
}

// ===================================================================
// 1) getQuoteForFile — Lee de GCS y cuenta palabras (lazy require mammoth/pdf-parse + Storage)
// ===================================================================
exports.getQuoteForFile = onRequest({ invoker: "public" }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ⬇️ Lazy import aquí (evita que el módulo falte durante el build de Stripe)
    const { Storage } = require("@google-cloud/storage");
    const storage = new Storage();

    const { gsPath, bucket, name } = req.body || {};
    let bucketName, filePath;

    if (gsPath && typeof gsPath === "string" && gsPath.startsWith("gs://")) {
      const noScheme = gsPath.slice(5);
      const slash = noScheme.indexOf("/");
      if (slash < 0) {
        return res.status(400).json({ error: "Invalid gsPath" });
      }
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
      // Carga perezosa de mammoth
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ buffer: buf });
      text = result.value || "";
    } else if (lower.endsWith(".pdf")) {
      // Carga perezosa de pdf-parse
      const pdfParse = require("pdf-parse");
      const result = await pdfParse(buf);
      text = result.text || "";
    } else {
      // .txt u otros: tratamos como texto plano
      text = buf.toString("utf8");
    }

    const words = naiveWordCount(text);
    res.json({
      bucket: bucketName,
      path: filePath,
      words,
      characters: text.length,
    });
  } catch (err) {
    console.error("getQuoteForFile error:", err);
    res
      .status(500)
      .json({ error: "Internal error", details: String(err && err.message) });
  }
});

// ===================================================================
// 2) createProCheckoutSessionV2 — Crea una sesión de Stripe Checkout
// ===================================================================
exports.createProCheckoutSessionV2 = onRequest(
  { secrets: [STRIPE_SECRET_KEY], invoker: "public" },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    try {
      // Carga perezosa de Stripe
      const Stripe = require("stripe");
      const stripe = new Stripe(STRIPE_SECRET_KEY.value(), {
        apiVersion: "2024-06-20",
      });

      const {
        amount, // entero en centavos (p.ej. 12345)
        currency = "usd",
        requestId, // id del doc en Firestore para marcar pago en el webhook
        customer_email,
        success_url,
        cancel_url,
        description = "Professional Translation Service",
        mode = "payment", // o "subscription" si usás priceId
        priceId, // si viene, ignoramos amount
        quantity = 1,
      } = req.body || {};

      if (!success_url || !cancel_url) {
        return res
          .status(400)
          .json({ error: "Missing success_url or cancel_url" });
      }

      const sessionParams = {
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
          return res
            .status(400)
            .json({ error: "Missing/invalid amount (integer cents)" });
        }
        sessionParams.line_items = [
          {
            price_data: {
              currency,
              product_data: {
                name: "Translation / Professional Service",
                description,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ];
      }

      const session = await stripe.checkout.sessions.create(sessionParams);
      res.json({ id: session.id, url: session.url });
    } catch (err) {
      console.error("createProCheckoutSessionV2 error:", err);
      res
        .status(500)
        .json({ error: "Internal error", details: String(err && err.message) });
    }
  }
);

// ===================================================================
// 3) stripeWebhookV2 — Webhook de Stripe (¡sin CORS! Stripe no hace preflight)
// ===================================================================
exports.stripeWebhookV2 = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET], invoker: "public" },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).send("Method not allowed");
    }

    try {
      const sig = req.headers["stripe-signature"];
      if (!sig) return res.status(400).send("Missing stripe-signature header");

      const Stripe = require("stripe");
      const stripe = new Stripe(STRIPE_SECRET_KEY.value(), {
        apiVersion: "2024-06-20",
      });

      let event;
      try {
        event = stripe.webhooks.constructEvent(
          req.rawBody,
          sig,
          STRIPE_WEBHOOK_SECRET.value()
        );
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
          await db
            .collection("proRequests")
            .doc(requestId)
            .set(
              {
                status: "paid",
                paidAt: admin.firestore.FieldValue.serverTimestamp(),
                amount_total: session.amount_total || null,
                currency: session.currency || null,
                customer_email: session.customer_email || null,
                session_id: session.id,
              },
              { merge: true }
            );
        }
      }

      // Manejá otros event types si necesitás.
      res.json({ received: true });
    } catch (err) {
      console.error("stripeWebhookV2 error:", err);
      res.status(500).send("Internal error");
    }
  }
);
