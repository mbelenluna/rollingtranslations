# Client Portal — Manual Test Checklist

## Prerequisites

- Set `ADMIN_EMAILS` in Firebase Functions config (comma-separated admin emails)
- Deploy functions: `cd rolling-professional && firebase deploy --only functions`
- Deploy Firestore indexes: `firebase deploy --only firestore:indexes`

## 1. Guest submission (unchanged behavior)

- [ ] Open `/rolling-professional/professional.html`
- [ ] Do NOT log in to the portal
- [ ] Fill form, add files, click Preview quote
- [ ] Click Pay now, complete Stripe payment
- [ ] Verify order appears in Firestore `crowdRequests` with `userId: null`
- [ ] Verify confirmation email received (SendGrid)
- [ ] Verify no Client Portal link in email (guest has no portal access)

## 2. Optional portal notice

- [ ] On professional.html, after Preview quote, verify blue notice appears:
  - "Want to track your request in our Client Portal... Please register and log in before ordering. (Optional)"
- [ ] Notice links to `../portal/`

## 3. Registration & login

- [ ] Open `/portal/`
- [ ] Click Register tab
- [ ] Enter email + password (min 6 chars), submit
- [ ] Verify redirect to dashboard
- [ ] Log out
- [ ] Log in with same credentials
- [ ] Verify redirect to dashboard

## 4. Logged-in submission

- [ ] Log in to portal first
- [ ] Open `/rolling-professional/professional.html` (same browser)
- [ ] Fill form, add files, Preview quote, Pay now
- [ ] Complete Stripe payment
- [ ] Verify Firestore doc has `userId` set to the logged-in user's uid
- [ ] Verify `originalFiles` array is populated

## 5. Portal dashboard

- [ ] Log in to portal
- [ ] Dashboard shows table of projects (Project ID, date, status, files, amount)
- [ ] Click "View" / project row → project detail page
- [ ] If no projects, verify empty state message

## 6. Portal project detail

- [ ] Open a project (must be one you own)
- [ ] Verify metadata: languages, words, amount, due date
- [ ] Verify original files list
- [ ] Verify status history timeline
- [ ] If deliverable exists: Download button works (signed URL)
- [ ] If no deliverable: "Not available yet" shown

## 7. Portal settings

- [ ] Open `/portal/settings.html`
- [ ] Toggle "Email me when status changes" off, Save
- [ ] Reload page, verify toggle stays off
- [ ] Toggle on, Save, verify

## 8. Admin access

- [ ] Add your email to `ADMIN_EMAILS` and redeploy
- [ ] Log in with that email
- [ ] Open `/admin/`
- [ ] Verify project list loads (all projects)
- [ ] Filter by status
- [ ] Search by ID, email, or name

## 9. Admin project detail

- [ ] Open a project in admin
- [ ] Change status via dropdown, click Update status
- [ ] Verify status updates in Firestore
- [ ] Add internal notes, Save
- [ ] Upload deliverable file
- [ ] Verify status becomes "Delivered"
- [ ] Verify deliverable appears in Firestore

## 10. Status-change emails

- [ ] Create a project as logged-in user with notifications ON
- [ ] In admin, change status to "In Progress"
- [ ] Verify user receives email (SendGrid)
- [ ] Turn notifications OFF in portal settings
- [ ] Change status again in admin
- [ ] Verify NO email sent
- [ ] Set status to "Delivered" (with deliverable)
- [ ] Turn notifications ON
- [ ] Verify "Your translation is ready" email received

## 11. Secure download

- [ ] As project owner, open project in portal
- [ ] Click Download when deliverable exists
- [ ] Verify file downloads (signed URL works)
- [ ] As different user, try to access getDeliverableDownloadUrl for another user's project
- [ ] Verify 403 Forbidden

## 12. Authorization

- [ ] Log in as regular user
- [ ] Try to open `/admin/` → verify 403 or redirect
- [ ] Try to access another user's project in portal → verify 403
- [ ] Log in as admin
- [ ] Verify can access all projects in admin
