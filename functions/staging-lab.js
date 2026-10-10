/** Preview-only customer integration lab. Never served on the production domain. */
import { reply } from "./_lib/staging-auth.js";

const HTML = String.raw`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>WORLD TV | Cloudflare Staging Lab</title>
<style nonce="__NONCE__">
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f8f8fb;background:#100e16;line-height:1.45}
*{box-sizing:border-box}body{margin:0;padding:28px 16px;min-height:100vh;background:radial-gradient(ellipse at 78% 0,#49381a 0%,transparent 45%),#100e16}
main{max-width:960px;margin:0 auto}header{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:12px}
h1{margin:0;font-size:clamp(27px,4vw,46px);letter-spacing:-.05em}small,p{color:#bdb9c8}strong.gold,a{color:#ffd15b}
.warning{background:#38291a;border:1px solid #8e6b34;color:#ffe2a8;padding:14px 16px;border-radius:14px;margin:16px 0 22px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:14px}section{background:#1c1825;border:1px solid #353041;border-radius:18px;padding:18px}
h2{font-size:17px;margin:0 0 12px}p{margin:8px 0;font-size:14px}form{display:grid;gap:10px}
input,button,.button-link{font:inherit;border-radius:10px;padding:11px 13px;min-width:0}input{color:#fff;background:#110e19;border:1px solid #4c4558}
input:focus{outline:2px solid #e4ba52}button{border:0;background:#ecc054;color:#251a03;font-weight:700;cursor:pointer}
button.alt{background:#393342;color:#f4ecdb;border:1px solid #60556d}.buttons{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.button-link{display:inline-block;background:#ecc054;color:#251a03;font-weight:700;text-decoration:none}pre{font-size:12px;white-space:pre-wrap;word-break:break-word;line-height:1.5;min-height:100px;background:#0c0a11;border-radius:12px;padding:16px;overflow:auto}
</style></head><body><main>
<header><div><small>WORLD TV • PRIVATE DEVELOPMENT PREVIEW</small><h1>Cloudflare <strong class="gold">Staging Lab</strong></h1></div><small>No real payments</small></header>
<div class="warning"><b>TEST ACCOUNTS ONLY</b> — Use an allowlisted staging email. Existing customer passwords and real payment details do not belong here.</div>
<div class="grid">
<section><h2>Test account</h2><p>Create, verify or recover your staging account before using the lab.</p><div class="buttons"><a class="button-link" href="/staging-account">Open staging account</a></div></section>
<section><h2>Sign in</h2><form id="login"><input name="email" type="email" placeholder="Test email" autocomplete="username" required><input name="password" type="password" autocomplete="current-password" placeholder="Test password" required><button>Sign in</button></form><div class="buttons"><button class="alt" id="profile">My test account</button><button class="alt" id="logout">Sign out</button></div></section>
<section><h2>Subscription preview</h2><p>Read your own entitlements or generate a draft checkout with no payment URL.</p><div class="buttons"><button id="subscriptions">My subscriptions</button><button class="alt" id="checkout">Create test checkout</button></div><form id="code"><input name="reference" placeholder="WTVTEST- order reference" required><button>Retrieve my unused test code</button></form></section>
<section><h2>Support chat preview</h2><p>Send and read messages isolated to your own staging account.</p><div class="buttons"><button id="start-chat">Start test chat</button><button class="alt" id="refresh-chat">Read my messages</button></div><form id="chat"><input name="message" placeholder="Message for test support" maxlength="2000" required><button>Send message</button></form></section>
</div>
<section style="margin-top:16px"><h2>Staging API response</h2><p>The test API may return 404 while a feature is disabled.</p><pre role="status" aria-live="polite" id="response">No request sent yet.</pre></section>
</main><script nonce="__NONCE__">
(function(){
  'use strict';
  var output=document.getElementById('response');
  function formData(id){return Object.fromEntries(new FormData(document.getElementById(id)));}
  async function send(path,method,data){
    output.textContent='Working...';
    try{
      var options={method:method||'GET',credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}};
      if(data!==undefined){options.headers['content-type']='application/json';options.body=JSON.stringify(data);}
      var response=await fetch(path,options);
      var body=await response.json().catch(function(){return {error:'No JSON response'};});
      output.textContent='HTTP '+response.status+'\n'+JSON.stringify(body,null,2);
    }catch(error){output.textContent='Request failed: '+String(error);}
  }
  function onForm(id,path){document.getElementById(id).addEventListener('submit',function(event){event.preventDefault();send(path,'POST',formData(id));});}
  onForm('login','/api/staging/auth/login');
  onForm('chat','/api/staging/chat/send');
  document.getElementById('code').addEventListener('submit',function(event){event.preventDefault();send('/api/staging/subscriptions/test-code?reference='+encodeURIComponent(formData('code').reference),'GET');});
  [
    ['profile','/api/staging/auth/me','GET'],
    ['logout','/api/staging/auth/logout','POST'],
    ['subscriptions','/api/staging/subscriptions','GET'],
    ['checkout','/api/staging/payment/checkout-draft','POST',{plan_slug:'annual'}],
    ['start-chat','/api/staging/chat/start','POST',{page_path:'/staging-lab'}],
    ['refresh-chat','/api/staging/chat/messages','GET']
  ].forEach(function(command){document.getElementById(command[0]).addEventListener('click',function(){send(command[1],command[2],command[3]);});});
})();
</script></body></html>`;

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  if (url.hostname !== "worldtv-preview.pages.dev" ||
      context.env?.WORLDTV_STAGING_AUTH_ENABLED !== "true" ||
      context.env?.WORLDTV_STAGING_UI_ENABLED !== "true") {
    return reply({ error: "Not found" }, 404);
  }
  const random = crypto.getRandomValues(new Uint8Array(24));
  const nonce = Array.from(random, value => value.toString(16).padStart(2, "0")).join("");
  return new Response(HTML.replaceAll("__NONCE__", nonce), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; connect-src 'self'; style-src 'nonce-" + nonce + "'; script-src 'nonce-" + nonce + "'"
    }
  });
}
