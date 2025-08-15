// professional.js — Rolling Translations (Instant Quote + Checkout)
// Usage: include in professional.html with
//   <script type="module" src="./professional.js"></script>
//
// 1) Fill firebaseConfig with your project's web config.
// 2) Set CF_BASE to your Cloud Functions base, e.g.:
//    const CF_BASE = "https://us-central1-<PROJECT_ID>.cloudfunctions.net";
//
// Expected HTML element IDs:
//   fullName, email, org, phone
//   source, target, subject, rush, certified
//   files (type="file", multiple)
//   btnPreview, btnPay
//   quoteBox (container to show preview), quoteDetails (inner div/list)
//
// Back-end Functions expected (Gen2 or Gen1):
//   - getQuoteForFile  (POST { gsPath }) → { words: number }
//   - createProCheckoutSession (POST payload below) → { url }
//
//
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-auth.js";
import { getStorage, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-storage.js";

// TODO: Paste your Firebase web config (project: rolling-professional)
const firebaseConfig = {
  apiKey: "AIzaSyDmmk2v-yOhvaqr6W7v3G5tFN71flWP34U",
  authDomain: "rolling-professional.firebaseapp.com",
  projectId: "rolling-professional",
  storageBucket: "rolling-professional.firebasestorage.app",
  messagingSenderId: "230433682337",
  appId: "1:230433682337:web:cb710df001642d1bb511e0",
  measurementId: "G-4K7GKKPMZW"
};

// TODO: Set your Cloud Functions base URL
// Example Gen2/Gen1: https://us-central1-your-project-id.cloudfunctions.net
const CF_BASE = "https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net";

// ------- Pricing (keep in sync with your backend) -------
const PRICING = {
  base: {
    "en>es": { translation: 0.16, certified: 0.20, min_fee: 50 },
    "es>en": { translation: 0.18, certified: 0.22, min_fee: 55 },
    "en>pt": { translation: 0.17, certified: 0.21, min_fee: 50 },
    "pt>en": { translation: 0.18, certified: 0.22, min_fee: 55 }
  },
  multipliers: {
    subject: { general: 1.0, legal: 1.15, medical: 1.25, technical: 1.2, marketing: 1.1 },
    rush: { standard: 1.0, h48: 1.15, h24: 1.35, same_day: 1.6 }
  },
  fees: { cert_fee: 20, format_match_layout: 15 }
};

function pickBaseRate(pair, service = "translation") {
  const p = PRICING.base[pair];
  if (!p) return null;
  return p[service] || p.translation || null;
}

function computeProAmount({ words, pair, service, subject, rush, certified, formatTier }) {
  const base = pickBaseRate(pair, service);
  if (!base) throw new Error(`No base rate for ${pair}/${service}`);
  const subjectMul = PRICING.multipliers.subject[subject] || 1.0;
  const rushMul = PRICING.multipliers.rush[rush] || 1.0;
  const effective = base * subjectMul * rushMul;
  const textCost = Math.max(words * effective, (PRICING.base[pair]?.min_fee || 0));
  const formatFee = (formatTier === "match_layout") ? PRICING.fees.format_match_layout : 0;
  const certFee = certified ? PRICING.fees.cert_fee : 0;
  const subtotal = textCost + formatFee + certFee;
  return { textCost, formatFee, certFee, total: subtotal };
}

// ------- Firebase init (anonymous auth + storage) -------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const storage = getStorage(app);

// Ensure anonymous session
await signInAnonymously(auth);
const uid = auth.currentUser?.uid;

// ------- DOM helpers -------
const $ = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
const filesEl = $("files");
const btnPreview = $("btnPreview");
const btnPay = $("btnPay");
const quoteBox = document.getElementById("quoteBox");
const quoteDetails = document.getElementById("quoteDetails");

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
let uploaded = []; // { name, gsPath, words }

// Upload file to Firebase Storage under pro/uploads/{uid}/FILENAME
async function uploadFile(file) {
  const safe = `${Date.now()}_${file.name.replace(/[^\w\-.]+/g, "_")}`;
  const path = `pro/uploads/${uid}/${safe}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type || "application/octet-stream" });
  return path; // relative path inside your default bucket
}

// Ask backend to count words for a file in GCS
async function fetchWordCount(gsPath) {
  const r = await fetch(`${CF_BASE}/getQuoteForFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gsPath })
  });
  if (!r.ok) throw new Error(`Word count failed (${r.status})`);
  const j = await r.json();
  if (typeof j.words !== "number") throw new Error("Invalid response from server");
  return j.words;
}

btnPreview?.addEventListener("click", async () => {
  try {
    if (!filesEl?.files?.length) return alert("Please select at least one file.");
    btnPreview.disabled = true;
    btnPreview.textContent = "Processing…";
    btnPay.disabled = true;

    uploaded = [];
    for (const f of filesEl.files) {
      if (f.size > MAX_FILE_SIZE) throw new Error(`${f.name} exceeds 25MB`);
      const gsPath = await uploadFile(f);
      const words = await fetchWordCount(gsPath);
      uploaded.push({ name: f.name, gsPath, words });
    }

    const totalWords = uploaded.reduce((a, b) => a + b.words, 0);
    const sourceLang = $("source").value;
    const targetLang = $("target").value;
    const subject = $("subject").value;
    const rush = $("rush").value;
    const certified = ($("certified").value === "true");
    const pair = `${sourceLang}>${targetLang}`;

    const { textCost, certFee, formatFee, total } = computeProAmount({
      words: totalWords, pair, service: "translation", subject, rush, certified, formatTier: "basic"
    });

    // Render quote
    if (quoteDetails) {
      quoteDetails.innerHTML = `
        <div><b>Files:</b> ${uploaded.map(u => u.name).join(", ")}</div>
        <div><b>Total words:</b> ${totalWords.toLocaleString()}</div>
        <div><b>Pair:</b> ${pair} | <b>Subject:</b> ${subject} | <b>Turnaround:</b> ${rush.replace("_", " ")}</div>
        <div><b>Text cost:</b> $${textCost.toFixed(2)}</div>
        ${certFee ? `<div><b>Certification:</b> $${certFee.toFixed(2)}</div>` : ""}
        ${formatFee ? `<div><b>Formatting:</b> $${formatFee.toFixed(2)}</div>` : ""}
        <div class="border-t border-blue-200 pt-2"><b>Total (preview):</b> $${total.toFixed(2)}</div>
      `;
    }
    quoteBox?.classList?.remove("hidden");
    btnPay.disabled = false;
    btnPreview.textContent = "Get quote";
  } catch (e) {
    alert(e.message || e);
    btnPreview.disabled = false;
    btnPreview.textContent = "Get quote";
  }
});

btnPay?.addEventListener("click", async () => {
  try {
    btnPay.disabled = true;
    btnPay.textContent = "Creating checkout…";

    const payload = {
      email: $("email").value,
      fullName: $("fullName").value,
      org: $("org").value,
      phone: $("phone").value,
      sourceLang: $("source").value,
      targetLang: $("target").value,
      subject: $("subject").value,
      rush: $("rush").value,
      certified: ($("certified").value === "true"),
      totalWords: uploaded.reduce((a, b) => a + b.words, 0),
      fileNames: uploaded.map(u => u.name),
      gsPaths: uploaded.map(u => u.gsPath)
    };

    const r = await fetch(`${CF_BASE}/createProCheckoutSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if (!r.ok || !j?.url) throw new Error(j?.error || "Checkout failed");
    window.location.href = j.url;
  } catch (e) {
    alert(e.message || e);
    btnPay.disabled = false;
    btnPay.textContent = "Pay now";
  }
});