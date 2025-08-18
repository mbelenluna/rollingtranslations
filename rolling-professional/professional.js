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

// ------- DOM -------
const $ = (s)=>document.querySelector(s);
const $form = $("#quoteForm");
const $email = $("#email");
const $source = $("#sourceLang");
const $target = $("#targetLang"); // se oculta y reemplaza por multi-UI
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

// Defaults
if ($source && (!$source.value || $source.value.trim() === "")) { $source.value = "English"; }
if ($target) { $target.value = ""; } // ningún target por defecto

// Preview en azul (match Pay Now)
(function(){ if ($btnPreview){ $btnPreview.classList.remove("bg-gray-200"); $btnPreview.classList.add("bg-blue-600","text-white","hover:bg-blue-700","focus:ring-2","focus:ring-blue-600","focus:ring-offset-2"); } })();

// ------- Files state -------
const selectedFiles = new Map(); // key -> { file, uploaded?: {name, gsPath, words} }
let lastQuoteCents = 0;

// ------- Helpers -------
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
function norm(s){ return String(s||"").trim().toLowerCase().replace(/\s+/g,' '); }
function titleize(s){ return s.split(' ').map(w=> w==='and'||w==='of' ? w : (w[0]? w[0].toUpperCase()+w.slice(1) : '')).join(' '); }

// Language normalization robusta
function normalizeLangName(s){
  let out = norm(s);
  const noParen = out.replace(/\s*\(.*?\)\s*/g,'').trim(); // "English (US)" -> "english"
  if (noParen) out = noParen;
  const aliases = {
    'eenglish':'english','englisn':'english',
    'gurajati':'gujarati','gebrew':'hebrew','noewegian':'norwegian',
    'malaysian':'malay',
    'farsi':'farsi','persian':'farsi',
    'hakkien':'hokkien',
    'simplified chinese':'chinese (simplified)',
    'traditional chinese':'chinese (traditional)',
    'haitian creole':'french creole'
  };
  out = aliases[out] || out;
  if (/^english\b/.test(out)) out = 'english';
  if (/^chinese\b.*simplified/.test(out)) out = 'chinese (simplified)';
  if (/^chinese\b.*traditional/.test(out)) out = 'chinese (traditional)';
  return out;
}
function isEnglishLang(x){ return /^english\b/.test(normalizeLangName(x)); }

// ------- Pricing table -------
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
function pairBaseRateUSD(sourceLang, targetLang){
  const src = normalizeLangName(sourceLang);
  const tgt = normalizeLangName(targetLang);
  if (src === 'english' && tgt !== 'english'){
    return PAIR_BASE_USD[`english->${tgt}`] ?? null;
  } else if (tgt === 'english' && src !== 'english'){
    const base = PAIR_BASE_USD[`english->${src}`];
    return base != null ? (Number(base)+0.02) : null; // X->English +$0.02
  }
  return null;
}

// ------- Multi-target UI -------
const selectedTargets = new Set();
function allTargetsFromTable(){
  const set = new Set();
  Object.keys(PAIR_BASE_USD).forEach(k=>{ set.add(titleize(k.split('->')[1])); });
  return Array.from(set).sort();
}
function allowedTargetsForSource(src){
  if (isEnglishLang(src)) return allTargetsFromTable().filter(x=> x.toLowerCase()!=='english');
  return ['English'];
}
function buildMultiTargetUI(){
  if (!$target) return;
  $target.style.display = 'none';
  let wrap = document.querySelector('#targetMultiWrap');
  if (!wrap){
    wrap = document.createElement('div');
    wrap.id = 'targetMultiWrap';
    wrap.className = 'mt-2';
    $target.insertAdjacentElement('afterend', wrap);
  }
  wrap.innerHTML = `
    <div class="flex gap-2 items-center">
      <input id="addTargetInput" class="flex-1 px-3 py-2 rounded-lg border border-gray-300" list="targetOptions" placeholder="Add target language">
      <datalist id="targetOptions"></datalist>
      <button id="btnAddTarget" type="button" class="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">Add</button>
    </div>
    <div id="targetChips" class="mt-2 flex flex-wrap gap-2"></div>
  `;
  refreshDatalist();
  $("#btnAddTarget")?.addEventListener('click', addTargetFromInput);
  $("#addTargetInput")?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); addTargetFromInput(); }});
  renderTargetChips();
}
function refreshDatalist(){
  const allowed = allowedTargetsForSource($source?.value || 'English');
  const dl = $("#targetOptions");
  if (!dl) return;
  dl.innerHTML = allowed.map(t=> `<option value="${t}"></option>`).join('');
  for (const t of Array.from(selectedTargets)){
    if (!allowed.includes(t)) selectedTargets.delete(t);
  }
  renderTargetChips();
}
function renderTargetChips(){
  const box = $("#targetChips");
  if (!box) return;
  if (selectedTargets.size===0){
    box.innerHTML = `<span class="text-gray-500 text-sm">No target languages yet</span>`;
    return;
  }
  box.innerHTML = Array.from(selectedTargets).map(t=> `
    <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100">
      ${t}
      <button type="button" class="text-gray-500 hover:text-red-600" data-rm="${t}" aria-label="Remove ${t}">×</button>
    </span>
  `).join('');
  box.querySelectorAll('button[data-rm]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      selectedTargets.delete(btn.getAttribute('data-rm'));
      renderTargetChips();
    });
  });
}
function addTargetFromInput(){
  const inp = $("#addTargetInput"); if (!inp) return;
  const label = (inp.value||"").trim();
  if (!label) return;
  const allowed = allowedTargetsForSource($source?.value || 'English');
  if (!allowed.includes(label)) { alert("We don't support that language as a target for the chosen source."); return; }
  selectedTargets.add(label);
  inp.value = "";
  renderTargetChips();
}
$source?.addEventListener('change', refreshDatalist);
buildMultiTargetUI();
refreshDatalist(); // asegura opciones correctas si seteamos English por defecto

// ------- Words / pricing -------
function sumWords(){
  let w=0; for (const v of selectedFiles.values()) if (v.uploaded && Number.isFinite(v.uploaded.words)) w+= v.uploaded.words|0;
  return w;
}
function rushToken(){ const v=($rush?.value||"").toLowerCase(); if(v==='urgent')return'h24'; if(v==='rush')return'2bd'; return 'standard'; }
function computePairCents(words, src, tgt, subject, rushTok, certified){
  const rate = pairBaseRateUSD(src, tgt);
  if (rate == null) return 0;
  let totalUsd = words * Number(rate);
  switch ((subject||"").toLowerCase()){
    case 'technical':
    case 'marketing': totalUsd *= 1.20; break;
    case 'legal':
    case 'medical': totalUsd *= 1.25; break;
  }
  switch (rushTok){
    case '2bd': totalUsd *= 1.20; break;
    case 'h24': totalUsd *= 1.40; break;
  }
  if (certified) totalUsd *= 1.10;
  return Math.round(Math.max(totalUsd, 1.0) * 100);
}
function computeTotalCents(words){
  const src = $source?.value || "";
  const subject = ($subject?.value || "").toLowerCase();
  const certified = readBoolFlexible($certified);
  const rTok = rushToken();
  let sum = 0;
  for (const tgt of selectedTargets){
    sum += computePairCents(words, src, tgt, subject, rTok, certified);
  }
  return sum;
}
function allPairsSupported(){
  const src = $source?.value || "";
  if (selectedTargets.size===0) return false;
  for (const tgt of selectedTargets){
    if (pairBaseRateUSD(src, tgt) == null) return false;
  }
  return true;
}

// ------- Quote view -------
function buildQuoteMarkup(words, totalCents){
  const src = $source?.value || "-";
  const subject = ($subject?.value || "General");
  const rTok = rushToken();
  const rushLabel = rTok==='h24' ? '24 hours' : (rTok==='2bd' ? '2 business days' : 'Standard');
  const certified = readBoolFlexible($certified);

  const items = Array.from(selectedTargets).map(tgt=>{
    const cents = computePairCents(words, src, tgt, subject, rTok, certified);
    return `<li class="flex justify-between py-2"><span class="truncate">${src} → ${tgt}</span><span class="font-medium">${fmtMoney(cents)}</span></li>`;
  }).join('');

  const files = Array.from(selectedFiles.values()).filter(v=>v.uploaded);
  const fileItems = files.map(v => {
    const w = v.uploaded?.words ?? 0;
    return `<li class="flex justify-between py-2"><span class="truncate">${v.file.name}</span><span class="text-gray-600">${w.toLocaleString()} w</span></li>`;
  }).join("");

  return `
  <div class="rounded-2xl border border-gray-200 p-8 bg-white shadow-sm">
    <div class="flex items-start justify-between">
      <div>
        <h2 class="text-2xl md:text-3xl font-extrabold tracking-tight">Your Quote</h2>
        <p class="text-gray-500 mt-1">${Array.from(selectedTargets).join(', ')} (${selectedTargets.size} target${selectedTargets.size===1?'':'s'})</p>
      </div>
      <div class="text-right">
        <div class="text-4xl md:text-5xl font-black">${fmtMoney(totalCents)}</div>
        <div class="text-xs md:text-sm text-gray-500">Total for all languages</div>
      </div>
    </div>

    <div class="mt-6">
      <h3 class="font-semibold mb-2">Breakdown</h3>
      <ul class="divide-y divide-gray-200 text-sm md:text-base">${items || '<li class="py-2 text-gray-500">No pairs</li>'}</ul>
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
  lastQuoteCents = computeTotalCents(words);
  $quoteDetails.innerHTML = buildQuoteMarkup(words, lastQuoteCents);
  showQuoteOnly();
  const btnPay = document.querySelector("#btnPayQuote");
  const btnEdit = document.querySelector("#btnEdit");
  if (btnPay) btnPay.disabled = !(lastQuoteCents > 0 && words > 0);
  if (btnPay) btnPay.addEventListener("click", (e)=>{ e.preventDefault(); startPayment(); });
  if (btnEdit) btnEdit.addEventListener("click", (e)=>{ e.preventDefault(); showFormAgain(); });
}

// ------- Upload & análisis SOLO en Preview -------
async function getQuoteForGsPath(gsPath, uid){
  const r = await fetch(`${CF_BASE}/getQuoteForFile`,{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ gsPath, uid }) });
  const raw = await r.text().catch(()=> ""); if (!r.ok) throw new Error(`getQuoteForFile failed: ${r.status} ${raw.slice(0,200)}`);
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
  if (selectedTargets.size === 0) { alert("Please add at least one target language."); return; }
  if (!allPairsSupported()){ alert("We don't support the language pair you selected. We apologize for the inconvenience."); return; }
  if (selectedFiles.size===0){ alert("Upload at least one file."); return; }

  $quoteBox.classList.remove("hidden");
  $quoteDetails.innerHTML = `<div class="p-8 text-center text-gray-600">Loading / processing your files…</div>`;
  $btnPreview?.setAttribute("disabled","true");
  try {
    const user = await ensureAuth($email?.value || "");
    for (const ent of selectedFiles.values()){
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
  const targets = Array.from(selectedTargets);
  const pairs = targets.map(tgt => ({ sourceLang, targetLang: tgt }));

  const desc = [
    "Professional translation",
    `${sourceLang||"-"}→${targets.join('/')||"-"}`,
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
        rush: rTok, certified: String(certified), subject, pairs
      })
    });
    const raw = await r.text().catch(()=> ""); if (!r.ok) throw new Error(raw.slice(0,200)||"Failed");
    const data = JSON.parse(raw); if (data?.url) location.href = data.url; else throw new Error("No URL from server");
  } catch(e){ alert("We couldn't start the payment. Please try again."); }
  finally { if ($pay){ $pay.disabled = false; $pay.textContent = "Pay now"; } }
}

// ------- File UI (persistente + quitar) -------
function renderFileList(){
  if (!$fileList) return;
  $fileList.innerHTML="";
  if (selectedFiles.size===0){
    const p=document.createElement('p'); p.className="muted mt-2"; p.textContent="No files selected yet."; $fileList.appendChild(p); return;
  }
  const ul=document.createElement('ul'); ul.className="mt-2 space-y-2";
  for (const [key, ent] of selectedFiles.entries()){
    const li=document.createElement('li'); li.className="flex items-center justify-between bg-gray-100 rounded-lg px-3 py-2";
    const left=document.createElement('div'); left.className="truncate";
    left.innerHTML = `<span class="font-medium">${ent.file.name}</span>` + (ent.uploaded ? ` <span class="text-xs text-gray-600">· ${ent.uploaded.words} words</span>` : ` <span class="text-xs text-gray-500">· pending</span>`);
    const btn=document.createElement('button'); btn.className="ml-3 text-gray-500 hover:text-red-600 text-xl leading-none"; btn.textContent="×"; btn.setAttribute("aria-label","Remove file");
    btn.addEventListener('click', ()=>{ selectedFiles.delete(key); renderFileList(); });
    li.appendChild(left); li.appendChild(btn); ul.appendChild(li);
  }
  $fileList.appendChild(ul);
}
function addFilesFromInput(fileList){
  const arr=Array.from(fileList||[]);
  for (const f of arr){ const k=fileKey(f); if(!selectedFiles.has(k)) selectedFiles.set(k,{file:f}); }
  if ($files) $files.value="";
  renderFileList();
}
$files?.addEventListener("change", (e)=> addFilesFromInput(e.target.files || []));
$btnPreview?.addEventListener("click", (e)=> { e.preventDefault(); previewQuote(); });

// Init
(function(){ if ($fileList && selectedFiles.size===0){ const p=document.createElement('p'); p.className="muted mt-2"; p.textContent="No files selected yet."; $fileList.appendChild(p); } })();