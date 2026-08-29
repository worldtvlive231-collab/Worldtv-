"use strict";
const express=require("express");
const previousStatic=express.static;
const STYLE='<link rel="stylesheet" href="/assets/hero-entertainment.css?v=20260829-1">';
const ART='<div class="hero-entertainment-glow" aria-hidden="true"></div><img class="hero-entertainment-art" src="/assets/worldtv-entertainment-hero.svg?v=20260829-1" alt="" aria-hidden="true">';
express.static=function worldTvHeroStatic(root,...args){
  const middleware=previousStatic(root,...args);
  return function(req,res,next){
    const p=String(req.path||"").toLowerCase();
    const target=p==='/'||p==='/index.html';
    if(!target)return middleware(req,res,next);
    const originalSend=res.send;
    res.send=function worldTvHeroInjectedSend(body){
      res.send=originalSend;
      let output=body;
      try{
        if(typeof output==='string'){
          if(!output.includes('/assets/hero-entertainment.css')) output=output.replace('</head>',`${STYLE}\n</head>`);
          if(!output.includes('hero-entertainment-art')) output=output.replace('<section class="hero">',`<section class="hero">${ART}`);
        }
        res.setHeader('Cache-Control','no-cache, no-store, must-revalidate');
      }catch(_){ }
      return originalSend.call(res,output);
    };
    return middleware(req,res,(err)=>{res.send=originalSend;next(err);});
  };
};
console.log('WORLD TV dynamic football, movies and kids homepage hero enabled');