"use strict";

const fs=require("fs");
const path=require("path");
const express=require("express");

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

const GUEST_SCRIPT="/assets/paypal-guest-checkout.js?v=20260824-1";
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
    res.setHeader("Cache-Control","no-cache");
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

console.log("WORLD TV PayPal guest debit/credit card checkout enabled");
