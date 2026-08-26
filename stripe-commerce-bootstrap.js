"use strict";

require("dotenv").config();
const express=require("express");
const path=require("path");
const crypto=require("crypto");
const Database=require("better-sqlite3");
const Stripe=require("stripe");
const { getExchangeRates }=require("./exchange-rates");

const db=new Database(path.join(process.cwd(),"data","worldtv.sqlite"));
db.pragma("journal_mode=WAL");
db.pragma("busy_timeout=5000");
const RESELLER_CODE_PRICE_USD=19;
const MIN_RESELLER_CODES=10;
const GHANA_TV_BOX_PRICE_GHS=850;
const INTERNATIONAL_TV_BOX_PRICE_USD=100;

function stripeSecret(){return String(process.env.STRIPE_SECRET_KEY||"").trim();}
function stripeWebhookSecret(){return String(process.env.STRIPE_WEBHOOK_SECRET||"").trim();}
function stripeConfigured(){return /^(sk|rk)_(test|live)_/.test(stripeSecret());}
function baseUrl(){return String(process.env.PUBLIC_BASE_URL||process.env.APP_URL||"https://myworldtvlive.com").replace(/\/$/,"");}
let client=null,key="";
function stripe(){const secret=stripeSecret();if(!secret)throw new Error("Stripe is not configured");if(!client||key!==secret){client=new Stripe(secret,{apiVersion:"2026-07-29.dahlia"});key=secret;}return client;}
function verifyStripeEvent(req){const secret=stripeWebhookSecret(),sig=String(req.headers["stripe-signature"]||"");if(!secret||!sig||!req.rawBody)return null;try{return stripe().webhooks.constructEvent(req.rawBody,sig,secret);}catch(_){return null;}}

function productOrder(orderNumber){return db.prepare(`SELECT po.*,p.name AS product_name FROM product_orders po JOIN products p ON p.id=po.product_id WHERE po.order_number=?`).get(orderNumber);}
function requirePayableProduct(orderNumber){const order=productOrder(orderNumber);if(!order)throw Object.assign(new Error("Product order not found"),{status:404});if(String(order.status||"").toLowerCase()==="cancelled")throw Object.assign(new Error("This order has been cancelled"),{status:409});if(String(order.status||"").toLowerCase()==="confirmed")throw Object.assign(new Error("This order has already been paid"),{status:409});return order;}
function isTvBox(order){return /android\s*tv\s*box|world\s*tv\s*box/i.test(String(order?.product_name||""));}
function isGhana(order){const raw=String(order?.country||order?.delivery_location||"").trim().toLowerCase();return raw==="ghana"||raw==="gh"||raw==="gha"||raw.startsWith("ghana ")||raw.startsWith("ghana—")||raw.startsWith("ghana —");}
function qty(order){return Math.max(1,Number(order?.quantity)||1);}
async function usdPerGhs(){const fx=await getExchangeRates();const rate=Number(fx?.rates?.USD);if(!(rate>0))throw new Error("USD exchange rate is unavailable");return rate;}
async function productStripeAmounts(order){const quantity=qty(order);const rate=await usdPerGhs();if(isTvBox(order)&&!isGhana(order)){const usd=INTERNATIONAL_TV_BOX_PRICE_USD*quantity;return {usd:Number(usd.toFixed(2)),ghs:Number((usd/rate).toFixed(2)),market:"international"};}const ghs=isTvBox(order)&&isGhana(order)?GHANA_TV_BOX_PRICE_GHS*quantity:Number(order.total_ghs);if(!(ghs>0))throw new Error("This order does not have a payable total");return {ghs:Number(ghs.toFixed(2)),usd:Number((ghs*rate).toFixed(2)),market:isTvBox(order)?"ghana":"standard"};}

async function createProductStripe(req,res){
  try{
    if(!stripeConfigured())return res.status(503).json({error:"Stripe is not configured"});
    const orderNumber=String(req.body?.order_number||"").trim();
    const order=requirePayableProduct(orderNumber);
    if(!String(order.email||"").trim())return res.status(400).json({error:"Customer email is required for Stripe payment"});
    const amount=await productStripeAmounts(order);
    const paymentRef=`WTVPS-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const session=await stripe().checkout.sessions.create({
      mode:"payment",
      success_url:`${baseUrl()}/order.html?payment=stripe&order=${encodeURIComponent(orderNumber)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${baseUrl()}/order.html?payment=cancelled&order=${encodeURIComponent(orderNumber)}`,
      client_reference_id:orderNumber,
      customer_email:String(order.email).trim(),
      line_items:[{price_data:{currency:"usd",unit_amount:Math.round(amount.usd*100),product_data:{name:String(order.product_name||"WORLD TV Product"),description:`WORLD TV product order ${orderNumber}`}},quantity:1}],
      metadata:{purchase_type:"product_order",order_number:orderNumber,payment_reference:paymentRef,pricing_market:amount.market},
      payment_intent_data:{metadata:{purchase_type:"product_order",order_number:orderNumber,payment_reference:paymentRef}}
    });
    if(!session?.id||!session?.url)return res.status(502).json({error:"Stripe checkout URL was not received"});
    db.prepare(`INSERT INTO product_payment_attempts(order_number,provider,provider_reference,amount_ghs,amount_provider,provider_currency,status) VALUES(?,?,?,?,?,'USD','pending')`).run(orderNumber,"stripe",session.id,amount.ghs,amount.usd);
    res.json({ok:true,checkout_url:session.url,session_id:session.id,total_usd:amount.usd,total_ghs:amount.ghs,pricing_market:amount.market});
  }catch(e){console.error("Product Stripe initialize error:",e);res.status(e.status||500).json({error:e.message||"Could not start Stripe payment"});}
}

async function fulfillProductStripeSession(session){
  const orderNumber=String(session.client_reference_id||session.metadata?.order_number||"").trim();
  if(!orderNumber)throw new Error("Stripe product order reference is missing");
  const order=productOrder(orderNumber);if(!order)throw new Error("Product order not found");
  const attempt=db.prepare(`SELECT * FROM product_payment_attempts WHERE order_number=? AND provider='stripe' AND provider_reference=?`).get(orderNumber,session.id);
  if(!attempt)throw new Error("Stripe product payment record not found");
  if(session.payment_status!=="paid"||String(session.currency||"").toLowerCase()!=="usd"||Number(session.amount_total)!==Math.round(Number(attempt.amount_provider)*100))throw new Error("Stripe product payment details do not match this order");
  const tx=db.transaction(()=>{
    const fresh=db.prepare(`SELECT status FROM product_payment_attempts WHERE id=?`).get(attempt.id);
    if(fresh?.status==="paid")return false;
    db.prepare(`UPDATE product_orders SET status='confirmed' WHERE order_number=?`).run(orderNumber);
    db.prepare(`UPDATE product_payment_attempts SET status='paid',updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(attempt.id);
    return true;
  });
  tx();
  return {ok:true,paid:true,order_number:orderNumber,total_usd:Number(attempt.amount_provider),total_ghs:Number(attempt.amount_ghs),provider:"Stripe"};
}

async function confirmProductStripe(req,res){try{if(!stripeConfigured())return res.status(503).json({error:"Stripe is not configured"});const orderNumber=String(req.query.order_number||"").trim(),sessionId=String(req.query.session_id||"").trim();if(!orderNumber||!sessionId)return res.status(400).json({error:"Order number and Stripe session are required"});const session=await stripe().checkout.sessions.retrieve(sessionId);const result=await fulfillProductStripeSession(session);if(result.order_number!==orderNumber)return res.status(400).json({error:"Stripe session does not match this order"});res.json(result);}catch(e){console.error("Product Stripe confirm error:",e);res.status(e.status||500).json({error:e.message||"Could not verify Stripe payment"});}}

async function resellerAmounts(count){const usd=Number((RESELLER_CODE_PRICE_USD*count).toFixed(2));const rate=await usdPerGhs();const ghs=Number((usd/rate).toFixed(2));return {usd,ghs,unitGhs:Number((ghs/count).toFixed(2))};}
function resellerPurchase(reference){return db.prepare(`SELECT * FROM reseller_code_purchases WHERE reference=?`).get(reference);}
function resellerQuota(resellerId){return db.prepare(`SELECT allocated_count,used_count,available_count FROM reseller_code_allocation WHERE reseller_id=?`).get(resellerId)||{allocated_count:0,used_count:0,available_count:0};}

async function createResellerStripe(req,res){
  try{
    if(!stripeConfigured())return res.status(503).json({error:"Stripe is not configured"});
    const count=Math.floor(Number(req.body?.count));if(!Number.isFinite(count)||count<MIN_RESELLER_CODES||count>1000)return res.status(400).json({error:`Minimum purchase is ${MIN_RESELLER_CODES} codes.`});
    const reseller=db.prepare(`SELECT id,name,email FROM resellers WHERE id=? AND status='active'`).get(req.resellerId);if(!reseller)return res.status(401).json({error:"Unauthorized"});
    const amount=await resellerAmounts(count);const reference=`WTV-RCS-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    db.prepare(`INSERT INTO reseller_code_purchases(reseller_id,reference,code_count,unit_price_ghs,amount_ghs,unit_price_usd,amount_usd,status,provider) VALUES(?,?,?,?,?,?,?,'pending','stripe')`).run(req.resellerId,reference,count,amount.unitGhs,amount.ghs,RESELLER_CODE_PRICE_USD,amount.usd);
    const session=await stripe().checkout.sessions.create({
      mode:"payment",
      success_url:`${baseUrl()}/reseller?stripe_code_purchase=success&reference=${encodeURIComponent(reference)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${baseUrl()}/reseller?stripe_code_purchase=cancelled&reference=${encodeURIComponent(reference)}`,
      client_reference_id:reference,
      customer_email:String(reseller.email||"").trim(),
      line_items:[{price_data:{currency:"usd",unit_amount:RESELLER_CODE_PRICE_USD*100,product_data:{name:"WORLD TV Reseller Code Credits",description:`${count} one-year WORLD TV code credits at US$${RESELLER_CODE_PRICE_USD} each`}},quantity:count}],
      metadata:{purchase_type:"reseller_code_credits",reference,reseller_id:String(req.resellerId),code_count:String(count)},
      payment_intent_data:{metadata:{purchase_type:"reseller_code_credits",reference,reseller_id:String(req.resellerId),code_count:String(count)}}
    });
    if(!session?.id||!session?.url)throw new Error("Stripe checkout URL was not received");
    db.prepare(`UPDATE reseller_code_purchases SET provider_reference=? WHERE reference=?`).run(session.id,reference);
    res.json({ok:true,reference,count,amount_usd:amount.usd,checkout_url:session.url,session_id:session.id});
  }catch(e){console.error("Reseller Stripe initialize error:",e);res.status(500).json({error:e.message||"Could not start Stripe payment"});}
}

async function fulfillResellerStripeSession(session){
  const reference=String(session.client_reference_id||session.metadata?.reference||"").trim();if(!reference)throw new Error("Stripe reseller purchase reference is missing");
  const purchase=resellerPurchase(reference);if(!purchase)throw new Error("Reseller code purchase not found");
  if(String(purchase.provider||"")!=="stripe")throw new Error("This reseller purchase was not created for Stripe");
  if(String(purchase.provider_reference||"")!==String(session.id))throw new Error("Stripe session does not match this reseller purchase");
  if(session.payment_status!=="paid"||String(session.currency||"").toLowerCase()!=="usd"||Number(session.amount_total)!==Math.round(Number(purchase.amount_usd)*100))throw new Error("Stripe payment details do not match this reseller purchase");
  const credited=db.transaction(()=>{
    const fresh=db.prepare(`SELECT status FROM reseller_code_purchases WHERE id=?`).get(purchase.id);if(fresh?.status==="paid")return false;
    db.prepare(`UPDATE reseller_code_purchases SET status='paid',provider_reference=?,paid_at=CURRENT_TIMESTAMP WHERE id=?`).run(session.id,purchase.id);
    const existing=db.prepare(`SELECT id FROM reseller_code_allocation WHERE reseller_id=?`).get(purchase.reseller_id);
    if(existing)db.prepare(`UPDATE reseller_code_allocation SET allocated_count=allocated_count+?,available_count=available_count+?,updated_at=CURRENT_TIMESTAMP WHERE reseller_id=?`).run(purchase.code_count,purchase.code_count,purchase.reseller_id);
    else db.prepare(`INSERT INTO reseller_code_allocation(reseller_id,allocated_count,used_count,available_count) VALUES(?,?,0,?)`).run(purchase.reseller_id,purchase.code_count,purchase.code_count);
    return true;
  })();
  return {ok:true,paid:true,credited:credited?Number(purchase.code_count):0,already_credited:!credited,purchase:{...purchase,status:"paid"},quota:resellerQuota(purchase.reseller_id)};
}

async function confirmResellerStripe(req,res){try{if(!stripeConfigured())return res.status(503).json({error:"Stripe is not configured"});const reference=String(req.params.reference||"").trim(),sessionId=String(req.query.session_id||"").trim();const purchase=resellerPurchase(reference);if(!purchase||Number(purchase.reseller_id)!==Number(req.resellerId))return res.status(404).json({error:"Purchase not found"});if(!sessionId)return res.status(400).json({error:"Stripe session is required"});const session=await stripe().checkout.sessions.retrieve(sessionId);const result=await fulfillResellerStripeSession(session);res.json(result);}catch(e){console.error("Reseller Stripe confirm error:",e);res.status(500).json({error:e.message||"Could not verify Stripe payment"});}}

async function commerceWebhook(req,res,next){
  const event=verifyStripeEvent(req);if(!event)return next();
  if(event.type!=="checkout.session.completed"&&event.type!=="checkout.session.async_payment_succeeded")return next();
  const session=event.data?.object||{};const purchaseType=String(session.metadata?.purchase_type||"");
  if(purchaseType!=="product_order"&&purchaseType!=="reseller_code_credits")return next();
  if(session.payment_status!=="paid")return res.json({received:true,pending:true});
  try{if(purchaseType==="product_order")await fulfillProductStripeSession(session);else await fulfillResellerStripeSession(session);return res.json({received:true,fulfilled:true,type:purchaseType});}catch(e){console.error("Stripe commerce webhook fulfillment error:",e);return res.status(500).json({error:"Stripe payment was verified but fulfillment failed"});}
}

function installCommerceRoutes(app){
  if(app.locals.__worldTvStripeCommerceRoutes)return;app.locals.__worldTvStripeCommerceRoutes=true;
  app.post("/api/product-payments/stripe/create-session",createProductStripe);
  app.get("/api/product-payments/stripe/confirm",confirmProductStripe);
  app.post("/api/payment/stripe/webhook",commerceWebhook);
  console.log("WORLD TV Stripe product/reseller commerce enabled");
}

const previousPost=express.application.post;
const previousGet=express.application.get;
express.application.post=function worldTvStripeCommercePost(routePath,...handlers){
  const result=previousPost.call(this,routePath,...handlers);
  if(routePath==="/api/reseller/generate-codes"&&!this.__worldTvStripeResellerRoutes){
    const resellerOnly=handlers[0];
    if(typeof resellerOnly==="function"){
      previousPost.call(this,"/api/reseller/code-purchases/stripe/initialize",resellerOnly,createResellerStripe);
      previousGet.call(this,"/api/reseller/code-purchases/stripe/confirm/:reference",resellerOnly,confirmResellerStripe);
      this.__worldTvStripeResellerRoutes=true;
    }
  }
  return result;
};

const previousListen=express.application.listen;
express.application.listen=function worldTvStripeCommerceListen(...args){
  if(!this.locals?.__worldTvStripeCommerceRoutes){
    const router=this._router;
    if(router&&Array.isArray(router.stack)){
      const before=router.stack.length;installCommerceRoutes(this);const added=router.stack.splice(before);const insertAt=Math.max(0,router.stack.length-2);router.stack.splice(insertAt,0,...added);
    }else installCommerceRoutes(this);
  }
  return previousListen.apply(this,args);
};
