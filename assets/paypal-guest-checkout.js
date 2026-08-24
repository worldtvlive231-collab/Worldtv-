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
      .wtv-paypal-guest-btn:hover{background:#f4f9ff}
      .wtv-paypal-guest-btn:disabled{opacity:.55;cursor:not-allowed}
      .wtv-paypal-guest-icon{font-size:25px;line-height:1}
      .wtv-paypal-guest-copy{display:flex;flex-direction:column;align-items:flex-start;text-align:left;line-height:1.15}
      .wtv-paypal-guest-copy strong{font-size:15px}
      .wtv-paypal-guest-copy small{font-size:12px;font-weight:750;color:#41647f;margin-top:4px}
      .wtv-paypal-guest-note{font-size:11.5px;line-height:1.35;color:#716958;margin:7px 8px 0}
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

  function attach(btn){
    if(btn.dataset[MARK]==="1") return;
    btn.dataset[MARK]="1";

    const wrap=document.createElement("div");
    wrap.className="wtv-paypal-guest-wrap";

    const guest=document.createElement("button");
    guest.type="button";
    guest.className="wtv-paypal-guest-btn";
    guest.setAttribute("aria-label","Pay with debit or credit card worldwide via PayPal guest checkout");
    guest.innerHTML=`<span class="wtv-paypal-guest-icon" aria-hidden="true">💳</span><span class="wtv-paypal-guest-copy"><strong>Pay with Debit or Credit Card</strong><small>Worldwide via PayPal</small></span>`;

    const note=document.createElement("div");
    note.className="wtv-paypal-guest-note";
    note.textContent="Securely processed through our WORLD TV PayPal account. No PayPal account is required where PayPal Guest Checkout is available.";

    const syncDisabled=()=>{ guest.disabled=Boolean(btn.disabled); };
    syncDisabled();
    new MutationObserver(syncDisabled).observe(btn,{attributes:true,attributeFilter:["disabled"]});

    guest.addEventListener("click",()=>{
      if(btn.disabled) return;
      try{sessionStorage.setItem("wtv_paypal_guest_checkout","1");}catch(_){ }
      btn.click();
    });

    wrap.appendChild(guest);
    wrap.appendChild(note);
    btn.insertAdjacentElement("afterend",wrap);
  }

  function scan(){
    addStyles();
    document.querySelectorAll("button").forEach(btn=>{ if(isPayPalButton(btn)) attach(btn); });
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",scan,{once:true});
  else scan();

  const observer=new MutationObserver(()=>scan());
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
