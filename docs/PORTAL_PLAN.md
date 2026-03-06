# Client Portal & Admin — Implementation Plan

## 1. Current Stack Summary

### Frontend
- **Static site**: HTML/CSS/JS, hosted on rolling-translations.com (likely Cloudflare/GitHub Pages)
- **Main site**: `index.html`, `script.js`, `style.css` — EmailJS for Contact Us form
- **Instant Quote**: `rolling-professional/professional.html` + `professional.js` (ES module)

### Backend
- **Firebase** (project: `rolling-crowdsourcing`):
  - **Firestore**: `crowdRequests` collection — project/order data
  - **Storage**: `crowd/uploads/{uid}/{timestamp}-{filename}` — original file uploads
  - **Auth**: Anonymous sign-in for uploads (no email/password users yet)
  - **Cloud Functions** (Node 22, us-central1):
    - `getQuoteForFile` — word count from uploaded file
    - `createCheckoutSession` — Stripe Checkout + Firestore doc creation
    - `stripeWebhook` — payment completion → SendGrid confirmation + Firestore update
    - `resendConfirmation` — resend confirmation email
    - `emailOnRequestCreated` — Firestore trigger → SendGrid "request received" email

### professional.html Submission Flow
1. **Preview quote**: Anonymous auth → upload files to Storage → `getQuoteForFile` for word count → show quote
2. **Pay now**: `createCheckoutSession` (POST) with `requestId`, `email`, `fullName`, `totalWords`, `rush`, `certified`, `subject`, `notes`, `pairs`, `successUrl`, `cancelUrl` → Stripe Checkout redirect
3. **After payment**: Stripe webhook → Firestore `status: "paid"` + SendGrid confirmation

### Current crowdRequests Document Fields
- `requestId`, `email`, `fullName`, `sourceLang`, `targetLang`, `pairs`, `subject`, `rush`, `turnaroundLabel`, `certified`, `notes`, `totalWords`, `estimatedTotal`, `rate`, `stripeSessionId`, `checkoutCreatedAt`, `status` (pending_payment → paid)
- After webhook: `paidAt`, `paymentIntentId`, `amountPaid`, `confirmationEmailSentAt`, etc.
- **Missing**: `userId`, `ownerUid`, `originalFiles`, `statusHistory`, `deliverable`, `dueDate`

### SendGrid Usage
- **Config**: `SENDGRID_API_KEY` (Firebase secret)
- **From**: `info@rolling-translations.com`
- **Emails**: (1) Order confirmed (client + internal), (2) Request received (client + internal), (3) Resend confirmation

### File Storage
- **Uploads**: Firebase Storage `crowd/uploads/{uid}/{timestamp}-{filename}` — created during Preview
- **Deliverables**: None yet — to be added at `crowd/deliverables/{requestId}/{filename}`

---

## 2. Chosen Approach

### Auth
- **Firebase Auth** (email/password) — already in project, no new services
- **Users collection** (Firestore): `users/{uid}` — `email`, `notificationsEnabled` (default true), `role` ("user"|"admin"), `createdAt`
- **Session**: Firebase Auth ID token in httpOnly cookie or Authorization header for API calls
- **Admin**: Env var `ADMIN_EMAILS` (comma-separated) — if user email in list, treat as admin

### Database
- **Firestore** — reuse existing
- **Collections**:
  - `users` — new
  - `crowdRequests` — extend with `userId`, `originalFiles`, `statusHistory`, `deliverable`, `dueDate`, `internalNotes`

### Storage
- **Firebase Storage** — reuse
- **Deliverables**: `crowd/deliverables/{requestId}/{filename}` — admin uploads via Cloud Function

### API / Routes
- **Option A**: Firebase Hosting + Cloud Functions (callable/HTTP) for `/portal`, `/admin`, `/api/*`
- **Option B**: Static HTML/JS for portal/admin, call Cloud Functions directly (no server-side routing)
- **Chosen**: Static HTML pages (`portal/index.html`, `portal/login.html`, `admin/index.html`, etc.) + Cloud Functions for API. Portal/admin are client-side apps that call Functions with Firebase Auth token. No new hosting config — pages live alongside existing site.

### Secure Downloads
- **Cloud Function** `getDeliverableDownloadUrl`: accepts `requestId`, verifies user owns project or is admin, returns signed URL (15 min) for deliverable file

---

## 3. Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `SENDGRID_API_KEY` | Firebase Functions | Already exists |
| `STRIPE_SECRET_KEY` | Firebase Functions | Already exists |
| `STRIPE_WEBHOOK_SECRET` | Firebase Functions | Already exists |
| `ADMIN_EMAILS` | Firebase Functions config | Comma-separated admin emails |

---

## 4. Data Model

### users
```
id: string (Firebase uid)
email: string
notificationsEnabled: boolean (default true)
role: "user" | "admin"
createdAt: timestamp
```

### crowdRequests (extended)
```
...existing fields...
userId: string | null        // Firebase uid if logged-in user
clientEmail: string          // alias for email, always set
originalFiles: [{ filename, storagePath, size }]  // from upload
statusHistory: [{ at, from, to, by }]
deliverable: { filename, storagePath, uploadedAt } | null
dueDate: timestamp | null
internalNotes: string | null
```

---

## 5. Implementation Order

1. ✅ docs/PORTAL_PLAN.md (this file)
2. Auth: register, login, logout, session (Firebase Auth + users collection)
3. Data layer: users collection, extend crowdRequests in createCheckoutSession
4. professional.html: guest + logged-in flow, optional portal notice, pass originalFiles
5. Portal pages: dashboard, project detail, settings
6. Admin pages: list, project detail, status update, deliverable upload
7. SendGrid: status-change emails (registered users, respect toggle)
8. Secure deliverable downloads
9. docs/PORTAL_TESTS.md
