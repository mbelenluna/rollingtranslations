
/* professional.patched.v3.js
 * Pair-based pricing (English <-> Other). Reverse (X→English) adds $0.02/word.
 * Still applies rush/certified/subject multipliers (same as backend).
 */

const DEBUG = false;
function ts(){const d=new Date();return d.toISOString().replace('T',' ').replace('Z','');}
function log(...a){ if(DEBUG) console.log('[RT '+ts()+']',...a); }

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

const selected = new Map();
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

// Pair table
const PAIR_BASE_USD = {
  "english->afrikaans": 0.16,
  "english->albanian": 0.21,
  "english->amharic": 0.19,
  "english->arabic": 0.15,
  "english->armenian": 0.15,
  "english->bengali": 0.19,
  "english->bosnian": 0.3,
  "english->bulgarian": 0.21,
  "english->chinese (simplified)": 0.14,
  "english->chinese (traditional)": 0.14,
  "english->czech": 0.21,
  "english->danish": 0.21,
  "english->dari": 0.16,
  "english->dutch": 0.19,
  "english->estonian": 0.21,
  "english->farsi": 0.15,
  "english->finnish": 0.21,
  "english->french": 0.15,
  "english->french creole": 0.16,
  "english->greek": 0.21,
  "english->gujarati": 0.19,
  "english->hebrew": 0.19,
  "english->hindi": 0.15,
  "english->hmong": 0.3,
  "english->hokkien": 0.21,
  "english->indonesian": 0.15,
  "english->italian": 0.15,
  "english->japanese": 0.16,
  "english->korean": 0.15,
  "english->lao": 0.19,
  "english->latvian": 0.3,
  "english->lithuanian": 0.21,
  "english->malay": 0.19,
  "english->mongolian": 0.21,
  "english->nepali": 0.21,
  "english->norwegian": 0.19,
  "english->pashto": 0.15,
  "english->polish": 0.14,
  "english->portuguese (brazil)": 0.12,
  "english->portuguese (portugal)": 0.12,
  "english->punjabi": 0.16,
  "english->romanian": 0.22,
  "english->russian": 0.15,
  "english->slovak": 0.19,
  "english->slovene": 0.19,
  "english->somali": 0.19,
  "english->spanish (latam)": 0.12,
  "english->spanish (spain)": 0.12,
  "english->swahili": 0.19,
  "english->swedish": 0.19,
  "english->tagalog": 0.14,
  "english->telugu": 0.19,
  "english->thai": 0.15,
  "english->turkish": 0.19,
  "english->ukrainian": 0.16,
  "english->urdu": 0.16,
  "english->vietnamese": 0.15,
  "english->zomi": 0.3,
  "english->zulu": 0.3
};
function norm(s){ return String(s||"").trim().toLowerCase().replace(/\s+/g,' '); }
function normalizeLangName(s){
  s = norm(s);
  const aliases = {
    'eenglish':'english','englisn':'english',
    'gurajati':'gujarati','gebrew':'hebrew','noewegian':'norwegian',
    'malaysian':'malay','farsi':'farsi','persian':'farsi',
    'simplified chinese':'chinese (simplified)',
    'traditional chinese':'chinese (traditional)',
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
    return base != null ? (Number(base)+0.02) : null;
  }
  return null;
}

function computeAmountCentsFE(words){
  const src = $source?.value || "";
  const tgt = $target?.value || "";
  const subject = ($subject?.value || "").toLowerCase();
  const rush = (function(){const v=($rush?.value||"").toLowerCase(); if(v==='urgent')return'h24'; if(v==='rush')return'2bd'; return 'standard';})();
  const certified = readBoolFlexible($certified);
  let rate = pairBaseRateUSD(src, tgt);
  if (rate == null) return 0;
  let totalUsd = words * Number(rate);

  switch (subject){
    case 'technical':
    case 'marketing': totalUsd *= 1.20; break;
    case 'legal':
    case 'medical': totalUsd *= 1.25; break;
  }
  switch (rush){
    case '2bd': totalUsd *= 1.20; break;
    case 'h24': totalUsd *= 1.40; break;
  }
  if (certified) totalUsd *= 1.10;

  const MIN_TOTAL_USD = 1.0;
  return Math.round(Math.max(totalUsd, MIN_TOTAL_USD) * 100);
}

function ensureQuotePayButton(){
  let $btn = document.querySelector("#btnPayQuote");
  if ($btn) return $btn;
  $btn = document.createElement("button");
  $btn.id = "btnPayQuote";
  $btn.className = "mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-50";
  $btn.textContent = "Pay now";
  $btn.addEventListener("click", (e)=>{ e.preventDefault(); startPayment(); });
  $quoteBox?.appendChild($btn);
  return $btn;
}

function sumWords(){
  let w=0; for (const v of selected.values()) if (v.uploaded && Number.isFinite(v.uploaded.words)) w+= v.uploaded.words|0; return w;
}

function renderQuote(){
  if (!$quoteBox || !$quoteDetails) return;
  const words = sumWords();
  lastQuoteCents = computeAmountCentsFE(words);
  const parts = [
    `<strong>Total words:</strong> ${words}`,
    `<strong>Languages:</strong> ${$source?.value || "-"} → ${$target?.value || "-"}`,
    `<strong>Total:</strong> ${fmtMoney(lastQuoteCents)}`,
  ];
  $quoteDetails.innerHTML = parts.join("<br>");
  $quoteBox.style.display="block";
  const $btn = ensureQuotePayButton();
  $btn.disabled = !(lastQuoteCents > 0 && words > 0);
}

// Upload/analyze
async function getQuoteForGsPath(gsPath, uid){
  const r = await fetch(`${CF_BASE}/getQuoteForFile`,{
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ gsPath, uid })
  });
  const raw = await r.text().catch(()=> "");
  if (!r.ok) throw new Error(`getQuoteForFile failed: ${r.status} ${raw.slice(0,200)}`);
  return JSON.parse(raw);
}
import { ref as sRef } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-storage.js"; // alias not used here

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
  } else {
    const anon = await signInAnonymously(auth); return anon.user;
  }
}

async function previewQuote(){
  if (selected.size===0){ alert("Upload at least one file."); return; }
  $quoteBox.style.display="block"; $quoteDetails.textContent="Loading / processing your files…";
  $btnPreview?.setAttribute("disabled","true");
  try {
    const user = await ensureAuth($email?.value || "");
    for (const ent of selected.values()){
      if (!ent.uploaded){
        try { ent.uploaded = await uploadAndQuote(ent.file, user.uid); renderFileList(); } catch {}
      }
    }
    renderQuote();
  } finally { $btnPreview?.removeAttribute("disabled"); }
}

async function startPayment(){
  const words = sumWords();
  if (!(words>0)) { alert("Generate your quote first."); return; }
  const email = ($email?.value || "").trim(); if (!email){ alert("We need an email for the receipt."); return; }

  const rush = (function(){const v=($rush?.value||"").toLowerCase(); if(v==='urgent')return'h24'; if(v==='rush')return'2bd'; return 'standard';})();
  const certified = readBoolFlexible($certified);
  const subject = ($subject?.value || "").toLowerCase();
  const sourceLang = $source?.value || "";
  const targetLang = $target?.value || "";

  const desc = [
    "Professional translation",
    `${sourceLang||"-"}→${targetLang||"-"}`,
    `${words} words`,
    rush!=='standard' ? rush : null,
    certified ? "certified" : null,
    subject && subject!=='general' ? subject : null,
  ].filter(Boolean).join(" · ");

  const $pay = document.querySelector("#btnPayQuote") || ensureQuotePayButton();
  $pay.disabled = true; const prev = $pay.textContent; $pay.textContent = "Creating payment session…";
  try {
    const r = await fetch(`${CF_BASE}/createCheckoutSession`, {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({
        requestId: requestId(), email, description: desc, totalWords: words,
        rush, certified: String(certified), subject, sourceLang, targetLang
      })
    });
    const raw = await r.text().catch(()=> ""); if (!r.ok) throw new Error(raw.slice(0,200)||"Failed");
    const data = JSON.parse(raw); if (data?.url) location.href = data.url; else throw new Error("No URL from server");
  } catch(e){ alert("We couldn't start the payment. Please try again."); }
  finally { $pay.disabled = false; $pay.textContent = prev; }
}

// File UI with removable items
function renderFileList(){
  if (!$fileList) return;
  $fileList.innerHTML="";
  if (selected.size===0){ const p=document.createElement('p'); p.className="muted mt-2"; p.textContent="No files selected yet."; $fileList.appendChild(p); return; }
  const ul=document.createElement('ul'); ul.className="mt-2 space-y-2";
  for (const [key, ent] of selected.entries()){
    const li=document.createElement('li'); li.className="flex items-center justify-between bg-gray-100 rounded-lg px-3 py-2";
    const left=document.createElement('div'); left.className="truncate";
    left.innerHTML = `<span class="font-medium">${ent.file.name}</span>` + (ent.uploaded ? ` <span class="text-xs text-gray-600">· ${ent.uploaded.words} words</span>` : ` <span class="text-xs text-gray-500">· pending</span>`);
    const btn=document.createElement('button'); btn.className="ml-3 text-gray-500 hover:text-red-600 text-xl leading-none"; btn.textContent="×"; btn.setAttribute("aria-label","Remove file");
    btn.addEventListener('click', ()=>{ selected.delete(key); renderFileList(); if ($quoteBox && $quoteBox.style.display==="block") renderQuote(); });
    li.appendChild(left); li.appendChild(btn); ul.appendChild(li);
  }
  $fileList.appendChild(ul);
}
function addFilesFromInput(fileList){ const arr=Array.from(fileList||[]); for (const f of arr){ const k=fileKey(f); if(!selected.has(k)) selected.set(k,{file:f}); } if ($files) $files.value=""; renderFileList(); }

$files?.addEventListener("change", (e)=> addFilesFromInput(e.target.files || []));
$btnPreview?.addEventListener("click", (e)=> { e.preventDefault(); previewQuote(); });

// Init
(function(){ if ($fileList && selected.size===0){ const p=document.createElement('p'); p.className="muted mt-2"; p.textContent="No files selected yet."; $fileList.appendChild(p); } })();
