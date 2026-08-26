"use strict";

const express=require("express");
const fs=require("fs");
const path=require("path");
const STRIPE_SCRIPT='<script src="/assets/stripe-mobile-redirect.js?v=20260826-1"></script><script src="/assets/stripe-checkout.js?v=20260826-6"></script>';
const previousStatic=express.static;

function injectStripeScripts(html){
  let output=String(html||"");
  const stripeTag=/<script\s+src=["']\/assets\/stripe-checkout\.js(?:\?[^"']*)?["']><\/script>/i;
  if(stripeTag.test(output)) output=output.replace(stripeTag,STRIPE_SCRIPT);
  else output=output.includes("</body>")?output.replace("</body>",`${STRIPE_SCRIPT}\n</body>`):output+STRIPE_SCRIPT;
  return output;
}

express.static=function worldTvStripeUiStatic(root,...args){
  const middleware=previousStatic(root,...args);
  return function(req,res,next){
    if(String(req.path||"").toLowerCase()!=="/subscribe.html")return middleware(req,res,next);

    const filePath=path.join(root,"subscribe.html");
    fs.readFile(filePath,"utf8",(err,html)=>{
      if(err)return middleware(req,res,next);
      try{
        res.setHeader("Cache-Control","no-cache, no-store, must-revalidate");
        res.type("html").send(injectStripeScripts(html));
      }catch(_){
        return middleware(req,res,next);
      }
    });
  };
};

console.log("WORLD TV Stripe subscription UI injection enabled");
