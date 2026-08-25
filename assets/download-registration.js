(()=>{
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let modal=null;
function build(){
 if(modal)return modal;
 modal=document.createElement('div');
 modal.id='downloadRegistrationModal';
 modal.style.cssText='display:none;position:fixed;inset:0;background:#0009;z-index:99999;align-items:center;justify-content:center;padding:10px';
 modal.innerHTML=`<div style="background:#fff;width:min(440px,100%);max-height:88vh;overflow:auto;border-radius:18px;padding:16px;box-shadow:0 25px 70px #0004;position:relative">
 <button id="dlRegClose" aria-label="Close" style="position:absolute;right:10px;top:6px;border:0;background:none;font-size:24px;cursor:pointer;z-index:2">×</button>
 <div style="text-align:center"><img src="/world-tv-logo.png" alt="WORLD TV" style="height:48px;max-width:130px;object-fit:contain"><h2 style="font-size:21px;line-height:1.15;margin:4px 25px 5px">Create Your Official WORLD TV Account</h2><p style="font-size:13px;margin:0 4px 8px;color:#716958;line-height:1.35">Register once, then use the same email and password in the app. No second account is needed.</p></div>
 <form id="dlRegForm">
  <label style="display:block;font-size:13px;font-weight:800;margin:6px 0 3px">Full Name *</label><input id="dlName" required autocomplete="name" style="width:100%;padding:10px;border:1px solid #d8ccb2;border-radius:9px;font-size:14px">
  <label style="display:block;font-size:13px;font-weight:800;margin:6px 0 3px">Email Address *</label><input id="dlEmail" required type="email" autocomplete="email" style="width:100%;padding:10px;border:1px solid #d8ccb2;border-radius:9px;font-size:14px">
  <label style="display:block;font-size:13px;font-weight:800;margin:6px 0 3px">Password *</label><input id="dlPassword" required type="password" minlength="8" autocomplete="new-password" placeholder="At least 8 characters" style="width:100%;padding:10px;border:1px solid #d8ccb2;border-radius:9px;font-size:14px">
  <label style="display:block;font-size:13px;font-weight:800;margin:6px 0 3px">Referral Code <span style="color:#716958;font-weight:500">(optional)</span></label><input id="dlReferral" autocomplete="off" placeholder="WTV..." style="width:100%;padding:10px;border:1px solid #d8ccb2;border-radius:9px;text-transform:uppercase;font-size:14px">
  <button id="dlSubmit" type="submit" style="width:100%;border:0;border-radius:11px;padding:12px;font-weight:900;font-size:14px;background:linear-gradient(135deg,#f4c542,#d89a00);cursor:pointer">Create Account & Download App</button>
  <div id="dlRegMsg" style="margin-top:8px;font-size:12px;line-height:1.35;color:#716958;text-align:center"></div>
  <p style="text-align:center;color:#716958;font-size:12px;margin:9px 0 0">Already registered? <a id="dlLoginLink" href="/login.html?next=%2Faccount.html" style="color:#8a6100;font-weight:800">Log in to your official account</a></p>
 </form></div>`;
 document.body.appendChild(modal);
 modal.querySelector('#dlRegClose').onclick=()=>modal.style.display='none';
 modal.querySelector('#dlLoginLink').onclick=e=>{e.preventDefault();e.stopPropagation();window.location.assign('/login.html?next=%2Faccount.html')};
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
