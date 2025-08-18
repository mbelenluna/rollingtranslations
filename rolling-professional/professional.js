
/* professional.patched.js
 * Rolling Translations — Professional Services (Instant Quote)
 * Changes vs. original:
 * - Persistent file queue with removable items (X) rendered in #fileList
 * - Selecting more files appends; previous ones remain
 * - Quote appears on a separate "preview" step (#quoteBox) with a loading message
 * - "Pay Now" button only appears after the quote is ready (and uses Stripe as before)
 * - Word count reflects current selection (adds/removes across multiple picks)
 *
 * Drop-in replacement for ./professional.js referenced by professional.html.
 * If you prefer, rename this file to professional.js.
 */

const DEBUG = false;

// ===== Logging helpers =====
function ts() { const d = new Date(); return d.toISOString().replace('T',' ').replace('Z',''); }
function log(...args){ if(DEBUG) console.log('[RT '+ts()+']', ...args); }
function info(...args){ if(DEBUG) console.info('[RT '+ts()+']', ...args); }
function warn(...args){ if(DEBUG) console.warn('[RT '+ts()+']', ...args); }
function err(...args){ if(DEBUG) console.error('[RT '+ts()+']', ...args); }

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-storage.js";

// ==================== CONFIG ====================
const firebaseConfig = {
  apiKey: "AIzaSyCRrDn3p9alXlLjZN7SoBkJSodcSk2uZs8",
  authDomain: "rolling-crowdsourcing.firebaseapp.com",
  projectId: "rolling-crowdsourcing",
  storageBucket: "rolling-crowdsourcing.firebasestorage.app",
  messagingSenderId: "831997390366",
  appId: "1:831997390366:web:a86f5223fa22cc250b480f",
  measurementId: "G-77E7560XRX"
};

// ==================== INIT ====================
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app); // kept for parity with original
const storage = getStorage(app);
let currentUser = null;
onAuthStateChanged(auth, (user) => { currentUser = user || null; });

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
const $fullName = $("#fullName");
const $email = $("#email");
const $source = $("#sourceLang");
const $target = $("#targetLang");
const $subject = $("#subject");
const $rush = $("#rush");
const $certified = $("#certified");
const $files = $("#files");
const $fileList = $("#fileList");
const $btnPreview = $("#btnPreview");
const $btnPay = $("#btnPay"); // will be hidden; we will create a Pay button inside #quoteBox
const $quoteBox = $("#quoteBox");
const $quoteDetails = $("#quoteDetails");

// Hide the in-form Pay button entirely; we'll show one in the quote view
if ($btnPay) $btnPay.style.display = "none";

// ==================== STATE ====================
// Map key: name::size::lastModified  →  { file, uploaded?: { name, gsPath, words } }
const selected = new Map();
let lastQuoteCents = 0;

// ==================== HELPERS ====================
const fmtMoney = (cents) => new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY.toUpperCase() }).format((cents | 0) / 100);
function readBoolFlexible(el) {
  if (!el) return false;
  if (el.type === "checkbox") return !!el.checked;
  const v = String(el.value || "").toLowerCase();
  if (v === "true" || v === "yes" || v === "1") return true;
  if (v === "false" || v === "no" || v === "0" || v === "standard") return false;
  return !!v;
}
function requestId() { return `PRO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function fileKey(f) { return `${f.name}::${f.size}::${f.lastModified||0}`; }

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

function sumSelectedWords() {
  let words = 0;
  for (const ent of selected.values()) {
    if (ent.uploaded && Number.isFinite(ent.uploaded.words)) words += ent.uploaded.words | 0;
  }
  return words;
}

function ensureQuotePayButton() {
  let $btn = document.querySelector("#btnPayQuote");
  if ($btn) return $btn;
  $btn = document.createElement("button");
  $btn.id = "btnPayQuote";
  $btn.className = "mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-50";
  $btn.textContent = "Pay now";
  $btn.addEventListener("click", (e) => { e.preventDefault(); startPayment(); });
  $quoteBox?.appendChild($btn);
  return $btn;
}

function renderQuote() {
  if (!$quoteBox || !$quoteDetails) return;
  const rush = readBoolFlexible($rush);
  const certified = readBoolFlexible($certified);
  const totalWords = sumSelectedWords();
  lastQuoteCents = calcProfessionalQuoteCents(totalWords, { rush, certified });

  const parts = [
    `<strong>Total words:</strong> ${totalWords}`,
    `<strong>Languages:</strong> ${$source?.value || "-"} → ${$target?.value || "-"}`,
    `<strong>Rush:</strong> ${rush ? "Yes" : "No"}`,
    `<strong>Certified:</strong> ${certified ? "Yes" : "No"}`,
    `<strong>Total:</strong> ${fmtMoney(lastQuoteCents)}`,
  ];
  $quoteDetails.innerHTML = parts.join("<br>");
  $quoteBox.style.display = "block";

  // Reveal Pay button only if there are analyzed files and a positive quote
  const $btn = ensureQuotePayButton();
  $btn.disabled = !(lastQuoteCents > 0 && sumSelectedWords() > 0);
}

async function getQuoteForGsPath(gsPath, uid) {
  const r = await fetch(`${CF_BASE}/getQuoteForFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gsPath, uid })
  });
  const raw = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`getQuoteForFile failed: ${r.status} ${raw.slice(0,300)}`);
  let json;
  try { json = JSON.parse(raw); } catch { throw new Error("getQuoteForFile returned non-JSON"); }
  return json;
}

async function uploadAndQuote(file, uid) {
  const stamp = Date.now();
  const relPath = `crowd/uploads/${uid}/${stamp}-${file.name}`;
  const sref = ref(storage, relPath);
  await uploadBytes(sref, file);

  const gsFull = `gs://${firebaseConfig.storageBucket}/${relPath}`;
  try {
    const quote = await getQuoteForGsPath(gsFull, uid);
    return { name: file.name, gsPath: gsFull, words: quote.words | 0 };
  } catch (e) {
    // fallback to relative path
    const quote2 = await getQuoteForGsPath(relPath, uid);
    return { name: file.name, gsPath: relPath, words: quote2.words | 0 };
  }
}

async function ensureAuth(email) {
  if (currentUser) return currentUser;
  const e = (email || "").trim();
  try {
    if (e) {
      try {
        const cred = await signInWithEmailAndPassword(auth, e, "placeholder-password");
        return cred.user;
      } catch (err1) {
        if (err1?.code === 'auth/user-not-found' || err1?.code === 'auth/wrong-password') {
          const cred2 = await createUserWithEmailAndPassword(auth, e, "placeholder-password");
          return cred2.user;
        }
        throw err1;
      }
    } else {
      const anon = await signInAnonymously(auth);
      return anon.user;
    }
  } catch (e2) {
    err("Auth error:", e2);
    throw e2;
  }
}

// =============== FILE LIST UI ==================
function renderFileList() {
  if (!$fileList) return;
  $fileList.innerHTML = "";

  if (selected.size === 0) {
    const p = document.createElement("p");
    p.className = "muted mt-2";
    p.textContent = "No files selected yet.";
    $fileList.appendChild(p);
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "mt-2 space-y-2";
  for (const [key, ent] of selected.entries()) {
    const li = document.createElement("li");
    li.className = "flex items-center justify-between bg-gray-100 rounded-lg px-3 py-2";
    const left = document.createElement("div");
    left.className = "truncate";
    left.innerHTML = `<span class="font-medium">${ent.file.name}</span>` +
                     (ent.uploaded ? ` <span class="text-xs text-gray-600">· ${ent.uploaded.words} words</span>`
                                   : ` <span class="text-xs text-gray-500">· pending</span>`);
    const btn = document.createElement("button");
    btn.className = "ml-3 text-gray-500 hover:text-red-600 text-xl leading-none";
    btn.setAttribute("aria-label", "Remove file");
    btn.textContent = "×";
    btn.addEventListener("click", () => {
      selected.delete(key);
      renderFileList();
      if ($quoteBox && $quoteBox.style.display === "block") {
        // If we're on the quote step, update totals immediately
        if (sumSelectedWords() > 0) renderQuote();
        else {
          $quoteDetails.textContent = "No files selected.";
          const $pay = document.querySelector("#btnPayQuote");
          if ($pay) $pay.disabled = true;
        }
      }
    });
    li.appendChild(left);
    li.appendChild(btn);
    ul.appendChild(li);
  }
  $fileList.appendChild(ul);
}

function addFilesFromInput(fileList) {
  const arr = Array.from(fileList || []);
  for (const f of arr) {
    const key = fileKey(f);
    if (!selected.has(key)) selected.set(key, { file: f });
  }
  // Clear the native input so user can re-open the picker and add the same file if removed, etc.
  if ($files) $files.value = "";
  renderFileList();
}

// =============== QUOTE PREVIEW FLOW ==================
async function previewQuote() {
  if (selected.size === 0) {
    alert("Upload at least one file.");
    return;
  }
  $quoteBox.style.display = "block";
  $quoteDetails.textContent = "Loading / processing your files…";

  $btnPreview?.setAttribute("disabled", "true");
  try {
    const user = await ensureAuth($email?.value || "");
    // Upload/analyze only entries that aren't analyzed yet
    for (const ent of selected.values()) {
      if (!ent.uploaded) {
        try {
          const u = await uploadAndQuote(ent.file, user.uid);
          ent.uploaded = u;
          renderFileList(); // update "pending" → words
        } catch (e) {
          warn("Failed to analyze", ent.file?.name, e);
        }
      }
    }
    renderQuote();
  } catch (e) {
    alert("Something went wrong while preparing your quote. Please try again.");
  } finally {
    $btnPreview?.removeAttribute("disabled");
  }
}

// =============== PAYMENT ==================
async function startPayment() {
  // Ensure quote is ready
  const totalWords = sumSelectedWords();
  if (!totalWords || !lastQuoteCents) {
    alert("Generate your quote first.");
    return;
  }
  const email = ($email?.value || "").trim();
  if (!email) {
    alert("We need an email for the receipt.");
    return;
  }
  if (!currentUser) {
    try { await ensureAuth(email); } catch { alert("Authentication failed."); return; }
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
    email,
    description: desc,
    totalWords,
    subject: $subject?.value,
    certified: String(readBoolFlexible($certified)),
    rush: mappedRush
  };

  const $btn = ensureQuotePayButton();
  $btn.disabled = true;
  const original = $btn.textContent;
  $btn.textContent = "Creating payment session…";
  try {
    const r = await fetch(`${CF_BASE}/createCheckoutSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = await r.text().catch(() => "");
    if (!r.ok) throw new Error(`createCheckoutSession failed: ${r.status} ${raw.slice(0,300)}`);
    const data = JSON.parse(raw);
    if (data?.url) location.href = data.url;
    else throw new Error("Server response missing URL");
  } catch (e) {
    alert("We couldn't start the payment. Please try again.");
  } finally {
    $btn.disabled = false;
    $btn.textContent = original;
  }
}

// =============== EVENTS ==================
$files?.addEventListener("change", (e) => {
  addFilesFromInput(e.target.files || []);
});

$btnPreview?.addEventListener("click", (e) => {
  e.preventDefault();
  previewQuote();
});

// Initialize file list to "empty" message
renderFileList();
