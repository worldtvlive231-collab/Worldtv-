"use strict";

const fs = require("fs");
const path = require("path");

const assetPath = path.join(__dirname, "assets", "site-meta.js");
let baseAsset = "";
try { baseAsset = fs.readFileSync(assetPath, "utf8"); }
catch (error) { console.error("Admin enhancement asset read error:", error.message); }

const enhancement = `
;(()=>{
  const ATTR_KEY='wtv_marketing_attribution';
  const VISITOR_KEY='wtv_marketing_visitor';
  const safe=v=>String(v||'').trim().slice(0,300);
  const visitor=()=>{
    let id=localStorage.getItem(VISITOR_KEY);
    if(!id){id=(globalThis.crypto&&crypto.randomUUID)?crypto.randomUUID():'wtv-'+Date.now()+'-'+Math.random().toString(36).slice(2);localStorage.setItem(VISITOR_KEY,id)}
    return id;
  };
  function readAttribution(){try{return JSON.parse(localStorage.getItem(ATTR_KEY)||'null')}catch(e){return null}}
  function captureAttribution(){
    const p=new URLSearchParams(location.search);
    const has=['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ref','referral','referral_code'].some(k=>p.get(k));
    let a=readAttribution();
    if(has){
      a={visitor_id:visitor(),source:safe(p.get('utm_source')||'direct'),medium:safe(p.get('utm_medium')),campaign:safe(p.get('utm_campaign')),content:safe(p.get('utm_content')),term:safe(p.get('utm_term')),referral_code:safe(p.get('ref')||p.get('referral')||p.get('referral_code')).toUpperCase(),landing_path:location.pathname,referrer:safe(document.referrer),captured_at:new Date().toISOString()};
      localStorage.setItem(ATTR_KEY,JSON.stringify(a));
      fetch('/api/marketing/visit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(a),keepalive:true}).catch(()=>{});
    }
    return a;
  }
  async function bindCustomer(token){
    const a=readAttribution();if(!a||!token)return null;
    const r=await fetch('/api/customer/marketing-attribution',{method:'POST',headers:{'Content-Type':'application/json','x-customer-token':token},body:JSON.stringify(a)});
    if(!r.ok)return null;return r.json().catch(()=>null);
  }
  function fillReferral(){const a=readAttribution(),input=document.getElementById('referral_code');if(a?.referral_code&&input&&!input.value)input.value=a.referral_code}
  function addAdminLinks(){
    if(!/^\\/admin(?:\\.html)?$/.test(location.pathname))return;
    const tabs=document.querySelector('#dashboard .tabs');if(!tabs)return;
    if(!document.getElementById('salesRecoveryLink')){
      const link=document.createElement('a');link.id='salesRecoveryLink';link.className='btn tab';link.href='/sales-recovery.html';link.textContent='Sales Recovery';link.style.textDecoration='none';
      const tv=[...tabs.children].find(el=>/TV Match Channels/i.test(el.textContent||''));tv?tabs.insertBefore(link,tv):tabs.appendChild(link);
    }
    if(!document.getElementById('marketingAttributionLink')){
      const link=document.createElement('a');link.id='marketingAttributionLink';link.className='btn tab';link.href='/marketing-dashboard.html';link.textContent='Marketing Attribution';link.style.textDecoration='none';
      const sr=document.getElementById('salesRecoveryLink');sr?.nextSibling?tabs.insertBefore(link,sr.nextSibling):tabs.appendChild(link);
    }
  }
  function addCommunitySection(){
    if(!/^\\/(?:index\\.html)?$/.test(location.pathname)||document.getElementById('community'))return;
    const support=document.getElementById('support');if(!support)return;
    if(!document.getElementById('worldTvCommunityStyles')){
      const style=document.createElement('style');style.id='worldTvCommunityStyles';style.textContent='.community-section{background:linear-gradient(135deg,#090714,#101b38 52%,#16091f);color:#fff;position:relative;overflow:hidden}.community-section:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 18% 12%,rgba(42,171,238,.18),transparent 35%),radial-gradient(circle at 82% 84%,rgba(37,211,102,.14),transparent 35%);pointer-events:none}.community-section .community-inner{position:relative}.community-section .section-head p{color:#c9c6d6}.community-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px;max-width:920px;margin:auto}.community-card{background:rgba(255,255,255,.98);color:#17130a;border-radius:24px;padding:24px;display:grid;grid-template-columns:150px 1fr;gap:22px;align-items:center;box-shadow:0 18px 55px rgba(0,0,0,.24);border:1px solid rgba(255,255,255,.5)}.community-card img{width:150px;height:150px;background:#fff;border-radius:18px;padding:8px}.community-card h3{font-size:25px;margin:0 0 6px}.community-handle{font-size:18px;font-weight:900;word-break:break-word;margin:6px 0 16px}.community-card p{color:#625d6a;line-height:1.55;margin:0 0 16px}.community-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 17px;border-radius:12px;font-weight:900;color:#fff;text-decoration:none}.telegram-button{background:#229ED9}.whatsapp-button{background:#1da851}.community-note{text-align:center;color:#bdb8ca;font-size:13px;margin-top:22px}.community-logo{display:block;width:100px;margin:0 auto 14px;filter:drop-shadow(0 8px 18px rgba(0,0,0,.28))}@media(max-width:760px){.community-grid{grid-template-columns:1fr}.community-card{grid-template-columns:110px 1fr;padding:18px}.community-card img{width:110px;height:110px}.community-card h3{font-size:21px}}@media(max-width:460px){.community-card{grid-template-columns:1fr;text-align:center}.community-card img{margin:auto}.community-button{width:100%}}';document.head.appendChild(style);
    }
    const section=document.createElement('section');section.id='community';section.className='community-section';section.innerHTML='<div class="wrap community-inner"><img class="community-logo" src="/world-tv-logo.png" alt="WORLD TV"><div class="section-head"><h2>Join the WORLD TV Community</h2><p>Get customer support, subscription help and WORLD TV updates. Scan a code or tap a button to connect.</p></div><div class="community-grid"><article class="community-card"><img src="/assets/telegram-qr.svg" alt="Scan to join WORLD TV on Telegram"><div><h3>Telegram</h3><div class="community-handle">@MYWORLDTVLIVE</div><p>Join our Telegram community for WORLD TV updates and customer information.</p><a class="community-button telegram-button" href="https://t.me/MYWORLDTVLIVE" target="_blank" rel="noopener">✈ Join on Telegram</a></div></article><article class="community-card"><img src="/assets/whatsapp-qr.svg" alt="Scan to chat with WORLD TV on WhatsApp"><div><h3>WhatsApp</h3><div class="community-handle">+1 (530) 904-0310</div><p>Chat directly with WORLD TV for subscription, setup and customer support.</p><a class="community-button whatsapp-button" href="https://wa.me/15309040310?text=Hello%20WORLD%20TV%2C%20I%20need%20help." target="_blank" rel="noopener">💬 Chat on WhatsApp</a></div></article></div><div class="community-note">WORLD TV customer support • Scan or tap to connect</div></div>';
    support.parentNode.insertBefore(section,support);
    const nav=document.querySelector('header nav');if(nav&&!nav.querySelector('a[href="#community"]')){const link=document.createElement('a');link.href='#community';link.textContent='Community';nav.appendChild(link)}
  }
  const a=captureAttribution();
  window.WorldTVMarketing={getAttribution:readAttribution,bindCustomer,captureAttribution};
  function ready(){fillReferral();addAdminLinks();addCommunitySection();const token=localStorage.getItem('wtv_customer_token');if(token&&a)bindCustomer(token).catch(()=>{})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
  new MutationObserver(()=>{fillReferral();addAdminLinks();addCommunitySection()}).observe(document.documentElement,{childList:true,subtree:true});
})();
`;

const expressPath = require.resolve("express");
const originalExpress = require(expressPath);
function wrappedExpress(...args) {
  const app = originalExpress(...args);
  app.get("/assets/site-meta.js", (req, res) => {
    res.set("Cache-Control", "no-store, max-age=0");
    res.type("application/javascript").send(baseAsset + enhancement);
  });
  return app;
}
Object.assign(wrappedExpress, originalExpress);
Object.setPrototypeOf(wrappedExpress, Object.getPrototypeOf(originalExpress));
require.cache[expressPath].exports = wrappedExpress;
