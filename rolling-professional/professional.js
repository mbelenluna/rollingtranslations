/* professional.js — v5
 * - Pricing por par (English<->X). Si es X->English, suma +$0.02/word.
 * - Preview oculta el formulario y muestra SOLO el quote (más grande, prolijo).
 * - Si el par NO es hacia/desde inglés: cartelito y NO sube/analiza nada.
 * - Botón Preview con el mismo azul que Pay Now.
 */

const DEBUG = false;
function ts(){const d=new Date();return d.toISOString().replace('T',' ').replace('Z','');}
function log(...a){ if(DEBUG) console.log('[RT '+ts()+']',...a); }
console.log("RT loaded v5");

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCRrDn3p9alXlLjZN7SoBkJSodcSk2uZs8",
  authDomain: "rolling-crowdsourcing.firebaseapp.com",
  projectId: "rolling-crowdsourcing",
  storageBucket: "rolling-crowdsourcing.firebasestorage.app",
  messagingSenderId: "831997390366",
  appId: "1:831997390366:web:a86f5223fa22cc250b480f",
  measurementId: "G-77E7560XRX"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
let currentUser = null;
onAuthStateChanged(auth, (u)=> currentUser = u || null);

const CF_BASE = "https://us-central1-rolling-crowdsourcing.cloudfunctions.net";
const CURRENCY = "usd";

const $ = (s)=>document.querySelector(s);
const $form = $("#quoteForm");
const $email = $("#email");
const $source = $("#sourceLang");
const $target = $("#targetLang");
const $subject = $("#subject");
const $rush = $("#rush");
const $certified = $("#certified");
const $files = $("#files");
const $fileList = $("#fileList");
const $btnPreview = $("#btnPreview");
const $btnPay = $("#btnPay");
const $quoteBox = $("#quoteBox");
const $quoteDetails = $("#quoteDetails");
if ($btnPay) $btnPay.style.display="none";

// Preview en azul (igual que Pay Now)
(function(){
  if ($btnPreview){
    $btnPreview.classList.remove("bg-gray-200");
    $btnPreview.classList.add("bg-blue-600","text-white","hover:bg-blue-700","focus:ring-2","focus:ring-blue-600","focus:ring-offset-2");
  }
})();

// ================== Estado de archivos ==================
const selected = new Map(); // key -> { file, uploaded?: {name, gsPath, words} }
let lastQuoteCents = 0;

const fmtMoney = (c)=> new Intl.NumberFormat(undefined,{style:"currency",currency:CURRENCY.toUpperCase()}).format((c|0)/100);
function readBoolFlexible(el){
  if (!el) return false;
  if (el.type === "checkbox") return !!el.checked;
  const v = String(el.value||"").toLowerCase();
  if (["true","yes","1"].includes(v)) return true;
  if (["false","no","0","standard"].includes(v)) return false;
  return !!v;
}
function fileKey(f){ return `${f.name}::${f.size}::${f.lastModified||0}`; }
function requestId(){ return `PRO-${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }

// ===== Pares (English->X) y normalización =====
const PAIR_BASE_USD = {
  "english->afrikaans":0.16,"english->albanian":0.21,"english->amharic":0.19,"english->arabic":0.15,
  "english->armenian":0.15,"english->bengali":0.19,"english->bosnian":0.30,"english->bulgarian":0.21,
  "english->czech":0.21,"english->danish":0.21,"english->dari":0.16,"english->dutch":0.19,
  "english->french":0.15,"english->french creole":0.16,"english->estonian":0.21,"english->farsi":0.15,
  "english->finnish":0.21,"english->greek":0.21,"english->gujarati":0.19,"english->hebrew":0.19,
  "english->hindi":0.15,"english->hmong":0.30,"english->hokkien":0.21,"english->indonesian":0.15,
  "english->italian":0.15,"english->japanese":0.16,"english->korean":0.15,"english->lao":0.19,
  "english->latvian":0.30,"english->lithuanian":0.21,"english->malay":0.19,"english->mongolian":0.21,
  "english->nepali":0.21,"english->norwegian":0.19,"english->pashto":0.15,"english->polish":0.14,
  "english->portuguese (brazil)":0.12,"english->portuguese (portugal)":0.12,"english->punjabi":0.16,
  "english->romanian":0.22,"english->russian":0.15,"english->chinese (simplified)":0.14,"english->slovak":0.19,
  "english->slovene":0.19,"english->somali":0.19,"english->spanish (latam)":0.12,"english->spanish (spain)":0.12,
  "english->swahili":0.19,"english->swedish":0.19,"english->tagalog":0.14,"english->telugu":0.19,
  "english->thai":0.15,"english->chinese (traditional)":0.14,"english->turkish":0.19,"english->ukrainian":0.16,
  "english->urdu":0.16,"english->vietnamese":0.15,"english->zomi":0.30,"english->zulu":0.30
};
function norm(s){ return String(s||"").trim().toLowerCase().replace(/\s+/g,' '); }
function normalizeLangName(s){
  s = norm(s);
  const aliases = {
    'eenglish':'english','englisn':'english',
    'gurajati':'gujarati','gebrew':'hebrew','noewegian':'norwegian',
    'malaysian':'malay','farsi':'farsi','persian':'farsi',
    'simplified chinese':'chinese (simplified)','traditional chinese':'chinese (traditional)',
    'haitian creole':'french creole'
  };
  return aliases[s] || s;
}
function pairBaseRateUSD(sourceLang, targetLang){
  const src = normalizeLangName(sourceLang);
  const tgt = normalizeLangName(targetLang);
  if (src === 'english' && tgt !== 'english'){
    return PAIR_BASE_USD[`english->${tgt}`] ?? null;
  } else if (tgt === 'english' && src !== 'english'){
    const base = PAIR_BASE_USD[`english->${src}`];
    return base != null ? (Number(base)+0.02) : null; // X->English suma $0.02
  }
  return null;
}
function isPairSupported(){ return pairBaseRateUSD($source?.value, $target?.value) != null; }

function sumWords(){
  let w=0;
  for (const v of selected.values()){
    if (v.uploaded && Number.isFinite(v.uploaded.words)) w+= v.uploaded.words|0;
  }
  return w;
}
function rushToken(){ const v=($rush?.value||"").toLowerCase(); if(v==='urgent')return'h24'; if(v==='rush')return'2bd'; return 'standard'; }

function computeAmountCentsFE(words){
  const src = $source?.value || "";
  const tgt = $target?.value || "";
  const subject = ($subject?.value || "").toLowerCase();
  const certified = readBoolFlexible($certified);
  const rTok = rushToken();
  let rate = pairBaseRateUSD(src, tgt);
  if (rate == null) return 0;

  let totalUsd = words * Number(rate);

  switch (subject){
    case 'technical':
    case 'marketing': totalUsd *= 1.20; break;
    case 'legal':
    case 'medical': totalUsd *= 1.25; break;
  }
  switch (rTok){
    case '2bd': totalUsd *= 1.20; break;
    case 'h24': totalUsd *= 1.40; break;
  }
  if (certified) totalUsd *= 1.10;

  const MIN_TOTAL_USD = 1.0;
  return Math.round(Math.max(totalUsd, MIN_TOTAL_USD) * 100);
}

// ===== Quote-only view =====
function buildQuoteMarkup(words, cents){
  const src = $source?.value || "-";
  const tgt = $target?.value || "-";
  const subject = ($subject?.value || "General");
  const rTok = rushToken();
  const rushLabel = rTok==='h24' ? '24 hours' : (rTok==='2bd' ? '2 business days' : 'Standard');
  const certified = readBoolFlexible($certified);
  const files = Array.from(selected.values()).filter(v=>v.uploaded);

  const fileItems = files.map(v => {
    const w = v.uploaded?.words ?? 0;
    return `<li class="flex justify-between py-2"><span class="truncate">${v.file.name}</span><span class="text-gray-600">${w.toLocaleString()} w</span></li>`;
  }).join("");

  return `
  <div class="rounded-2xl border border-gray-200 p-8 bg-white shadow-sm">
    <div class="flex items-start justify-between">
      <div>
        <h2 class="text-2xl md:text-3xl font-extrabold tracking-tight">Your Quote</h2>
        <p class="text-gray-500 mt-1">${src} → ${tgt} · ${files.length} file${files.length===1?'':'s'}</p>
      </div>
      <div class="text-right">
        <div class="text-4xl md:text-5xl font-black">${fmtMoney(cents)}</div>
        <div class="text-xs md:text-sm text-gray-500">Includes options selected</div>
      </div>
    </div>

    <dl class="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm md:text-base">
      <div><dt class="font-semibold">Words</dt><dd>${words.toLocaleString()}</dd></div>
      <div><dt class="font-semibold">Subject</dt><dd>${subject || 'General'}</dd></div>
      <div><dt class="font-semibold">Turnaround</dt><dd>${rushLabel}</dd></div>
      <div><dt class="font-semibold">Certified</dt><dd>${certified ? 'Yes' : 'No'}</dd></div>
    </dl>

    <div class="mt-6">
      <h3 class="font-semibold mb-2">Files</h3>
      <ul class="divide-y divide-gray-200 text-sm md:text-base">${fileItems || '<li class="py-2 text-gray-500">No files</li>'}</ul>
    </div>

    <div class="mt-8 flex flex-col md:flex-row gap-3">
      <button id="btnEdit" class="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Edit selection</button>
      <button id="btnPayQuote" class="px-5 py-3 rounded-xl bg-blue-600 text-white text-base font-semibold disabled:opacity-50">Pay now</button>
    </div>
  </div>`;
}

function showQuoteOnly(){ if ($form) $form.classList.add("hidden"); if ($quoteBox) $quoteBox.classList.remove("hidden"); }
function showFormAgain(){ if ($quoteBox) $quoteBox.classList.add("hidden"); if ($form) $form.classList.remove("hidden"); }

function renderQuoteView(){
  const words = sumWords();
  lastQuoteCents = computeAmountCentsFE(words);
  $quoteDetails.innerHTML = buildQuoteMarkup(words, lastQuoteCents);
  showQuoteOnly();
  const btnPay = document.querySelector("#btnPayQuote");
  const btnEdit = document.querySelector("#btnEdit");
  if (btnPay) btnPay.disabled = !(lastQuoteCents > 0 && words > 0);
  if (btnPay) btnPay.addEventListener("click", (e)=>{ e.preventDefault(); startPayment(); });
  if (btnEdit) btnEdit.addEventListener("click", (e)=>{ e.preventDefault(); showFormAgain(); });
}

// ============== Upload & análisis SOLO en Preview ==============
async function getQuoteForGsPath(gsPath, uid){
  const r = await fetch(`${CF_BASE}/getQuoteForFile`,{
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ gsPath, uid })
  });
  const raw = await r.text().catch(()=> "");
  if (!r.ok) throw new Error(`getQuoteForFile failed: ${r.status} ${raw.slice(0,200)}`);
  return JSON.parse(raw);
}

async function uploadAndQuote(file, uid){
  const stamp = Date.now();
  const relPath = `crowd/uploads/${uid}/${stamp}-${file.name}`;
  const sref = ref(storage, relPath);
  await uploadBytes(sref, file);
  const q = await getQuoteForGsPath(relPath, uid);
  return { name:file.name, gsPath: relPath, words: q.words|0 };
}

async function ensureAuth(email){
  if (currentUser) return currentUser;
  const e = String(email||"").trim();
  if (e){
    try {
      const cred = await signInWithEmailAndPassword(auth, e, "placeholder-password"); return cred.user;
    } catch (err1){
      if (err1?.code === 'auth/user-not-found' || err1?.code === 'auth/wrong-password'){
        const cred2 = await createUserWithEmailAndPassword(auth, e, "placeholder-password"); return cred2.user;
      }
      throw err1;
    }
  } else { const anon = await signInAnonymously(auth); return anon.user; }
}

async function previewQuote(){
  // Si el par no es soportado, avisamos y no hacemos nada
  if (!isPairSupported()){
    alert("We don't support the language pair you selected. We apologize for the inconvenience.");
    return;
  }
  if (selected.size===0){ alert("Upload at least one file."); return; }

  $quoteBox.classList.remove("hidden");
  $quoteDetails.innerHTML = `<div class="p-8 text-center text-gray-600">Loading / processing your files…</div>`;
  $btnPreview?.setAttribute("disabled","true");
  try {
    const user = await ensureAuth($email?.value || "");
    for (const ent of selected.values()){
      if (!ent.uploaded){
        try { ent.uploaded = await uploadAndQuote(ent.file, user.uid); }
        catch {}
      }
    }
    renderQuoteView();
  } finally {
    $btnPreview?.removeAttribute("disabled");
  }
}

async function startPayment(){
  const words = sumWords();
  if (!(words>0 && lastQuoteCents>0)) { alert("Generate your quote first."); return; }
  const email = ($email?.value || "").trim(); if (!email){ alert("We need an email for the receipt."); return; }

  const rTok = rushToken();
  const certified = readBoolFlexible($certified);
  const subject = ($subject?.value || "").toLowerCase();
  const sourceLang = $source?.value || "";
  const targetLang = $target?.value || "";

  const desc = [
    "Professional translation",
    `${sourceLang||"-"}→${targetLang||"-"}`,
    `${words} words`,
    rTok!=='standard' ? rTok : null,
    certified ? "certified" : null,
    subject && subject!=='general' ? subject : null,
  ].filter(Boolean).join(" · ");

  const $pay = document.querySelector("#btnPayQuote");
  if ($pay){ $pay.disabled = true; $pay.textContent = "Creating payment session…"; }
  try {
    const r = await fetch(`${CF_BASE}/createCheckoutSession`, {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({
        requestId: requestId(), email, description: desc, totalWords: words,
        rush: rTok, certified: String(certified), subject, sourceLang, targetLang
      })
    });
    const raw = await r.text().catch(()=> ""); if (!r.ok) throw new Error(raw.slice(0,200)||"Failed");
    const data = JSON.parse(raw); if (data?.url) location.href = data.url; else throw new Error("No URL from server");
  } catch(e){ alert("We couldn't start the payment. Please try again."); }
  finally { if ($pay){ $pay.disabled = false; $pay.textContent = "Pay now"; } }
}

// ============== UI de archivos (persistente + quitar) ==============
function renderFileList(){
  if (!$fileList) return;
  $fileList.innerHTML="";
  if (selected.size===0){
    const p=document.createElement('p'); p.className="muted mt-2"; p.textContent="No files selected yet."; $fileList.appendChild(p); return;
  }
  const ul=document.createElement('ul'); ul.className="mt-2 space-y-2";
  for (const [key, ent] of selected.entries()){
    const li=document.createElement('li'); li.className="flex items-center justify-between bg-gray-100 rounded-lg px-3 py-2";
    const left=document.createElement('div'); left.className="truncate";
    left.innerHTML = `<span class="font-medium">${ent.file.name}</span>` + (ent.uploaded ? ` <span class="text-xs text-gray-600">· ${ent.uploaded.words} words</span>` : ` <span class="text-xs text-gray-500">· pending</span>`);
    const btn=document.createElement('button'); btn.className="ml-3 text-gray-500 hover:text-red-600 text-xl leading-none"; btn.textContent="×"; btn.setAttribute("aria-label","Remove file");
    btn.addEventListener('click', ()=>{ selected.delete(key); renderFileList(); });
    li.appendChild(left); li.appendChild(btn); ul.appendChild(li);
  }
  $fileList.appendChild(ul);
}
function addFilesFromInput(fileList){
  const arr=Array.from(fileList||[]);
  for (const f of arr){ const k=fileKey(f); if(!selected.has(k)) selected.set(k,{file:f}); }
  if ($files) $files.value=""; // permite re-seleccionar los mismos nombres
  renderFileList();
}

$files?.addEventListener("change", (e)=> addFilesFromInput(e.target.files || []));
$btnPreview?.addEventListener("click", (e)=> { e.preventDefault(); previewQuote(); });

// Init
(function(){ if ($fileList && selected.size===0){ const p=document.createElement('p'); p.className="muted mt-2"; p.textContent="No files selected yet."; $fileList.appendChild(p); } })();
