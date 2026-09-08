'use strict';

const express=require('express');
const STYLE='<link rel="stylesheet" href="/assets/mobile-customer.css?v=20260828-1">';
const previousStatic=express.static;
const targets=new Set(['/','/index.html','/subscribe.html','/download.html','/login.html','/register.html','/account.html','/products.html']);

const DOWNLOAD_GUIDES=`
<section><div class="install-heading"><h2>Visual Installation Guides</h2><p>Follow these guides for Android installation, supported devices, subscription and troubleshooting.</p></div>
<div class="guide-grid">
 <article class="guide-card"><h3>📱 Google Play Protect — Install Anyway</h3><img class="guide-img" src="/assets/guide-play-protect-choice.svg?v=20260908" alt="WORLD TV Google Play Protect install anyway guide in English and French"><p class="guide-note">If you intentionally downloaded WORLD TV from <strong>myworldtvlive.com</strong> and Google Play Protect shows the warning, tap <strong>More details</strong>, scroll down, choose <strong>Install anyway</strong>, then continue the installation.</p></article>
 <article class="guide-card"><h3>📺 Supported Devices &amp; Subscription</h3><img class="guide-img" src="/assets/guide-devices-subscription.svg?v=20260908" alt="WORLD TV supported Android devices and one year subscription guide"><p class="guide-note">Android TV, Android TV Box, compatible Android Smart TV, Android phone and tablet. 1-year subscription: <strong>US$23</strong>.</p></article>
 <article class="guide-card"><h3>🛠 Installation Help</h3><img class="guide-img" src="/assets/guide-troubleshooting-help.svg?v=20260908" alt="WORLD TV installation troubleshooting guide"><p class="guide-note">If installation still does not work, send a screenshot to WhatsApp <strong>+1 (530) 904-0310</strong> and support can guide you step by step.</p></article>
</div></section>`;

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
        if((p==='/download.html')&&typeof output==='string'){
          output=output.replace(/<div class="security-note">[\s\S]*?<\/div>/,
            '<div class="security-note"><strong>Google Play Protect:</strong> Android may show an “Unsafe app blocked” warning. If you intentionally downloaded WORLD TV from <strong>myworldtvlive.com</strong>, recognize the app, and choose to continue, tap <strong>More details</strong> → scroll down → <strong>Install anyway</strong> → continue installation.</div>');
          output=output.replace(/<section><div class="install-heading"><h2>Visual Installation Guides<\/h2>[\s\S]*?<\/section>/,DOWNLOAD_GUIDES);
        }
        res.setHeader('Cache-Control','no-cache, no-store, must-revalidate');
      }catch(_){ }
      return originalSend.call(res,output);
    };
    return middleware(req,res,(err)=>{res.send=originalSend;next(err);});
  };
};

console.log('WORLD TV phone-first customer UI enabled');
