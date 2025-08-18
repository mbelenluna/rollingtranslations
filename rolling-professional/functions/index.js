// index.js — Pair-based pricing + multi-target checkout + full endpoints
// ===== Cloud Functions for Firebase v2 (Node.js 22) =====
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

// Admin SDK
const admin = require("firebase-admin");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const xlsx = require("xlsx");
const fileTypeLib = require("file-type");

// ===== Pair-based rate table (English <-> Other) =====
const PAIR_BASE_USD = {
  "english->afrikaans": 0.16,
  "english->albanian": 0.21,
  "english->amharic": 0.19,
  "english->arabic": 0.15,
  "english->armenian": 0.15,
  "english->bengali": 0.19,
  "english->bosnian": 0.30,
  "english->bulgarian": 0.21,
  "english->chinese (simplified)": 0.14,
  "english->chinese (traditional)": 0.14,
  "english->czech": 0.21,
  "english->danish": 0.21,
  "english->dari": 0.16,
  "english->dutch": 0.19,
  "english->estonian": 0.21,
  "english->farsi": 0.15,
  "english->finnish": 0.21,
  "english->french": 0.15,
  "english->french creole": 0.16,
  "english->greek": 0.21,
  "english->gujarati": 0.19,
  "english->hebrew": 0.19,
  "english->hindi": 0.15,
  "english->hmong": 0.30,
  "english->hokkien": 0.21,
  "english->indonesian": 0.15,
  "english->italian": 0.15,
  "english->japanese": 0.16,
  "english->korean": 0.15,
  "english->lao": 0.19,
  "english->latvian": 0.30,
  "english->lithuanian": 0.21,
  "english->malay": 0.19,
  "english->mongolian": 0.21,
  "english->nepali": 0.21,
  "english->norwegian": 0.19,
  "english->pashto": 0.15,
  "english->polish": 0.14,
  "english->portuguese (brazil)": 0.12,
  "english->portuguese (portugal)": 0.12,
  "english->punjabi": 0.16,
  "english->romanian": 0.22,
  "english->russian": 0.15,
  "english->slovak": 0.19,
  "english->slovene": 0.19,
  "english->somali": 0.19,
  "english->spanish (latam)": 0.12,
  "english->spanish (spain)": 0.12,
  "english->swahili": 0.19,
  "english->swedish": 0.19,
  "english->tagalog": 0.14,
  "english->telugu": 0.19,
  "english->thai": 0.15,
  "english->turkish": 0.19,
  "english->ukrainian": 0.16,
  "english->urdu": 0.16,
  "english->vietnamese": 0.15,
  "english->zomi": 0.30,
  "english->zulu": 0.30
};

function normalizeLangName(s) {
  if (!s) return "";
  s = String(s).trim().toLowerCase().replace(/\s+/g, ' ');
  const aliases = {
    'eenglish':'english','englisn':'english',
    'gurajati':'gujarati',
    'gebrew':'hebrew',
    'noewegian':'norwegian',
    'malaysian':'malay',
    'farsi':'farsi','persian':'farsi',
    'simplified chinese':'chinese (simplified)',
    'traditional chinese':'chinese (traditional)',
    'haitian creole':'french creole'
  };
  return aliases[s] || s;
}

function pairBaseRateUSD(sourceLang, targetLang) {
  const src = normalizeLangName(sourceLang);
  const tgt = normalizeLangName(targetLang);
  if (src === 'english' && tgt !== 'english') {
    const base = PAIR_BASE_USD[`english->${tgt}`];
    return base != null ? Number(base) : null;
  } else if (tgt === 'english' && src !== 'english') {
    const base = PAIR_BASE_USD[`english->${src}`];
    return base != null ? Number(base) + 0.02 : null; // reverse direction +$0.02
  }
  return null; // non-English↔non-English not supported
}

// ===== Global options & init =====
setGlobalOptions({ region: "us-central1" });

if (!admin.apps.length) {
  admin.initializeApp({
    storageBucket: "rolling-crowdsourcing.firebasestorage.app",
  });
}
const bucket = admin.storage().bucket();

// ===== Parameters / Secrets =====
const Stripe = require("stripe");
const sgMail = require("@sendgrid/mail");
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

const CHECKOUT_ORIGIN =
  process.env.checkout_origin ||
  process.env.CHECKOUT_ORIGIN ||
  "https://mbelenluna.github.io/rolling-portal";

// Allowed CORS origins for your frontend(s)
const ALLOWED_ORIGINS = [
  "https://mbelenluna.github.io",
  "https://mbelenluna.github.io/rolling-portal",
  "https://rolling-translations.com",
  "https://www.rolling-translations.com",
];

// ===== Helpers: quoting / parsing =====
const MIN_TOTAL_USD = 1.0;

// Legacy (fallback) — not used for supported pairs
function rateForWords(words) { return 0.10; }

function computeAmountCentsForPair(totalWords, rush, certified, subject, sourceLang, targetLang) {
  const w = Number(totalWords || 0);
  let rate = pairBaseRateUSD(sourceLang, targetLang);
  if (rate == null) {
    return { rate: null, amountUsd: 0, amountCents: 0, unsupported: true };
  }
  let totalUsd = w * Number(rate);

  switch ((subject || "").toLowerCase()) {
    case 'technical':
    case 'marketing':
      totalUsd *= 1.20; break;
    case 'legal':
    case 'medical':
      totalUsd *= 1.25; break;
    default: break;
  }

  switch (rush) {
    case '2bd': totalUsd *= 1.20; break;
    case 'h24': totalUsd *= 1.40; break;
    default: break;
  }

  if (certified === 'true' || certified === true) totalUsd *= 1.10;

  totalUsd = Math.max(totalUsd, MIN_TOTAL_USD);
  return { rate, amountUsd: totalUsd, amountCents: Math.round(totalUsd * 100) };
}

// Multi: suma por cada par
function computeAmountCentsMulti(totalWords, rush, certified, subject, pairs, fallbackSingle) {
  if (Array.isArray(pairs) && pairs.length > 0) {
    let sum = 0;
    for (const p of pairs) {
      const one = computeAmountCentsForPair(
        totalWords, rush, certified, subject, p.sourceLang, p.targetLang
      );
      if (one.unsupported) return { amountCents: 0, unsupported: true };
      sum += one.amountCents;
    }
    return { amountCents: sum, unsupported: false };
  }
  // Fallback a par único (compatibilidad)
  const { sourceLang, targetLang } = fallbackSingle || {};
  const out = computeAmountCentsForPair(totalWords, rush, certified, subject, sourceLang, targetLang);
  return { amountCents: out.amountCents, unsupported: !!out.unsupported };
}

// Simple word counter (safe without unicode props)
function countWordsGeneric(text) {
  if (!text) return 0;
  const cleaned = String(text).replace(/[^A-Za-z0-9’'-]+/g, " ");
  const parts = cleaned.trim().split(/\s+/);
  return parts[0] === "" ? 0 : parts.length;
}

async function fileTypeFromBufferSafe(buf) {
  try { return await fileTypeLib.fileTypeFromBuffer(buf); }
  catch { return null; }
}

async function extractTextFromBuffer(buf, filename) {
  const ft = await fileTypeFromBufferSafe(buf);
  const mime = ft && ft.mime ? ft.mime : "";
  const ext = (filename.split(".").pop() || "").toLowerCase();

  // Text-like
  if (mime.startsWith("text/") || ["txt", "csv", "srt", "vtt", "md", "html", "json"].includes(ext)) {
    let text = buf.toString("utf8");
    if (ext === "json") {
      try { text = JSON.stringify(JSON.parse(text)); } catch { }
    }
    if (ext === "srt" || ext === "vtt") {
      text = text.replace(/\d{2}:\d{2}:\d{2}[,\.]\d{3} --> .+\n/g, " ");
    }
    return text;
  }

  // PDF
  if (mime === "application/pdf" || ext === "pdf") {
    const data = await pdfParse(buf);
    return data.text || "";
  }

  // DOCX
  if (ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const res = await mammoth.extractRawText({ buffer: buf });
    return (res && res.value) || "";
  }

  // XLS/XLSX
  if (
    ["xlsx", "xls"].includes(ext) ||
    (mime && (mime.includes("spreadsheetml") || mime.includes("ms-excel")))
  ) {
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

  // Legacy .doc → ignore text
  if (ext === "doc") return "";

  // Fallback
  return buf.toString("utf8");
}

// ===== 1) Auto-quote HTTP (CORS) =====
exports.getQuoteForFile = onRequest(
  {
    cors: ALLOWED_ORIGINS,
    region: "us-central1",
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        return res.status(405).send("Method Not Allowed");
      }

      const { gsPath, uid } = req.body || {};
      if (!gsPath) return res.status(400).send("Missing gsPath.");
      
      // Validate path to user-owned uploads
      if (!uid || !gsPath.startsWith(`crowd/uploads/${uid}/`)) {
        return res.status(403).send("Forbidden path.");
      }

      const file = bucket.file(gsPath);
      const [buf] = await file.download();

      const text = await extractTextFromBuffer(buf, gsPath);
      let words = countWordsGeneric(text);

      // Heuristic: scanned PDF (no visible text)
      const scanned = words < 10 && gsPath.toLowerCase().endsWith(".pdf");
      if (scanned) {
        return res.json({
          words: 0,
          scanned: true,
          rate: null,
          total: null,
          note: "Likely scanned PDF (requires OCR)."
        });
      }

      const rate = rateForWords(words);
      const total = Math.round(Math.max(words * rate, MIN_TOTAL_USD) * 100) / 100;

      return res.json({ words, rate, total, currency: "USD" });
    } catch (err) {
      logger.error("getQuoteForFile error", err);
      return res.status(500).send(err.message || "Internal Server Error");
    }
  }
);

// ===== 2) Stripe Checkout session creator (multi-target) =====
exports.createCheckoutSession = onRequest(
  {
    cors: ALLOWED_ORIGINS,
    region: "us-central1",
    secrets: [STRIPE_SECRET_KEY],
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

      const stripeSecret = STRIPE_SECRET_KEY.value();
      if (!stripeSecret) {
        return res.status(500).json({ error: "Stripe secret key not configured" });
      }
      const stripe = new Stripe(stripeSecret, { apiVersion: "2024-06-20" });

      let {
        requestId, totalWords = 0, email, description,
        rush, certified, subject,
        sourceLang, targetLang,   // compat (single)
        pairs,                    // [{sourceLang, targetLang}, ...] (multi)
        successUrl, cancelUrl     // optional overrides
      } = req.body || {};
      if (!requestId) return res.status(400).json({ error: "Missing requestId" });

      // Optionally cross-check Firestore
      let wordsServer = Number(totalWords || 0);
      try {
        const snap = await admin.firestore().collection("crowdRequests").doc(requestId).get();
        if (snap.exists) {
          const d = snap.data() || {};
          if (Number(d.totalWords) > 0) wordsServer = Number(d.totalWords);
          else if (Number(d.estWords) > 0) wordsServer = Number(d.estWords);
        }
      } catch (_) { /* ignore */ }

      const { amountCents, unsupported } = computeAmountCentsMulti(
        wordsServer, rush, certified, subject, pairs, { sourceLang, targetLang }
      );

      if (unsupported) {
        return res.status(400).json({ error: "Unsupported language pair(s)." });
      }
      if (!(amountCents > 0)) {
        return res.status(400).json({ error: "Invalid amount computed." });
      }

      const origin = (process.env.checkout_origin || process.env.CHECKOUT_ORIGIN || CHECKOUT_ORIGIN).replace(/\/+$/, '');
      const success_url = successUrl || `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}&requestId=${encodeURIComponent(requestId)}`;
      const cancel_url  = cancelUrl  || `${origin}/cancel.html?requestId=${encodeURIComponent(requestId)}`;

      const name = description || "Professional translation";

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: email || undefined,
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name, description: `Total words: ${wordsServer}` },
            unit_amount: amountCents,
          },
          quantity: 1,
        }],
        success_url,
        cancel_url,
        payment_intent_data: {
          description: `${name} — ${wordsServer} words`,
          metadata: {
            requestId,
            totalWords: String(wordsServer),
            rush: String(rush || "standard"),
            certified: String(certified === "true" || certified === true),
            subject: String(subject || "general"),
            pairs: Array.isArray(pairs) ? JSON.stringify(pairs) : JSON.stringify([{ sourceLang, targetLang }])
          }
        },
        metadata: {
          requestId,
          totalWords: String(wordsServer),
          pairs: Array.isArray(pairs) ? JSON.stringify(pairs) : JSON.stringify([{ sourceLang, targetLang }])
        }
      });

      await admin.firestore().collection("crowdRequests").doc(requestId).set({
        stripeSessionId: session.id,
        stripeMode: "payment",
        checkoutCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: "pending_payment",
        totalWords: wordsServer
      }, { merge: true });

      return res.json({ url: session.url });
    } catch (err) {
      logger.error("createCheckoutSession error", err);
      return res.status(500).json({ error: err?.message || "Server error" });
    }
  }
);

// ===== 3) Stripe Webhook (verifies signature) =====
exports.stripeWebhook = onRequest(
  {
    region: "us-central1",
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SENDGRID_API_KEY],
  },
  async (req, res) => {
    try {
      const stripeSecret = STRIPE_SECRET_KEY.value();
      const webhookSecret = STRIPE_WEBHOOK_SECRET.value();
      if (!stripeSecret || !webhookSecret) {
        logger.error("Missing Stripe secrets");
        return res.status(500).send("Secrets not configured");
      }
      const stripe = new Stripe(stripeSecret, { apiVersion: "2024-06-20" });

      const sig = req.headers["stripe-signature"];
      let event;

      try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
      } catch (err) {
        logger.error("Webhook signature verification failed", err);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const paymentIntentId = session.payment_intent;
        const requestId = session.metadata && session.metadata.requestId;
        const totalWords = session.metadata && Number(session.metadata.totalWords || 0);
        const amountTotal = typeof session.amount_total === "number" ? session.amount_total : null;

        if (!requestId) {
          logger.warn("checkout.session.completed without requestId in metadata");
        } else {
          try {
            await admin.firestore().collection("crowdRequests").doc(requestId).set({
              status: "paid",
              paidAt: admin.firestore.FieldValue.serverTimestamp(),
              paymentIntentId: paymentIntentId || null,
              amountPaid: amountTotal != null ? amountTotal / 100 : null,
            }, { merge: true });
          } catch (e) {
            logger.error("Failed to update Firestore on payment", e);
          }

          // ==== Send emails with SendGrid ====
          try {
            sgMail.setApiKey(SENDGRID_API_KEY.value());

            // Retrieve doc for more details
            let docData = {};
            try {
              const snap = await admin.firestore().collection("crowdRequests").doc(requestId).get();
              if (snap.exists) docData = snap.data() || {};
            } catch (_) { }

            const clientEmail = docData.email || session.customer_details?.email || "";
            const clientName = docData.fullName || docData.fullname || "Client";
            const sourceLang = docData.sourceLang || "—";
            const targetLang = docData.targetLang || "—";
            const nf = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
            const amountStr = amountTotal != null ? nf.format(amountTotal / 100) : "—";

            const html = `
              <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Inter;">
                <h2 style="margin:0 0 8px 0;">Your order is confirmed ✅</h2>
                <p style="margin:0 0 14px 0;">Thank you for choosing <b>Rolling Translations</b>!</p>
                <table style="border-collapse:collapse;width:100%;max-width:560px">
                  <tr><td style="padding:8px 0;color:#64748b">Order ID</td><td style="padding:8px 0"><b>${requestId}</b></td></tr>
                  <tr><td style="padding:8px 0;color:#64748b">Languages</td><td style="padding:8px 0">${sourceLang} → ${targetLang}</td></tr>
                  <tr><td style="padding:8px 0;color:#64748b">Total words</td><td style="padding:8px 0">${Number.isFinite(totalWords) ? totalWords : (docData.totalWords ?? docData.estWords ?? "—")}</td></tr>
                  <tr><td style="padding:8px 0;color:#64748b">Amount paid</td><td style="padding:8px 0"><b>${amountStr}</b></td></tr>
                </table>
                <p style="margin:16px 0 8px 0;">
                  We’ll start processing your request and email you with updates shortly.
                </p>
                <p style="margin:0 0 14px 0;">
                  Questions? <a href="mailto:info@rolling-translations.com">info@rolling-translations.com</a>.
                </p>
                <p style="margin:18px 0 0 0;color:#64748b;font-size:13px">— Rolling Translations</p>
              </div>
            `;

            const msgs = [];
            if (clientEmail) {
              msgs.push({
                to: clientEmail,
                from: { email: "info@rolling-translations.com", name: "Rolling Translations" },
                subject: `Order ${requestId} confirmed — Rolling Translations`,
                html,
              });
            }
            // Internal copy
            msgs.push({
              to: "info@rolling-translations.com",
              from: { email: "info@rolling-translations.com", name: "Rolling Translations" },
              subject: `New paid order — ${requestId}`,
              html,
            });

            if (msgs.length) await sgMail.send(msgs);
          } catch (mailErr) {
            logger.error("SendGrid send failed", mailErr?.response?.body || mailErr?.message || mailErr);
          }
        }
      }

      res.json({ received: true });
    } catch (err) {
      logger.error("stripeWebhook error", err);
      return res.status(500).send("Webhook handler error");
    }
  }
);

// ===== 4) Firestore trigger: email on new request (pre-payment receipt) =====
exports.emailOnRequestCreated = onDocumentCreated(
  {
    document: "crowdRequests/{requestId}",
    region: "us-central1",
    secrets: [SENDGRID_API_KEY],
  },
  async (event) => {
    const data = event.data?.data() || {};
    const requestId = event.params.requestId;

    try {
      const clientEmail = data.email || data.clientEmail || "";
      const clientName = data.fullName || data.fullname || "Client";
      const sourceLang = data.sourceLang || "—";
      const targetLang = data.targetLang || "—";
      const totalWords = Number(data.totalWords ?? data.estWords ?? data.words ?? 0);
      const rate = Number(data.rate ?? 0);
      const estTotal = typeof data.estimatedTotal === "number" ? Number(data.estimatedTotal) : null;

      const nf = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
      const amountStr = estTotal != null ? nf.format(estTotal) : "—";
      const rateStr = rate ? `$${rate.toFixed(2)}/word` : "—";

      const htmlClient = `
        <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Inter;">
          <h2 style="margin:0 0 10px 0;">We received your request ✅</h2>
          <p style="margin:0 0 12px 0;">Hi ${clientName}, thanks for choosing <b>Rolling Translations</b>!</p>
          <table style="border-collapse:collapse;width:100%;max-width:560px">
            <tr><td style="padding:6px 0;color:#64748b">Order ID</td><td style="padding:6px 0"><b>${requestId}</b></td></tr>
            <tr><td style="padding:6px 0;color:#64748b">Languages</td><td style="padding:6px 0">${sourceLang} → ${targetLang}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b">Total words</td><td style="padding:6px 0">${totalWords || "—"}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b">Rate</td><td style="padding:6px 0">${rateStr}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b">Estimate</td><td style="padding:6px 0"><b>${amountStr}</b></td></tr>
          </table>
          <p style="margin:14px 0 0 0;">To complete your order, please finish the payment you just started. We'll email you once it's confirmed.</p>
          <p style="margin:14px 0 0 0;">Questions? <a href="mailto:info@rolling-translations.com">info@rolling-translations.com</a>.</p>
          <p style="margin:18px 0 0 0;color:#64748b;font-size:13px">— Rolling Translations</p>
        </div>
      `;

      const htmlInternal = `
        <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Inter;">
          <h3 style="margin:0 0 10px 0;">New crowdsourcing request</h3>
          <table style="border-collapse:collapse;width:100%;max-width:560px">
            <tr><td style="padding:6px 0;color:#64748b">Order ID</td><td style="padding:6px 0"><b>${requestId}</b></td></tr>
            <tr><td style="padding:6px 0;color:#64748b">Client</td><td style="padding:6px 0">${clientName} &lt;${clientEmail || "—"}&gt;</td></tr>
            <tr><td style="padding:6px 0;color:#64748b">Languages</td><td style="padding:6px 0">${sourceLang} → ${targetLang}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b">Words</td><td style="padding:6px 0">${totalWords || "—"}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b">Rate</td><td style="padding:6px 0">${rateStr}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b">Estimate</td><td style="padding:6px 0"><b>${amountStr}</b></td></tr>
          </table>
        </div>
      `;

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
      logger.info("Emails sent for new request", { requestId });
    } catch (err) {
      logger.error("emailOnRequestCreated error", err?.response?.body || err?.message || err);
    }
  }
);
