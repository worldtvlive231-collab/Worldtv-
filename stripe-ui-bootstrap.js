"use strict";

const express=require("express");
const STRIPE_SCRIPT='<script src="/assets/stripe-checkout.js?v=20260826-2"></script>';
const previousStatic=express.static;

express.static=function worldTvStripeUiStatic(root,...args){
  const middleware=previousStatic(root,...args);
  return function(req,res,next){
    if(String(req.path||"").toLowerCase()!=="/subscribe.html")return middleware(req,res,next);
    const originalSend=res.send;
    res.send=function worldTvStripeInjectedSend(body){
      res.send=originalSend;
      let output=body;
      try{
        if(typeof output==="string"&&!output.includes("/assets/stripe-checkout.js")){
          output=output.includes("</body>")?output.replace("</body>",`${STRIPE_SCRIPT}\n</body>`):output+STRIPE_SCRIPT;
        }
        res.setHeader("Cache-Control","no-cache, no-store, must-revalidate");
      }catch(_){ }
      return originalSend.call(res,output);
    };
    return middleware(req,res,(err)=>{res.send=originalSend;next(err);});
  };
};

console.log("WORLD TV Stripe subscription UI injection enabled");
