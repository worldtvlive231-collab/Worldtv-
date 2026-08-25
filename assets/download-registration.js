(()=>{
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let modal=null;
function build(){
 if(modal)return modal;
 modal=document.createElement('div');
 modal.id='downloadRegistrationModal';
 modal.style.cssText='display:none;position:fixed;inset:0;background:#0009;z-index:99999;align-items:center;justify-content:center;padding:16px';
 modal.innerHTML=`<div style="background:#fff;width:min(560px,100%);max-height:92vh;overflow:auto;border-radius:22px;padding:24px;box-shadow:0 25px 70px #0004;position:relative">
 <button id="dlRegClose" aria-label="Close" style="position:absolute;right:15px;top:10px;border:0;background:none;font-size:28px;cursor:pointer">×</button>
 <div style="text-align:center"><img src="/world-tv-logo.png" alt="WORLD TV" style="height:70px;max-width:180px;object-fit:contain"><h2 style="margin:8px 0">Create Your Official WORLD TV Account</h2><p style="color:#716958;line-height:1.5">Register once, download the app, then use the same email and password to log in and subscribe. No second account is needed.</p></div>
 <form id="dlRegForm">
  <label style="display:block;font-weight:800;margin:10px 0 5px">Full Name *</label><input id="dlName" required autocomplete="name" style="width:100%;padding:12px;border:1px solid #d8ccb2;border-radius:10px">
  <label style="display:block;font-weight:800;margin:10px 0 5px">Email Address *</label><input id="dlEmail" required type="email" autocomplete="email" style="width:100%;padding:12px;border:1px solid #d8ccb2;border-radius:10px">
  <label style="display:block;font-weight:800;margin:10px 0 5px">Password *</label><input id="dlPassword" required type="password" minlength="8" autocomplete="new-password" placeholder="At least 8 characters" style="width:100%;padding:12px;border:1px solid #d8ccb2;border-radius:10px">
  <label style="display:block;font-weight:800;margin:10px 0 5px">Referral Code <span style="color:#716958;font-weight:500">(optional)</span></label><input id="dlReferral" autocomplete="off" placeholder="WTV..." style="width:100%;padding:12px;border:1px solid #d8ccb2;border-radius:10px;text-transform:uppercase">
  <button id="dlSubmit" type="submit" style="width:100%;border:0;border-radius:13px;padding:15px;font-weight:900;font-size:16px;background:linear-gradient(135deg,#f4c542,#d89a00);cursor:pointer">Create Account & Download App</button>
  <div id="dlRegMsg" style="margin-top:12px;font-size:13px;color:#716958;text-align:center"></div>
  <p style="text-align:center;color:#716958;font-size:13px;margin:14px 0 0">Already registered? <a href="/login.html?next=/download.html" style="color:#8a6100;font-weight:800">Log in to your official account</a></p>
 </form></div>`;
 document.body.appendChild(modal);
 modal.querySelector('#dlRegClose').onclick=()=>modal.style.display='none';
 modal.addEventListener('click',e=>{if(e.target===modal)modal.style.display='none'});
 modal.querySelector('#dlRegForm').addEventListener('submit',submit);
 const attribution=window.WorldTVMarketing?.getAttribution?.();
 if(attribution?.referral_code)modal.querySelector('#dlReferral').value=attribution.referral_code;
 return modal;
}
async function submit(e){
 e.preventDefault();
 const btn=document.getElementById('dlSubmit'),msg=document.getElementById('dlRegMsg');
 btn.disabled=true;msg.style.color='#716958';msg.textContent='Creating your official account and preparing your download...';
 try{
  const account={name:document.getElementById('dlName').value.trim(),email:document.getElementById('dlEmail').value.trim(),password:document.getElementById('dlPassword').value,referral_code:document.getElementById('dlReferral').value.trim().toUpperCase()};
  const r=await fetch('/api/customer/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(account)});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Registration failed.');
  localStorage.setItem('wtv_customer_token',d.token);
  localStorage.setItem('wtv_download_registered_email',account.email.toLowerCase());
  try{await window.WorldTVMarketing?.bindCustomer?.(d.token)}catch(_){}
  fetch('/api/download/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:account.name,email:account.email})}).catch(()=>{});
  msg.style.color='#1e6b34';msg.textContent='Account created! Check your welcome email for your 3-day trial, the $23 yearly plan, payment methods and subscription link. Your download is starting.';
  setTimeout(()=>{window.location.href='/api/app/download'},700);
 }catch(err){msg.style.color='#8d2222';msg.textContent=err.message||'Registration failed. Please try again.';btn.disabled=false;}
}
function intercept(e){
 const t=e.target.closest&&e.target.closest('button,a');if(!t)return;
 // Never intercept clicks inside the registration modal itself. In particular,
 // the submit button contains the words "Download App" and was previously being
 // caught here before the form submit event could run.
 if(t.closest('#downloadRegistrationModal'))return;
 const text=(t.textContent||'').toLowerCase();const onclick=t.getAttribute('onclick')||'';
 if(!text.includes('download app')&&!onclick.includes('downloadApp'))return;
 e.preventDefault();e.stopImmediatePropagation();build().style.display='flex';
}
document.addEventListener('click',intercept,true);
})();
