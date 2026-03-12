# Stripe + Firebase Setup Guide

This guide explains how to configure the Pay Now with Stripe button for the certified translation calculator.

## Prerequisites

- Firebase CLI installed (`npm install -g firebase-tools`)
- A Stripe account ([dashboard.stripe.com](https://dashboard.stripe.com))
- Firebase project: `rolling-translations-personal` (from `.firebaserc`)

---

## Step 1: Get Your Stripe Secret Key

1. Go to [Stripe Dashboard → Developers → API keys](https://dashboard.stripe.com/apikeys)
2. Copy your **Secret key** (starts with `sk_test_` for test mode, `sk_live_` for production)
3. **Never** commit this key to git or expose it in frontend code

---

## Step 2: Set the Secret in Firebase

From the `pages/certified-translation` folder, run:

```bash
cd pages/certified-translation
firebase functions:secrets:set STRIPE_SECRET_KEY
```

When prompted, paste your Stripe secret key.

---

## Step 3: Deploy the Cloud Functions

```bash
firebase deploy --only functions
```

After deployment, copy the **Function URL** from the output (e.g. `https://createcheckoutsession-xxxxx-uc.a.run.app`) and update `checkoutEndpoint` in `translation-calculator.html` if it changed.

## Step 3b: Allow Public Access (REQUIRED — fixes "Cannot reach the payment server")

The Cloud Run service blocks unauthenticated requests by default. You **must** allow public access:

**Option A — Run these commands (recommended):**

```bash
# Required for checkout to work from the browser
gcloud run services add-iam-policy-binding createcheckoutsession --region=us-central1 --member="allUsers" --role="roles/run.invoker" --project=rolling-translations-personal

# Required for file uploads (Pay with Stripe flow)
gcloud run services add-iam-policy-binding uploadtranslationfile --region=us-central1 --member="allUsers" --role="roles/run.invoker" --project=rolling-translations-personal

# Required for Stripe webhooks (email notifications) to work
gcloud run services add-iam-policy-binding stripewebhook --region=us-central1 --member="allUsers" --role="roles/run.invoker" --project=rolling-translations-personal

# Optional: for the test email endpoint
gcloud run services add-iam-policy-binding testnotificationemail --region=us-central1 --member="allUsers" --role="roles/run.invoker" --project=rolling-translations-personal
```

If `gcloud` is not installed: [Install Google Cloud SDK](https://cloud.google.com/sdk/docs/install), then run `gcloud auth login` and `gcloud config set project rolling-translations-personal`.

**Option B — Via Cloud Console:**

1. Go to [Google Cloud Console → Cloud Run](https://console.cloud.google.com/run?project=rolling-translations-personal)
2. For each service (**createcheckoutsession**, **stripewebhook**, **testnotificationemail**):
   - Click the service name
   - Go to **Permissions** tab → **Add principal**
   - New principals: `allUsers`
   - Role: **Cloud Run Invoker**
   - Save

---

## Step 4: Test the Integration

1. Open `translation-calculator.html` in your browser (via Live Server or by deploying to Firebase Hosting)
2. Fill in contact info, upload a file, select a tier
3. Click **Pay Now with Stripe**
4. You should be redirected to Stripe Checkout

Use Stripe test cards for testing:
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- [More test cards](https://stripe.com/docs/testing#cards)

---

## Optional: Deploy to Firebase Hosting

To serve the calculator from Firebase (e.g. `https://rolling-translations-personal.web.app`):

1. Copy `translation-calculator.html` into the `public` folder
2. Run: `firebase deploy --only hosting`
3. Update `checkoutEndpoint` in `translation-calculator.html` to:
   ```
   https://rolling-translations-personal.web.app/api/createCheckoutSession
   ```
   File uploads use the same origin (`/api/uploadTranslationFile`) automatically when the page is served from Hosting.

---

## Optional: Stripe Webhook + Email Notifications

When a project is paid, the webhook sends an email to **info@rolling-translations.com** and **connor@rolling-translations.com** with all project details including file download links.

1. In Stripe Dashboard → Developers → Webhooks, add endpoint:
   - **URL (use one of these):**
     - Cloud Run (recommended): `https://stripewebhook-tumjzeybyq-uc.a.run.app` — get the exact URL from `firebase functions:list` or Cloud Console after deploy
     - Or: `https://us-central1-rolling-translations-personal.cloudfunctions.net/stripeWebhook`
   - **Events:** `checkout.session.completed`

2. Copy the **Signing secret** (starts with `whsec_`)

3. Set secrets in Firebase:
   ```bash
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   firebase functions:secrets:set SENDGRID_API_KEY
   ```
   For SENDGRID_API_KEY, use your SendGrid API key from [SendGrid Dashboard → API Keys](https://app.sendgrid.com/settings/api_keys).

4. Redeploy: `firebase deploy --only functions`

The webhook stores orders in Firestore (`translationOrders` collection) and sends a notification email with: order ID, amount paid, client name/email/phone, tier, total pages, add-ons, and **download links for each uploaded file**.

**Important:** For the notification email to include **client name, phone, and file download links**, you **must** enable Firestore. Without it, orders are not stored and the email will show dashes for contact info and "No files recorded."
1. Enable the Cloud Firestore API: [Enable for rolling-translations-personal](https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=rolling-translations-personal)
2. Redeploy: `firebase deploy --only functions`

**Files:** PDFs are uploaded via the server (`/api/uploadTranslationFile`) and stored in Firebase Storage (`orders/{timestamp}/{filename}`). The webhook includes download links in the email. If the calculator is served from a different domain than your Firebase Hosting, set `uploadEndpoint` in `translation-calculator.html` to `https://rolling-translations-personal.web.app/api/uploadTranslationFile`.

### Test email delivery (without completing a payment)

To verify SendGrid works without going through Stripe checkout:

1. Redeploy: `firebase deploy --only functions`
2. Allow public access for the test endpoint (see Step 3b above — `testnotificationemail` service)
3. Open in browser or curl:
   ```
   https://rolling-translations-personal.web.app/api/testNotificationEmail?key=rt-test-email-verify-9x7k2
   ```
   Or use the Cloud Run URL from `firebase functions:list`.

If successful, you'll receive a test email at info@ and connor@. If it fails, the response will show the SendGrid error.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Stripe not configured" | Run `firebase functions:secrets:set STRIPE_SECRET_KEY` and redeploy |
| CORS error on Cloud Function | Ensure `cors: true` is set in the function (already done) |
| CORS error on Storage (localhost) | The app now falls back to file names only when upload fails. To enable uploads from localhost, configure CORS on your Storage bucket (see below). |
| 404 on fetch | Verify the function is deployed: `firebase functions:list` |
| Wrong redirect after payment | Check `successUrl` and `cancelUrl` in the request |
| **No email after payment** | See "Webhook & email troubleshooting" below |
| **Webhook returns 403** | Run the `stripewebhook` IAM command in Step 3b so Stripe can POST to the endpoint |

### Webhook & email troubleshooting

If you complete a payment but never receive the notification email:

1. **Verify Stripe webhook is configured** — Stripe Dashboard → Developers → Webhooks. The endpoint must listen for `checkout.session.completed` and use the correct URL (Cloud Run or cloudfunctions.net).
2. **Allow public access for stripewebhook** — Cloud Run blocks unauthenticated requests by default. Run:
   ```bash
   gcloud run services add-iam-policy-binding stripewebhook --region=us-central1 --member="allUsers" --role="roles/run.invoker" --project=rolling-translations-personal
   ```
3. **Check Stripe webhook logs** — Stripe Dashboard → Developers → Webhooks → your endpoint → "Recent deliveries". Failed attempts show the HTTP status (e.g. 403 = access denied).
4. **Verify SendGrid** — Use the test endpoint: `/api/testNotificationEmail?key=rt-test-email-verify-9x7k2`. If that fails, SENDGRID_API_KEY may be wrong or the sender (info@rolling-translations.com) may not be verified in SendGrid.
5. **Check function logs** — `firebase functions:log --only stripeWebhook` to see "Payment completed" and "Notification emails sent" or any SendGrid errors.

### Enable Storage uploads from localhost (optional)

If you want file uploads to work when testing from `http://127.0.0.1:5500`, create `cors.json`:

```json
[{"origin": ["http://127.0.0.1:5500", "http://localhost:5500"], "method": ["GET", "POST", "PUT", "DELETE", "OPTIONS"], "responseHeader": ["Content-Type", "Authorization", "x-goog-resumable", "x-goog-meta-*"], "maxAgeSeconds": 3600}]
```

Then run (requires `gsutil`, part of Google Cloud SDK):

```bash
gsutil cors set cors.json gs://rolling-translations-personal.firebasestorage.app
```

---

## Firebase Blaze Plan Required

Cloud Functions require the **Blaze (pay-as-you-go)** plan. You will not be charged unless you exceed the free tier. See [Firebase pricing](https://firebase.google.com/pricing).
