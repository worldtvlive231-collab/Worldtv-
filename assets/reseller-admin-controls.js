(()=>{
  'use strict';
  const token=()=>localStorage.getItem('wtv_admin_token')||'';
  const api=async(url,options={})=>{options.headers=Object.assign({},options.headers||{}, {'x-admin-token':token()});const r=await fetch(url,options);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d;};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  let overlay;

  function brand(){
    document.querySelectorAll('img.logo').forEach(img=>{img.src='/world-tv-logo.png';img.alt='WORLD TV';img.style.objectFit='contain';});
    const tab=document.getElementById('resellersTab');
    if(tab&&!document.getElementById('resellerPricingBanner')){
      const card=document.createElement('div');card.id='resellerPricingBanner';card.className='card';card.innerHTML=`<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap"><img src="/world-tv-logo.png" alt="WORLD TV" style="width:110px;height:70px;object-fit:contain"><div><h2 style="margin:0 0 6px">WORLD TV Reseller Code Pricing</h2><div style="font-size:30px;font-weight:900;color:#d89a00">$19 USD <span style="font-size:15px;color:#716958">per 1-year code</span></div><p class="muted" style="margin:6px 0 0">Minimum package: <b>10 codes</b> • Minimum checkout: <b>$190 USD</b>. Resellers can generate only paid/allocated code credits.</p></div></div>`;
      tab.insertBefore(card,tab.firstChild);
    }
  }

  function ensureOverlay(){
    if(overlay)return overlay;
    overlay=document.createElement('div');overlay.id='resellerCodeControlOverlay';overlay.style.cssText='display:none;position:fixed;inset:0;background:#0008;z-index:9999;padding:20px;align-items:center;justify-content:center';
    overlay.innerHTML='<div id="resellerCodeControlBox" style="background:#fff;border-radius:18px;width:min(900px,100%);max-height:90vh;overflow:auto;padding:24px;position:relative"></div>';
    overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.style.display='none';});document.body.appendChild(overlay);return overlay;
  }

  async function openControl(id){
    const o=ensureOverlay(),box=document.getElementById('resellerCodeControlBox');o.style.display='flex';box.innerHTML='<p>Loading reseller code controls...</p>';
    try{
      const d=await api(`/api/admin/resellers/${id}/code-control`),q=d.quota||{},codes=d.codes||[];
      box.innerHTML=`<button onclick="document.getElementById('resellerCodeControlOverlay').style.display='none'" style="position:absolute;right:14px;top:10px;border:0;background:none;font-size:28px;cursor:pointer">×</button>
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:14px"><img src="/world-tv-logo.png" style="width:90px;height:55px;object-fit:contain"><div><h2 style="margin:0">${esc(d.reseller.name)}</h2><div class="muted">${esc(d.reseller.email)}</div></div></div>
      <div class="grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:18px"><div class="card"><div class="muted">Allocated</div><div class="stat">${Number(q.allocated_count||0)}</div></div><div class="card"><div class="muted">Generated</div><div class="stat">${Number(q.used_count||0)}</div></div><div class="card"><div class="muted">Unused Credits</div><div class="stat">${Number(q.available_count||0)}</div></div></div>
      <div class="card"><h3>Revoke Unused Code Credits</h3><p class="muted">This reduces credits the reseller has not generated yet.</p><div style="display:flex;gap:10px;align-items:end"><div style="flex:1"><label>Credits to revoke</label><input id="revokeCreditCount" type="number" min="1" max="${Number(q.available_count||0)}" value="1"></div><button class="btn danger" onclick="wtvRevokeCredits(${id})">Revoke Credits</button></div><p id="revokeCreditMsg" class="muted"></p></div>
      <div class="card"><h3>Generated Codes</h3><p class="muted">Unused generated codes can be revoked individually. Used customer codes are protected.</p><div style="overflow:auto"><table><thead><tr><th>Code</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>${codes.length?codes.map(c=>`<tr><td><b>${esc(c.code)}</b></td><td>${esc(c.status)}</td><td>${c.created_at?new Date(c.created_at).toLocaleString():'—'}</td><td>${String(c.status).toLowerCase()==='used'?'<span class="muted">Used — protected</span>':`<button class="btn danger" onclick="wtvRevokeGeneratedCode(${id},'${esc(c.code)}')">Revoke</button>`}</td></tr>`).join(''):'<tr><td colspan="4" class="muted">No generated codes on this account.</td></tr>'}</tbody></table></div></div>`;
    }catch(e){box.innerHTML=`<button onclick="document.getElementById('resellerCodeControlOverlay').style.display='none'" style="float:right">×</button><p>${esc(e.message)}</p>`;}
  }

  window.wtvRevokeCredits=async id=>{const count=Number(document.getElementById('revokeCreditCount')?.value||0),m=document.getElementById('revokeCreditMsg');if(!count||count<1)return;m.textContent='Revoking...';try{await api(`/api/admin/resellers/${id}/revoke-credits`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({count})});m.textContent=`${count} unused credit(s) revoked.`;setTimeout(()=>openControl(id),500);window.loadResellers?.();}catch(e){m.textContent=e.message;}};
  window.wtvRevokeGeneratedCode=async(id,code)=>{if(!confirm(`Revoke subscription code ${code}? The reseller will no longer be able to use or sell this code.`))return;try{await api(`/api/admin/resellers/${id}/revoke-code`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});await openControl(id);window.loadResellers?.();}catch(e){alert(e.message);}};
  window.wtvDeleteReseller=async(id,name)=>{if(!confirm(`Delete reseller account "${name}"?\n\nThis disables login immediately and revokes all unused code credits. Historical sales and subscriber records are preserved.`))return;try{await api(`/api/admin/resellers/${id}`,{method:'DELETE'});alert('Reseller account deleted.');window.loadResellers?.();}catch(e){alert(e.message);}};
  window.wtvOpenResellerCodeControl=openControl;

  function enhanceRows(){
    const tbody=document.getElementById('resellersTable');if(!tbody)return;
    [...tbody.querySelectorAll('tr')].forEach(row=>{
      const manage=[...row.querySelectorAll('button')].find(b=>/openResellerDetails\((\d+)\)/.test(b.getAttribute('onclick')||''));if(!manage||row.querySelector('.wtv-code-control'))return;
      const m=(manage.getAttribute('onclick')||'').match(/openResellerDetails\((\d+)\)/);if(!m)return;const id=Number(m[1]);const name=row.cells?.[0]?.innerText?.trim()||'this reseller';const cell=manage.parentElement;
      const codeBtn=document.createElement('button');codeBtn.className='btn secondary wtv-code-control';codeBtn.textContent='Code Control';codeBtn.style.marginLeft='6px';codeBtn.onclick=()=>openControl(id);cell.appendChild(codeBtn);
      const del=document.createElement('button');del.className='btn danger wtv-delete-reseller';del.textContent='Delete';del.style.marginLeft='6px';del.onclick=()=>window.wtvDeleteReseller(id,name);cell.appendChild(del);
    });
  }

  function init(){brand();enhanceRows();const tbody=document.getElementById('resellersTable');if(tbody)new MutationObserver(enhanceRows).observe(tbody,{childList:true,subtree:true});new MutationObserver(brand).observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();