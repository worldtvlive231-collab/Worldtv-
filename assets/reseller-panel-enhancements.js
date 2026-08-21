(()=>{
  'use strict';
  const MIN_CODES=10, UNIT_USD=19;
  const $=id=>document.getElementById(id);
  const usd=v=>'$'+Number(v||0).toFixed(2)+' USD';

  function applyBranding(){
    document.querySelectorAll('.brand').forEach(el=>{
      if(el.querySelector('img[data-wtv-logo]'))return;
      el.innerHTML='<img data-wtv-logo src="/world-tv-logo.png" alt="WORLD TV" style="height:70px;max-width:180px;object-fit:contain;display:block">';
      if(el.closest('.login')){el.style.display='flex';el.style.justifyContent='center';}
    });
  }

  function ensurePaypalButton(configured){
    const paystack=$('buyCodesBtn');
    if(!paystack)return;
    paystack.textContent='Pay with Paystack';
    let or=document.getElementById('resellerPaymentOr');
    let btn=document.getElementById('buyCodesPaypalBtn');
    if(!or){or=document.createElement('div');or.id='resellerPaymentOr';or.style.cssText='text-align:center;margin:10px 0;font-weight:800;color:#746d5e';or.textContent='OR';paystack.insertAdjacentElement('afterend',or);}
    if(!btn){btn=document.createElement('button');btn.id='buyCodesPaypalBtn';btn.className='btn';btn.style.cssText='width:100%;background:#0070ba;color:#fff;margin-top:0';btn.textContent='Pay with PayPal';btn.onclick=window.buyCodeCreditsPaypal;or.insertAdjacentElement('afterend',btn);}
    btn.disabled=!configured;
  }

  async function refreshStore(){
    if(!localStorage.getItem('wtv_reseller_token'))return;
    try{
      const token=localStorage.getItem('wtv_reseller_token')||'';
      const [storeRes,paypalRes]=await Promise.all([
        fetch('/api/reseller/code-store',{headers:{'x-reseller-token':token}}),
        fetch('/api/payment/paypal/config').catch(()=>null)
      ]);
      const d=await storeRes.json().catch(()=>({}));
      const pp=paypalRes?await paypalRes.json().catch(()=>({})):{};
      if(!storeRes.ok)return;
      const count=$('purchaseCount');
      if(count){count.min=String(MIN_CODES);if(Number(count.value)<MIN_CODES)count.value=String(MIN_CODES);}
      if($('unitPrice'))$('unitPrice').textContent=usd(d.unit_price_usd||UNIT_USD);
      if($('purchaseTotal'))$('purchaseTotal').textContent=usd((Number(count?.value)||MIN_CODES)*(d.unit_price_usd||UNIT_USD));
      if($('storeStatus')){$('storeStatus').className='msg success';$('storeStatus').textContent=`Reseller price is ${usd(d.unit_price_usd||UNIT_USD)} per 1-year code. Minimum purchase: ${MIN_CODES} codes (${usd(MIN_CODES*(d.unit_price_usd||UNIT_USD))}). Choose Paystack or PayPal. Paid code credits are added only after successful payment verification.`;}
      if($('buyCodesBtn'))$('buyCodesBtn').disabled=!d.payment_configured;
      ensurePaypalButton(Boolean(pp&&pp.configured));
      document.querySelector('.store .note')?.replaceChildren(document.createTextNode(`Code packages start at ${MIN_CODES} codes. You can buy ${MIN_CODES} or more, and you can generate only the number of credits you have paid for.`));
      const rows=d.history||[];
      if($('purchaseHistory'))$('purchaseHistory').innerHTML=rows.length?rows.map(p=>`<tr><td>${new Date(p.created_at).toLocaleString()}</td><td>${String(p.reference||'')}</td><td>${Number(p.code_count||0)}</td><td>${usd(p.amount_usd??p.amount_ghs)}</td><td><span class="pill ${p.status==='paid'?'paid':'pending'}">${String(p.status||'')}</span></td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;color:#837b69;padding:20px">No purchases yet</td></tr>';
    }catch(e){console.error(e)}
  }

  window.money=usd;
  window.updatePurchaseTotal=function(){
    const input=$('purchaseCount');let count=parseInt(input?.value||String(MIN_CODES),10);if(!Number.isFinite(count))count=MIN_CODES;
    if(count<MIN_CODES){count=MIN_CODES;if(input)input.value=String(MIN_CODES);}
    if($('purchaseTotal'))$('purchaseTotal').textContent=usd(count*UNIT_USD);
  };

  window.buyCodeCredits=async function(){
    const token=localStorage.getItem('wtv_reseller_token')||'';
    const count=parseInt($('purchaseCount')?.value||'0',10);
    const out=$('purchaseMsg');
    if(!Number.isFinite(count)||count<MIN_CODES){if(out){out.className='msg error';out.textContent=`Minimum purchase is ${MIN_CODES} codes.`;}return;}
    const btn=$('buyCodesBtn');if(btn)btn.disabled=true;
    try{
      const r=await fetch('/api/reseller/code-purchases/initialize',{method:'POST',headers:{'Content-Type':'application/json','x-reseller-token':token},body:JSON.stringify({count})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not start payment.');
      if(out){out.className='msg success';out.textContent=`Opening Paystack for ${count} codes (${usd(d.amount_usd||count*UNIT_USD)}). You will be charged the current GHS equivalent.`;}
      location.href=d.authorization_url;
    }catch(e){if(out){out.className='msg error';out.textContent=e.message;}if(btn)btn.disabled=false;}
  };

  window.buyCodeCreditsPaypal=async function(){
    const token=localStorage.getItem('wtv_reseller_token')||'';
    const count=parseInt($('purchaseCount')?.value||'0',10);
    const out=$('purchaseMsg');
    if(!Number.isFinite(count)||count<MIN_CODES){if(out){out.className='msg error';out.textContent=`Minimum purchase is ${MIN_CODES} codes.`;}return;}
    const btn=$('buyCodesPaypalBtn');if(btn)btn.disabled=true;
    try{
      const r=await fetch('/api/reseller/code-purchases/paypal/create',{method:'POST',headers:{'Content-Type':'application/json','x-reseller-token':token},body:JSON.stringify({count})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not start PayPal payment.');
      if(out){out.className='msg success';out.textContent=`Opening PayPal for ${count} codes (${usd(d.amount_usd||count*UNIT_USD)}).`;}
      location.href=d.approval_url;
    }catch(e){if(out){out.className='msg error';out.textContent=e.message;}if(btn)btn.disabled=false;}
  };

  async function verifyPaypalReturn(){
    const u=new URL(location.href),reference=u.searchParams.get('paypal_code_purchase_ref'),status=u.searchParams.get('paypal');
    if(!reference)return;
    const out=$('purchaseMsg');
    if(status==='cancelled'){
      if(out){out.className='msg error';out.textContent='PayPal payment was cancelled. No code credits were added.';}
      u.searchParams.delete('paypal_code_purchase_ref');u.searchParams.delete('paypal');history.replaceState({},'',u.pathname+u.search);return;
    }
    const orderID=u.searchParams.get('token');
    if(!orderID)return;
    const token=localStorage.getItem('wtv_reseller_token')||'';
    try{
      if(out){out.className='msg info';out.textContent='Verifying PayPal payment and adding your code credits...';}
      const r=await fetch('/api/reseller/code-purchases/paypal/capture',{method:'POST',headers:{'Content-Type':'application/json','x-reseller-token':token},body:JSON.stringify({reference,orderID})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not verify PayPal payment.');
      if(out){out.className='msg success';out.textContent=d.already_credited?'This PayPal payment was already credited.':`PayPal payment successful. ${d.credited} code credit(s) added to your account.`;}
      u.searchParams.delete('paypal_code_purchase_ref');u.searchParams.delete('paypal');u.searchParams.delete('token');u.searchParams.delete('PayerID');history.replaceState({},'',u.pathname+u.search);
      if(typeof window.loadData==='function')await window.loadData();
      await refreshStore();
    }catch(e){if(out){out.className='msg error';out.textContent=e.message;}}
  }

  function init(){
    applyBranding();
    const p=$('purchaseCount');if(p){p.min=String(MIN_CODES);p.value=String(Math.max(MIN_CODES,Number(p.value)||MIN_CODES));p.addEventListener('change',window.updatePurchaseTotal);}
    refreshStore();setTimeout(refreshStore,800);setTimeout(verifyPaypalReturn,1000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();