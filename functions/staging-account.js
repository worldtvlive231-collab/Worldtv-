import { gate, reply } from './_lib/staging-auth.js';

export async function onRequestGet(context) {
  const blocked = gate(context);
  if (blocked) return blocked;
  if (context.env.WORLDTV_STAGING_UI_ENABLED !== 'true' || context.env.WORLDTV_STAGING_IDENTITY_ENABLED !== 'true')
    return reply({ error: 'Not found' }, 404);
  const sitekey = context.env.WORLDTV_TURNSTILE_SITEKEY;
  if (typeof sitekey !== 'string' || !/^[A-Za-z0-9_-]{10,100}$/.test(sitekey)) return reply({ error: 'Service unavailable' }, 503);
  const nonce = crypto.randomUUID().replaceAll('-','');
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>WORLD TV staging account</title>
<style nonce="${nonce}">body{font:16px system-ui;background:#101827;color:#f7f9fc;margin:0}main{max-width:600px;margin:2rem auto;padding:1rem}section{border:1px solid #506079;border-radius:12px;padding:1rem;margin:1rem 0}label{display:block;margin:12px 0}input,button{font:inherit;box-sizing:border-box;width:100%;padding:12px;border-radius:6px}input{margin-top:6px}button{background:#ffe28a;color:#111;cursor:pointer}a{color:#ffe28a}#result{white-space:pre-wrap}</style></head><body><main>
<h1>WORLD TV staging account</h1><p>Isolated test accounts only. No real payments. Existing Railway accounts are not available here.</p>
<p><a href="/staging-lab">Subscription and chat test lab</a></p>
<section><h2>Create test account</h2><form id="register"><label>Name<input name="name" required maxlength="120" autocomplete="name"></label><label>Email<input name="email" type="email" required autocomplete="email"></label><label>Password (12–128 characters)<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><div class="cf-turnstile" data-sitekey="${sitekey}" data-action="register"></div><button>Create account and send verification</button></form></section>
<section><h2>Sign in</h2><form id="login"><label>Email<input name="email" type="email" required autocomplete="username"></label><label>Password<input name="password" type="password" required autocomplete="current-password"></label><button>Sign in</button></form><button id="logout" type="button">Sign out</button></section>
<section><h2>Email help</h2><form id="request-email"><label>Email<input name="email" type="email" required autocomplete="email"></label><label>Action<select name="purpose"><option value="verify">Resend verification</option><option value="reset">Recover password</option></select></label><button>Request email</button></form></section>
<section id="complete-section" hidden><h2 id="complete-title">Complete email action</h2><form id="complete-email"><label id="new-password-label" hidden>New password<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password"></label><button id="complete-button">Confirm</button></form></section>
<p id="result" role="status" aria-live="polite"></p>
<script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<script nonce="${nonce}">
const result=document.getElementById('result');
const fragment=new URLSearchParams(location.hash.slice(1));
let purpose=fragment.has('verify')?'verify':fragment.has('reset')?'reset':null;
let token=purpose?fragment.get(purpose):null;
history.replaceState(null,'',location.pathname);
if(purpose&&/^[A-Za-z0-9_-]{43}$/.test(token||'')){
 document.getElementById('complete-section').hidden=false;
 document.getElementById('complete-title').textContent=purpose==='verify'?'Verify your email':'Set a new password';
 document.getElementById('new-password-label').hidden=purpose!=='reset';
 document.querySelector('#complete-email input').required=purpose==='reset';
}else{purpose=null;token=null;}
async function post(path,body){
 const response=await fetch('/api/staging/auth/'+path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const json=await response.json();result.textContent=json.error||json.status;
 if(!response.ok)throw new Error('request failed');return json;
}
for(const id of ['register','login','request-email','complete-email']){
 document.getElementById(id).addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button');button.disabled=true;
  const body=Object.fromEntries(new FormData(form));
  if(id==='register'){body.turnstileToken=body['cf-turnstile-response'];delete body['cf-turnstile-response'];}
  if(id==='complete-email'){body.purpose=purpose;body.token=token;if(purpose!=='reset')delete body.password;}
  try{await post(id,body);if(id==='complete-email'){token=null;document.getElementById('complete-section').hidden=true;}form.reset();}
  catch(error){if(error.message!=='request failed')result.textContent='Request unavailable. Try again.';}
  finally{button.disabled=false;if(id==='register'&&window.turnstile)window.turnstile.reset();}
 });
}
document.getElementById('logout').addEventListener('click',()=>post('logout',{}).catch(()=>{}));
</script></main></body></html>`, {headers:{
    'content-type':'text/html; charset=utf-8','cache-control':'no-store', 'x-robots-tag':'noindex, nofollow',
    'referrer-policy':'no-referrer','x-content-type-options':'nosniff',
    'content-security-policy':`default-src 'none'; script-src 'nonce-${nonce}' https://challenges.cloudflare.com; style-src 'nonce-${nonce}'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`
  }});
}
