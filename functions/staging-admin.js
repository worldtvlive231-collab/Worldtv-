import { reply } from './_lib/staging-auth.js';
import { requireStagingAdmin } from './_lib/staging-admin-access.js';

const HTML = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>WORLD TV | Admin staging</title><style nonce="__NONCE__">
:root{font:15px system-ui;color:#f8f8fb;background:#0d0b12;line-height:1.45}*{box-sizing:border-box}body{margin:0;padding:24px}main{max-width:1050px;margin:auto}
h1{color:#f4c64d}.warning,section{border:1px solid #393342;border-radius:16px;padding:16px;margin:14px 0;background:#1b1723}.warning{background:#38291a;color:#ffe2a8}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}form,.buttons{display:flex;gap:8px;flex-wrap:wrap;margin:9px 0}input,select,button{font:inherit;padding:9px 11px;border-radius:9px}
input,select{background:#0d0b12;color:#fff;border:1px solid #51495e}button{border:0;background:#f4c64d;color:#251a03;font-weight:700;cursor:pointer}button.alt{background:#3e3748;color:#fff}
pre{white-space:pre-wrap;word-break:break-word;background:#08070b;border-radius:12px;padding:14px;min-height:180px}a{color:#f4c64d}
</style></head><body><main><h1>Cloudflare staging admin</h1><div class="warning"><b>TEST ENVIRONMENT.</b> Cloudflare Access identity and the D1 admin role are both required. Production actions are unavailable.</div>
<div class="grid"><section><h2>Create reseller</h2><form id="create"><input name="name" placeholder="Name" required><input name="email" type="email" placeholder="Email" required><input name="phone" placeholder="Phone"><input name="commission_percent" type="number" min="0" max="100" step="0.1" value="10" required><input name="password" type="password" minlength="12" autocomplete="new-password" placeholder="Temporary staging password" required><button>Create</button></form></section>
<section><h2>Manage reseller</h2><form id="allocate"><input name="reseller_id" type="number" min="1" placeholder="Reseller ID" required><input name="count" type="number" min="1" max="1000" value="1" required><button>Allocate test codes</button></form><form id="status"><input name="reseller_id" type="number" min="1" placeholder="Reseller ID" required><select name="status"><option value="active">Active</option><option value="suspended">Suspended</option></select><button>Set status</button></form></section></div>
<section><h2>Existing-customer continuity</h2><p>Stage one approved Railway entitlement. The database stores only keyed digests of the email and source record ID.</p><form id="continuity"><input name="source_record_id" placeholder="Railway record ID" required><input name="email" type="email" placeholder="Verified customer email" required><input name="ends_at" placeholder="2027-01-31T23:59:59Z" required><button>Stage entitlement</button></form></section>
<section><h2>Pocketi test payment reports — manual review only</h2>
<p>Use Pocketi merchant records independently; a customer-supplied reference is not proof of payment. This staging panel never marks orders paid or issues activation codes.</p>
<div class="buttons"><button id="pocketi-queue">Load Pocketi test reports</button></div>
<form id="pocketi-review">
<input name="report_id" type="number" min="1" placeholder="Report ID" required>
<select name="decision"><option value="rejected">Reject report</option><option value="verified">Verified in Pocketi merchant records</option></select>
<input name="verified_amount_pesewas" type="number" min="1" step="1" placeholder="Merchant amount in GHS pesewas, if verified">
<input name="review_note" maxlength="300" minlength="10" placeholder="Review note (10-300 characters)" required>
<label><input name="merchant_confirmed" type="checkbox">I independently checked the merchant record and amount (required to verify)</label>
<button>Save staging review</button>
</form></section>
<section><h2>Customer support inbox</h2><p>Use the Chat queue button below to find a conversation ID. Messages and actions remain isolated to staging.</p><form id="thread"><input name="conversation_id" type="number" min="1" step="1" placeholder="Conversation ID" required><button>Read conversation</button></form><form id="reply"><input name="conversation_id" type="number" min="1" step="1" placeholder="Conversation ID" required><input name="message" maxlength="2000" placeholder="Reply to customer" required><button>Send reply</button></form><form id="close-chat"><input name="conversation_id" type="number" min="1" step="1" placeholder="Conversation ID" required><button class="alt">Close conversation</button></form></section>
<section><h2>Operations</h2><div class="buttons"><button data-get="overview">Overview</button><button data-get="resellers">Resellers</button><button data-get="activation-deliveries">Activation delivery</button><button data-get="continuity-entitlements">Continuity</button><button data-get="chats">Chat queue</button></div><form id="delivery"><input name="order_id" type="number" min="1" placeholder="Order ID" required><button>Retry activation email</button></form><pre id="output" role="status" aria-live="polite">No request sent.</pre></section><p><a href="/">Back to staging home</a></p>
<script nonce="__NONCE__">(function(){'use strict';var output=document.getElementById('output');async function send(path,method,data){output.textContent='Working...';try{var options={method:method,credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}};if(data!==undefined){options.headers['content-type']='application/json';options.body=JSON.stringify(data);}var response=await fetch(path,options);var body=await response.json().catch(function(){return {error:'Invalid response'};});output.textContent='HTTP '+response.status+'\n'+JSON.stringify(body,null,2);}catch(error){output.textContent='Request failed';}}
function values(id){return Object.fromEntries(new FormData(document.getElementById(id)));}document.getElementById('create').addEventListener('submit',function(e){e.preventDefault();var data=values('create');data.commission_percent=Number(data.commission_percent);send('/api/staging/admin/resellers','POST',data);});document.getElementById('allocate').addEventListener('submit',function(e){e.preventDefault();var data=values('allocate');send('/api/staging/admin/reseller-allocate','POST',{reseller_id:Number(data.reseller_id),count:Number(data.count)});});document.getElementById('status').addEventListener('submit',function(e){e.preventDefault();var data=values('status');send('/api/staging/admin/reseller-status','POST',{reseller_id:Number(data.reseller_id),status:data.status});});document.getElementById('continuity').addEventListener('submit',function(e){e.preventDefault();var data=values('continuity');send('/api/staging/admin/continuity-entitlements','POST',{entries:[{source_record_id:data.source_record_id,email:data.email,plan_slug:'annual',ends_at:data.ends_at}]});});document.getElementById('pocketi-queue').addEventListener('click',function(){send('/api/staging/admin/pocketi-manual-reports','GET');});
document.getElementById('pocketi-review').addEventListener('submit',function(e){e.preventDefault();var data=values('pocketi-review');send('/api/staging/admin/pocketi-manual-review','POST',{report_id:Number(data.report_id),decision:data.decision,verified_amount_pesewas:data.verified_amount_pesewas?Number(data.verified_amount_pesewas):null,review_note:data.review_note,merchant_confirmed:data.merchant_confirmed==='on'});});
document.getElementById('delivery').addEventListener('submit',function(e){e.preventDefault();var data=values('delivery');send('/api/staging/admin/activation-delivery-retry','POST',{order_id:Number(data.order_id)});});document.getElementById('thread').addEventListener('submit',function(e){e.preventDefault();var id=Number(values('thread').conversation_id);if(!Number.isSafeInteger(id)||id<=0)return;send('/api/staging/admin/chat-messages?conversation_id='+encodeURIComponent(id),'GET');});
document.getElementById('reply').addEventListener('submit',function(e){e.preventDefault();var data=values('reply');var id=Number(data.conversation_id);if(!Number.isSafeInteger(id)||id<=0||!data.message.trim())return;send('/api/staging/admin/chat-reply','POST',{conversation_id:id,message:data.message});});
document.getElementById('close-chat').addEventListener('submit',function(e){e.preventDefault();var id=Number(values('close-chat').conversation_id);if(!Number.isSafeInteger(id)||id<=0)return;send('/api/staging/admin/chat-close','POST',{conversation_id:id});});
document.querySelectorAll('[data-get]').forEach(function(button){button.addEventListener('click',function(){send('/api/staging/admin/'+button.dataset.get,'GET');});});})();</script></main></body></html>`;

export async function onRequestGet(context) {
  if (context.env?.WORLDTV_STAGING_ADMIN_UI_ENABLED !== 'true') return reply({ error: 'Not found' }, 404);
  const auth = await requireStagingAdmin(context);
  if (auth.response) return auth.response;
  const nonce = crypto.randomUUID().replaceAll('-', '');
  return new Response(HTML.replaceAll('__NONCE__', nonce), { headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': `default-src 'none'; connect-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`
  } });
}
