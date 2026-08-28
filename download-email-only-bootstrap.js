'use strict';
require('dotenv').config();
const path=require('path');
const express=require('express');
const Database=require('better-sqlite3');
const db=new Database(path.join(__dirname,'data','worldtv.sqlite'));
db.pragma('journal_mode=WAL');
db.pragma('busy_timeout=5000');

const BASE=String(process.env.PUBLIC_BASE_URL||process.env.APP_URL||'https://myworldtvlive.com').replace(/\/+$/,'');
const RESEND_API_KEY=String(process.env.RESEND_API_KEY||'').trim();
const EMAIL_FROM=String(process.env.EMAIL_FROM||'').trim();
const APK_URL='https://23s.tv/IPTV/worldtv8.2.8-20260822.apk';

db.exec(`CREATE TABLE IF NOT EXISTS download_email_leads(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 email TEXT NOT NULL UNIQUE,
 download_count INTEGER NOT NULL DEFAULT 1,
 first_download_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_download_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 thank_sent_at TEXT,
 trial_followup_sent_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);

function clean(v,max=200){return String(v==null?'':v).trim().slice(0,max)}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)}
function htmlShell(title,body,buttonText,buttonUrl){
 return `<!doctype html><html><body style="margin:0;background:#fffaf0;font-family:Arial,sans-serif;color:#17130a"><div style="max-width:650px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border:1px solid #eadfc8;border-radius:18px;padding:26px"><div style="text-align:center;margin-bottom:18px"><img src="${BASE}/world-tv-logo.png" alt="WORLD TV" width="145" style="max-width:145px;height:auto"><h2 style="margin:12px 0 0">${title}</h2></div><div style="font-size:16px;line-height:1.65;color:#3b3428">${body}</div><div style="text-align:center;margin-top:24px"><a href="${buttonUrl}" style="display:inline-block;background:#e0a200;color:#17130a;text-decoration:none;font-weight:800;padding:14px 24px;border-radius:10px">${buttonText}</a></div></div></div></body></html>`;
}
async function sendEmail(to,subject,text,html,key){
 if(!RESEND_API_KEY||!EMAIL_FROM) throw new Error('Email service is not configured');
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({from:EMAIL_FROM,to:[to],subject,text,html})});
 if(!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text().catch(()=>'' )).slice(0,250)}`);
}
async function sendThankYou(lead){
 const text=`Thank you for downloading WORLD TV!\n\nInstall WORLD TV v8.2.8 and enjoy your 3-day free trial. No account is required just to download the app.\n\nWhen you are ready to subscribe, create your WORLD TV account here: ${BASE}/register.html\n\n1-year subscription: US$23.\nSubscription page: ${BASE}/subscribe.html\n\nThank you for choosing WORLD TV.`;
 const body=`<p>Thank you for downloading <strong>WORLD TV v8.2.8</strong>! 🎉</p><p>Install the app and enjoy your <strong>3-day free trial</strong>.</p><p>When you are ready to subscribe, create your WORLD TV account using the button below. After creating your account, you can subscribe to the 1-year plan for <strong>US$23</strong>.</p>`;
 await sendEmail(lead.email,'Thank you for downloading WORLD TV — enjoy your 3-day free trial',text,htmlShell('Thank You for Downloading WORLD TV',body,'Create WORLD TV Account',`${BASE}/register.html`),`worldtv-download-thank-${lead.id}`);
 db.prepare('UPDATE download_email_leads SET thank_sent_at=CURRENT_TIMESTAMP WHERE id=?').run(lead.id);
}
async function sendTrialFollowup(lead){
 const text=`Your WORLD TV 3-day free trial is ending.\n\nCreate your WORLD TV account to subscribe and continue watching: ${BASE}/register.html\n\nAfter creating your account, choose the 1-year subscription for US$23 here: ${BASE}/subscribe.html`;
 const body=`<p>Your <strong>3-day WORLD TV free trial</strong> is ending.</p><p>Create your WORLD TV account now so you can subscribe and continue watching.</p><p>After creating your account, choose the <strong>1-year subscription for US$23</strong>.</p>`;
 await sendEmail(lead.email,'Your WORLD TV free trial is ending — create your account to subscribe',text,htmlShell('Continue Watching WORLD TV',body,'Create Account & Subscribe',`${BASE}/register.html`),`worldtv-trial-followup-${lead.id}`);
 db.prepare('UPDATE download_email_leads SET trial_followup_sent_at=CURRENT_TIMESTAMP WHERE id=?').run(lead.id);
}
async function register(req,res){
 try{
  const email=clean(req.body&&req.body.email,200).toLowerCase();
  if(!validEmail(email)) return res.status(400).json({error:'Enter a valid email address.'});
  let lead=db.prepare('SELECT * FROM download_email_leads WHERE lower(email)=lower(?)').get(email);
  if(!lead){
   const r=db.prepare('INSERT INTO download_email_leads(email) VALUES(?)').run(email);
   lead=db.prepare('SELECT * FROM download_email_leads WHERE id=?').get(r.lastInsertRowid);
  }else{
   db.prepare('UPDATE download_email_leads SET download_count=download_count+1,last_download_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(lead.id);
   lead=db.prepare('SELECT * FROM download_email_leads WHERE id=?').get(lead.id);
  }
  if(!lead.thank_sent_at){try{await sendThankYou(lead)}catch(e){console.error('Download thank-you email:',e.message)}}
  return res.json({ok:true,email,download_url:APK_URL});
 }catch(e){console.error('Email-only download registration:',e);return res.status(500).json({error:'Could not save your email. Please try again.'})}
}

async function processDueFollowups(){
 try{
  const rows=db.prepare(`SELECT * FROM download_email_leads WHERE trial_followup_sent_at IS NULL AND datetime(first_download_at)<=datetime('now','-3 days') ORDER BY id LIMIT 10`).all();
  for(const lead of rows){try{await sendTrialFollowup(lead)}catch(e){console.error('Trial follow-up email:',e.message)}}
 }catch(e){console.error('Trial follow-up worker:',e.message)}
}
setInterval(()=>{processDueFollowups().catch(()=>{})},15*60*1000).unref();
setTimeout(()=>{processDueFollowups().catch(()=>{})},20000).unref();

const originalUse=express.application.use;
express.application.use=function patchedEmailOnlyDownloadUse(...args){
 if(!this.__wtvEmailOnlyDownloadRoute){
  this.__wtvEmailOnlyDownloadRoute=true;
  originalUse.call(this,'/api/download/email-register',express.json({limit:'32kb'}),(req,res,next)=>{
   if(req.method!=='POST') return next();
   return register(req,res);
  });
 }
 return originalUse.apply(this,args);
};
