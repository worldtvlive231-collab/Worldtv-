(()=>{
  "use strict";
  const STYLE_ID="wtv-stripe-style";
  const WRAP_ID="wtvStripeCheckoutWrap";
  const OR_ID="wtvStripePaymentOr";
  let configured=false;
  let working=false;

  function addStyles(){
    if(document.getElementById(STYLE_ID))return;
    const style=document.createElement("style");
    style.id=STYLE_ID;
    style.textContent=`
      .wtv-stripe-wrap{width:100%;margin-top:0;text-align:center}
      .wtv-stripe-or{display:flex;align-items:center;gap:10px;margin:15px 0;color:#8b816d;font-size:13px;font-weight:800}.wtv-stripe-or:before,.wtv-stripe-or:after{content:"";height:1px;background:#eadfc8;flex:1}
      .wtv-stripe-btn{width:100%;min-height:58px;border:0;border-radius:12px;background:#635bff;color:#fff;padding:12px 16px;display:flex;align-items:center;justify-content:center;gap:12px;font:inherit;font-weight:900;cursor:pointer;box-shadow:0 8px 22px rgba(99,91,255,.22)}
      .wtv-stripe-btn:hover{background:#554ee8}.wtv-stripe-btn:disabled{opacity:.55;cursor:not-allowed}
      .wtv-stripe-mark{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;background:#fff;color:#635bff;font-size:20px;font-weight:950}
      .wtv-stripe-copy{display:flex;flex-direction:column;align-items:flex-start;text-align:left;line-height:1.15}.wtv-stripe-copy strong{font-size:15px}.wtv-stripe-copy small{font-size:12px;font-weight:750;color:#efefff;margin-top:4px}
      .wtv-stripe-note{font-size:11.5px;line-height:1.35;color:#716958;margin:7px 8px 0}
      .wtv-stripe-signup{display:none;margin-top:12px;padding:14px;border:1px solid #dedcff;border-radius:14px;background:#fafaff;text-align:left}.wtv-stripe-signup.show{display:block}
      .wtv-stripe-signup h3{margin:0 0 6px}.wtv-stripe-signup p{margin:0 0 10px;color:#5f5a79;font-size:12px}.wtv-stripe-signup label{display:block;font-size:12px;font-weight:800;margin-top:8px}.wtv-stripe-signup input{width:100%;box-sizing:border-box;padding:11px;border:1px solid #d5d2ff;border-radius:9px;margin-top:5px}.wtv-stripe-signup button{width:100%;margin-top:12px;padding:12px;border:0;border-radius:10px;background:#635bff;color:#fff;font-weight:850}.wtv-stripe-signup-msg{font-size:12px;margin-top:8px;color:#7a2a2a}
      @media(max-width:560px){.wtv-stripe-btn{min-height:56px}.wtv-stripe-copy strong{font-size:14px}.wtv-stripe-note{font-size:11px}}
    `;
    document.head.appendChild(style);
  }

  function setPageWording(){
    document.querySelectorAll("p.muted.center").forEach(p=>{
      if(/choose paystack/i.test(p.textContent||""))p.textContent="Choose Paystack or Stripe to complete your subscription securely.";
    });
    document.querySelectorAll(".payment-note").forEach(note=>{
      if(note.dataset.stripeUpdated)return;
      note.dataset.stripeUpdated="1";
      if(/worldwide pricing/i.test(note.textContent||""))note.innerHTML='<b>Worldwide pricing:</b> Stripe charges the US$23 base price directly. Paystack charges the current Ghana-cedi equivalent. Any valid coupon is applied before payment.';
    });
  }

  function showMessage(html){const msg=document.getElementById("msg");if(msg)msg.innerHTML=html;}
  function renderSuccess(data){
    if(typeof window.renderPaymentSuccess==="function")return window.renderPaymentSuccess(data);
    if(data.fulfilled===false){showMessage(`<div class="success"><h2>✅ Payment Received</h2><p>${data.message||"Your payment was received. Subscription activation is pending."}</p></div>`);return;}
    showMessage(`<div class="success"><h2>✅ Payment Successful</h2><p>Your WORLD TV subscription has been activated.</p>${data.code?`<p>Subscription Code: <b>${data.code}</b></p>`:""}<p>Your code has also been sent to your registered email address.</p><p><a href="/account.html">Go to My Account</a></p></div>`);
  }

  async function createAccount(form){
    const msg=form.querySelector(".wtv-stripe-signup-msg"),submit=form.querySelector("button");
    const name=form.querySelector('[name="name"]').value.trim(),email=form.querySelector('[name="email"]').value.trim(),password=form.querySelector('[name="password"]').value;
    if(!name||!email||password.length<8){msg.textContent="Enter your full name, a valid email and a password of at least 8 characters.";return false;}
    submit.disabled=true;msg.textContent="Creating your WORLD TV account...";
    try{
      let referral_code="";try{referral_code=String(window.WorldTVMarketing?.getAttribution?.()?.referral_code||"").trim().toUpperCase();}catch(_){ }
      const response=await fetch("/api/customer/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,email,password,referral_code})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok){if(String(data.error||"").toLowerCase().includes("already")){msg.innerHTML='This email already has a WORLD TV account. <a href="/login.html?next=%2Fsubscribe.html">Log in here</a> and return to pay.';return false;}throw new Error(data.error||"Could not create your account.");}
      if(!data.token)throw new Error("Account created but automatic login failed.");
      localStorage.setItem("wtv_customer_token",data.token);msg.textContent="Account created. Opening secure Stripe checkout...";return true;
    }catch(error){msg.textContent=error.message||"Could not create your account.";return false;}finally{submit.disabled=false;}
  }

  async function startStripe(){
    if(working||!configured)return;working=true;
    const btn=document.querySelector(".wtv-stripe-btn");if(btn)btn.disabled=true;
    try{
      showMessage('<div class="payment-note">Preparing secure Stripe checkout...</div>');
      if(typeof window.createCheckoutRequest!=="function")throw new Error("Subscription checkout is not ready. Refresh the page and try again.");
      const requestData=await window.createCheckoutRequest();
      const customerToken=localStorage.getItem("wtv_customer_token")||"";
      const response=await fetch("/api/payment/stripe/create-session",{method:"POST",headers:{"Content-Type":"application/json","x-customer-token":customerToken},body:JSON.stringify({reference:requestData.reference})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Could not start Stripe payment");
      if(data.paid){renderSuccess(data);return;}if(!data.checkout_url)throw new Error("Stripe checkout URL was not received.");location.href=data.checkout_url;
    }catch(error){showMessage(`<div class="error">${String(error.message||"Could not start Stripe payment.")}</div>`);}finally{working=false;if(btn)btn.disabled=false;}
  }

  function createUi(){
    if(document.getElementById(WRAP_ID))return;
    const paystackBtn=document.getElementById("paystackBtn");if(!paystackBtn)return;
    addStyles();setPageWording();
    let or=document.getElementById(OR_ID);if(!or){or=document.createElement("div");or.id=OR_ID;or.className="wtv-stripe-or";or.textContent="OR";paystackBtn.insertAdjacentElement("afterend",or);}
    const wrap=document.createElement("div");wrap.id=WRAP_ID;wrap.className="wtv-stripe-wrap";wrap.style.display="none";
    wrap.innerHTML=`<button type="button" class="wtv-stripe-btn"><span class="wtv-stripe-mark" aria-hidden="true">S</span><span class="wtv-stripe-copy"><strong>Pay securely with Stripe</strong><small>Debit / Credit Card • Worldwide</small></span></button><div class="wtv-stripe-note">Secure Stripe checkout. Create or use your WORLD TV account so your payment and subscription code are linked to your email.</div><form class="wtv-stripe-signup" novalidate><h3>Create your WORLD TV account</h3><p>Your subscription code and payment confirmation will be sent to this email address.</p><label>Full Name</label><input name="name" autocomplete="name" required><label>Email Address</label><input name="email" type="email" autocomplete="email" required><label>Create Password</label><input name="password" type="password" minlength="8" autocomplete="new-password" required><button type="submit">Create Account & Continue to Stripe</button><div class="wtv-stripe-signup-msg"></div></form>`;
    or.insertAdjacentElement("afterend",wrap);
    const button=wrap.querySelector(".wtv-stripe-btn"),form=wrap.querySelector(".wtv-stripe-signup");
    button.onclick=()=>{const token=localStorage.getItem("wtv_customer_token")||"";if(token){startStripe();return;}form.classList.toggle("show");if(form.classList.contains("show"))form.querySelector('[name="name"]')?.focus();};
    form.onsubmit=async e=>{e.preventDefault();if(await createAccount(form)){form.classList.remove("show");startStripe();}};
  }

  async function loadConfig(){
    try{const response=await fetch("/api/payment/stripe/config",{cache:"no-store"});const data=await response.json().catch(()=>({}));configured=Boolean(response.ok&&data.configured);const wrap=document.getElementById(WRAP_ID),or=document.getElementById(OR_ID);if(wrap)wrap.style.display=configured?"block":"none";if(or)or.style.display=configured?"flex":"none";}catch(_){configured=false;}
  }

  async function handleReturn(){
    const params=new URLSearchParams(location.search),state=params.get("stripe"),reference=params.get("reference")||"";
    if(state==="cancelled"){showMessage('<div class="error">Stripe payment was cancelled. No charge was completed.</div>');history.replaceState({},"",location.pathname);return;}
    if(state!=="success")return;
    const sessionId=params.get("session_id")||"";if(!reference||!sessionId){showMessage('<div class="error">Stripe returned without the payment reference. Please contact support if you were charged.</div>');return;}
    showMessage('<div class="payment-note">Confirming your Stripe payment and issuing your subscription code...</div>');
    try{const customerToken=localStorage.getItem("wtv_customer_token")||"";const response=await fetch("/api/payment/stripe/confirm",{method:"POST",headers:{"Content-Type":"application/json","x-customer-token":customerToken},cache:"no-store",body:JSON.stringify({reference,session_id:sessionId})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"Could not confirm Stripe payment");renderSuccess(data);history.replaceState({},"",location.pathname);}catch(error){showMessage(`<div class="error">${String(error.message||"Could not confirm Stripe payment.")}</div>`);}
  }

  function scan(){createUi();setPageWording();}
  async function init(){scan();await loadConfig();await handleReturn();}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
  new MutationObserver(()=>scan()).observe(document.documentElement,{childList:true,subtree:true});
})();