"use strict";

const express=require("express");
const SCRIPT='<script src="/assets/disable-paypal-ui.js?v=20260830-whatsapp-lightweight-v4"></script>';
const previousStatic=express.static;

express.static=function worldTvPaymentPauseStatic(root,...args){
  const middleware=previousStatic(root,...args);
  return function(req,res,next){
    const p=String(req.path||"").toLowerCase();
    const target=p==='/'||p==='/index.html'||p==='/order.html'||p==='/checkout.html'||p==='/payment.html'||p==='/reseller'||p==='/reseller.html';
    if(!target)return middleware(req,res,next);
    const originalSend=res.send;
    res.send=function worldTvPaymentPauseInjectedSend(body){
      res.send=originalSend;
      let output=body;
      try{
        if(typeof output==='string'&&!output.includes('/assets/disable-paypal-ui.js')){
          output=output.includes('</head>')?output.replace('</head>',`${SCRIPT}\n</head>`):output+SCRIPT;
        }
        res.setHeader('Cache-Control','no-cache, no-store, must-revalidate');
        res.setHeader('Pragma','no-cache');
        res.setHeader('Expires','0');
      }catch(_){ }
      return originalSend.call(res,output);
    };
    return middleware(req,res,(err)=>{res.send=originalSend;next(err);});
  };
};

console.log('WORLD TV payment pause helper enabled only on remaining customer payment entry pages');
