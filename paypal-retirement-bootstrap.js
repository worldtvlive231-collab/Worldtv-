"use strict";

const express=require("express");

function isPaypalRoute(route){
  return typeof route==="string" && route.toLowerCase().includes("/paypal");
}

function retiredHandler(req,res){
  res.setHeader("Cache-Control","no-store");
  return res.status(410).json({
    error:"PayPal payments are no longer supported. Please use Stripe or Paystack."
  });
}

const originalPost=express.application.post;
express.application.post=function worldTvRetirePaypalPost(route,...handlers){
  if(isPaypalRoute(route)) return originalPost.call(this,route,retiredHandler);
  return originalPost.call(this,route,...handlers);
};

const originalGet=express.application.get;
express.application.get=function worldTvRetirePaypalGet(route,...handlers){
  if(isPaypalRoute(route)) return originalGet.call(this,route,retiredHandler);
  return originalGet.call(this,route,...handlers);
};

console.log("WORLD TV legacy PayPal payment endpoints retired");
