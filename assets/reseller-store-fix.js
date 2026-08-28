(()=>{
  'use strict';
  if(!/^\/reseller(?:\.html)?$/.test(location.pathname))return;

  const usd=v=>'$'+Number(v||0).toFixed(2);

  function minimumCodes(){
    try{return Math.max(1,Number(storeData?.minimum_codes||10));}catch(_){return 10;}
  }

  function applyLabels(){
    const purchase=document.getElementById('purchaseCount');
    if(purchase){
      const min=minimumCodes();
      purchase.min=String(min);
      if(Number(purchase.value||0)<min)purchase.value=String(min);
    }
    const used=document.getElementById('usedCount');
    const label=used?.parentElement?.querySelector('span');
    if(label)label.textContent='Credits Used To Generate';
  }

  window.updatePurchaseTotal=function(){
    applyLabels();
    const count=Math.max(minimumCodes(),parseInt(document.getElementById('purchaseCount')?.value||String(minimumCodes()),10));
    document.getElementById('purchaseTotal').textContent=storeData?.configured?usd(count*Number(storeData.unit_price_usd||19)):'—';
  };

  window.renderPurchaseHistory=function(){
    const rows=storeData?.history||[];
    document.getElementById('purchaseHistory').innerHTML=rows.length?rows.map(p=>`<tr><td>${new Date(p.created_at).toLocaleString()}</td><td>${esc(p.reference)}</td><td>${Number(p.code_count||0)}</td><td>${usd(p.amount_usd??(Number(p.code_count||0)*Number(p.unit_price_usd||19)))}</td><td><span class="pill ${p.status==='paid'?'paid':'pending'}">${esc(p.status)}</span></td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;color:#837b69;padding:20px">No purchases yet</td></tr>';
  };

  window.loadStore=async function(){
    try{
      storeData=await api('/api/reseller/code-store');
      applyLabels();
      document.getElementById('unitPrice').textContent=storeData.configured?usd(storeData.unit_price_usd||19):'Not set';
      document.getElementById('buyCodesBtn').disabled=!storeData.configured||!storeData.payment_configured;
      if(!storeData.configured){
        msg(document.getElementById('storeStatus'),'The reseller price has not been configured yet. Contact WORLD TV admin.','error');
      }else if(!storeData.payment_configured){
        msg(document.getElementById('storeStatus'),'Payment is temporarily unavailable. Contact WORLD TV admin.','error');
      }else{
        msg(document.getElementById('storeStatus'),`Each code costs ${usd(storeData.unit_price_usd||19)}. Minimum purchase: ${minimumCodes()} codes. Paystack charges the current Ghana-cedi equivalent at checkout.`,'success');
      }
      updatePurchaseTotal();
      renderPurchaseHistory();
    }catch(e){
      msg(document.getElementById('storeStatus'),e.message,'error');
    }
  };

  window.buyCodeCredits=async function(){
    if(buying)return;
    const min=minimumCodes();
    const count=parseInt(document.getElementById('purchaseCount').value,10);
    if(!count||count<min||count>1000){
      return msg(document.getElementById('purchaseMsg'),`Choose between ${min} and 1000 codes.`,'error');
    }
    buying=true;
    document.getElementById('buyCodesBtn').disabled=true;
    try{
      const r=await api('/api/reseller/code-purchases/initialize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({count})});
      if(!r.authorization_url)throw new Error('Payment link was not returned.');
      msg(document.getElementById('purchaseMsg'),`Opening secure Paystack checkout for ${r.count} code(s) — ${usd(r.amount_usd)} total. You will be charged the current GHS equivalent.`,'success');
      window.location.href=r.authorization_url;
    }catch(e){
      msg(document.getElementById('purchaseMsg'),e.message,'error');
      document.getElementById('buyCodesBtn').disabled=false;
      buying=false;
    }
  };

  function ready(){
    applyLabels();
    if(resellerToken){loadStore().catch(()=>{});}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})();
