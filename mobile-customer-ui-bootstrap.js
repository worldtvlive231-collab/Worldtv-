'use strict';

const express=require('express');
const STYLE='<link rel="stylesheet" href="/assets/mobile-customer.css?v=20260828-1">';
const previousStatic=express.static;
const targets=new Set(['/','/index.html','/subscribe.html','/download.html','/login.html','/register.html','/account.html','/products.html']);

express.static=function worldTvMobileCustomerStatic(root,...args){
  const middleware=previousStatic(root,...args);
  return function(req,res,next){
    const p=String(req.path||'/').toLowerCase();
    if(!targets.has(p)) return middleware(req,res,next);
    const originalSend=res.send;
    res.send=function worldTvMobileCustomerSend(body){
      res.send=originalSend;
      let output=body;
      try{
        if(typeof output==='string'&&!output.includes('/assets/mobile-customer.css')){
          output=output.includes('</head>')?output.replace('</head>',`${STYLE}\n</head>`):output+STYLE;
        }
        if((p==='/account.html')&&typeof output==='string'){
          output=output.replace('<div style="overflow:auto"><table>','<div class="account-mobile-history" style="overflow:auto"><table>');
        }
        res.setHeader('Cache-Control','no-cache, no-store, must-revalidate');
      }catch(_){ }
      return originalSend.call(res,output);
    };
    return middleware(req,res,(err)=>{res.send=originalSend;next(err);});
  };
};

console.log('WORLD TV phone-first customer UI enabled');
