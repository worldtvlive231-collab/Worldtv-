"use strict";

const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const express=require("express");
const Database=require("better-sqlite3");
const {getExchangeRates}=require("./exchange-rates");

const db=new Database(path.join(process.cwd(),"data","worldtv.sqlite"));
db.pragma("journal_mode=WAL");
const SUBSCRIPTION_PROMO_USD=23;

// Make all PayPal approval pages guest-checkout friendly. PayPal still decides
// whether guest card checkout is available for the buyer's country/account.
if(typeof global.fetch==="function" && !global.__worldTvPayPalGuestFetchPatched){
  global.__worldTvPayPalGuestFetchPatched=true;
  const originalFetch=global.fetch.bind(global);
  global.fetch=async function worldTvPayPalGuestFetch(input,options={}){
    try{
      const url=typeof input==="string"?input:String(input&&input.url||"");
      const method=String(options&&options.method||"GET").toUpperCase();
      if(method==="POST" && /^https:\/\/api-m(?:\.sandbox)?\.paypal\.com\/v2\/checkout\/orders(?:\?.*)?$/.test(url) && typeof options.body==="string"){
        const body=JSON.parse(options.body);
        const context=body&&body.payment_source&&body.payment_source.paypal&&body.payment_source.paypal.experience_context;
        if(context){
          context.landing_page="GUEST_CHECKOUT";
          options={...options,body:JSON.stringify(body)};
        }
      }
    }catch(error){
      console.warn("WORLD TV PayPal guest-checkout preference could not be applied:",error&&error.message||error);
    }
    return originalFetch(input,options);
  };
}

const GUEST_SCRIPT="/assets/paypal-guest-checkout.js?v=20260824-2";
const RESELLER_SCRIPT="/assets/reseller-panel-enhancements.js?v=20260824-4";

function injectScripts(html,scripts){
  let out=String(html||"");
  for(const src of scripts){
    const plain=src.split("?")[0];
    if(out.includes(plain)) continue;
    const tag=`<script src="${src}"></script>`;
    out=out.includes("</body>")?out.replace("</body>",tag+"\n</body>"):out+tag;
  }
  return out;
}

function serveInjected(filePath,scripts,res,next){
  fs.readFile(filePath,"utf8",(err,html)=>{
    if(err){
      if(typeof next==="function") return next();
      return res.status(500).send("Page unavailable");
    }
    res.setHeader("Cache-Control","no-cache, no-store, must-revalidate");
    res.type("html").send(injectScripts(html,scripts));
  });
}

// Add the guest-card button script to every checkout page without disturbing
// the existing checkout code. The reseller page also keeps its enhancement script.
const previousStatic=express.static;
express.static=function worldTvGuestStatic(root,...args){
  const middleware=previousStatic(root,...args);
  return function(req,res,next){
    const p=String(req.path||"").toLowerCase();
    if(p==="/subscribe.html") return serveInjected(path.join(root,"subscribe.html"),[GUEST_SCRIPT],res,next);
    if(p==="/order.html") return serveInjected(path.join(root,"order.html"),[GUEST_SCRIPT],res,next);
    if(p==="/reseller.html") return serveInjected(path.join(root,"reseller.html"),[RESELLER_SCRIPT,GUEST_SCRIPT],res,next);
    return middleware(req,res,next);
  };
};

// The site also exposes /reseller without the .html extension. Intercept that
// registration so the same guest-card UI is present there too.
const previousGet=express.application.get;
express.application.get=function worldTvGuestGet(routePath,...handlers){
  if(typeof routePath==="string" && routePath.toLowerCase()==="/reseller"){
    return this.route(routePath).get((req,res,next)=>serveInjected(path.join(process.cwd(),"reseller.html"),[RESELLER_SCRIPT,GUEST_SCRIPT],res,next));
  }
  return previousGet.call(this,routePath,...handlers);
};

async function createGuestCheckout(req,res){
  try{
    const name=String(req.body?.name||"").trim();
    const email=String(req.body?.email||"").trim().toLowerCase();
    const planId=Number(req.body?.planId||1);
    const couponCode=String(req.body?.coupon_code||"").trim().toUpperCase();
    if(!name) return res.status(400).json({error:"Your name is required for guest checkout."});
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"Enter a valid email address so we can issue your subscription code."});

    const ratesResult=await getExchangeRates();
    const usdPerGhs=Number(ratesResult?.rates?.USD||ratesResult?.data?.rates?.USD);
    if(!Number.isFinite(usdPerGhs)||usdPerGhs<=0) return res.status(503).json({error:"Exchange rate is temporarily unavailable. Please try again."});

    const plan=db.prepare("SELECT * FROM plans WHERE id=? AND active=1").get(planId);
    if(!plan) return res.status(400).json({error:"Invalid subscription plan"});

    const ghsPerUsd=1/usdPerGhs;
    const originalUsd=Number(plan.price_usd||SUBSCRIPTION_PROMO_USD);
    if(!Number.isFinite(originalUsd)||originalUsd<=0) return res.status(500).json({error:"Subscription price is not configured"});

    let discountUsd=0,coupon=null;
    if(couponCode){
      coupon=db.prepare("SELECT * FROM coupons WHERE code=? AND active=1").get(couponCode);
      if(!coupon) return res.status(404).json({error:"Invalid coupon code"});
      if(!["subscription","all"].includes(coupon.applies_to)) return res.status(400).json({error:"Coupon does not apply to subscriptions"});
      if(coupon.expires_at && new Date(coupon.expires_at)<=new Date()) return res.status(400).json({error:"Coupon has expired"});
      if(coupon.max_uses!=null && coupon.used_count>=coupon.max_uses) return res.status(400).json({error:"Coupon usage limit reached"});
      discountUsd=coupon.discount_type==="percent"?originalUsd*(Number(coupon.discount_value)/100):Number(coupon.discount_value)*usdPerGhs;
      discountUsd=Math.max(0,Math.min(originalUsd,discountUsd));
    }

    const finalUsd=Number((originalUsd-discountUsd).toFixed(2));
    const originalGhs=Number((originalUsd*ghsPerUsd).toFixed(2));
    const discountGhs=Number((discountUsd*ghsPerUsd).toFixed(2));
    const finalGhs=Number((finalUsd*ghsPerUsd).toFixed(2));
    const reference="WTV-GUEST-"+Date.now()+"-"+crypto.randomBytes(3).toString("hex").toUpperCase();

    let user=db.prepare("SELECT id,name,email FROM users WHERE email=?").get(email);
    if(!user){
      const inserted=db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,NULL)").run(name,email);
      user={id:Number(inserted.lastInsertRowid),name,email};
    }else if(!String(user.name||"").trim() && name){
      db.prepare("UPDATE users SET name=? WHERE id=?").run(name,user.id);
    }

    db.prepare(`INSERT INTO checkout_requests(
      reference,user_id,plan_id,coupon_code,
      original_amount_usd,discount_usd,final_amount_usd,fx_ghs_per_usd,
      original_amount_ghs,discount_ghs,final_amount_ghs
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      reference,user.id,plan.id,couponCode||null,
      originalUsd,Number(discountUsd.toFixed(2)),finalUsd,Number(ghsPerUsd.toFixed(6)),
      originalGhs,discountGhs,finalGhs
    );

    res.json({ok:true,reference,plan:plan.name,final_amount_usd:finalUsd,email,guest:true});
  }catch(error){
    console.error("Guest subscription checkout error:",error);
    res.status(500).json({error:"Could not start guest checkout. Please try again."});
  }
}

const previousListen=express.application.listen;
express.application.listen=function worldTvGuestListen(...args){
  if(!this.__worldTvGuestSubscriptionRouteInstalled){
    this.__worldTvGuestSubscriptionRouteInstalled=true;
    const router=this._router;
    const before=router&&Array.isArray(router.stack)?router.stack.length:0;
    this.post("/api/guest/checkout-request",createGuestCheckout);
    if(router&&Array.isArray(router.stack)){
      const added=router.stack.splice(before);
      const insertAt=Math.max(0,router.stack.length-2);
      router.stack.splice(insertAt,0,...added);
    }
  }
  return previousListen.apply(this,args);
};

console.log("WORLD TV PayPal guest debit/credit card checkout enabled");
