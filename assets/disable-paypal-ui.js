(()=>{
  'use strict';
  const currentPath=String(location.pathname||'/').toLowerCase();
  const params=new URLSearchParams(location.search);
  let changed=false;

  if(currentPath==='/subscribe.html'&&params.has('paypal')){
    params.delete('paypal');
    params.delete('token');
    params.delete('reference');
    changed=true;
  }
  if(currentPath==='/order.html'&&String(params.get('payment')||'').toLowerCase()==='paypal'){
    params.delete('payment');
    params.delete('token');
    changed=true;
  }
  if(changed){
    const query=params.toString();
    history.replaceState({},'',location.pathname+(query?`?${query}`:'')+location.hash);
  }

  const customerPaymentPage=currentPath==='/'||currentPath==='/index.html'||currentPath==='/subscribe.html'||currentPath==='/order.html'||currentPath==='/reseller'||currentPath==='/reseller.html';
  if(!customerPaymentPage)return;

  function scrub(){
    const legacyPaypal=document.getElementById('paypalBtn');
    if(legacyPaypal){legacyPaypal.style.display='none';legacyPaypal.disabled=true;legacyPaypal.setAttribute('aria-hidden','true');}
    document.getElementById('buyCodesPaypalBtn')?.remove();
    document.querySelectorAll('.wtv-paypal-guest-wrap').forEach(el=>el.remove());
    document.querySelectorAll('button,a').forEach(el=>{
      if(el.id==='paypalBtn')return;
      if(/pay\s*with\s*paypal|paypal checkout|debit or credit card.*paypal/i.test(el.textContent||''))el.remove();
    });
    document.querySelectorAll('.paybtn.paypal').forEach(el=>el.remove());
    document.getElementById('resellerPaymentOr')?.remove();

    if(currentPath==='/subscribe.html'){
      document.querySelectorAll('.or').forEach(el=>{if(!el.nextElementSibling||el.nextElementSibling?.id==='paypalBtn'||/paypal/i.test(el.nextElementSibling?.textContent||''))el.remove();});
      document.querySelectorAll('p.muted.center').forEach(el=>{if(/choose paystack or paypal/i.test(el.textContent||''))el.textContent='Choose Paystack or Stripe to complete your subscription securely.';});
      document.querySelectorAll('.payment-note').forEach(el=>{if(/paypal charges/i.test(el.textContent||''))el.innerHTML='<b>Worldwide pricing:</b> Stripe charges the US$23 base price directly. Paystack charges the current Ghana-cedi equivalent. Any valid coupon is applied before payment.';});
      document.querySelectorAll('.account-note').forEach(el=>{if(/debit\/credit card button below/i.test(el.textContent||''))el.innerHTML='<strong>New customer?</strong> Use the Stripe button below to create your WORLD TV account and pay securely by debit or credit card.';});
    }

    if(currentPath==='/'||currentPath==='/index.html'){
      const meta=document.querySelector('meta[name="description"]');
      if(meta)meta.content=meta.content.replace(/, Card or PayPal/i,', Card or Stripe').replace(/PayPal/gi,'Stripe');
      document.querySelectorAll('p,span,b,div').forEach(el=>{
        if(el.children.length>0)return;
        const t=el.textContent||'';
        if(t==='PayPal'){el.textContent='Stripe';return;}
        if(t==='International payments'){el.textContent='Worldwide card payments';return;}
        if(/PayPal is also available where offered\./i.test(t))el.textContent=t.replace(/PayPal is also available where offered\./i,'Stripe is available for secure worldwide card checkout.');
        if(/Mobile Money, Card and PayPal where available\./i.test(t))el.textContent=t.replace(/Mobile Money, Card and PayPal where available\./i,'Mobile Money, Card and Stripe where available.');
        if(/🅿️\s*PayPal/i.test(t))el.textContent='💳 Stripe';
      });
      document.querySelectorAll('img[alt*="PayPal" i]').forEach(img=>{img.alt=img.alt.replace(/\s*and PayPal|,?\s*PayPal/ig,'').replace(/Mobile Money, Card\s*$/i,'Mobile Money, Card and Stripe');});
    }
  }

  scrub();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scrub,{once:true});
  new MutationObserver(scrub).observe(document.documentElement,{childList:true,subtree:true});
})();