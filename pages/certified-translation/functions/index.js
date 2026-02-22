/**
 * Firebase Functions entrypoint
 * Uses v2 onRequest with invoker:"public" to bypass org IAM restrictions
 */

const {onRequest} = require("firebase-functions/v2/https");
const cors = require("cors")({origin: true});
const Stripe = require("stripe");
const nodemailer = require("nodemailer");
const {defineSecret} = require("firebase-functions/params");

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const EMAIL_USER = defineSecret("EMAIL_USER");
const EMAIL_PASS = defineSecret("EMAIL_PASS");

exports.health = onRequest({invoker: "public"}, (req, res) => {
  res.status(200).send("OK");
});

exports.createCheckoutSession = onRequest(
  {secrets: [STRIPE_SECRET_KEY], invoker: "public"},
  (req, res) => {
    cors(req, res, async () => {
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }

      if (req.method !== "POST") {
        res.status(405).json({error: "Method not allowed"});
        return;
      }

      try {
        const stripe = new Stripe(STRIPE_SECRET_KEY.value(), {
          apiVersion: "2024-06-20",
        });

        const body = req.body || {};
        const amount = body.amount;
        const description = body.description || "Translation order";
        const contact = body.contact || {};
        const tier = body.tier || "";
        const totalPages = body.totalPages || 0;
        const files = Array.isArray(body.files) ? body.files : [];
        const addons = body.addons || {};

        if (!Number.isInteger(amount) || amount <= 0) {
          res.status(400).json({error: "Invalid amount"});
          return;
        }

        if (!contact.email) {
          res.status(400).json({error: "Missing contact.email"});
          return;
        }

        const metadata = {
          clientName: `${contact.firstName || ""} ${contact.lastName || ""}`.trim(),
          clientEmail: String(contact.email || ""),
          clientPhone: String(contact.phone || ""),
          tier: String(tier),
          totalPages: String(totalPages),
          fileCount: String(files.length),
          notarization: String(Boolean(addons.notarization)),
          hardcopy: String(Boolean(addons.hardcopy)),
          fileDetails: JSON.stringify(files).slice(0, 4500),
        };

        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          payment_method_types: ["card"],
          customer_email: contact.email,
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {name: description},
                unit_amount: amount,
              },
              quantity: 1,
            },
          ],
          success_url: "https://rolling-translations.com/thank-you?session_id={CHECKOUT_SESSION_ID}",
          cancel_url: "https://rolling-translations.com/quote",
          metadata,
        });

        res.status(200).json({url: session.url});
      } catch (err) {
        console.error("createCheckoutSession error", err);
        res.status(500).json({error: "Internal error"});
      }
    });
  },
);

exports.stripeWebhook = onRequest(
  {
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, EMAIL_USER, EMAIL_PASS],
    invoker: "public",
  },
  async (req, res) => {
    try {
      const stripe = new Stripe(STRIPE_SECRET_KEY.value(), {
        apiVersion: "2024-06-20",
      });

      const sig = req.headers["stripe-signature"];
      if (!sig) {
        res.status(400).send("Missing stripe-signature");
        return;
      }

      const event = stripe.webhooks.constructEvent(
        req.rawBody, sig, STRIPE_WEBHOOK_SECRET.value(),
      );

      if (event.type !== "checkout.session.completed") {
        res.status(200).send("Ignored");
        return;
      }

      const session = event.data.object;
      const md = session.metadata || {};

      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user: EMAIL_USER.value(),
          pass: EMAIL_PASS.value(),
        },
      });

      let files = [];
      try {
        files = JSON.parse(md.fileDetails || "[]");
        if (!Array.isArray(files)) files = [];
      } catch (e) {
        files = [];
      }

      const fileRows = files.map((f) => {
        const name = String(f.name || "");
        const pages = String(f.pages || "");
        const url = String(f.url || "");
        return `<tr><td style="padding:6px 10px;border:1px solid #ddd;">${name}</td><td style="padding:6px 10px;border:1px solid #ddd;">${pages}</td><td style="padding:6px 10px;border:1px solid #ddd;"><a href="${url}">Download</a></td></tr>`;
      }).join("");

      const clientName = md.clientName || "";
      const tier = md.tier || "";
      const totalPages = md.totalPages || "";
      const amountPaid = (session.amount_total || 0) / 100;

      const html = `
        <div style="font-family:Arial,sans-serif;">
          <h2>New Paid Order</h2>
          <p><strong>Client:</strong> ${clientName}</p>
          <p><strong>Email:</strong> ${md.clientEmail || ""}</p>
          <p><strong>Phone:</strong> ${md.clientPhone || ""}</p>
          <p><strong>Tier:</strong> ${tier}</p>
          <p><strong>Total pages:</strong> ${totalPages}</p>
          <p><strong>Add-ons:</strong> Notarization=${md.notarization}, Hardcopy=${md.hardcopy}</p>
          <p><strong>Amount paid:</strong> $${amountPaid.toFixed(2)}</p>
          <h3>Files</h3>
          <table style="border-collapse:collapse;">
            <thead>
              <tr>
                <th style="padding:6px 10px;border:1px solid #ddd;">File</th>
                <th style="padding:6px 10px;border:1px solid #ddd;">Pages</th>
                <th style="padding:6px 10px;border:1px solid #ddd;">Link</th>
              </tr>
            </thead>
            <tbody>
              ${fileRows || "<tr><td colspan='3' style='padding:6px 10px;border:1px solid #ddd;'>No files listed</td></tr>"}
            </tbody>
          </table>
        </div>
      `;

      await transporter.sendMail({
        from: EMAIL_USER.value(),
        to: [
          "info@rolling-translations.com",
          "connor@rolling-translations.com",
        ],
        subject: `Paid order: ${clientName} | ${tier} | ${totalPages} pages | $${amountPaid.toFixed(2)}`,
        html,
      });

      res.status(200).send("OK");
    } catch (err) {
      console.error("stripeWebhook error", err);
      res.status(400).send(`Webhook error: ${err.message}`);
    }
  },
);
