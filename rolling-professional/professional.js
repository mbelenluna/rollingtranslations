/* professional.debug.js
 * Instrumented for deep client-side logging
 * Based on the user's original professional.js, with verbose logs added.
 * Toggle DEBUG by changing the flag below.
 */
const DEBUG = true;

// ===== Global Logging Helpers =====
function ts() {
  const d = new Date();
  return d.toISOString().replace('T',' ').replace('Z','');
}
function log(...args) {
  if (!DEBUG) return;
  console.log(`[RT ${ts()}]`, ...args);
}
function info(...args) {
  if (!DEBUG) return;
  console.info(`[RT ${ts()}]`, ...args);
}
function warn(...args) {
  if (!DEBUG) return;
  console.warn(`[RT ${ts()}]`, ...args);
}
function err(...args) {
  if (!DEBUG) return;
  console.error(`[RT ${ts()}]`, ...args);
}
function group(label) {
  if (!DEBUG) return;
  console.group(`[RT] ${label}`);
}
function groupEnd() {
  if (!DEBUG) return;
  console.groupEnd();
}

// Catch global errors to aid debugging
window.addEventListener("error", (e) => {
  err("Global error:", { message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno, error: e.error });
});
window.addEventListener("unhandledrejection", (e) => {
  err("Unhandled promise rejection:", e.reason);
});

// Basic environment dump
group("Environment");
info("navigator.userAgent:", navigator.userAgent);
info("location.href:", location.href);
groupEnd();

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
group("⚙️ Firebase init");
const app = initializeApp(firebaseConfig);
info("app.options (redacted apiKey):", { ...app.options, apiKey: (app.options.apiKey || '').slice(0, 8) + "…" });
if (!/^AIza/.test(app.options.apiKey || "")) {
  throw new Error("Config problem: apiKey missing or malformed (must start with 'AIza')");
}
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
info("✅ getAuth/getFirestore/getStorage OK");
groupEnd();

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
info("Pricing constants:", { PRO_TIERS_CENTS, RUSH_MULTIPLIER, CERTIFIED_FEE_CENTS });

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
info("DOM ready?", {
  hasSource: !!$source, hasTarget: !!$target, hasSubject: !!$subject,
  hasRush: !!$rush, hasCert: !!$certified, hasFiles: !!$files,
  hasButtons: !!$btnPreview && !!$btnPay
});

// ==================== STATE ====================
let uploaded = []; // [{ name, gsPath, words }]
let totalWords = 0;
let lastQuoteCents = 0;
let currentUser = null;

onAuthStateChanged(auth, (user) => {
  currentUser = user || null;
  if (user) info("👤 onAuthStateChanged: signed-in", { uid: user.uid, email: user.email, isAnonymous: user.isAnonymous });
  else info("🚪 onAuthStateChanged: signed-out");
});

// ==================== HELPERS ====================
const fmtMoney = (cents) => new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY.toUpperCase() }).format((cents | 0) / 100);
function requestId() { return `PRO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function calcProfessionalQuoteCents(words, opts) {
  group("calcProfessionalQuoteCents()");
  info("input:", { words, opts });
  let remaining = Math.max(0, words | 0);
  let total = 0;
  let consumed = 0;
  for (const tier of PRO_TIERS_CENTS) {
    const upTo = tier.upTo === Infinity ? Infinity : tier.upTo;
    const maxThisTier = upTo === Infinity ? remaining : Math.max(0, upTo - consumed);
    const chunk = Math.min(remaining, maxThisTier);
    if (chunk <= 0) break;
    const add = Math.round(chunk * tier.rateCents);
    info("tier step:", { tier, chunk, add });
    total += add;
    remaining -= chunk;
    consumed += chunk;
  }
  if (opts?.rush) { total = Math.round(total * RUSH_MULTIPLIER); info("rush applied:", RUSH_MULTIPLIER, "→", total); }
  if (opts?.certified) { total += CERTIFIED_FEE_CENTS; info("certified fee added:", CERTIFIED_FEE_CENTS, "→", total); }
  info("total cents:", total);
  groupEnd();
  return total;
}

function readBoolFlexible(el) {
  if (!el) return false;
  if (el.type === "checkbox") return !!el.checked;
  const v = String(el.value || "").toLowerCase();
  if (v === "true" || v === "yes" || v === "1") return true;
  if (v === "false" || v === "no" || v === "0" || v === "standard") return false;
  return !!v; // Treat other non-empty values as true
}

function renderQuote() {
  group("renderQuote()");
  const rush = readBoolFlexible($rush);
  const certified = readBoolFlexible($certified);
  const cents = calcProfessionalQuoteCents(totalWords, { rush, certified });
  lastQuoteCents = cents;
  info("computed quote:", { totalWords, rush, certified, cents, formatted: fmtMoney(cents) });
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
  groupEnd();
}

async function getQuoteForGsPath(gsPath, uid) {
  group("getQuoteForGsPath()");
  const t0 = performance.now();
  info("request:", { endpoint: `${CF_BASE}/getQuoteForFile`, body: { gsPath, uid } });
  const r = await fetch(`${CF_BASE}/getQuoteForFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gsPath, uid })
  });
  const text = await r.text().catch(() => "");
  info("response (raw):", { ok: r.ok, status: r.status, text: text?.slice(0, 300) });
  if (!r.ok) {
    throw new Error(`getQuoteForFile failed: ${r.status} ${text}`);
  }
  let json;
  try { json = JSON.parse(text); }
  catch (e) {
    throw new Error("getQuoteForFile returned non-JSON: " + (text?.slice(0, 300) || "<empty>"));
  }
  const dt = Math.round(performance.now() - t0);
  info("parsed JSON:", json, `(${dt}ms)`);
  groupEnd();
  return json;
}

async function uploadAndQuote(file, uid) {
  group("uploadAndQuote()");
  info("file:", { name: file.name, size: file.size });
  const stamp = Date.now();
  const relPath = `crowd/uploads/${uid}/${stamp}-${file.name}`;
  const sref = ref(storage, relPath);
  info("uploadBytes to storage path:", relPath);
  await uploadBytes(sref, file);
  info("upload complete.");

  // Attempt 1: use gs://bucket/path
  const gsFull = `gs://${firebaseConfig.storageBucket}/${relPath}`;
  info("attempt 1: gsFull:", gsFull);
  try {
    const quote = await getQuoteForGsPath(gsFull, uid);
    info("attempt 1 success:", quote);
    groupEnd();
    return { name: file.name, gsPath: gsFull, words: quote.words | 0 };
  } catch (e) {
    warn("getQuote with gs:// failed, trying relative path…", e?.message || e);
    // Attempt 2 (fallback): send the relative path some backends expect
    info("attempt 2: relPath:", relPath);
    const quote2 = await getQuoteForGsPath(relPath, uid);
    info("attempt 2 success:", quote2);
    groupEnd();
    return { name: file.name, gsPath: relPath, words: quote2.words | 0 };
  }
}

// ==================== AUTH + MAIN FLOW ====================
async function ensureAuth(email, password) {
  group("ensureAuth()");
  info("inputs:", { emailMasked: email ? email.replace(/(.).+(@.*)/, "$1***$2") : null, hasPassword: !!password });
  try {
    if (email && password) {
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        info("signInWithEmailAndPassword OK:", { uid: cred.user.uid, isAnonymous: cred.user.isAnonymous });
        groupEnd();
        return cred.user;
      } catch (err1) {
        warn("signInWithEmailAndPassword failed:", err1?.code || err1?.message || err1);
        if (err1?.code === 'auth/user-not-found' || err1?.code === 'auth/wrong-password') {
          info("Creating email/password user…");
          const cred2 = await createUserWithEmailAndPassword(auth, email, password);
          info("createUserWithEmailAndPassword OK:", { uid: cred2.user.uid });
          groupEnd();
          return cred2.user;
        }
        throw err1;
      }
    }
    info("No password → using anonymous session");
    const anon = await signInAnonymously(auth);
    info("signInAnonymously OK:", { uid: anon.user.uid, isAnonymous: anon.user.isAnonymous });
    groupEnd();
    return anon.user;
  } catch (e) {
    err("Auth error:", e);
    groupEnd();
    throw e;
  }
}

async function handleAuthAndQuote() {
  group("handleAuthAndQuote()");
  const files = Array.from($files?.files || []);
  const email = ($email?.value || "").trim();
  const password = $password?.value || "";
  info("preconditions:", { filesCount: files.length, hasEmail: !!email, hasPassword: !!password });

  if (!files.length) {
    warn("No files selected.");
    alert("Upload at least one file.");
    groupEnd();
    return;
  }

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
    info("uploaded summary:", uploaded);
    info("totalWords:", totalWords);
    renderQuote();
    if ($quoteDetails) $quoteDetails.innerHTML += `<br><em>${uploaded.length} file(s) ready.</em>`;
  } catch (errX) {
    err("Failure during auth/upload/quote:", errX);
    alert("Something went wrong. Check the console for details.");
  } finally {
    $btnPreview?.removeAttribute("disabled");
    groupEnd();
  }
}

// ==================== PAYMENT (Stripe Checkout via CF) ====================
$btnPay?.addEventListener("click", async (e) => {
  group("PAYMENT click handler");
  e.preventDefault();
  info("clicked Pay Now");

  // Re-run the quote calculation before attempting to pay
  await handleAuthAndQuote();

  if (!currentUser) {
    warn("No currentUser after handleAuthAndQuote");
    alert("Upload a file first to authenticate and generate the quote.");
    groupEnd();
    return;
  }
  if (!uploaded.length) {
    warn("No uploaded files available");
    alert("Upload at least one file.");
    groupEnd();
    return;
  }
  if (!lastQuoteCents) {
    warn("lastQuoteCents is 0");
    alert("Generate the quote first.");
    groupEnd();
    return;
  }

  const email = ($email?.value || "").trim();
  if (!email) {
    warn("Missing email for receipt");
    alert("We need an email for the receipt.");
    groupEnd();
    return;
  }

  const desc = [
    "Professional translation",
    `${$source?.value || "-"}→${$target?.value || "-"}`,
    `${totalWords} words`,
    readBoolFlexible($rush) ? "rush" : null,
    readBoolFlexible($certified) ? "certified" : null,
  ].filter(Boolean).join(" · ");

  const mappedRush = ($rush?.value === 'urgent') ? 'h24'
                    : ($rush?.value === 'rush') ? '2bd'
                    : 'standard';

  const payload = {
    requestId: requestId(),
    email,                         // used as customer_email in server
    description: desc,
    totalWords,                    // REQUIRED for server pricing
    subject: $subject?.value,      // "general" | "technical" | "marketing" | "legal" | "medical"
    certified: String(readBoolFlexible($certified)), // "true"/"false"
    rush: mappedRush
  };
  info("Checkout payload:", payload);

  $btnPay.disabled = true;
  const original = $btnPay.textContent;
  $btnPay.textContent = "Creating payment session…";

  try {
    const t0 = performance.now();
    const r = await fetch(`${CF_BASE}/createCheckoutSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = await r.text().catch(() => "");
    const dt = Math.round(performance.now() - t0);
    info("createCheckoutSession response:", { ok: r.ok, status: r.status, raw: raw.slice(0, 500), elapsedMs: dt });

    if (!r.ok) {
      throw new Error(`createCheckoutSession failed: ${r.status} ${raw}`);
    }
    let data;
    try { data = JSON.parse(raw); }
    catch (e) {
      throw new Error("createCheckoutSession returned non-JSON: " + raw.slice(0, 500));
    }
    info("createCheckoutSession JSON:", data);

    if (data?.url) {
      info("Redirecting to Checkout URL:", data.url);
      location.href = data.url;
    } else {
      throw new Error("Server response missing URL");
    }
  } catch (errPay) {
    err("Payment flow error:", errPay);
    alert("We couldn't start the payment. See console for details.");
  } finally {
    $btnPay.disabled = false;
    $btnPay.textContent = original;
    groupEnd();
  }
});

// ==================== EVENTS ====================
$files?.addEventListener("change", (e) => { info("files change"); handleAuthAndQuote(); });
$btnPreview?.addEventListener("click", (e) => { info("preview click"); e.preventDefault(); handleAuthAndQuote(); });

// Extra: initial state dump
info("Initial UI values:", {
  source: $source?.value, target: $target?.value, subject: $subject?.value,
  rushRaw: $rush?.value, rushBool: readBoolFlexible($rush),
  certifiedRaw: $certified?.value, certifiedBool: readBoolFlexible($certified)
});