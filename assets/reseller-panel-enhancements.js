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

  async function refreshStore(){
    if(!localStorage.getItem('wtv_reseller_token'))return;
    try{
      const token=localStorage.getItem('wtv_reseller_token')||'';
      const r=await fetch('/api/reseller/code-store',{headers:{'x-reseller-token':token}});
      const d=await r.json().catch(()=>({}));
      if(!r.ok)return;
      const count=$('purchaseCount');
      if(count){count.min=String(MIN_CODES);if(Number(count.value)<MIN_CODES)count.value=String(MIN_CODES);}
      if($('unitPrice'))$('unitPrice').textContent=usd(d.unit_price_usd||UNIT_USD);
      if($('purchaseTotal'))$('purchaseTotal').textContent=usd((Number(count?.value)||MIN_CODES)*(d.unit_price_usd||UNIT_USD));
      if($('storeStatus')){$('storeStatus').className='msg success';$('storeStatus').textContent=`Reseller price is ${usd(d.unit_price_usd||UNIT_USD)} per 1-year code. Minimum purchase: ${MIN_CODES} codes (${usd(MIN_CODES*(d.unit_price_usd||UNIT_USD))}). Paystack will charge the current GHS equivalent at checkout, then your paid code credits are added automatically.`;}
      if($('buyCodesBtn'))$('buyCodesBtn').disabled=!d.payment_configured;
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
      if(out){out.className='msg success';out.textContent=`Opening secure payment for ${count} codes (${usd(d.amount_usd||count*UNIT_USD)}). Paystack will charge approximately GH₵${Number(d.amount_ghs||0).toFixed(2)}.`;}
      location.href=d.authorization_url;
    }catch(e){if(out){out.className='msg error';out.textContent=e.message;}if(btn)btn.disabled=false;}
  };

  function init(){applyBranding();const p=$('purchaseCount');if(p){p.min=String(MIN_CODES);p.value=String(Math.max(MIN_CODES,Number(p.value)||MIN_CODES));p.addEventListener('change',window.updatePurchaseTotal);}refreshStore();setTimeout(refreshStore,800);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();