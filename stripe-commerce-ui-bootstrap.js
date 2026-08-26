"use strict";
const express=require("express");
const fs=require("fs");
const path=require("path");
const SCRIPT='<script src="/assets/stripe-commerce.js?v=20260826-1"></script>';
function inject(html){if(typeof html!=="string"||html.includes('/assets/stripe-commerce.js'))return html;return html.includes('</body>')?html.replace('</body>',`${SCRIPT}\n</body>`):html+SCRIPT;}

const previousStatic=express.static;
express.static=function worldTvStripeCommerceStatic(root,...args){
  const middleware=previousStatic(root,...args);
  return function(req,res,next){
    const p=String(req.path||"").toLowerCase();
    if(p!=="/order.html")return middleware(req,res,next);
    const file=path.join(root,"order.html");
    fs.readFile(file,"utf8",(err,html)=>{
      if(err)return middleware(req,res,next);
      res.setHeader("Content-Type","text/html; charset=utf-8");
      res.setHeader("Cache-Control","no-cache, no-store, must-revalidate");
      res.send(inject(html));
    });
  };
};

const previousSendFile=express.response.sendFile;
express.response.sendFile=function worldTvStripeCommerceSendFile(filePath,...args){
  const normalized=String(filePath||"").replace(/\\/g,"/").toLowerCase();
  if(!normalized.endsWith("/reseller.html"))return previousSendFile.call(this,filePath,...args);
  const res=this;
  fs.readFile(filePath,"utf8",(err,html)=>{
    if(err)return previousSendFile.call(res,filePath,...args);
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.setHeader("Cache-Control","no-cache, no-store, must-revalidate");
    res.send(inject(html));
  });
  return this;
};
console.log("WORLD TV Stripe product/reseller UI injection enabled");
