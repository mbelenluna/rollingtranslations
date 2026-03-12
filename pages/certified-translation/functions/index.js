/**
 * Firebase Cloud Functions for Stripe Checkout
 * Requires: firebase functions:secrets:set STRIPE_SECRET_KEY
 * For email notifications: firebase functions:secrets:set SENDGRID_API_KEY
 * See SETUP-GUIDE.md for full instructions.
 */

const {onRequest} = require('firebase-functions/v2/https');
const {defineSecret} = require('firebase-functions/params');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const stripeSecret = defineSecret('STRIPE_SECRET_KEY');
const sendgridSecret = defineSecret('SENDGRID_API_KEY');

// Hardcoded key for test endpoint (see SETUP-GUIDE); change if needed for security
const TEST_EMAIL_KEY = 'rt-test-email-verify-9x7k2';

const SENDGRID_NO_CLICK_TRACKING = {
  trackingSettings: {clickTracking: {enable: false, enableText: false}},
};

/**
 * Server-side file upload for translation orders.
 * Bypasses client CORS issues. POST multipart/form-data with field "file".
 * Returns { url, name } or { error }.
 */
const Busboy = require('busboy');

function parseMultipart(rawBody, headers) {
  return new Promise((resolve, reject) => {
    const fields = {};
    let fileData = null;
    let pendingFiles = 0;
    const bb = Busboy({headers});
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file', (name, stream, info) => {
      pendingFiles++;
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        fileData = {buffer: Buffer.concat(chunks), filename: info.filename || 'document.pdf'};
        pendingFiles--;
        tryResolve();
      });
    });
    bb.on('error', reject);
    function tryResolve() {
      if (pendingFiles === 0) resolve({fields, fileData});
    }
    bb.on('finish', tryResolve);
    bb.end(rawBody);
  });
}

exports.uploadTranslationFile = onRequest(
  {maxInstances: 10, rawBody: true},
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({error: 'Method not allowed'});
      return;
    }
    const rawBody = req.rawBody || req.body;
    if (!rawBody || rawBody.length === 0) {
      res.status(400).json({error: 'No file received'});
      return;
    }
    try {
      const {fields, fileData} = await parseMultipart(rawBody, req.headers);
      if (!fileData || !fileData.buffer || fileData.buffer.length === 0) {
        res.status(400).json({error: 'No file in request. Send multipart/form-data with field "file".'});
        return;
      }
      const orderTimestamp = fields.orderTimestamp || String(Date.now());
      const safeName = (fileData.filename || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `orders/${orderTimestamp}/${safeName}`;
      const bucket = admin.storage().bucket();
      const file = bucket.file(filePath);
      await file.save(fileData.buffer, {
        metadata: {contentType: 'application/pdf'},
      });
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      });
      res.status(200).json({url, name: safeName});
    } catch (err) {
      console.error('uploadTranslationFile error:', err);
      res.status(500).json({error: err.message || 'Upload failed'});
    }
  }
);

/**
 * Create a Stripe Checkout Session for translation orders.
 * Stores full order in Firestore so webhook can send notification email with all details.
 * POST /api/createCheckoutSession
 * Body: { amount, description, contact, tier, totalPages, files, addons, successUrl, cancelUrl }
 */
exports.createCheckoutSession = onRequest(
  {secrets: [stripeSecret]},
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({error: 'Method not allowed'});
      return;
    }

    const secret = stripeSecret.value();
    if (!secret || secret === '') {
      res.status(500).json({
        error: 'Stripe not configured. Run: firebase functions:secrets:set STRIPE_SECRET_KEY',
      });
      return;
    }

    const Stripe = require('stripe');
    const stripe = new Stripe(secret);

    try {
      const {
        amount,
        description,
        contact,
        tier,
        totalPages,
        files,
        addons,
        sourceLang,
        targetLang,
        successUrl,
        cancelUrl,
      } = req.body;

      if (!amount || amount < 50) {
        res.status(400).json({error: 'Invalid amount (minimum 50 cents)'});
        return;
      }

      const origin = req.get('origin') || req.get('referer') || '';
      const baseUrl = (origin || 'https://immigration-translation-e8a11.web.app').replace(/\/$/, '');
      const success = successUrl || `${baseUrl}?success=1`;
      const cancel = cancelUrl || `${baseUrl}?canceled=1`;

      // Store full order in Firestore for webhook (optional — payment works even if Firestore is disabled)
      let orderId = null;
      let orderRef = null;
      try {
        const db = admin.firestore();
        const orderData = {
          status: 'pending_payment',
          amount: amount,
          description: description || 'Translation Order',
          contact: contact || {},
          tier: tier || 'standard',
          totalPages: totalPages || 0,
          files: Array.isArray(files) ? files : [],
          addons: addons || {},
          sourceLang: sourceLang || '',
          targetLang: targetLang || '',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        orderRef = await db.collection('translationOrders').add(orderData);
        orderId = orderRef.id;
      } catch (firestoreErr) {
        console.warn('Firestore unavailable (enable Cloud Firestore API for full email notifications):', firestoreErr.message);
      }

      const metadata = {
        contactEmail: (contact && contact.email) || '',
        contactName: contact ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim() : '',
        contactPhone: (contact && contact.phone) || '',
        tier: tier || 'standard',
        totalPages: String(totalPages || 0),
        sourceLang: sourceLang || '',
        targetLang: targetLang || '',
      };
      if (orderId) metadata.orderId = orderId;

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: description || 'Translation Order',
                description: `Tier: ${tier || 'standard'} • ${totalPages || 0} pages`,
                metadata: {
                  tier: tier || 'standard',
                  totalPages: String(totalPages || 0),
                  contactEmail: (contact && contact.email) || '',
                },
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: success,
        cancel_url: cancel,
        metadata,
      });

      if (orderRef) {
        try {
          await orderRef.update({stripeSessionId: session.id});
        } catch (e) {
          console.warn('Could not update order with session ID:', e.message);
        }
      }

      res.status(200).json({url: session.url});
    } catch (err) {
      console.error('Stripe createCheckoutSession error:', err);
      res.status(500).json({
        error: err.message || 'Failed to create checkout session',
      });
    }
  }
);

/**
 * Stripe webhook for payment completion.
 * Sends notification email to info@ and connor@ with full project details including file links.
 * Configure in Stripe Dashboard. Requires STRIPE_WEBHOOK_SECRET and SENDGRID_API_KEY.
 */
const webhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');

const NOTIFY_EMAILS = ['info@rolling-translations.com', 'connor@rolling-translations.com'];

exports.stripeWebhook = onRequest(
  {secrets: [webhookSecret, stripeSecret, sendgridSecret], rawBody: true},
  async (req, res) => {
    console.log('stripeWebhook invoked:', req.method, 'hasSignature:', !!req.headers['stripe-signature']);
    const sig = req.headers['stripe-signature'];
    const secret = webhookSecret.value();

    if (!secret || !sig) {
      res.status(400).send('Webhook secret not configured or missing signature');
      return;
    }

    const Stripe = require('stripe');
    const stripe = new Stripe(stripeSecret.value());
    const rawBody = req.rawBody || (req.body ? JSON.stringify(req.body) : '');

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      let orderId = session.metadata?.orderId;
      const amountTotal = typeof session.amount_total === 'number' ? session.amount_total / 100 : null;

      console.log('Payment completed:', session.id, 'orderId from metadata:', orderId);

      const db = admin.firestore();
      let orderData = {};
      let orderRef = null;

      if (orderId) {
        const orderSnap = await db.collection('translationOrders').doc(orderId).get();
        if (orderSnap.exists) {
          orderRef = orderSnap.ref;
          orderData = orderSnap.data() || {};
        }
      }
      // Fallback: look up order by stripeSessionId (in case orderId was missing from metadata)
      if (Object.keys(orderData).length === 0) {
        const bySessionSnap = await db.collection('translationOrders')
          .where('stripeSessionId', '==', session.id)
          .limit(1)
          .get();
        if (!bySessionSnap.empty) {
          const doc = bySessionSnap.docs[0];
          orderRef = doc.ref;
          orderId = doc.id;
          orderData = doc.data() || {};
          console.log('Found order by stripeSessionId:', orderId);
        }
      }

      if (orderRef) {
        try {
          await orderRef.update({
            status: 'paid',
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            amountPaid: amountTotal,
            notificationSentAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (e) {
          console.warn('Could not update order status:', e.message);
        }
      }

      // Build notification email with ALL project details (fallback to session metadata when order not found)
      const contact = orderData.contact || {};
      const contactName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
        session.metadata?.contactName?.trim() || '—';
      const contactEmail = contact.email || session.metadata?.contactEmail || session.customer_details?.email || '—';
      const contactPhone = contact.phone || session.metadata?.contactPhone || '—';
      const tier = orderData.tier || session.metadata?.tier || '—';
      const totalPages = orderData.totalPages ?? session.metadata?.totalPages ?? '—';
      const description = orderData.description || '—';
      const sourceLang = orderData.sourceLang || session.metadata?.sourceLang || '—';
      const targetLang = orderData.targetLang || session.metadata?.targetLang || '—';
      const languagePair = (sourceLang !== '—' || targetLang !== '—') ? `${sourceLang} → ${targetLang}` : '—';
      const addons = orderData.addons || {};
      const notarization = addons.notarization ? 'Yes' : 'No';
      const hardcopy = addons.hardcopy ? 'Yes' : 'No';

      const nf = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'});
      const amountStr = amountTotal != null ? nf.format(amountTotal) : '—';

      let filesHtml = '<p><strong>No files recorded.</strong></p>';
      const files = Array.isArray(orderData.files) ? orderData.files : [];
      if (files.length > 0) {
        filesHtml = files.map((f, i) => {
          const url = f.url ? `<a href="${f.url}" target="_blank" rel="noopener">Download</a>` : '(upload failed)';
          return `<tr><td style="padding:6px 12px;border:1px solid #e2e8f0">${i + 1}</td><td style="padding:6px 12px;border:1px solid #e2e8f0">${f.name || '—'}</td><td style="padding:6px 12px;border:1px solid #e2e8f0">${f.pages ?? '—'}</td><td style="padding:6px 12px;border:1px solid #e2e8f0">${url}</td></tr>`;
        }).join('');
        filesHtml = `<table style="border-collapse:collapse;width:100%;max-width:600px"><thead><tr><th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left">#</th><th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left">File name</th><th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left">Pages</th><th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left">Download</th></tr></thead><tbody>${filesHtml}</tbody></table>`;
      }

      const html = `
<div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Inter;max-width:640px">
  <h2 style="margin:0 0 16px 0;color:#0f172a">New paid translation order</h2>
  <p style="margin:0 0 20px 0;color:#475569">A project was just paid via the translation-calculator page.</p>

  <table style="border-collapse:collapse;width:100%;margin-bottom:20px">
    <tr><td style="padding:8px 0;color:#64748b;width:140px">Order ID</td><td style="padding:8px 0"><b>${orderId || session.id}</b></td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Language pair</td><td style="padding:8px 0">${languagePair}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Amount paid</td><td style="padding:8px 0"><b>${amountStr}</b></td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Description</td><td style="padding:8px 0">${description}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Speed tier</td><td style="padding:8px 0">${tier}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Total pages</td><td style="padding:8px 0">${totalPages}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Notarization</td><td style="padding:8px 0">${notarization}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Hard copy mailing</td><td style="padding:8px 0">${hardcopy}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Client name</td><td style="padding:8px 0">${contactName}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Client email</td><td style="padding:8px 0"><a href="mailto:${contactEmail}">${contactEmail}</a></td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Client phone</td><td style="padding:8px 0">${contactPhone}</td></tr>
  </table>

  <h3 style="margin:20px 0 10px 0;font-size:1rem">Files</h3>
  ${filesHtml}

  <p style="margin:24px 0 0 0;color:#64748b;font-size:13px">— Rolling Translations (translation-calculator)</p>
</div>`;

      const sgKey = sendgridSecret.value();
      if (sgKey && sgKey !== '') {
        const sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(sgKey);
        const msgs = NOTIFY_EMAILS.map((to) => ({
          ...SENDGRID_NO_CLICK_TRACKING,
          to,
          from: {email: 'info@rolling-translations.com', name: 'Rolling Translations'},
          subject: `Paid translation order — ${orderId || session.id} — $${amountTotal != null ? amountTotal.toFixed(2) : '?'}`,
          html,
        }));
        try {
          await sgMail.send(msgs);
          console.log('Notification emails sent to', NOTIFY_EMAILS.join(', '));
        } catch (e) {
          console.error('SendGrid error:', e?.response?.body || e?.message || e);
        }
      } else {
        console.warn('SENDGRID_API_KEY not set — skipping notification email');
      }
    }

    res.status(200).json({received: true});
  }
);

/**
 * Test endpoint to verify SendGrid email delivery.
 * GET /api/testNotificationEmail?key=rt-test-email-verify-9x7k2
 */
exports.testNotificationEmail = onRequest(
  {secrets: [sendgridSecret]},
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method !== 'GET') {
      res.status(405).json({error: 'Method not allowed'});
      return;
    }
    const providedKey = req.query?.key;
    if (providedKey !== TEST_EMAIL_KEY) {
      res.status(401).json({
        error: 'Unauthorized. Use ?key=rt-test-email-verify-9x7k2 (see SETUP-GUIDE)',
      });
      return;
    }
    const sgKey = sendgridSecret.value();
    if (!sgKey || sgKey === '') {
      res.status(500).json({error: 'SENDGRID_API_KEY not set'});
      return;
    }
    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(sgKey);
      await sgMail.send({
        ...SENDGRID_NO_CLICK_TRACKING,
        to: NOTIFY_EMAILS,
        from: {email: 'info@rolling-translations.com', name: 'Rolling Translations'},
        subject: '[TEST] Translation calculator — SendGrid OK',
        html: '<p>This is a test email from the translation-calculator. If you received this, SendGrid is configured correctly.</p>',
      });
      res.status(200).json({ok: true, message: 'Test email sent to ' + NOTIFY_EMAILS.join(', ')});
    } catch (e) {
      console.error('Test email SendGrid error:', e?.response?.body || e?.message || e);
      res.status(500).json({
        error: 'SendGrid failed',
        details: e?.response?.body || e?.message || String(e),
      });
    }
  }
);
