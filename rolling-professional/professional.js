const DEBUG = false;

// ---------- Lightweight logger ----------
const log = (...a) => { if (DEBUG) console.log("[RT]", ...a); };
const warn = (...a) => { if (DEBUG) console.warn("[RT]", ...a); };
const err =  (...a) => { if (DEBUG) console.error("[RT]", ...a); };

// ---------- Firebase imports ----------
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
import { getStorage, ref, uploadBytes, deleteObject } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-storage.js";

// ---------- Config ----------
const firebaseConfig = {
  apiKey: "AIzaSyCRrDn3p9alXlLjZN7SoBkJSodcSk2uZs8",
  authDomain: "rolling-crowdsourcing.firebaseapp.com",
  projectId: "rolling-crowdsourcing",
  storageBucket: "rolling-crowdsourcing.appspot.com",   // <= bucket correcto
  messagingSenderId: "831997390366",
  appId: "1:831997390366:web:a86f5223fa22cc250b480f",
  measurementId: "G-77E7560XRX"
};

const CF_BASE = "https://us-central1-rolling-crowdsourcing.cloudfunctions.net";
const CURRENCY = "usd";

// Pricing tiers (20¢ up to 500, 16¢ up to 2k, 12¢ thereafter), rush +40%, certified +$15
const PRO_TIERS_CENTS = [
  { upTo: 500, rateCents: 20 },
  { upTo: 2000, rateCents: 16 },
  { upTo: Infinity, rateCents: 12 },
];
const RUSH_MULTIPLIER = 1.4;
const CERTIFIED_FEE_CENTS = 1500;

// ---------- Init ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
log("Firebase initialized", { bucket: app.options.storageBucket });

// ---------- DOM ----------
const $ = (s) => document.querySelector(s);
const $fullName   = $("#fullName");
const $email      = $("#email");
const $password   = $("#password");
const $source     = $("#sourceLang");
const $target     = $("#targetLang");
const $subject    = $("#subject");
const $rush       = $("#rush");
const $certified  = $("#certified");
const $files      = $("#files");
const $btnPreview = $("#btnPreview");
const $btnPay     = $("#btnPay");
const $quoteBox   = $("#quoteBox");
const $quoteDetails = $("#quoteDetails");

// Create/ensure a container to render selected files
let $fileList = $("#fileList");
if (!$fileList) {
  $fileList = document.createElement("div");
  $fileList.id = "fileList";
  $fileList.style.marginTop = "8px";
  $files?.insertAdjacentElement("afterend", $fileList);
}
// Minimal chip styles
const style = document.createElement("style");
style.textContent = `
#fileList { display: flex; flex-wrap: wrap; gap: 8px; }
.file-chip {
  display: inline-flex; align-items: center; gap: 8px;
  border: 1px solid #e2e2e2; padding: 6px 10px; border-radius: 999px;
  font-size: 14px; background: #fafafa;
}
.file-chip .remove {
  cursor: pointer; border: none; background: transparent; font-weight: 600;
}
.file-chip .meta { opacity: .7; font-size: 12px; }
`;
document.head.appendChild(style);

// ---------- State ----------
let currentUser = null;
// items: [{id, name, size, signature, gsPath, words}]
let items = [];
let pendingUploads = 0;
let lastQuoteCents = 0;

// ---------- Auth ----------
onAuthStateChanged(auth, (user) => { currentUser = user || null; });

async function ensureAuth(email, password) {
  if (currentUser) return currentUser;
  if (email && password) {
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      return cred.user;
    } catch (e) {
      if (e?.code === "auth/user-not-found" || e?.code === "auth/wrong-password") {
        const cred2 = await createUserWithEmailAndPassword(auth, email, password);
        return cred2.user;
      }
      throw e;
    }
  }
  const anon = await signInAnonymously(auth);
  return anon.user;
}

// ---------- Utilities ----------
const fmtMoney = (cents) => new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY.toUpperCase() }).format((cents | 0) / 100);
const requestId = () => `PRO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const signatureOf = (file) => `${file.name}:${file.size}:${file.lastModified}`;

function calcProfessionalQuoteCents(words, { rush, certified }) {
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
  if (rush) total = Math.round(total * RUSH_MULTIPLIER);
  if (certified) total += CERTIFIED_FEE_CENTS;
  return total;
}

function readBoolFlexible(el) {
  if (!el) return false;
  if (el.type === "checkbox") return !!el.checked;
  const v = String(el.value || "").toLowerCase();
  if (["true","yes","1"].includes(v)) return true;
  if (["false","no","0","standard"].includes(v)) return false;
  return !!v;
}

// ---------- Backend helpers ----------
async function getQuoteForGsPath(gsPath, uid) {
  // Try relative path first (your backend accepted this), fallback to gs://
  const tryOnce = async (path) => {
    const r = await fetch(`${CF_BASE}/getQuoteForFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gsPath: path, uid })
    });
    const text = await r.text().catch(() => "");
    if (!r.ok) throw new Error(`${r.status} ${text}`);
    const json = JSON.parse(text);
    return json;
  };

  try {
    // relative path only
    if (gsPath.startsWith("gs://")) {
      // if we got a gs://, convert to relative to avoid 403
      const rel = gsPath.replace(/^gs:\/\/[^\/]+\//, "");
      return await tryOnce(rel);
    } else {
      return await tryOnce(gsPath);
    }
  } catch (e1) {
    // fallback to gs:// if relative fails (unlikely)
    if (!gsPath.startsWith("gs://")) {
      const gs = `gs://${firebaseConfig.storageBucket}/${gsPath}`;
      return await tryOnce(gs);
    }
    throw e1;
  }
}

async function uploadAndQuote(file, uid) {
  const stamp = Date.now();
  const relPath = `crowd/uploads/${uid}/${stamp}-${file.name}`;
  const sref = ref(storage, relPath);
  await uploadBytes(sref, file);
  const quote = await getQuoteForGsPath(relPath, uid);
  return { relPath, words: (quote?.words | 0) };
}

// ---------- Rendering ----------
function renderFileList() {
  $fileList.innerHTML = "";
  if (!items.length) return;

  for (const it of items) {
    const chip = document.createElement("div");
    chip.className = "file-chip";
    chip.dataset.id = it.id;

    const name = document.createElement("span");
    name.textContent = it.name;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `(${it.words} words)`;

    const btn = document.createElement("button");
    btn.className = "remove";
    btn.type = "button";
    btn.setAttribute("aria-label", `Remove ${it.name}`);
    btn.textContent = "✕";
    btn.addEventListener("click", () => removeItem(it.id));

    chip.appendChild(name);
    chip.appendChild(meta);
    chip.appendChild(btn);
    $fileList.appendChild(chip);
  }
}

function renderQuote() {
  const rush = readBoolFlexible($rush);
  const certified = readBoolFlexible($certified);
  const totalWords = items.reduce((s, it) => s + (it.words | 0), 0);
  const cents = calcProfessionalQuoteCents(totalWords, { rush, certified });
  lastQuoteCents = cents;

  if ($quoteDetails) {
    $quoteDetails.innerHTML = [
      `<strong>Files:</strong> ${items.length}`,
      `<strong>Total words:</strong> ${totalWords}`,
      `<strong>Languages:</strong> ${$source?.value || "-"} → ${$target?.value || "-"}`,
      `<strong>Rush:</strong> ${rush ? "Yes" : "No"}`,
      `<strong>Certified:</strong> ${certified ? "Yes" : "No"}`,
      `<strong>Total:</strong> ${fmtMoney(cents)}`,
    ].join("<br>");
  }
  if ($quoteBox) $quoteBox.style.display = "block";

  // Enable pay only when we have files, a price, and nothing uploading
  const canPay = items.length > 0 && cents > 0 && pendingUploads === 0;
  if ($btnPay) $btnPay.disabled = !canPay;
}

// ---------- Add / Remove files ----------
function removeItem(id) {
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return;
  const it = items[idx];
  items.splice(idx, 1);
  // Try to delete from storage; ignore errors silently
  if (it.gsPath) {
    try {
      const sref = ref(storage, it.gsPath.startsWith("gs://")
        ? it.gsPath.replace(/^gs:\/\/[^\/]+\//, "")
        : it.gsPath
      );
      deleteObject(sref).catch(() => {});
    } catch (_) {}
  }
  renderFileList();
  renderQuote();
}

async function addFiles(selectedFiles) {
  if (!selectedFiles || !selectedFiles.length) return;
  const email = ($email?.value || "").trim();
  const password = $password?.value || "";
  const user = await ensureAuth(email, password);

  const existing = new Set(items.map(it => it.signature));
  const toProcess = [];
  for (const f of Array.from(selectedFiles)) {
    const sig = signatureOf(f);
    if (existing.has(sig)) continue; // dedupe
    toProcess.push({ file: f, sig });
    existing.add(sig);
  }
  if (!toProcess.length) return;

  pendingUploads += toProcess.length;
  // temporary UI state
  if ($quoteDetails) $quoteDetails.innerHTML = "Uploading and analyzing files…";
  renderQuote();

  for (const { file, sig } of toProcess) {
    try {
      const { relPath, words } = await uploadAndQuote(file, user.uid);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      items.push({
        id,
        name: file.name,
        size: file.size,
        signature: sig,
        gsPath: relPath,
        words
      });
    } catch (e) {
      err("Failed to upload/quote file", file?.name, e);
      alert(`No pudimos procesar "${file?.name}". Intenta otra vez o con otro formato.`);
    } finally {
      pendingUploads--;
      renderFileList();
      renderQuote();
    }
  }
}

// ---------- Events ----------
$files?.addEventListener("change", (e) => {
  addFiles(e.target.files);
});

$btnPreview?.addEventListener("click", (e) => {
  e.preventDefault();
  if ($files?.files?.length) addFiles($files.files);
  else renderQuote();
});

$rush?.addEventListener("change", renderQuote);
$certified?.addEventListener("change", renderQuote);
$source?.addEventListener("change", renderQuote);
$target?.addEventListener("change", renderQuote);
$subject?.addEventListener("change", renderQuote);

// ---------- Pay Now ----------
$btnPay?.addEventListener("click", async (e) => {
  e.preventDefault();
  if (pendingUploads > 0) {
    alert("Aguarde a que terminen de subirse los archivos.");
    return;
  }
  if (!items.length) {
    alert("Subí al menos un archivo.");
    return;
  }
  if (!lastQuoteCents) {
    alert("Generá la cotización primero.");
    return;
  }
  const email = ($email?.value || "").trim();
  if (!email) {
    alert("Necesitamos un email para el recibo.");
    return;
  }
  const totalWords = items.reduce((s, it) => s + (it.words | 0), 0);
  const desc = [
    "Professional translation",
    `${$source?.value || "-"}→${$target?.value || "-"}`,
    `${totalWords} words`,
    readBoolFlexible($rush) ? "rush" : null,
    readBoolFlexible($certified) ? "certified" : null,
  ].filter(Boolean).join(" · ");

  const mappedRush =
    ($rush?.value === "urgent") ? "h24" :
    ($rush?.value === "rush")   ? "2bd" :
                                  "standard";

  const payload = {
    requestId: requestId(),
    email,
    description: desc,
    totalWords,
    subject: $subject?.value || "general",
    certified: String(readBoolFlexible($certified)),
    rush: mappedRush
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
    const raw = await r.text();
    if (!r.ok) throw new Error(`createCheckoutSession failed: ${r.status} ${raw}`);
    const data = JSON.parse(raw);
    if (data?.url) location.href = data.url;
    else throw new Error("Server response missing URL");
  } catch (e) {
    err("Payment flow error:", e);
    alert("No pudimos iniciar el pago. Revisá la consola para más detalles.");
  } finally {
    $btnPay.disabled = false;
    $btnPay.textContent = original;
  }
});

// ---------- First render ----------
renderFileList();
renderQuote();
