(()=>{
  "use strict";

  const STYLE_ID="wtv-paypal-guest-style";
  const MARK="wtvGuestCheckoutAttached";

  function addStyles(){
    if(document.getElementById(STYLE_ID)) return;
    const style=document.createElement("style");
    style.id=STYLE_ID;
    style.textContent=`
      .wtv-paypal-guest-wrap{grid-column:1/-1;width:100%;margin-top:12px;text-align:center}
      .wtv-paypal-guest-btn{width:100%;min-height:58px;border:2px solid #0b5cab;border-radius:12px;background:#fff;color:#102a43;padding:11px 14px;display:flex;align-items:center;justify-content:center;gap:11px;font:inherit;font-weight:850;cursor:pointer;box-shadow:0 5px 14px rgba(0,48,93,.08)}
      .wtv-paypal-guest-btn:hover{background:#f4f9ff}.wtv-paypal-guest-btn:disabled{opacity:.55;cursor:not-allowed}
      .wtv-paypal-guest-icon{font-size:25px;line-height:1}.wtv-paypal-guest-copy{display:flex;flex-direction:column;align-items:flex-start;text-align:left;line-height:1.15}
      .wtv-paypal-guest-copy strong{font-size:15px}.wtv-paypal-guest-copy small{font-size:12px;font-weight:750;color:#41647f;margin-top:4px}
      .wtv-paypal-guest-note{font-size:11.5px;line-height:1.35;color:#716958;margin:7px 8px 0}
      .wtv-card-signup{display:none;margin-top:12px;padding:14px;border:1px solid #d9e7f5;border-radius:14px;background:#f8fbff;text-align:left}
      .wtv-card-signup.show{display:block}.wtv-card-signup h3{margin:0 0 6px}.wtv-card-signup p{margin:0 0 10px;color:#5d6f7f;font-size:12px}.wtv-card-signup label{display:block;font-size:12px;font-weight:800;margin-top:8px}.wtv-card-signup input{width:100%;box-sizing:border-box;padding:11px;border:1px solid #cbd9e6;border-radius:9px;margin-top:5px}.wtv-card-signup button{width:100%;margin-top:12px;padding:12px;border:0;border-radius:10px;background:#0b5cab;color:#fff;font-weight:850}.wtv-card-signup-msg{font-size:12px;margin-top:8px;color:#7a2a2a}
      @media(max-width:560px){.wtv-paypal-guest-btn{min-height:56px}.wtv-paypal-guest-copy strong{font-size:14px}.wtv-paypal-guest-note{font-size:11px}}
    `;
    document.head.appendChild(style);
  }

  function isPayPalButton(btn){
    if(!(btn instanceof HTMLElement) || btn.classList.contains("wtv-paypal-guest-btn")) return false;
    const id=String(btn.id||"");
    const text=String(btn.textContent||"").replace(/\s+/g," ").trim().toLowerCase();
    if(id==="paypalBtn" || id==="buyCodesPaypalBtn") return true;
    if(btn.classList.contains("paypal") && text.includes("paypal")) return true;
    return text==="pay with paypal" || text.startsWith("pay with paypal ");
  }

  async function registerAndContinue(form,paypalBtn){
    const msg=form.querySelector('.wtv-card-signup-msg');
    const submit=form.querySelector('button');
    const name=form.querySelector('[name=name]').value.trim();
    const email=form.querySelector('[name=email]').value.trim();
    const password=form.querySelector('[name=password]').value;
    if(!name||!email||password.length<8){msg.textContent='Enter your full name, a valid email and a password of at least 8 characters.';return;}
    submit.disabled=true;msg.textContent='Creating your WORLD TV account...';
    try{
      const r=await fetch('/api/customer/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok){
        if(String(d.error||'').toLowerCase().includes('already')){msg.innerHTML='This email already has a WORLD TV account. <a href="/login.html?next=%2Fsubscribe.html">Log in here</a> and return to pay.';return;}
        throw new Error(d.error||'Could not create your account.');
      }
      if(!d.token)throw new Error('Account created but automatic login failed.');
      localStorage.setItem('wtv_customer_token',d.token);
      try{sessionStorage.setItem('wtv_paypal_guest_checkout','1')}catch(_){ }
      msg.textContent='Account created. Opening secure PayPal card checkout...';
      setTimeout(()=>paypalBtn.click(),250);
    }catch(e){msg.textContent=e.message||'Could not create your account.';}finally{submit.disabled=false;}
  }

  function attach(btn){
    if(btn.dataset[MARK]==="1") return;
    btn.dataset[MARK]="1";addStyles();
    let wrap=btn.parentElement?.querySelector(':scope > .wtv-paypal-guest-wrap');
    if(!wrap){
      wrap=document.createElement("div");wrap.className="wtv-paypal-guest-wrap";
      wrap.innerHTML=`<button type="button" class="wtv-paypal-guest-btn"><span class="wtv-paypal-guest-icon" aria-hidden="true">💳</span><span class="wtv-paypal-guest-copy"><strong>Pay with Debit or Credit Card</strong><small>Worldwide via PayPal</small></span></button><div class="wtv-paypal-guest-note">Create or use your WORLD TV account so your payment is linked to you and your subscription code can be emailed automatically after successful payment.</div><form class="wtv-card-signup" novalidate><h3>Create your WORLD TV account</h3><p>Use your real email address. Your payment confirmation and subscription code will be sent there.</p><label>Full Name</label><input name="name" autocomplete="name" required><label>Email Address</label><input name="email" type="email" autocomplete="email" required><label>Create Password</label><input name="password" type="password" minlength="8" autocomplete="new-password" required><button type="submit">Create Account & Continue to Card Payment</button><div class="wtv-card-signup-msg"></div></form>`;
      btn.insertAdjacentElement("afterend",wrap);
    }
    const guest=wrap.querySelector('.wtv-paypal-guest-btn');
    const form=wrap.querySelector('.wtv-card-signup');
    const syncDisabled=()=>{guest.disabled=Boolean(btn.disabled);};syncDisabled();new MutationObserver(syncDisabled).observe(btn,{attributes:true,attributeFilter:['disabled']});
    guest.onclick=()=>{
      if(btn.disabled)return;
      const token=localStorage.getItem('wtv_customer_token')||'';
      try{sessionStorage.setItem('wtv_paypal_guest_checkout','1')}catch(_){ }
      if(token){btn.click();return;}
      form.classList.toggle('show');
      if(form.classList.contains('show'))form.querySelector('[name=name]')?.focus();
    };
    form.onsubmit=e=>{e.preventDefault();registerAndContinue(form,btn);};
  }

  function scan(){addStyles();document.querySelectorAll('button').forEach(btn=>{if(isPayPalButton(btn))attach(btn);});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan,{once:true});else scan();
  new MutationObserver(()=>scan()).observe(document.documentElement,{childList:true,subtree:true});
})();
