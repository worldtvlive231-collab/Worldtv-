import { reply } from './_lib/staging-auth.js';
import { resellerGate } from './_lib/staging-reseller.js';

const HTML = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>WORLD TV | Reseller staging</title><style nonce="__NONCE__">
:root{font:16px system-ui;color:#f8f8fb;background:#100e16;line-height:1.45}*{box-sizing:border-box}body{margin:0;padding:24px}
main{max-width:900px;margin:auto}h1{color:#f4c64d}.warning,section{border:1px solid #393342;border-radius:16px;padding:16px;margin:14px 0;background:#1c1825}
.warning{background:#38291a;color:#ffe2a8}form,.buttons{display:flex;gap:9px;flex-wrap:wrap;margin:10px 0}input,button{font:inherit;padding:10px 12px;border-radius:9px}
input{background:#100e16;color:#fff;border:1px solid #51495e}button{border:0;background:#f4c64d;color:#251a03;font-weight:700;cursor:pointer}button.alt{background:#3e3748;color:#fff}
pre{white-space:pre-wrap;word-break:break-word;background:#0b0910;border-radius:12px;padding:14px;min-height:100px}a{color:#f4c64d}
</style></head><body><main><h1>Reseller staging</h1><div class="warning"><b>TEST CODES ONLY.</b> Do not use live customer credentials or sell codes generated here.</div>
<section><h2>Sign in</h2><form id="login"><input name="email" type="email" autocomplete="username" placeholder="Staging reseller email" required><input name="password" type="password" autocomplete="current-password" placeholder="Password" required><button>Sign in</button></form></section>
<section><h2>Code allocation</h2><form id="generate"><input name="count" type="number" min="1" max="20" value="1" required><button>Generate test codes</button></form><div class="buttons"><button class="alt" id="dashboard">Refresh dashboard</button><button class="alt" id="logout">Sign out</button></div></section>
<section><h2>Reseller quota</h2><p id="quota" role="status" aria-live="polite">Sign in, then refresh the dashboard to see remaining staging code quota.</p></section>
<section><h2>Secure response</h2><p>New test codes appear only in the generation response. Save them in an approved test location.</p><pre id="output" role="status" aria-live="polite">No request sent.</pre></section><p><a href="/">Back to staging home</a></p>
<script nonce="__NONCE__">(function(){'use strict';var output=document.getElementById('output');
async function send(path,method,data){output.textContent='Working...';try{var options={method:method,credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}};if(data!==undefined){options.headers['content-type']='application/json';options.body=JSON.stringify(data);}var response=await fetch(path,options);var body=await response.json().catch(function(){return {error:'Invalid response'};});output.textContent='HTTP '+response.status+'\n'+JSON.stringify(body,null,2);return {ok:response.ok,body:body};}catch(error){output.textContent='Request failed';}}
function values(id){return Object.fromEntries(new FormData(document.getElementById(id)));}
document.getElementById('login').addEventListener('submit',function(event){event.preventDefault();var form=event.currentTarget;var valuesToSend=values('login');form.querySelector('input[name=password]').value='';send('/api/staging/reseller/login','POST',valuesToSend);});
document.getElementById('generate').addEventListener('submit',function(event){event.preventDefault();var data=values('generate');send('/api/staging/reseller/generate-codes','POST',{count:Number(data.count)});});
document.getElementById('dashboard').addEventListener('click',function(){send('/api/staging/reseller/dashboard','GET').then(function(r){if(r?.ok&&r.body?.quota){var q=r.body.quota;document.getElementById('quota').textContent='Allocated: '+q.allocated_count+' | Used: '+q.used_count+' | Available: '+q.available_count;}});});
document.getElementById('logout').addEventListener('click',function(){output.textContent='Clearing displayed codes...';document.getElementById('quota').textContent='Signed out';send('/api/staging/reseller/logout','POST',{}).then(function(r){if(r?.ok)output.textContent='Signed out. Previously displayed codes cleared from this page.';});});})();</script></main></body></html>`;

export async function onRequestGet(context) {
  if (context.env?.WORLDTV_STAGING_RESELLER_UI_ENABLED !== 'true') return reply({ error: 'Not found' }, 404);
  const blocked = resellerGate(context);
  if (blocked) return blocked;
  const nonce = crypto.randomUUID().replaceAll('-', '');
  return new Response(HTML.replaceAll('__NONCE__', nonce), { headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': `default-src 'none'; connect-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`
  } });
}
