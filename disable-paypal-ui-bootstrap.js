"use strict";

const express=require("express");
const SCRIPT='<script src="/assets/disable-paypal-ui.js?v=20260826-1"></script>';
const previousStatic=express.static;

express.static=function worldTvDisablePaypalStatic(root,...args){
  const middleware=previousStatic(root,...args);
  return function(req,res,next){
    const p=String(req.path||"").toLowerCase();
    const target=p==='/'||p.endsWith('.html')||p==='/reseller'||p==='/admin';
    if(!target)return middleware(req,res,next);
    const originalSend=res.send;
    res.send=function worldTvDisablePaypalInjectedSend(body){
      res.send=originalSend;
      let output=body;
      try{
        if(typeof output==='string'&&!output.includes('/assets/disable-paypal-ui.js')){
          output=output.includes('</body>')?output.replace('</body>',`${SCRIPT}\n</body>`):output+SCRIPT;
        }
        res.setHeader('Cache-Control','no-cache, no-store, must-revalidate');
      }catch(_){ }
      return originalSend.call(res,output);
    };
    return middleware(req,res,(err)=>{res.send=originalSend;next(err);});
  };
};

console.log('WORLD TV PayPal payment UI disabled');
