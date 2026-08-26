require("dotenv").config();

const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const { getExchangeRates } = require("./exchange-rates");

const db = new Database(path.join(__dirname, "data", "worldtv.sqlite"));
db.pragma("journal_mode=WAL");

const GHANA_TV_BOX_PRICE_GHS = 850;
const INTERNATIONAL_TV_BOX_PRICE_USD = 100;

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

function isTvBoxOrder(order){
  return /android\s*tv\s*box|world\s*tv\s*box/i.test(String(order?.product_name || ""));
}

function isGhanaOrder(order){
  const raw = String(order?.country || order?.delivery_location || "").trim().toLowerCase();
  return raw === "ghana" || raw === "gh" || raw === "gha" || raw.startsWith("ghana ") || raw.startsWith("ghana—") || raw.startsWith("ghana —");
}

function orderQuantity(order){
  return Math.max(1, Number(order?.quantity) || 1);
}

async function paymentAmounts(order){
  const qty = orderQuantity(order);
  if(!isTvBoxOrder(order)){
    const ghs = Number(order.total_ghs);
    return {ghs,market:"standard"};
  }
  if(isGhanaOrder(order)){
    const ghs = GHANA_TV_BOX_PRICE_GHS * qty;
    return {ghs,market:"ghana"};
  }
  const rates = await getExchangeRates();
  const usdRate = Number(rates?.rates?.USD);
  if(!Number.isFinite(usdRate) || usdRate <= 0) throw new Error("USD exchange rate is unavailable");
  const usd = INTERNATIONAL_TV_BOX_PRICE_USD * qty;
  const ghs = Number((usd / usdRate).toFixed(2));
  return {ghs,usd,market:"international"};
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

function registerRoutes(app){
  app.get("/api/product-payments/config",(req,res)=>{
    res.setHeader("Cache-Control","no-store");
    res.json({ok:true,paystack_configured:Boolean(process.env.PAYSTACK_SECRET_KEY),paypal_configured:false});
  });

  app.post("/api/product-payments/paystack/initialize",async(req,res)=>{
    try{
      if(!process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({error:"Paystack is not configured"});
      const orderNumber=String(req.body?.order_number||"").trim();
      const requestedChannel=String(req.body?.channel||"").trim();
      const channel=requestedChannel === "mobile_money" || requestedChannel === "card" ? requestedChannel : null;
      const order=requirePayableOrder(orderNumber);
      if(!String(order.email||"").trim()) return res.status(400).json({error:"Customer email is required for Paystack payment"});
      const priced=await paymentAmounts(order);
      const reference=`WTVP-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
      const callback=`${publicBase()}/order.html?payment=paystack&order=${encodeURIComponent(orderNumber)}&payment_reference=${encodeURIComponent(reference)}`;
      const payload={
        email:String(order.email).trim(),
        amount:Math.round(Number(priced.ghs)*100),
        currency:"GHS",
        reference,
        callback_url:callback,
        metadata:{order_number:orderNumber,customer_name:order.customer_name,product:order.product_name,payment_channel:channel||"paystack",pricing_market:priced.market}
      };
      if(channel) payload.channels=[channel];
      const r=await fetch("https://api.paystack.co/transaction/initialize",{method:"POST",headers:{Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(payload)});
      const d=await r.json().catch(()=>({}));
      if(!r.ok || !d.status || !d.data?.authorization_url) return res.status(502).json({error:d.message||"Could not start Paystack payment"});
      db.prepare(`INSERT INTO product_payment_attempts(order_number,provider,provider_reference,amount_ghs,amount_provider,provider_currency,status) VALUES(?,?,?,?,?,?,?)`).run(orderNumber,"paystack",reference,Number(priced.ghs),Number(priced.ghs),"GHS","pending");
      res.json({ok:true,authorization_url:d.data.authorization_url,reference,channel:channel||"all",amount_ghs:Number(priced.ghs),pricing_market:priced.market});
    }catch(e){res.status(e.status||500).json({error:e.message||"Could not start Paystack payment"});}
  });

  app.get("/api/product-payments/paystack/verify",async(req,res)=>{
    try{
      if(!process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({error:"Paystack is not configured"});
      const orderNumber=String(req.query.order_number||"").trim();
      const reference=String(req.query.reference||"").trim();
      requirePayableOrder(orderNumber);
      const attempt=db.prepare(`SELECT * FROM product_payment_attempts WHERE order_number=? AND provider='paystack' AND provider_reference=?`).get(orderNumber,reference);
      if(!attempt) return res.status(400).json({error:"Payment reference does not match this order"});
      const r=await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,{headers:{Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`,Accept:"application/json"}});
      const d=await r.json().catch(()=>({}));
      if(!r.ok || !d.status || d.data?.status!=="success") return res.status(400).json({error:d.message||"Payment has not been completed"});
      const paidGhs=Number(d.data.amount)/100;
      if(d.data.currency!=="GHS" || Math.abs(paidGhs-Number(attempt.amount_provider))>0.001) return res.status(400).json({error:"Payment amount does not match this order"});
      markPaid(orderNumber,"paystack",reference);
      const providerLabel=d.data.channel==="mobile_money"?"Mobile Money":d.data.channel==="card"?"Card":"Paystack";
      res.json({ok:true,paid:true,order_number:orderNumber,total_ghs:Number(attempt.amount_ghs),provider:providerLabel});
    }catch(e){res.status(e.status||500).json({error:e.message||"Could not verify Paystack payment"});}
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
