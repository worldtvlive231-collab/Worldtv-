(()=>{
  "use strict";

  const STYLE_ID="wtv-paypal-guest-style";
  const MARK="wtvGuestCheckoutAttached";

  function addStyles(){
    if(document.getElementById(STYLE_ID)) return;
    const style=document.createElement("style");
    style.id=STYLE_ID;
    style.textContent=`
      .wtv-paypal-guest-wrap{grid-column:1/-1;width:100%;margin-top:10px;text-align:center}
      .wtv-paypal-guest-btn{width:100%;min-height:58px;border:2px solid #0b5cab;border-radius:12px;background:#fff;color:#102a43;padding:11px 14px;display:flex;align-items:center;justify-content:center;gap:11px;font:inherit;font-weight:850;cursor:pointer;box-shadow:0 5px 14px rgba(0,48,93,.08)}
      .wtv-paypal-guest-btn:hover{background:#f4f9ff}.wtv-paypal-guest-btn:disabled{opacity:.55;cursor:not-allowed}
      .wtv-paypal-guest-icon{font-size:25px;line-height:1}.wtv-paypal-guest-copy{display:flex;flex-direction:column;align-items:flex-start;text-align:left;line-height:1.15}
      .wtv-paypal-guest-copy strong{font-size:15px}.wtv-paypal-guest-copy small{font-size:12px;font-weight:750;color:#41647f;margin-top:4px}
      .wtv-paypal-guest-note{font-size:11.5px;line-height:1.35;color:#716958;margin:7px 8px 0}
      .wtv-guest-modal{position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;padding:18px}
      .wtv-guest-card{width:min(430px,100%);background:#fff;border-radius:18px;padding:22px;box-shadow:0 25px 70px rgba(0,0,0,.28);text-align:left;color:#17130a}
      .wtv-guest-card h2{margin:0 0 8px;font-size:22px}.wtv-guest-card p{margin:0 0 16px;color:#655d4c;line-height:1.45}
      .wtv-guest-card label{display:block;font-weight:800;font-size:13px;margin:10px 0 5px}.wtv-guest-card input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #d8ccb2;border-radius:10px;font:inherit;margin:0}
      .wtv-guest-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}.wtv-guest-actions button{border:0;border-radius:10px;padding:12px;font-weight:850;cursor:pointer}.wtv-guest-cancel{background:#eee8d8;color:#302817}.wtv-guest-continue{background:#0877d1;color:#fff}
      .wtv-guest-error{display:none;margin-top:12px;padding:10px;border-radius:9px;background:#fff0f0;color:#8a1f1f;font-size:13px;font-weight:700}
      @media(max-width:560px){.wtv-paypal-guest-btn{min-height:56px}.wtv-paypal-guest-copy strong{font-size:14px}.wtv-paypal-guest-note{font-size:11px}.wtv-guest-actions{grid-template-columns:1fr}}
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

  function openSubscriptionGuestCheckout(guest){
    if(document.getElementById("wtvGuestModal")) return;
    const modal=document.createElement("div");
    modal.id="wtvGuestModal";modal.className="wtv-guest-modal";
    modal.innerHTML=`<div class="wtv-guest-card" role="dialog" aria-modal="true" aria-labelledby="wtvGuestTitle"><h2 id="wtvGuestTitle">Pay by Card — No WORLD TV Login Required</h2><p>Enter your name and email so we can link the payment to your subscription and issue your code automatically after successful payment.</p><label>Full Name</label><input id="wtvGuestName" autocomplete="name" placeholder="Your full name"><label>Email Address</label><input id="wtvGuestEmail" type="email" autocomplete="email" placeholder="you@example.com"><div id="wtvGuestError" class="wtv-guest-error"></div><div class="wtv-guest-actions"><button type="button" class="wtv-guest-cancel" id="wtvGuestCancel">Cancel</button><button type="button" class="wtv-guest-continue" id="wtvGuestContinue">Continue to PayPal Card Checkout</button></div></div>`;
    document.body.appendChild(modal);
    const close=()=>modal.remove();
    modal.querySelector("#wtvGuestCancel").onclick=close;
    modal.addEventListener("click",e=>{if(e.target===modal)close();});
    modal.querySelector("#wtvGuestContinue").onclick=async()=>{
      const name=modal.querySelector("#wtvGuestName").value.trim();
      const email=modal.querySelector("#wtvGuestEmail").value.trim();
      const error=modal.querySelector("#wtvGuestError");
      const go=modal.querySelector("#wtvGuestContinue");
      error.style.display="none";
      if(!name){error.textContent="Enter your full name.";error.style.display="block";return;}
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){error.textContent="Enter a valid email address.";error.style.display="block";return;}
      go.disabled=true;go.textContent="Opening secure checkout...";guest.disabled=true;
      try{
        const coupon=document.getElementById("coupon")?.value||"";
        const cr=await fetch("/api/guest/checkout-request",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({name,email,planId:1,coupon_code:coupon})});
        const cd=await cr.json().catch(()=>({}));
        if(!cr.ok||!cd.reference) throw new Error(cd.error||"Could not create guest checkout.");
        const pp=await fetch("/api/payment/paypal/create-order",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({reference:cd.reference})});
        const pd=await pp.json().catch(()=>({}));
        if(!pp.ok||!pd.approval_url) throw new Error(pd.error||"Could not start PayPal card checkout.");
        try{sessionStorage.setItem("wtv_paypal_guest_checkout","1");sessionStorage.setItem("wtv_paypal_guest_email",email);}catch(_){ }
        location.href=pd.approval_url;
      }catch(e){
        error.textContent=e.message||"Could not open checkout. Please try again.";error.style.display="block";go.disabled=false;go.textContent="Continue to PayPal Card Checkout";guest.disabled=false;
      }
    };
    setTimeout(()=>modal.querySelector("#wtvGuestName")?.focus(),50);
  }

  function attach(btn){
    if(btn.dataset[MARK]==="1") return;
    btn.dataset[MARK]="1";
    const wrap=document.createElement("div");wrap.className="wtv-paypal-guest-wrap";
    const guest=document.createElement("button");guest.type="button";guest.className="wtv-paypal-guest-btn";guest.setAttribute("aria-label","Pay with debit or credit card worldwide via PayPal guest checkout");guest.innerHTML=`<span class="wtv-paypal-guest-icon" aria-hidden="true">💳</span><span class="wtv-paypal-guest-copy"><strong>Pay with Debit or Credit Card</strong><small>Worldwide via PayPal</small></span>`;
    const note=document.createElement("div");note.className="wtv-paypal-guest-note";note.textContent="Securely processed through our WORLD TV PayPal account. No PayPal account is required where PayPal Guest Checkout is available.";
    const syncDisabled=()=>{ guest.disabled=Boolean(btn.disabled); };syncDisabled();new MutationObserver(syncDisabled).observe(btn,{attributes:true,attributeFilter:["disabled"]});
    guest.addEventListener("click",()=>{
      if(btn.disabled)return;
      const isSubscription=btn.id==="paypalBtn" && /\/subscribe\.html$/i.test(location.pathname);
      if(isSubscription){openSubscriptionGuestCheckout(guest);return;}
      try{sessionStorage.setItem("wtv_paypal_guest_checkout","1");}catch(_){ }
      btn.click();
    });
    wrap.appendChild(guest);wrap.appendChild(note);btn.insertAdjacentElement("afterend",wrap);
  }

  function scan(){addStyles();document.querySelectorAll("button").forEach(btn=>{if(isPayPalButton(btn))attach(btn);});}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",scan,{once:true});else scan();
  const observer=new MutationObserver(()=>scan());observer.observe(document.documentElement,{childList:true,subtree:true});
})();
