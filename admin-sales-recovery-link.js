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
  const a=captureAttribution();
  window.WorldTVMarketing={getAttribution:readAttribution,bindCustomer,captureAttribution};
  function ready(){fillReferral();addAdminLinks();const token=localStorage.getItem('wtv_customer_token');if(token&&a)bindCustomer(token).catch(()=>{})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
  new MutationObserver(()=>{fillReferral();addAdminLinks()}).observe(document.documentElement,{childList:true,subtree:true});
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
