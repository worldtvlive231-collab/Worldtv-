require("dotenv").config();

const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const { getExchangeRates } = require("./exchange-rates");

const db = new Database(path.join(__dirname, "data", "worldtv.sqlite"));
db.pragma("journal_mode=WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS product_payment_attempts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_reference TEXT NOT NULL,
  amount_ghs REAL NOT NULL,
  amount_provider REAL,
  provider_currency TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_reference)
);
CREATE INDEX IF NOT EXISTS idx_product_payment_order
  ON product_payment_attempts(order_number);
`);

const paypalMode = String(process.env.PAYPAL_MODE || "sandbox").toLowerCase() === "live" ? "live" : "sandbox";
const paypalBase = paypalMode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
let paypalToken = { value:"", expiresAt:0 };

function productOrder(orderNumber){
  return db.prepare(`
    SELECT po.*,p.name AS product_name
    FROM product_orders po
    JOIN products p ON p.id=po.product_id
    WHERE po.order_number=?
  `).get(orderNumber);
}

function requirePayableOrder(orderNumber){
  const order = productOrder(orderNumber);
  if(!order) throw Object.assign(new Error("Product order not found"),{status:404});
  if(!Number.isFinite(Number(order.total_ghs)) || Number(order.total_ghs) <= 0){
    throw Object.assign(new Error("This order does not have a payable total"),{status:400});
  }
  if(String(order.status).toLowerCase() === "cancelled"){
    throw Object.assign(new Error("This order has been cancelled"),{status:409});
  }
  return order;
}

function markPaid(orderNumber, provider, providerReference){
  const tx = db.transaction(()=>{
    db.prepare(`UPDATE product_orders SET status='confirmed' WHERE order_number=?`).run(orderNumber);
    db.prepare(`
      UPDATE product_payment_attempts
      SET status='paid',updated_at=CURRENT_TIMESTAMP
      WHERE order_number=? AND provider=? AND provider_reference=?
    `).run(orderNumber,provider,providerReference);
  });
  tx();
}

function publicBase(){
  const base = String(process.env.PUBLIC_BASE_URL || process.env.APP_URL || "https://myworldtvlive.com").replace(/\/$/,"");
  return base.startsWith("https://") ? base : "https://myworldtvlive.com";
}

async function paypalAccessToken(){
  if(!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) throw new Error("PayPal is not configured");
  if(paypalToken.value && Date.now() < paypalToken.expiresAt - 60000) return paypalToken.value;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const r = await fetch(`${paypalBase}/v1/oauth2/token`,{
    method:"POST",
    headers:{Authorization:`Basic ${auth}`,"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},
    body:"grant_type=client_credentials"
  });
  const d = await r.json().catch(()=>({}));
  if(!r.ok || !d.access_token) throw new Error(d.error_description || "Could not connect to PayPal");
  paypalToken = {value:d.access_token,expiresAt:Date.now()+Number(d.expires_in||300)*1000};
  return paypalToken.value;
}

async function paypalRequest(endpoint,options={}){
  const token = await paypalAccessToken();
  const r = await fetch(`${paypalBase}${endpoint}`,{
    ...options,
    headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",Accept:"application/json",...(options.headers||{})}
  });
  const d = await r.json().catch(()=>({}));
  return {r,d};
}

async function usdFromGhs(ghs){
  const result = await getExchangeRates();
  const rate = Number(result?.rates?.USD);
  if(!Number.isFinite(rate) || rate<=0) throw new Error("USD exchange rate is unavailable");
  return Number((Number(ghs)*rate).toFixed(2));
}

function registerRoutes(app){
  app.get("/api/product-payments/config",(req,res)=>{
    res.setHeader("Cache-Control","no-store");
    res.json({ok:true,paystack_configured:Boolean(process.env.PAYSTACK_SECRET_KEY),paypal_configured:Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),paypal_mode:paypalMode});
  });

  app.post("/api/product-payments/paystack/initialize",async(req,res)=>{
    try{
      if(!process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({error:"Paystack is not configured"});
      const orderNumber=String(req.body?.order_number||"").trim();
      const requestedChannel=String(req.body?.channel||"").trim();
      const channel=requestedChannel === "mobile_money" || requestedChannel === "card" ? requestedChannel : null;
      const order=requirePayableOrder(orderNumber);
      if(!String(order.email||"").trim()) return res.status(400).json({error:"Customer email is required for Paystack payment"});
      const reference=`WTVP-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
      const callback=`${publicBase()}/order.html?payment=paystack&order=${encodeURIComponent(orderNumber)}&payment_reference=${encodeURIComponent(reference)}`;
      const payload={
        email:String(order.email).trim(),
        amount:Math.round(Number(order.total_ghs)*100),
        currency:"GHS",
        reference,
        callback_url:callback,
        metadata:{order_number:orderNumber,customer_name:order.customer_name,product:order.product_name,payment_channel:channel||"paystack"}
      };
      if(channel) payload.channels=[channel];
      const r=await fetch("https://api.paystack.co/transaction/initialize",{method:"POST",headers:{Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(payload)});
      const d=await r.json().catch(()=>({}));
      if(!r.ok || !d.status || !d.data?.authorization_url) return res.status(502).json({error:d.message||"Could not start Paystack payment"});
      db.prepare(`INSERT INTO product_payment_attempts(order_number,provider,provider_reference,amount_ghs,amount_provider,provider_currency,status) VALUES(?,?,?,?,?,?,?)`).run(orderNumber,"paystack",reference,Number(order.total_ghs),Number(order.total_ghs),"GHS","pending");
      res.json({ok:true,authorization_url:d.data.authorization_url,reference,channel:channel||"all"});
    }catch(e){res.status(e.status||500).json({error:e.message||"Could not start Paystack payment"});}
  });

  app.get("/api/product-payments/paystack/verify",async(req,res)=>{
    try{
      if(!process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({error:"Paystack is not configured"});
      const orderNumber=String(req.query.order_number||"").trim();
      const reference=String(req.query.reference||"").trim();
      const order=requirePayableOrder(orderNumber);
      const attempt=db.prepare(`SELECT * FROM product_payment_attempts WHERE order_number=? AND provider='paystack' AND provider_reference=?`).get(orderNumber,reference);
      if(!attempt) return res.status(400).json({error:"Payment reference does not match this order"});
      const r=await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,{headers:{Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`,Accept:"application/json"}});
      const d=await r.json().catch(()=>({}));
      if(!r.ok || !d.status || d.data?.status!=="success") return res.status(400).json({error:d.message||"Payment has not been completed"});
      const paidGhs=Number(d.data.amount)/100;
      if(d.data.currency!=="GHS" || Math.abs(paidGhs-Number(order.total_ghs))>0.001) return res.status(400).json({error:"Payment amount does not match this order"});
      markPaid(orderNumber,"paystack",reference);
      const providerLabel=d.data.channel==="mobile_money"?"Mobile Money":d.data.channel==="card"?"Card":"Paystack";
      res.json({ok:true,paid:true,order_number:orderNumber,total_ghs:Number(order.total_ghs),provider:providerLabel});
    }catch(e){res.status(e.status||500).json({error:e.message||"Could not verify Paystack payment"});}
  });

  app.post("/api/product-payments/paypal/create-order",async(req,res)=>{
    try{
      if(!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) return res.status(503).json({error:"PayPal is not configured"});
      const orderNumber=String(req.body?.order_number||"").trim();
      const order=requirePayableOrder(orderNumber);
      const usd=await usdFromGhs(order.total_ghs);
      const returnUrl=`${publicBase()}/order.html?payment=paypal&order=${encodeURIComponent(orderNumber)}`;
      const cancelUrl=`${publicBase()}/order.html?payment=cancelled&order=${encodeURIComponent(orderNumber)}`;
      const {r,d}=await paypalRequest("/v2/checkout/orders",{method:"POST",headers:{"PayPal-Request-Id":`product-${orderNumber}-${Date.now()}`},body:JSON.stringify({intent:"CAPTURE",purchase_units:[{reference_id:orderNumber,custom_id:orderNumber,description:`World TV product order ${orderNumber}`,amount:{currency_code:"USD",value:usd.toFixed(2)}}],payment_source:{paypal:{experience_context:{brand_name:"World TV",shipping_preference:"GET_FROM_FILE",user_action:"PAY_NOW",return_url:returnUrl,cancel_url:cancelUrl}}}})});
      if(!r.ok || !d.id) return res.status(502).json({error:d.message||"Could not start PayPal payment"});
      const approval=(d.links||[]).find(x=>x.rel==="payer-action"||x.rel==="approve");
      if(!approval?.href) return res.status(502).json({error:"PayPal approval link was not received"});
      db.prepare(`INSERT INTO product_payment_attempts(order_number,provider,provider_reference,amount_ghs,amount_provider,provider_currency,status) VALUES(?,?,?,?,?,?,?)`).run(orderNumber,"paypal",d.id,Number(order.total_ghs),usd,"USD","pending");
      res.json({ok:true,approval_url:approval.href,paypal_order_id:d.id,amount_usd:usd.toFixed(2),mode:paypalMode});
    }catch(e){res.status(e.status||500).json({error:e.message||"Could not start PayPal payment"});}
  });

  app.post("/api/product-payments/paypal/capture",async(req,res)=>{
    try{
      const orderNumber=String(req.body?.order_number||"").trim();
      const paypalOrderId=String(req.body?.paypal_order_id||req.body?.token||"").trim();
      const order=requirePayableOrder(orderNumber);
      const attempt=db.prepare(`SELECT * FROM product_payment_attempts WHERE order_number=? AND provider='paypal' AND provider_reference=?`).get(orderNumber,paypalOrderId);
      if(!attempt) return res.status(400).json({error:"PayPal order does not match this product order"});
      let {r,d}=await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,{method:"POST",body:"{}"});
      if(!r.ok){const shown=await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`,{method:"GET"});if(!shown.r.ok || shown.d?.status!=="COMPLETED") return res.status(502).json({error:d.message||"Could not capture PayPal payment"});d=shown.d;}
      if(d.status!=="COMPLETED") return res.status(400).json({error:"PayPal payment has not been completed"});
      const unit=d.purchase_units?.[0]||{};const capture=unit.payments?.captures?.[0]||{};const amt=capture.amount||unit.amount||{};
      if((unit.custom_id||unit.reference_id)!==orderNumber || amt.currency_code!=="USD" || Math.abs(Number(amt.value)-Number(attempt.amount_provider))>0.001) return res.status(400).json({error:"PayPal payment details do not match this order"});
      markPaid(orderNumber,"paypal",paypalOrderId);
      res.json({ok:true,paid:true,order_number:orderNumber,total_ghs:Number(order.total_ghs),provider:"PayPal"});
    }catch(e){res.status(e.status||500).json({error:e.message||"Could not verify PayPal payment"});}
  });
}

const originalListen=express.application.listen;
express.application.listen=function patchedProductPaymentsListen(...args){
  if(!this.__worldTvProductPaymentsInstalled){
    this.__worldTvProductPaymentsInstalled=true;
    const router=this._router;
    if(router && Array.isArray(router.stack)){
      const before=router.stack.length;
      registerRoutes(this);
      const added=router.stack.splice(before);
      const insertAt=Math.max(0,router.stack.length-2);
      router.stack.splice(insertAt,0,...added);
    }else{
      registerRoutes(this);
    }
  }
  return originalListen.apply(this,args);
};
