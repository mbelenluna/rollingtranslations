// professional.PRO-compat.js
// Frontend for the "Professional" site wired to Cloud Functions:
//   - POST /getQuoteForFile  { gsPath }
//   - POST /createProCheckoutSession { mode, amount, currency, description, success_url, cancel_url, customer_email?, requestId }
//
// Drop-in replacement for your existing professional.js. IDs expected in the HTML:
//   #fullName, #email, #source, #target, #subject, #rush, #certified, #files,
//   #btnPreview, #btnPay, #quoteBox, #quoteDetails
//
// IMPORTANT: Fill in FIREBASE_CONFIG below with your web app config from Firebase Console.
// (Project: rolling-professional). At a minimum include apiKey, authDomain, projectId, appId, and storageBucket.
//
// If you deploy the HTML under a different domain than rolling-translations.com,
// add that domain to the ALLOWED_ORIGINS set in functions/index.js.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// ==================== CONFIG ====================
const FIREBASE_CONFIG = {
  // TODO: paste your config from Firebase Console > Project Settings > General > Your apps (Web app)
  // Example:
  // apiKey: "AIza...",
  // authDomain: "rolling-professional.firebaseapp.com",
  projectId: "rolling-professional",
  storageBucket: "rolling-professional.firebasestorage.app",
  // appId: "1:230433682337:web:..."
};

// Base URL for your deployed HTTP functions (region us-central1)
const CF_BASE = "https://us-central1-rolling-professional.cloudfunctions.net";

// Default currency for Stripe
const CURRENCY = "usd";

// ==================== PRICING (EDIT TO TASTE) ====================
// Tiered per-word base rates for Professional (in cents)
// Example tiers: 0–500: $0.20, 501–2000: $0.16, 2001+: $0.12
const PRO_TIERS_CENTS = [
  { upTo: 500, rateCents: 20 },
  { upTo: 2000, rateCents: 16 },
  { upTo: Infinity, rateCents: 12 },
];
// Rush multiplier and certified fixed fee example
const RUSH_MULTIPLIER = 1.4;         // 40% extra for rush
const CERTIFIED_FEE_CENTS = 1500;    // +$15 for certified

// ==================== DOM HOOKS ====================
const el = (sel) => document.querySelector(sel);
const $fullName    = el("#fullName");
const $email       = el("#email");
const $source      = el("#source");
const $target      = el("#target");
const $subject     = el("#subject");
const $rush        = el("#rush");
const $certified   = el("#certified");
const $files       = el("#files");
const $btnPreview  = el("#btnPreview");
const $btnPay      = el("#btnPay");
const $quoteBox    = el("#quoteBox");
const $quoteDetails= el("#quoteDetails");

// State
let uploaded = []; // [{ name, gsPath, words }]
let totalWords = 0;
let lastQuoteCents = 0;

// ==================== INIT ====================
const app  = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
signInAnonymously(auth).catch(console.error);

// ==================== HELPERS ====================
function formatMoney(cents) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY.toUpperCase() }).format(cents / 100);
}

function calcProfessionalQuoteCents(words, opts) {
  // words: integer, opts: { rush: bool, certified: bool }
  let remaining = Math.max(0, words|0);
  let totalCents = 0;
  for (const tier of PRO_TIERS_CENTS) {
    const chunk = Math.min(remaining, tier.upTo === Infinity ? remaining : (tier.upTo - (words - remaining)));
    if (chunk <= 0) continue;
    totalCents += Math.round(chunk * tier.rateCents);
    remaining -= chunk;
    if (remaining <= 0) break;
  }
  if (opts?.rush)      totalCents = Math.round(totalCents * RUSH_MULTIPLIER);
  if (opts?.certified) totalCents += CERTIFIED_FEE_CENTS;
  return totalCents;
}

function renderQuote() {
  const rush = $rush?.checked || false;
  const certified = $certified?.checked || false;
  const cents = calcProfessionalQuoteCents(totalWords, { rush, certified });
  lastQuoteCents = cents;

  const parts = [
    `<strong>Total words:</strong> ${totalWords}`,
    `<strong>Languages:</strong> ${$source?.value || "-"} → ${$target?.value || "-"}`,
    `<strong>Rush:</strong> ${rush ? "Yes" : "No"}`,
    `<strong>Certified:</strong> ${certified ? "Yes" : "No"}`,
    `<strong>Total:</strong> ${formatMoney(cents)}`,
  ];
  if ($quoteDetails) $quoteDetails.innerHTML = parts.join("<br>");
  if ($quoteBox)     $quoteBox.style.display = "block";
  if ($btnPay)       $btnPay.disabled = (cents <= 0 || uploaded.length === 0);
}

function requestId() {
  return `PRO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getQuoteForGsPath(gsPath) {
  const r = await fetch(`${CF_BASE}/getQuoteForFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gsPath })
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`getQuoteForFile failed: ${r.status} ${t}`);
  }
  return r.json(); // { bucket, path, words, characters }
}

async function uploadAndQuote(file) {
  const uid = auth.currentUser?.uid || "anon";
  const stamp = Date.now();
  const path = `pro-uploads/${uid}/${stamp}-${file.name}`;
  const sref = ref(getStorage(app), path);
  await uploadBytes(sref, file);
  const gsPath = `gs://${FIREBASE_CONFIG.storageBucket}/${path}`;
  const quote = await getQuoteForGsPath(gsPath);
  return { name: file.name, gsPath, words: quote.words|0 };
}

// ==================== EVENT WIRING ====================
$files?.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  $btnPreview?.setAttribute("disabled", "true");
  $btnPay?.setAttribute("disabled", "true");
  $quoteDetails.innerHTML = "Subiendo y analizando archivos...";
  try {
    uploaded = [];
    totalWords = 0;
    for (const f of files) {
      const u = await uploadAndQuote(f);
      uploaded.push(u);
      totalWords += u.words;
    }
    renderQuote();
    $quoteDetails.innerHTML += `<br><em>${uploaded.length} archivo(s) listos.</em>`;
  } catch (err) {
    console.error(err);
    alert("Hubo un problema subiendo o analizando tus archivos. Mirá la consola para más detalles.");
  } finally {
    $btnPreview?.removeAttribute("disabled");
  }
});

$btnPreview?.addEventListener("click", (e) => {
  e.preventDefault();
  renderQuote();
});

$btnPay?.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!uploaded.length) return alert("Subí al menos un archivo.");
  if (!lastQuoteCents)  return alert("Generá la cotización primero.");

  const email = ($email?.value || "").trim();
  if (!email) return alert("Necesitamos un email para enviar el recibo y el resultado.");

  const desc = [
    "Professional translation",
    `${$source?.value || "-"}→${$target?.value || "-"}`,
    `${totalWords} words`,
    $rush?.checked ? "rush" : null,
    $certified?.checked ? "certified" : null,
  ].filter(Boolean).join(" · ");

  const payload = {
    mode: "payment",
    amount: lastQuoteCents,
    currency: CURRENCY,
    description: desc,
    success_url: `${location.origin}/professional/success.html`,
    cancel_url: `${location.origin}/professional/?canceled=1`,
    customer_email: email,
    requestId: requestId(),

    // OPTIONAL: anything else you want to pass for your own bookkeeping
    // The server webhook will persist the Stripe session info to Firestore
    // and attach metadata like requestId. You can also add client_reference_id
    // on the server if you prefer.
  };

  $btnPay.disabled = true;
  $btnPay.textContent = "Creando sesión de pago...";

  try {
    const r = await fetch(`${CF_BASE}/createProCheckoutSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`createProCheckoutSession failed: ${r.status} ${t}`);
    }
    const data = await r.json();
    if (data?.url) {
      location.href = data.url; // Redirect to Stripe Checkout
    } else {
      throw new Error("Respuesta inesperada del servidor (faltó la URL).");
    }
  } catch (err) {
    console.error(err);
    alert("No pudimos iniciar el pago. Revisá la consola para detalles.");
  } finally {
    $btnPay.disabled = false;
    $btnPay.textContent = "Pagar";
  }
});
