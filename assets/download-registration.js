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
 <div style="text-align:center"><img src="/world-tv-logo.png" alt="WORLD TV" style="height:70px;max-width:180px;object-fit:contain"><h2 style="margin:8px 0">Register to Download WORLD TV</h2><p style="color:#716958;line-height:1.5">Enter your details so we can send your welcome message, installation help and trial updates.</p></div>
 <form id="dlRegForm">
  <label style="display:block;font-weight:800;margin:10px 0 5px">Full Name *</label><input id="dlName" required autocomplete="name" style="width:100%;padding:12px;border:1px solid #d8ccb2;border-radius:10px">
  <label style="display:block;font-weight:800;margin:10px 0 5px">Email Address *</label><input id="dlEmail" required type="email" autocomplete="email" style="width:100%;padding:12px;border:1px solid #d8ccb2;border-radius:10px">
  <label style="display:block;font-weight:800;margin:10px 0 5px">Phone / WhatsApp</label><input id="dlPhone" autocomplete="tel" style="width:100%;padding:12px;border:1px solid #d8ccb2;border-radius:10px">
  <label style="display:block;font-weight:800;margin:10px 0 5px">Country</label><input id="dlCountry" autocomplete="country-name" style="width:100%;padding:12px;border:1px solid #d8ccb2;border-radius:10px">
  <label style="display:flex;gap:9px;align-items:flex-start;margin:14px 0;color:#5f5849;font-size:13px;line-height:1.45"><input id="dlMarketing" type="checkbox" style="margin-top:3px"> <span>I agree to receive WORLD TV trial reminders, subscription offers, product news and TV Box promotions by email. I can unsubscribe from marketing messages.</span></label>
  <button id="dlSubmit" type="submit" style="width:100%;border:0;border-radius:13px;padding:15px;font-weight:900;font-size:16px;background:linear-gradient(135deg,#f4c542,#d89a00);cursor:pointer">Register & Download App</button>
  <div id="dlRegMsg" style="margin-top:12px;font-size:13px;color:#716958;text-align:center"></div>
 </form></div>`;
 document.body.appendChild(modal);
 modal.querySelector('#dlRegClose').onclick=()=>modal.style.display='none';
 modal.addEventListener('click',e=>{if(e.target===modal)modal.style.display='none'});
 modal.querySelector('#dlRegForm').addEventListener('submit',submit);
 return modal;
}
async function submit(e){
 e.preventDefault();
 const btn=document.getElementById('dlSubmit'),msg=document.getElementById('dlRegMsg');
 btn.disabled=true;msg.style.color='#716958';msg.textContent='Registering and preparing your download...';
 try{
  const r=await fetch('/api/download/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('dlName').value.trim(),email:document.getElementById('dlEmail').value.trim(),phone:document.getElementById('dlPhone').value.trim(),country:document.getElementById('dlCountry').value.trim(),marketing_consent:document.getElementById('dlMarketing').checked})});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Registration failed.');
  localStorage.setItem('wtv_download_registered_email',document.getElementById('dlEmail').value.trim().toLowerCase());
  msg.style.color='#1e6b34';msg.textContent='Thank you! Your download is starting now.';
  setTimeout(()=>{window.location.href=d.download_url||'/api/app/download'},350);
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