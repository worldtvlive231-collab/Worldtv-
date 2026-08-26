"use strict";

require("dotenv").config();
const crypto=require("crypto");
const path=require("path");
const express=require("express");
const Database=require("better-sqlite3");
const Stripe=require("stripe");

// Preserve the exact request bytes so Stripe webhook signatures can be verified.
const previousJson=express.json;
express.json=function worldTvStripeJson(options={}){
  const originalVerify=options.verify;
  return previousJson({
    ...options,
    verify(req,res,buf,encoding){
      req.rawBody=Buffer.from(buf);
      if(typeof originalVerify==="function") originalVerify(req,res,buf,encoding);
    }
  });
};

const db=new Database(path.join(process.cwd(),"data","worldtv.sqlite"));
db.pragma("journal_mode=WAL");
db.pragma("busy_timeout=5000");
db.exec(`
CREATE TABLE IF NOT EXISTS stripe_payments(
  reference TEXT PRIMARY KEY,
  stripe_session_id TEXT NOT NULL UNIQUE,
  amount_usd REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS activation_email_log(
  reference TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stripe_payments_session ON stripe_payments(stripe_session_id);
`);

function stripeSecret(){return String(process.env.STRIPE_SECRET_KEY||"").trim();}
function stripeWebhookSecret(){return String(process.env.STRIPE_WEBHOOK_SECRET||"").trim();}
function stripeConfigured(){return /^(sk|rk)_(test|live)_/.test(stripeSecret());}
function stripeMode(){return /^(sk|rk)_live_/.test(stripeSecret())?"live":"test";}
function baseUrl(){return String(process.env.PUBLIC_BASE_URL||"https://myworldtvlive.com").replace(/\/$/,"");}

let stripeClient;
let stripeClientKey="";
function getStripeClient(){
  const secret=stripeSecret();
  if(!secret) throw new Error("Stripe is not configured");
  if(!stripeClient||stripeClientKey!==secret){
    stripeClient=new Stripe(secret,{apiVersion:"2026-07-29.dahlia"});
    stripeClientKey=secret;
  }
  return stripeClient;
}

function checkoutByReference(reference){
  return db.prepare(`
    SELECT c.*,p.name AS plan_name,p.duration_days,u.email,u.name AS customer_name
    FROM checkout_requests c
    JOIN plans p ON p.id=c.plan_id
    JOIN users u ON u.id=c.user_id
    WHERE c.reference=?
  `).get(reference);
}

function fulfilledByReference(reference){
  return db.prepare(`
    SELECT o.reference,sc.code,sc.expires_at
    FROM orders o
    LEFT JOIN subscription_codes sc ON sc.id=o.code_id
    WHERE o.reference=? AND o.status='paid'
  `).get(reference);
}

async function sendActivationEmail(reference){
  if(!reference)return;
  if(db.prepare("SELECT reference FROM activation_email_log WHERE reference=?").get(reference))return;
  const row=db.prepare(`
    SELECT u.name,u.email,sc.code,sc.expires_at
    FROM orders o
    JOIN users u ON u.id=o.user_id
    LEFT JOIN subscription_codes sc ON sc.id=o.code_id
    WHERE o.reference=? AND o.status='paid'
  `).get(reference);
  if(!row?.email||!row?.code)return;
  const apiKey=String(process.env.RESEND_API_KEY||"").trim();
  const from=String(process.env.EMAIL_FROM||"WORLD TV <support@myworldtvlive.com>").trim();
  if(!apiKey){console.warn("Stripe activation email skipped: RESEND_API_KEY missing");return;}
  const safe=v=>String(v||"").replace(/[<>&]/g,"");
  const expiry=row.expires_at?new Date(row.expires_at).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric",timeZone:"UTC"}):"";
  const response=await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      from,to:[row.email],subject:"Your WORLD TV subscription code",
      html:`<!doctype html><html><body style="margin:0;background:#fffaf0;font-family:Arial,sans-serif;color:#241b0c"><div style="max-width:620px;margin:0 auto;padding:28px"><div style="background:#fff;border:1px solid #ead9aa;border-radius:18px;padding:28px;text-align:center"><img src="https://myworldtvlive.com/world-tv-logo.png" alt="WORLD TV" style="max-width:150px;height:auto"><h1 style="font-size:25px;margin:18px 0 8px">Payment successful ✅</h1><p>Hi ${safe(row.name||"Customer")}, your WORLD TV subscription is active.</p><div style="margin:22px auto;padding:18px;background:#fff5cf;border:1px solid #e7c766;border-radius:12px"><div style="font-size:13px;color:#73633a">YOUR SUBSCRIPTION CODE</div><div style="font-size:28px;font-weight:800;letter-spacing:2px;margin-top:7px">${safe(row.code)}</div>${expiry?`<div style="margin-top:8px;color:#73633a">Valid until ${expiry}</div>`:""}</div><p>Your code is also saved in your WORLD TV account.</p><p style="margin:22px 0"><a href="https://myworldtvlive.com/account.html" style="display:inline-block;background:#e3a400;color:#17120a;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:700">Open My Account</a></p><p style="font-size:13px;color:#756b58">Thank you for choosing WORLD TV.</p></div></div></body></html>`,
      text:`Hi ${safe(row.name||"Customer")}, your WORLD TV subscription is active. Your subscription code is ${safe(row.code)}${expiry?`. Valid until ${expiry}`:""}. Open your account: https://myworldtvlive.com/account.html`
    })
  });
  if(!response.ok){console.error("Stripe activation email failed:",await response.text().catch(()=>""));return;}
  try{db.prepare("INSERT INTO activation_email_log(reference) VALUES(?)").run(reference);}catch(_){ }
}

async function retrieveStripeSession(sessionId){
  return getStripeClient().checkout.sessions.retrieve(sessionId);
}

async function fulfillStripeCheckout(reference,session){
  const existing=fulfilledByReference(reference);
  if(existing){
    await sendActivationEmail(reference).catch(()=>{});
    return {ok:true,paid:true,fulfilled:true,already_processed:true,code:existing.code||null,expires_at:existing.expires_at||null};
  }
  const checkout=checkoutByReference(reference);
  if(!checkout) throw new Error("Checkout not found");
  const paymentRow=db.prepare("SELECT * FROM stripe_payments WHERE reference=?").get(reference);
  if(!paymentRow) throw new Error("Stripe payment record not found");
  if(paymentRow.stripe_session_id!==session.id) throw new Error("Stripe session does not match this checkout");
  const expectedUsdCents=Math.round(Number(checkout.final_amount_usd)*100);
  const paidReference=String(session.client_reference_id||session.metadata?.reference||"");
  if(session.payment_status!=="paid"||paidReference!==reference||String(session.currency||"").toLowerCase()!=="usd"||Number(session.amount_total)!==expectedUsdCents){
    throw new Error("Stripe payment details do not match this subscription");
  }

  const code=db.prepare(`SELECT id,code FROM subscription_codes WHERE plan_id=? AND status='unused' ORDER BY id ASC LIMIT 1`).get(checkout.plan_id);
  if(!code){
    db.prepare("UPDATE checkout_requests SET status='payment_confirmed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='fulfilled'").run(checkout.id);
    db.prepare("UPDATE stripe_payments SET payment_intent_id=?,status='paid_pending_code',updated_at=CURRENT_TIMESTAMP WHERE reference=?").run(String(session.payment_intent||"")||null,reference);
    try{db.prepare("INSERT INTO notifications(user_id,title,message) VALUES(?,?,?)").run(checkout.user_id,"Payment Received","Your Stripe payment was received successfully. Subscription activation is pending because no unused code is currently available.");}catch(_){ }
    return {ok:true,paid:true,fulfilled:false,message:"Payment received successfully. Subscription activation is pending because no unused subscription code is available."};
  }

  let start=new Date();
  const current=db.prepare(`SELECT MAX(sc.expires_at) AS expiry FROM orders o JOIN subscription_codes sc ON sc.id=o.code_id WHERE o.user_id=? AND o.status='paid'`).get(checkout.user_id);
  if(current?.expiry&&new Date(current.expiry)>start)start=new Date(current.expiry);
  const expiry=new Date(start);expiry.setUTCDate(expiry.getUTCDate()+Number(checkout.duration_days));
  const expiresAt=expiry.toISOString();
  const paidAt=new Date().toISOString();
  const expectedAmountPesewas=Math.round(Number(checkout.final_amount_ghs)*100);

  const tx=db.transaction(()=>{
    const already=db.prepare("SELECT id FROM orders WHERE reference=?").get(reference);
    if(already)return {already:true};
    const assigned=db.prepare("UPDATE subscription_codes SET status='used',user_id=?,expires_at=? WHERE id=? AND status='unused'").run(checkout.user_id,expiresAt,code.id);
    if(assigned.changes!==1)throw new Error("Subscription code assignment conflict");
    db.prepare(`INSERT INTO orders(reference,user_id,plan_id,amount_pesewas,currency,status,code_id,paid_at) VALUES(?,?,?,?,?,'paid',?,?)`).run(reference,checkout.user_id,checkout.plan_id,expectedAmountPesewas,"GHS",code.id,paidAt);
    db.prepare("UPDATE checkout_requests SET status='fulfilled',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(checkout.id);
    db.prepare("UPDATE stripe_payments SET payment_intent_id=?,status='fulfilled',updated_at=CURRENT_TIMESTAMP WHERE reference=?").run(String(session.payment_intent||"")||null,reference);
    if(checkout.coupon_code)db.prepare("UPDATE coupons SET used_count=used_count+1 WHERE code=?").run(checkout.coupon_code);
    try{db.prepare("INSERT INTO notifications(user_id,title,message) VALUES(?,?,?)").run(checkout.user_id,"Subscription Activated",`Your WORLD TV subscription has been activated automatically. Your code is ${code.code}.`);}catch(_){ }
    return {already:false};
  });

  let result;
  try{result=tx();}catch(error){
    const raced=fulfilledByReference(reference);
    if(raced)return {ok:true,paid:true,fulfilled:true,already_processed:true,code:raced.code||null,expires_at:raced.expires_at||null};
    throw error;
  }
  if(result?.already){const row=fulfilledByReference(reference);return {ok:true,paid:true,fulfilled:true,already_processed:true,code:row?.code||null,expires_at:row?.expires_at||null};}
  await sendActivationEmail(reference).catch(error=>console.error("Stripe activation email error:",error));
  console.log("Stripe fulfilled WORLD TV subscription",{reference,user_id:checkout.user_id,code_id:code.id});
  return {ok:true,paid:true,fulfilled:true,message:"Stripe payment verified and subscription activated",code:code.code,expires_at:expiresAt};
}

function stripeCustomer(req){
  const token=String(req.headers["x-customer-token"]||"").trim();
  if(!token)return null;
  const tokenHash=crypto.createHash("sha256").update(token).digest("hex");
  return db.prepare(`
    SELECT s.user_id AS userId
    FROM customer_sessions s
    WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP
  `).get(tokenHash)||null;
}
function verifyStripeSignature(req){
  const secret=stripeWebhookSecret();
  const header=String(req.headers["stripe-signature"]||"");
  if(!secret||!header||!req.rawBody)return null;
  try{return getStripeClient().webhooks.constructEvent(req.rawBody,header,secret);}catch(_){return null;}
}

async function createStripeSession(req,res){
  try{
    if(!stripeConfigured())return res.status(503).json({error:"Stripe is not configured"});
    const reference=String(req.body?.reference||"").trim();
    if(!reference)return res.status(400).json({error:"Payment reference required"});
    const customer=stripeCustomer(req);
    if(!customer)return res.status(401).json({error:"Please sign in again to continue payment"});
    const checkout=checkoutByReference(reference);
    if(!checkout)return res.status(404).json({error:"Checkout not found"});
    if(Number(checkout.user_id)!==Number(customer.userId))return res.status(403).json({error:"This checkout belongs to another account"});
    const existing=fulfilledByReference(reference);
    if(existing)return res.json({ok:true,paid:true,fulfilled:true,already_processed:true,code:existing.code||null,expires_at:existing.expires_at||null});
    if(checkout.status==="cancelled")return res.status(409).json({error:"This checkout request was cancelled"});
    const amountUsd=Number(checkout.final_amount_usd);
    if(!Number.isFinite(amountUsd)||amountUsd<=0)return res.status(500).json({error:"Subscription USD amount is not configured"});
    const amountCents=Math.round(amountUsd*100);
    const successUrl=`${baseUrl()}/subscribe.html?stripe=success&session_id={CHECKOUT_SESSION_ID}&reference=${encodeURIComponent(reference)}`;
    const cancelUrl=`${baseUrl()}/subscribe.html?stripe=cancelled&reference=${encodeURIComponent(reference)}`;
    const session=await getStripeClient().checkout.sessions.create({
      mode:"payment",
      success_url:successUrl,
      cancel_url:cancelUrl,
      client_reference_id:reference,
      customer_email:String(checkout.email||""),
      line_items:[{
        price_data:{
          currency:"usd",
          unit_amount:amountCents,
          product_data:{name:`WORLD TV ${checkout.plan_name} Subscription`,description:"WORLD TV subscription access"}
        },
        quantity:1
      }],
      metadata:{reference},
      payment_intent_data:{metadata:{reference}},
      integration_identifier:"worldtv_checkout_qmzptbka"
    });
    if(!session?.id||!session?.url)return res.status(502).json({error:"Stripe checkout URL was not received"});
    db.prepare(`INSERT INTO stripe_payments(reference,stripe_session_id,amount_usd,currency,payment_intent_id,status,updated_at) VALUES(?,?,?,'USD',NULL,'created',CURRENT_TIMESTAMP) ON CONFLICT(reference) DO UPDATE SET stripe_session_id=excluded.stripe_session_id,amount_usd=excluded.amount_usd,currency='USD',payment_intent_id=NULL,status='created',updated_at=CURRENT_TIMESTAMP`).run(reference,session.id,amountUsd);
    return res.json({ok:true,reference,session_id:session.id,checkout_url:session.url,amount_usd:amountUsd.toFixed(2),mode:stripeMode()});
  }catch(error){console.error("Stripe create-session error:",error);return res.status(500).json({error:error.message||"Could not start Stripe payment"});}
}

async function confirmStripePayment(req,res){
  try{
    if(!stripeConfigured())return res.status(503).json({error:"Stripe is not configured"});
    const reference=String(req.body?.reference||"").trim();
    const sessionId=String(req.body?.session_id||req.body?.sessionId||"").trim();
    if(!reference||!sessionId)return res.status(400).json({error:"Stripe session ID and reference are required"});
    const customer=stripeCustomer(req);
    if(!customer)return res.status(401).json({error:"Please sign in again to confirm payment"});
    const checkout=checkoutByReference(reference);
    if(!checkout)return res.status(404).json({error:"Checkout not found"});
    if(Number(checkout.user_id)!==Number(customer.userId))return res.status(403).json({error:"This checkout belongs to another account"});
    const session=await retrieveStripeSession(sessionId);
    const result=await fulfillStripeCheckout(reference,session);
    return res.json(result);
  }catch(error){console.error("Stripe confirm error:",error);return res.status(500).json({error:error.message||"Could not verify Stripe payment"});}
}

async function stripeWebhook(req,res){
  const event=verifyStripeSignature(req);
  if(!event)return res.status(401).send("Invalid signature");
  if(!["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(String(event.type||"")))return res.sendStatus(200);
  const sessionId=String(event.data?.object?.id||"").trim();
  if(!sessionId)return res.sendStatus(200);
  try{
    const session=await retrieveStripeSession(sessionId);
    if(session.payment_status!=="paid")return res.sendStatus(200);
    const reference=String(session.client_reference_id||session.metadata?.reference||"").trim();
    if(!reference)return res.sendStatus(200);
    const result=await fulfillStripeCheckout(reference,session);
    console.log("Stripe webhook processed",{reference,result});
    return res.sendStatus(200);
  }catch(error){console.error("Stripe webhook processing failed:",error);return res.status(500).send("Webhook processing failed");}
}

function installRoutes(app){
  if(app.locals.__worldTvStripeRoutesInstalled)return;
  app.locals.__worldTvStripeRoutesInstalled=true;
  app.get("/api/payment/stripe/config",(req,res)=>{res.setHeader("Cache-Control","no-store");res.json({ok:true,configured:stripeConfigured(),webhook_configured:Boolean(stripeWebhookSecret()),mode:stripeMode(),currency:"USD"});});
  app.get("/api/payment/stripe/webhook",(req,res)=>res.json({ok:true,endpoint:"Stripe webhook",method:"POST",configured:stripeConfigured(),webhook_configured:Boolean(stripeWebhookSecret())}));
  app.post("/api/payment/stripe/create-session",createStripeSession);
  app.post("/api/payment/stripe/confirm",confirmStripePayment);
  app.post("/api/payment/stripe/webhook",stripeWebhook);
  console.log("WORLD TV Stripe checkout enabled");
}

const originalListen=express.application.listen;
express.application.listen=function worldTvStripeListen(...args){
  if(!this.locals.__worldTvStripeRoutesInstalled){
    const router=this._router;
    const before=router&&Array.isArray(router.stack)?router.stack.length:0;
    installRoutes(this);
    if(router&&Array.isArray(router.stack)){
      const added=router.stack.splice(before);
      const insertAt=Math.max(0,router.stack.length-2);
      router.stack.splice(insertAt,0,...added);
    }
  }
  return originalListen.apply(this,args);
};
