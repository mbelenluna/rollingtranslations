# Rolling Translations

Static site for Rolling Translations LLC — translation services with instant quote and checkout.

## Stack

- **Frontend**: HTML, CSS, JS (static)
- **Contact form**: EmailJS
- **Instant Quote**: Firebase (Auth, Firestore, Storage, Functions), Stripe, SendGrid

## Client Portal (optional)

- **Portal**: `/portal/` — register, login, view projects, settings
- **Admin**: `/admin/` — manage projects, change status, upload deliverables
- **Auth**: Firebase Auth (email/password)
- **Emails**: SendGrid for status-change notifications (when user has notifications enabled)

### Setup

1. **Firebase Functions** — set secrets:
   ```bash
   cd rolling-professional
   firebase functions:secrets:set SENDGRID_API_KEY
   firebase functions:secrets:set STRIPE_SECRET_KEY
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   ```

2. **Admin emails** — create `rolling-professional/functions/.env`:
   ```
   ADMIN_EMAILS=admin@example.com,other@example.com
   ```
   (Copy from `.env.example` if needed.)

3. **Deploy**:
   ```bash
   firebase deploy --only functions
   firebase deploy --only firestore:indexes
   ```

3. **Admin emails**: Comma-separated list in `ADMIN_EMAILS` (Firebase params). Only these users can access `/admin/`.

### Env vars (Firebase)

| Name | Type | Purpose |
|------|------|---------|
| `SENDGRID_API_KEY` | Secret | SendGrid for order/status emails |
| `STRIPE_SECRET_KEY` | Secret | Stripe Checkout |
| `STRIPE_WEBHOOK_SECRET` | Secret | Stripe webhook verification |
| `ADMIN_EMAILS` | Param | Comma-separated admin emails |
| `PORTAL_BASE_URL` | Param | Base URL for portal (e.g. `https://rolling-translations.com/portal`). Used for verification links in emails. Default: `https://rolling-translations.com/portal` |

### Email verification (Client Portal)

New client accounts must verify their email before accessing the portal:

1. **Registration** — Account is created with `emailVerified: false`. A verification email is sent automatically.
2. **Verification link** — User clicks the link in the email, which opens `verify-email.html?token=...`. The token is validated and the account is marked verified.
3. **Login before verification** — Unverified users are redirected to `verification-required.html` with a message and a "Resend verification email" button.
4. **Resend** — Unverified users can request a new verification email from the verification-required page.

**Setup**: No extra env vars required if using the default `PORTAL_BASE_URL`. For local development or custom domains, set `PORTAL_BASE_URL` to match your portal URL (e.g. `http://localhost:8080/portal`).

**Firestore**: A `verificationTokens` collection stores temporary tokens (auto-deleted after use or expiry). Tokens expire after 24 hours.

### Manual tests

See [docs/PORTAL_TESTS.md](docs/PORTAL_TESTS.md).
