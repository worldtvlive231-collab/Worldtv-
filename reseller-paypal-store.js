'use strict';

const path=require('path');
const crypto=require('crypto');
const express=require('express');
const Database=require('better-sqlite3');

const db=new Database(path.join(process.cwd(),'data','worldtv.sqlite'));
db.pragma('journal_mode=WAL');
const UNIT_USD=19;
const MIN_CODES=10;
const mode=String(process.env.PAYPAL_MODE||'sandbox').toLowerCase()==='live'?'live':'sandbox';
const apiBase=mode==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
let tokenCache={token:'',expiresAt:0};

function paypalConfigured(){return Boolean(String(process.env.PAYPAL_CLIENT_ID||'').trim()&&String(process.env.PAYPAL_CLIENT_SECRET||'').trim());}
async function getAccessToken(){
  if(!paypalConfigured())throw new Error('PayPal is not configured.');
  if(tokenCache.token&&Date.now()<tokenCache.expiresAt-60000)return tokenCache.token;
  const auth=Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const r=await fetch(`${apiBase}/v1/oauth2/token`,{method:'POST',headers:{Authorization:`Basic ${auth}`,'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:'grant_type=client_credentials'});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.access_token)throw new Error(d.error_description||'Could not connect to PayPal.');
  tokenCache={token:d.access_token,expiresAt:Date.now()+Number(d.expires_in||300)*1000};
  return tokenCache.token;
}
async function paypalRequest(endpoint,options={}){
  const token=await getAccessToken();
  const r=await fetch(`${apiBase}${endpoint}`,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json',...(options.headers||{})}});
  const d=await r.json().catch(()=>({}));
  return {response:r,data:d};
}
function creditPurchase(purchase,res){
  const credited=db.transaction(()=>{
    const fresh=db.prepare('SELECT status FROM reseller_code_purchases WHERE id=?').get(purchase.id);
    if(fresh&&fresh.status==='paid')return false;
    db.prepare(`UPDATE reseller_code_purchases SET status='paid',paid_at=CURRENT_TIMESTAMP WHERE id=?`).run(purchase.id);
    const q=db.prepare('SELECT id FROM reseller_code_allocation WHERE reseller_id=?').get(purchase.reseller_id);
    if(q){
      db.prepare(`UPDATE reseller_code_allocation SET allocated_count=allocated_count+?,available_count=available_count+?,updated_at=CURRENT_TIMESTAMP WHERE reseller_id=?`).run(purchase.code_count,purchase.code_count,purchase.reseller_id);
    }else{
      db.prepare(`INSERT INTO reseller_code_allocation(reseller_id,allocated_count,used_count,available_count) VALUES(?,?,0,?)`).run(purchase.reseller_id,purchase.code_count,purchase.code_count);
    }
    return true;
  })();
  const quota=db.prepare('SELECT allocated_count,used_count,available_count FROM reseller_code_allocation WHERE reseller_id=?').get(purchase.reseller_id);
  return res.json({ok:true,credited:credited?purchase.code_count:0,already_credited:!credited,purchase:{...purchase,status:'paid'},quota});
}

async function createPaypalPurchase(req,res){
  try{
    if(!paypalConfigured())return res.status(503).json({error:'PayPal is not configured.'});
    const count=Math.floor(Number(req.body&&req.body.count));
    if(!Number.isFinite(count)||count<MIN_CODES||count>1000)return res.status(400).json({error:`Minimum purchase is ${MIN_CODES} codes.`});
    const reseller=db.prepare("SELECT id,name,email FROM resellers WHERE id=? AND status='active'").get(req.resellerId);
    if(!reseller)return res.status(401).json({error:'Unauthorized'});
    const amountUsd=Number((UNIT_USD*count).toFixed(2));
    const reference=`WTV-RPP-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    db.prepare(`INSERT INTO reseller_code_purchases(reseller_id,reference,code_count,unit_price_ghs,amount_ghs,unit_price_usd,amount_usd,status,provider) VALUES(?,?,?,?,?,?,?,'pending','paypal')`).run(req.resellerId,reference,count,0,0,UNIT_USD,amountUsd);
    const base=String(process.env.PUBLIC_BASE_URL||`${req.protocol}://${req.get('host')}`).replace(/\/$/,'');
    if(!/^https:\/\//i.test(base))return res.status(500).json({error:'PUBLIC_BASE_URL must use HTTPS for PayPal.'});
    const returnUrl=`${base}/reseller?paypal_code_purchase_ref=${encodeURIComponent(reference)}&paypal=success`;
    const cancelUrl=`${base}/reseller?paypal_code_purchase_ref=${encodeURIComponent(reference)}&paypal=cancelled`;
    const {response,data}=await paypalRequest('/v2/checkout/orders',{method:'POST',headers:{'PayPal-Request-Id':`wtv-reseller-${reference}`},body:JSON.stringify({intent:'CAPTURE',purchase_units:[{reference_id:reference,custom_id:reference,description:`WORLD TV reseller code credits (${count})`,amount:{currency_code:'USD',value:amountUsd.toFixed(2)}}],payment_source:{paypal:{experience_context:{brand_name:'WORLD TV',shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW',return_url:returnUrl,cancel_url:cancelUrl}}}})});
    if(!response.ok||!data.id)return res.status(502).json({error:data.message||'Could not start PayPal payment.'});
    const approval=(data.links||[]).find(l=>l.rel==='payer-action'||l.rel==='approve');
    if(!approval?.href)return res.status(502).json({error:'PayPal approval URL was not received.'});
    db.prepare(`UPDATE reseller_code_purchases SET provider_reference=? WHERE reference=? AND reseller_id=?`).run(data.id,reference,req.resellerId);
    res.json({ok:true,reference,count,amount_usd:amountUsd,paypal_order_id:data.id,approval_url:approval.href,mode});
  }catch(e){console.error('Reseller PayPal create error:',e);res.status(500).json({error:e.message||'Could not start PayPal payment.'});}
}

async function capturePaypalPurchase(req,res){
  try{
    if(!paypalConfigured())return res.status(503).json({error:'PayPal is not configured.'});
    const reference=String(req.body&&req.body.reference||'').trim();
    const orderId=String(req.body&&req.body.orderID||req.body&&req.body.orderId||'').trim();
    if(!reference||!orderId)return res.status(400).json({error:'PayPal order ID and purchase reference are required.'});
    const purchase=db.prepare(`SELECT * FROM reseller_code_purchases WHERE reference=? AND reseller_id=? AND provider='paypal'`).get(reference,req.resellerId);
    if(!purchase)return res.status(404).json({error:'PayPal reseller purchase not found.'});
    if(purchase.status==='paid')return creditPurchase(purchase,res);
    if(String(purchase.provider_reference||'')!==orderId)return res.status(400).json({error:'PayPal order does not match this purchase.'});
    let {response,data}=await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,{method:'POST',body:'{}'});
    if(!response.ok){
      const shown=await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}`,{method:'GET'});
      if(!shown.response.ok||shown.data?.status!=='COMPLETED')return res.status(502).json({error:data.message||'Could not capture PayPal payment.'});
      data=shown.data;
    }
    if(data.status!=='COMPLETED')return res.status(400).json({error:'PayPal payment has not been completed.'});
    const unit=data.purchase_units?.[0]||{};
    const capture=unit.payments?.captures?.[0]||{};
    const amt=capture.amount||unit.amount||{};
    const custom=unit.custom_id||unit.reference_id||'';
    if(custom!==reference||String(amt.currency_code||'').toUpperCase()!=='USD'||Math.abs(Number(amt.value)-Number(purchase.amount_usd))>0.001)return res.status(400).json({error:'PayPal payment details do not match this reseller purchase.'});
    db.prepare(`UPDATE reseller_code_purchases SET provider_reference=? WHERE id=?`).run(capture.id||orderId,purchase.id);
    return creditPurchase(purchase,res);
  }catch(e){console.error('Reseller PayPal capture error:',e);res.status(500).json({error:e.message||'Could not verify PayPal payment.'});}
}

const originalPost=express.application.post;
express.application.post=function patchedResellerPaypalPost(routePath,...handlers){
  const result=originalPost.call(this,routePath,...handlers);
  if(routePath==='/api/reseller/generate-codes'&&!this.__wtvResellerPaypalRoutes){
    const resellerOnly=handlers[0];
    if(typeof resellerOnly==='function'){
      originalPost.call(this,'/api/reseller/code-purchases/paypal/create',resellerOnly,createPaypalPurchase);
      originalPost.call(this,'/api/reseller/code-purchases/paypal/capture',resellerOnly,capturePaypalPurchase);
      this.__wtvResellerPaypalRoutes=true;
    }
  }
  return result;
};
