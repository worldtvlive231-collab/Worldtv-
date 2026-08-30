(()=>{
  'use strict';

  const WHATSAPP_NUMBER='+1 (530) 904-0310';
  const WHATSAPP_URL='https://wa.me/15309040310?text='+encodeURIComponent('Hello WORLD TV, I want to subscribe and make payment. Please assist me.');
  const path=String(location.pathname||'/').toLowerCase();
  const allowed=new Set(['/','/index.html','/subscribe.html','/order.html','/checkout.html','/payment.html','/reseller','/reseller.html']);
  if(!allowed.has(path))return;

  function goWhatsApp(event){
    if(event){event.preventDefault();event.stopPropagation();}
    location.href=WHATSAPP_URL;
  }

  function start(){
    if(!document.body)return;

    if(!document.getElementById('wtv-wa-style')){
      const style=document.createElement('style');
      style.id='wtv-wa-style';
      style.textContent=`
        #wtv-wa-notice{background:#0f2417;color:#fff;padding:12px 16px;text-align:center;font-family:Inter,system-ui,sans-serif;position:relative;z-index:9999}
        #wtv-wa-notice .wtv-wa-row{max-width:1160px;margin:auto;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap}
        #wtv-wa-notice a,.wtv-wa-button{background:#25D366!important;color:#07150c!important;border:0!important;border-radius:12px!important;padding:10px 16px!important;font-weight:900!important;text-decoration:none!important;cursor:pointer!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;min-height:42px!important}
        .wtv-payment-disabled{opacity:.45!important;pointer-events:none!important}
      `;
      document.head.appendChild(style);
    }

    if(!document.getElementById('wtv-wa-notice')){
      const notice=document.createElement('div');
      notice.id='wtv-wa-notice';
      notice.innerHTML=`<div class="wtv-wa-row"><span><strong>Online payment is temporarily paused.</strong> To subscribe or make payment, WhatsApp WORLD TV at <strong>${WHATSAPP_NUMBER}</strong>.</span><a href="${WHATSAPP_URL}">💬 Subscribe & Pay on WhatsApp</a></div>`;
      document.body.prepend(notice);
    }

    const knownSelectors=[
      '#paypalBtn','#paystackBtn','#stripeBtn','#checkoutBtn','#subscribeBtn','#renewBtn',
      '.paypal-button','.paystack-button','.stripe-button','.paybtn',
      'a[href*="subscribe"]','a[href*="checkout"]','a[href*="payment"]',
      'button[data-provider="stripe"]','button[data-provider="paystack"]','button[data-provider="paypal"]'
    ];

    document.querySelectorAll(knownSelectors.join(',')).forEach(el=>{
      if(el.dataset.wtvWaBound==='1')return;
      el.dataset.wtvWaBound='1';
      el.classList.add('wtv-wa-button');
      if(el.tagName==='A'){
        el.href=WHATSAPP_URL;
        el.removeAttribute('target');
      }else{
        el.type='button';
        el.addEventListener('click',goWhatsApp,{capture:true});
      }
      if(/pay|stripe|paystack|paypal|checkout|subscribe|renew/i.test(String(el.textContent||el.value||''))){
        if(el.tagName==='INPUT')el.value='Subscribe & Pay on WhatsApp';
        else el.textContent='💬 Subscribe & Pay on WhatsApp';
      }
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();