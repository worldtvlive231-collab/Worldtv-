(()=>{
  'use strict';

  const WHATSAPP_NUMBER='+1 (530) 904-0310';
  const WHATSAPP_URL='https://wa.me/15309040310?text='+encodeURIComponent('Hello WORLD TV, I want to subscribe and make payment. Please assist me.');
  const currentPath=String(location.pathname||'/').toLowerCase();
  const customerPage=currentPath==='/'||currentPath==='/index.html'||currentPath.endsWith('.html')||currentPath==='/reseller'||currentPath==='/reseller.html';
  if(!customerPage)return;

  const paymentWords=/\b(pay|payment|checkout|subscribe|subscription|renew|buy\s*now|stripe|paystack|paypal|mobile\s*money|momo|card\s*payment)\b/i;
  const paymentHref=/(subscribe|checkout|payment|stripe|paystack|paypal)/i;

  function addStyles(){
    if(document.getElementById('wtv-whatsapp-payment-style'))return;
    const style=document.createElement('style');
    style.id='wtv-whatsapp-payment-style';
    style.textContent=`
      #wtv-whatsapp-payment-notice{position:relative;z-index:9998;background:#0f2417;color:#fff;border-bottom:1px solid rgba(255,255,255,.14);padding:12px 16px;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #wtv-whatsapp-payment-notice .wtv-wa-inner{width:min(1160px,94%);margin:auto;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;text-align:center}
      #wtv-whatsapp-payment-notice a,.wtv-whatsapp-pay-button{display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:8px!important;background:#25D366!important;color:#07150c!important;border:0!important;border-radius:12px!important;padding:10px 16px!important;font-weight:900!important;text-decoration:none!important;cursor:pointer!important;min-height:42px!important;box-shadow:none!important}
      .wtv-payment-paused-box{margin:18px 0;padding:18px;border:1px solid rgba(37,211,102,.35);border-radius:16px;background:rgba(37,211,102,.08);text-align:center}
      .wtv-payment-paused-box b{display:block;margin-bottom:6px;font-size:18px}
      .wtv-payment-paused-box p{margin:6px 0 12px!important}
    `;
    (document.head||document.documentElement).appendChild(style);
  }

  function addNotice(){
    if(document.getElementById('wtv-whatsapp-payment-notice')||!document.body)return;
    const notice=document.createElement('div');
    notice.id='wtv-whatsapp-payment-notice';
    notice.innerHTML=`<div class="wtv-wa-inner"><span><strong>Online payment is temporarily paused.</strong> To subscribe or make payment, contact WORLD TV on WhatsApp: <strong>${WHATSAPP_NUMBER}</strong></span><a href="${WHATSAPP_URL}" target="_blank" rel="noopener">💬 Subscribe & Pay on WhatsApp</a></div>`;
    document.body.prepend(notice);
  }

  function isPaymentControl(el){
    if(!el||!el.matches?.('a,button,input[type="button"],input[type="submit"]'))return false;
    const text=String(el.textContent||el.value||el.getAttribute('aria-label')||'').trim();
    const href=String(el.getAttribute?.('href')||'');
    const idClass=`${el.id||''} ${el.className||''}`;
    return paymentWords.test(text)||paymentHref.test(href)||/(stripe|paystack|paypal|checkout|payment|subscribe|renew)/i.test(idClass);
  }

  function convertControl(el){
    if(!isPaymentControl(el)||el.dataset?.wtvWhatsappPayment==='1')return;
    if(el.tagName==='A'){
      el.href=WHATSAPP_URL;
      el.target='_blank';
      el.rel='noopener';
    }else{
      el.type='button';
    }
    el.dataset.wtvWhatsappPayment='1';
    el.classList.add('wtv-whatsapp-pay-button');
    if(/stripe|paystack|paypal|checkout|pay\b|payment|subscribe|renew|buy\s*now/i.test(String(el.textContent||el.value||''))){
      if(el.tagName==='INPUT')el.value='Subscribe & Pay on WhatsApp';
      else el.textContent='💬 Subscribe & Pay on WhatsApp';
    }
  }

  function addPaymentPageBox(){
    if(!['/subscribe.html','/order.html','/checkout.html','/payment.html','/reseller','/reseller.html'].includes(currentPath))return;
    if(document.getElementById('wtv-payment-paused-box'))return;
    const main=document.querySelector('main,.container,.wrap,.card')||document.body;
    if(!main)return;
    const box=document.createElement('div');
    box.id='wtv-payment-paused-box';
    box.className='wtv-payment-paused-box';
    box.innerHTML=`<b>Payments are currently handled through WhatsApp</b><p>To subscribe or make payment, message WORLD TV on WhatsApp at <strong>${WHATSAPP_NUMBER}</strong>.</p><a class="wtv-whatsapp-pay-button" href="${WHATSAPP_URL}" target="_blank" rel="noopener">💬 Continue to WhatsApp</a>`;
    main.prepend(box);
  }

  function applyOnce(){
    addStyles();
    addNotice();
    addPaymentPageBox();
    document.querySelectorAll('a,button,input[type="button"],input[type="submit"]').forEach(convertControl);
    document.querySelectorAll('#paypalBtn,#paystackBtn,#stripeBtn,.paypal-button,.paystack-button,.stripe-button,.wtv-paypal-guest-wrap').forEach(el=>{
      if(el.matches?.('a,button,input'))convertControl(el);
      else el.style.display='none';
    });
  }

  document.addEventListener('click',event=>{
    const control=event.target?.closest?.('a,button,input[type="button"],input[type="submit"]');
    if(!isPaymentControl(control))return;
    event.preventDefault();
    event.stopImmediatePropagation();
    location.href=WHATSAPP_URL;
  },true);

  document.addEventListener('submit',event=>{
    const form=event.target;
    const action=String(form?.getAttribute?.('action')||'');
    const text=String(form?.textContent||'');
    if(paymentHref.test(action)||paymentWords.test(text)){
      event.preventDefault();
      event.stopImmediatePropagation();
      location.href=WHATSAPP_URL;
    }
  },true);

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>{
      applyOnce();
      setTimeout(applyOnce,1200);
    },{once:true});
  }else{
    applyOnce();
    setTimeout(applyOnce,1200);
  }
})();