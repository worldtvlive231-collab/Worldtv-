'use strict';

const express=require('express');
const STYLE='<link rel="stylesheet" href="/assets/mobile-customer.css?v=20260828-1">';
const previousStatic=express.static;
const targets=new Set(['/','/index.html','/subscribe.html','/download.html','/login.html','/register.html','/account.html','/products.html']);

const DOWNLOAD_GUIDES=`
<section id="installation-guides"><div class="install-heading"><h2>WORLD TV Installation Guide</h2><p>This clear English and French guide is also included in the download email.</p></div>
<div class="guide-grid">
 <article class="guide-card"><h3>“Unsafe App Blocked” — English &amp; Français</h3><a href="/assets/world-tv-installation-guide-en-fr.jpeg?v=20260909-1" target="_blank" rel="noopener"><img class="guide-img" src="/assets/world-tv-installation-guide-en-fr.jpeg?v=20260909-1" alt="WORLD TV bilingual installation guide: More details, scroll down, Install anyway, and continue installation"></a><p class="guide-note">More details → scroll down → Install anyway → continue installation. After installation, open WORLD TV and select <strong>Get Free Trial</strong>. Tap the guide to view it full size.</p></article>
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
            '<div class="security-note"><strong>Google Play Protect:</strong> Google may show an “Unsafe app blocked” message and provide the <strong>Install anyway</strong> option. If this is the WORLD TV APK you intentionally downloaded from <strong>myworldtvlive.com</strong> and you choose to continue, tap <strong>More details</strong> → scroll down → <strong>Install anyway</strong> → continue installation.</div>');
          output=output.replace(/<section(?: id="installation-guides")?><div class="install-heading"><h2>(?:Visual Installation Guides|WORLD TV Visual Installation Guide)<\/h2>[\s\S]*?<\/section>/,DOWNLOAD_GUIDES);
        }
        res.setHeader('Cache-Control','no-cache, no-store, must-revalidate');
      }catch(_){ }
      return originalSend.call(res,output);
    };
    return middleware(req,res,(err)=>{res.send=originalSend;next(err);});
  };
};

console.log('WORLD TV phone-first customer UI enabled');
