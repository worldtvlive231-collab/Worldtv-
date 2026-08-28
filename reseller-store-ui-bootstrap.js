"use strict";

const express=require("express");
const SCRIPT='<script defer src="/assets/reseller-store-fix.js?v=20260828-1"></script>';
const previousStatic=express.static;

express.static=function worldTvResellerStoreStatic(root,...args){
  const middleware=previousStatic(root,...args);
  return function(req,res,next){
    const p=String(req.path||"").toLowerCase();
    const target=p==='/reseller'||p==='/reseller.html';
    if(!target)return middleware(req,res,next);
    const originalSend=res.send;
    res.send=function worldTvResellerStoreInjectedSend(body){
      res.send=originalSend;
      let output=body;
      try{
        if(typeof output==='string'&&!output.includes('/assets/reseller-store-fix.js')){
          output=output.includes('</head>')?output.replace('</head>',`${SCRIPT}\n</head>`):output+SCRIPT;
        }
        res.setHeader('Cache-Control','no-cache, no-store, must-revalidate');
      }catch(_){ }
      return originalSend.call(res,output);
    };
    return middleware(req,res,(err)=>{res.send=originalSend;next(err);});
  };
};

console.log('WORLD TV reseller store USD pricing UI enabled');
