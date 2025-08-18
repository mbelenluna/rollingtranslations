import { initializeApp } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-storage.js";

// ==================== CONFIG (project: rolling-crowdsourcing) ====================
const firebaseConfig = {
  apiKey: "AIzaSyCRrDn3p9alXlLjZN7SoBkJSodcSk2uZs8",
  authDomain: "rolling-crowdsourcing.firebaseapp.com",
  projectId: "rolling-crowdsourcing",
  storageBucket: "rolling-crowdsourcing.firebasestorage.app",
  messagingSenderId: "831997390366",
  appId: "1:831997390366:web:a86f5223fa22cc250b480f",
  measurementId: "G-77E7560XRX"
};

// ==================== INIT (with smoke-test logs) ====================
console.group("⚙️ Firebase init");
const app = initializeApp(firebaseConfig);
console.log("app.options", { ...app.options, apiKey: (app.options.apiKey || '').slice(0, 8) + "…" });
if (!/^AIza/.test(app.options.apiKey || "")) {
  throw new Error("Config problem: apiKey missing or malformed (must start with 'AIza')");
}
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
console.log("✅ getAuth OK");
console.groupEnd();

// ==================== CONSTANTS ====================
const CF_BASE = "https://us-central1-rolling-crowdsourcing.cloudfunctions.net";
const CURRENCY = "usd";
const PRO_TIERS_CENTS = [
  { upTo: 500, rateCents: 20 },
  { upTo: 2000, rateCents: 16 },
  { upTo: Infinity, rateCents: 12 },
];
const RUSH_MULTIPLIER = 1.4;
const CERTIFIED_FEE_CENTS = 1500;

// ==================== DOM HOOKS ====================
const $ = (s) => document.querySelector(s);
const $fullName = document.querySelector("#fullName");
const $email = document.querySelector("#email");
const $password = document.querySelector("#password");
const $source = document.querySelector("#sourceLang");
const $target = document.querySelector("#targetLang");
const $subject = document.querySelector("#subject");
const $rush = document.querySelector("#rush");
const $certified = document.querySelector("#certified");
const $files = document.querySelector("#files");
const $btnPreview = document.querySelector("#btnPreview");
const $btnPay = document.querySelector("#btnPay");
const $quoteBox = document.querySelector("#quoteBox");
const $quoteDetails = document.querySelector("#quoteDetails");

// ==================== STATE ====================
let uploaded = []; // [{ name, gsPath, words }]
let totalWords = 0;
let lastQuoteCents = 0;
let currentUser = null;

onAuthStateChanged(auth, (user) => {
  currentUser = user || null;
  console.log(user ? "👤 Signed-in" : "🚪 Signed-out", user ? { uid: user.uid, email: user.email } : "");
});

// ==================== HELPERS ====================
const fmtMoney = (cents) => new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY.toUpperCase() }).format((cents | 0) / 100);
function requestId() { return `PRO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function calcProfessionalQuoteCents(words, opts) {
  let remaining = Math.max(0, words | 0);
  let total = 0;
  let consumed = 0;
  for (const tier of PRO_TIERS_CENTS) {
    const upTo = tier.upTo === Infinity ? Infinity : tier.upTo;
    const maxThisTier = upTo === Infinity ? remaining : Math.max(0, upTo - consumed);
    const chunk = Math.min(remaining, maxThisTier);
    if (chunk <= 0) break;
    total += Math.round(chunk * tier.rateCents);
    remaining -= chunk;
    consumed += chunk;
  }
  if (opts?.rush) total = Math.round(total * RUSH_MULTIPLIER);
  if (opts?.certified) total += CERTIFIED_FEE_CENTS;
  return total;
}

function readBoolFlexible(el) {
  if (!el) return false;
  if (el.type === "checkbox") return !!el.checked;
  const v = String(el.value || "").toLowerCase();
  if (v === "true" || v === "yes" || v === "1") return true;
  if (v === "false" || v === "no" || v === "0" || v === "standard") return false;
  // If another convention is used, any non-empty string counts as true
  return !!v;
}

function renderQuote() {
  const rush = readBoolFlexible($rush);
  const certified = readBoolFlexible($certified);
  const cents = calcProfessionalQuoteCents(totalWords, { rush, certified });
  lastQuoteCents = cents;
  const parts = [
    `<strong>Total words:</strong> ${totalWords}`,
    `<strong>Languages:</strong> ${$source?.value || "-"} → ${$target?.value || "-"}`,
    `<strong>Rush:</strong> ${rush ? "Yes" : "No"}`,
    `<strong>Certified:</strong> ${certified ? "Yes" : "No"}`,
    `<strong>Total:</strong> ${fmtMoney(cents)}`,
  ];
  if ($quoteDetails) $quoteDetails.innerHTML = parts.join("<br>");
  if ($quoteBox) $quoteBox.style.display = "block";
  if ($btnPay) $btnPay.disabled = (cents <= 0 || uploaded.length === 0);
}

async function getQuoteForGsPath(gsPath, uid) {
  const r = await fetch(`${CF_BASE}/getQuoteForFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gsPath, uid })
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`getQuoteForFile failed: ${r.status} ${t}`);
  }
  return r.json();
}

async function uploadAndQuote(file, uid) {
  const stamp = Date.now();
  const relPath = `crowd/uploads/${uid}/${stamp}-${file.name}`;
  const sref = ref(storage, relPath);
  await uploadBytes(sref, file);

  // Attempt 1: use gs://bucket/path
  const gsFull = `gs://${firebaseConfig.storageBucket}/${relPath}`;
  try {
    const quote = await getQuoteForGsPath(gsFull, uid);
    return { name: file.name, gsPath: gsFull, words: quote.words | 0 };
  } catch (e) {
    console.warn("⚠️ getQuote with gs:// failed, trying relative path…", e?.message || e);
    // Attempt 2 (fallback): send the relative path some backends expect
    const quote2 = await getQuoteForGsPath(relPath, uid);
    return { name: file.name, gsPath: relPath, words: quote2.words | 0 };
  }
}

// ==================== AUTH + MAIN FLOW ====================
async function ensureAuth(email, password) {
  try {
    if (email && password) {
      try { return (await signInWithEmailAndPassword(auth, email, password)).user; }
      catch (err) {
        if (err?.code === 'auth/user-not-found' || err?.code === 'auth/wrong-password') {
          console.log("Creating email/password user…");
          return (await createUserWithEmailAndPassword(auth, email, password)).user;
        }
        throw err;
      }
    }
    console.log("No password → using anonymous session");
    return (await signInAnonymously(auth)).user;
  } catch (e) {
    console.error("Auth error:", e);
    throw e;
  }
}

async function handleAuthAndQuote() {
  const files = Array.from($files?.files || []);
  const email = ($email?.value || "").trim();
  const password = $password?.value || "";
  if (!files.length) return alert("Upload at least one file.");

  $btnPreview?.setAttribute("disabled", "true");
  $btnPay?.setAttribute("disabled", "true");
  if ($quoteDetails) $quoteDetails.innerHTML = "Authenticating and analyzing files…";

  try {
    const user = await ensureAuth(email, password);
    uploaded = [];
    totalWords = 0;
    for (const f of files) {
      const u = await uploadAndQuote(f, user.uid);
      uploaded.push(u);
      totalWords += u.words;
    }
    renderQuote();
    if ($quoteDetails) $quoteDetails.innerHTML += `<br><em>${uploaded.length} file(s) ready.</em>`;
  } catch (err) {
    console.error("Failure during auth/upload/quote:", err);
    alert("Something went wrong. Check the console for details.");
  } finally {
    $btnPreview?.removeAttribute("disabled");
  }
}

// ==================== PAYMENT (Stripe Checkout via CF) ====================
$btnPay?.addEventListener("click", async (e) => {
  e.preventDefault();

  // Re-run the quote calculation before attempting to pay
  await handleAuthAndQuote();

  if (!currentUser) return alert("Upload a file first to authenticate and generate the quote.");
  if (!uploaded.length) return alert("Upload at least one file.");
  if (!lastQuoteCents) return alert("Generate the quote first.");

  const email = ($email?.value || "").trim();
  if (!email) return alert("We need an email for the receipt.");

  const desc = [
    "Professional translation",
    `${$source?.value || "-"}→${$target?.value || "-"}`,
    `${totalWords} words`,
    readBoolFlexible($rush) ? "rush" : null,
    readBoolFlexible($certified) ? "certified" : null,
  ].filter(Boolean).join(" · ");

  const payload = {
    requestId: requestId(),
    email,                         // used as customer_email in server
    description: desc,
    totalWords,                     // <-- REQUIRED so server can price correctly
    subject: $subject.value,        // "general" | "technical" | "marketing" | "legal" | "medical"
    certified: String(readBoolFlexible($certified)), // "true"/"false"
    rush: ($rush.value === 'urgent') ? 'h24'
      : ($rush.value === 'rush') ? '2bd'
        : 'standard'
  };

  $btnPay.disabled = true;
  const original = $btnPay.textContent;
  $btnPay.textContent = "Creating payment session…";

  try {
    const r = await fetch(`${CF_BASE}/createCheckoutSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`createCheckoutSession failed: ${r.status} ${await r.text().catch(() => "")}`);
    const data = await r.json();
    if (data?.url) location.href = data.url; else throw new Error("Server response missing URL");
  } catch (err) {
    console.error(err);
    alert("We couldn't start the payment. See console for details.");
  } finally {
    $btnPay.disabled = false;
    $btnPay.textContent = original;
  }
});

// ==================== EVENTS ====================
$files?.addEventListener("change", (e) => { handleAuthAndQuote(); });
$btnPreview?.addEventListener("click", (e) => { e.preventDefault(); handleAuthAndQuote(); });