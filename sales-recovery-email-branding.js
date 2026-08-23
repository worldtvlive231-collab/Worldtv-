'use strict';

require('dotenv').config();

const BASE=String(process.env.PUBLIC_BASE_URL||process.env.APP_URL||'https://myworldtvlive.com').replace(/\/+$/,'');
const LOGO_URL=`${BASE}/world-tv-logo.png`;

function esc(v){
  return String(v||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function extractUrl(text,label){
  const re=new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*(https?:\\/\\/\\S+)`,'i');
  const m=String(text||'').match(re);
  return m?m[1]:'';
}

function stripUtilityLines(text){
  return String(text||'')
    .replace(/\n?\s*Subscribe \/ renew:\s*https?:\/\/\S+/ig,'')
    .replace(/\n?\s*To stop sales-recovery reminders:\s*https?:\/\/\S+/ig,'')
    .trim();
}

function brandedHtml(text){
  const subscribe=extractUrl(text,'Subscribe / renew:')||`${BASE}/subscribe.html`;
  const unsubscribe=extractUrl(text,'To stop sales-recovery reminders:');
  const clean=stripUtilityLines(text);
  const body=esc(clean).replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>');

  return `<!doctype html><html><body style="margin:0;background:#fffaf0;font-family:Arial,sans-serif;color:#17130a"><div style="max-width:680px;margin:0 auto;padding:26px 18px"><div style="background:#fff;border:1px solid #eadfc8;border-radius:18px;padding:28px;box-shadow:0 8px 28px rgba(79,55,0,.08)"><div style="text-align:center;margin-bottom:24px"><img src="${LOGO_URL}" alt="WORLD TV" width="150" style="display:inline-block;max-width:150px;height:auto;border:0"><div style="font-size:12px;color:#8a6b1d;margin-top:6px">Watch Anywhere. Enjoy More.</div></div><div style="font-size:16px;line-height:1.65;color:#29251d"><p>${body}</p></div><div style="text-align:center;margin:26px 0 8px"><a href="${esc(subscribe)}" style="display:inline-block;background:#e0a200;color:#17130a;text-decoration:none;font-weight:800;padding:14px 24px;border-radius:10px">Complete Subscription</a></div><div style="margin-top:22px;padding:16px;border-radius:12px;background:#fff8df;border:1px solid #efd78f;text-align:center;font-size:14px;color:#6d5b2f">Need help? Visit <a href="${BASE}/download.html" style="color:#8a6200;font-weight:700">WORLD TV Support</a></div>${unsubscribe?`<div style="text-align:center;margin-top:20px;font-size:12px;color:#8b8274"><a href="${esc(unsubscribe)}" style="color:#8b8274;text-decoration:underline">Unsubscribe from sales reminders</a></div>`:''}</div></div></body></html>`;
}

const originalFetch=globalThis.fetch;
if(typeof originalFetch==='function'&&!globalThis.__wtvSalesRecoveryEmailBranding){
  globalThis.__wtvSalesRecoveryEmailBranding=true;
  globalThis.fetch=async function(input,init){
    try{
      const url=typeof input==='string'?input:(input&&input.url)||'';
      const headers=init&&init.headers||{};
      const key=(headers['Idempotency-Key']||headers['idempotency-key']||'');
      if(url==='https://api.resend.com/emails'&&String(key).startsWith('worldtv-email-')&&init&&typeof init.body==='string'){
        const payload=JSON.parse(init.body);
        if(payload&&payload.text){
          const unsubscribe=extractUrl(payload.text,'To stop sales-recovery reminders:');
          payload.html=brandedHtml(payload.text);
          if(unsubscribe){
            payload.headers=Object.assign({},payload.headers||{}, {'List-Unsubscribe':`<${unsubscribe}>`});
          }
          init=Object.assign({},init,{body:JSON.stringify(payload)});
        }
      }
    }catch(e){
      console.error('Sales recovery branding guard:',e.message);
    }
    return originalFetch.call(this,input,init);
  };
}
