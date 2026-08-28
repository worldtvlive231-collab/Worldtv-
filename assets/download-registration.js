(()=>{
'use strict';
const APK_URL='https://23s.tv/IPTV/worldtv8.2.8-20260822.apk';
let modal=null;
function build(){
 if(modal)return modal;
 modal=document.createElement('div');
 modal.id='downloadRegistrationModal';
 modal.style.cssText='display:none;position:fixed;inset:0;background:#0009;z-index:99999;align-items:center;justify-content:center;padding:10px';
 modal.innerHTML=`<div style="background:#fff;width:min(380px,100%);border-radius:18px;padding:18px;box-shadow:0 25px 70px #0004;position:relative">
 <button id="dlRegClose" aria-label="Close" style="position:absolute;right:11px;top:7px;border:0;background:none;font-size:24px;cursor:pointer">×</button>
 <div style="text-align:center"><img src="/world-tv-logo.png" alt="WORLD TV" style="height:50px;max-width:130px;object-fit:contain"><h2 style="font-size:20px;line-height:1.15;margin:8px 28px 6px">Enter Your Email to Download WORLD TV</h2><p style="color:#716958;font-size:13px;line-height:1.45;margin:0 6px 14px">We’ll send your thank-you message, 3-day trial information, and the official account link for subscribing later.</p></div>
 <form id="dlRegForm">
  <label style="display:block;font-size:13px;font-weight:800;margin:6px 0 5px">Email Address *</label>
  <input id="dlEmail" required type="email" autocomplete="email" placeholder="you@example.com" style="width:100%;padding:11px;border:1px solid #d8ccb2;border-radius:10px;font-size:14px;box-sizing:border-box">
  <button id="dlSubmit" type="submit" style="width:100%;border:0;border-radius:11px;padding:12px;margin-top:10px;font-weight:900;font-size:14px;background:linear-gradient(135deg,#f4c542,#d89a00);cursor:pointer">Continue & Download App</button>
  <div id="dlRegMsg" style="margin-top:9px;font-size:12px;line-height:1.4;color:#716958;text-align:center"></div>
 </form>
 <div style="margin-top:13px;padding-top:12px;border-top:1px solid #eee5cf;text-align:center;font-size:13px;color:#716958">Already have an account? <a href="/login.html?next=%2Fdownload.html" style="font-weight:900;color:#9b6b00">Login</a><br><span style="display:inline-block;margin-top:6px">Need an account? <a href="/register.html?next=%2Fdownload.html" style="font-weight:900;color:#9b6b00">Create Account</a></span></div>
 </div>`;
 document.body.appendChild(modal);
 modal.querySelector('#dlRegClose').onclick=()=>modal.style.display='none';
 modal.addEventListener('click',e=>{if(e.target===modal)modal.style.display='none'});
 modal.querySelector('#dlRegForm').addEventListener('submit',submit);
 return modal;
}
async function submit(e){
 e.preventDefault();
 const btn=document.getElementById('dlSubmit'),msg=document.getElementById('dlRegMsg');
 const email=document.getElementById('dlEmail').value.trim();
 btn.disabled=true;msg.style.color='#716958';msg.textContent='Saving your email and preparing WORLD TV v8.2.8...';
 try{
  const r=await fetch('/api/download/email-register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'Could not continue.');
  localStorage.setItem('wtv_download_registered_email',email.toLowerCase());
  msg.style.color='#1e6b34';msg.textContent='Thank you! Check your email for your trial information. Your download is starting now.';
  setTimeout(()=>{window.location.href=d.download_url||APK_URL},650);
 }catch(err){msg.style.color='#8d2222';msg.textContent=err.message||'Could not continue. Please try again.';btn.disabled=false;}
}
function intercept(e){
 const t=e.target.closest&&e.target.closest('button,a');if(!t)return;
 if(t.closest('#downloadRegistrationModal'))return;
 const text=(t.textContent||'').toLowerCase();const onclick=t.getAttribute('onclick')||'';
 if(!text.includes('download app')&&!onclick.includes('downloadApp'))return;
 e.preventDefault();e.stopImmediatePropagation();build().style.display='flex';
}
document.addEventListener('click',intercept,true);
})();
