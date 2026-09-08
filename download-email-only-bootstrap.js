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
 return `<!doctype html><html><body style="margin:0;background:#fffaf0;font-family:Arial,sans-serif;color:#17130a"><div style="max-width:680px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border:1px solid #eadfc8;border-radius:18px;padding:26px"><div style="text-align:center;margin-bottom:18px"><img src="${BASE}/world-tv-logo.png" alt="WORLD TV" width="145" style="max-width:145px;height:auto"><h2 style="margin:12px 0 0">${title}</h2></div><div style="font-size:16px;line-height:1.65;color:#3b3428">${body}</div><div style="text-align:center;margin-top:24px"><a href="${buttonUrl}" style="display:inline-block;background:#e0a200;color:#17130a;text-decoration:none;font-weight:800;padding:14px 24px;border-radius:10px">${buttonText}</a></div></div></div></body></html>`;
}
async function sendEmail(to,subject,text,html,key){
 if(!RESEND_API_KEY||!EMAIL_FROM) throw new Error('Email service is not configured');
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({from:EMAIL_FROM,to:[to],subject,text,html})});
 if(!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text().catch(()=>'' )).slice(0,250)}`);
}
async function sendThankYou(lead){
 const text=`Thank you for downloading WORLD TV!\n\nYour WORLD TV v8.2.8 download has started.\n\nANDROID PHONE / TABLET\n1. Open your Downloads or Files app.\n2. Tap the WORLD TV APK file.\n3. Follow the normal Android installation prompts.\n4. Open WORLD TV and select Get Free Trial.\n\nANDROID TV / GOOGLE TV\n1. Open the Downloader app.\n2. Enter Downloader code: 4193413.\n3. Download the WORLD TV APK and follow the normal installation prompts.\n4. Open WORLD TV and select Get Free Trial.\n\nIf Android or Play Protect blocks the app, do not override the security warning. Contact WORLD TV support for a verified build or use the official app-store version when available.\n\n1-year subscription: US$23\nSubscribe: ${BASE}/subscribe.html\nInstallation page: ${BASE}/download.html\n\nThank you for choosing WORLD TV.`;
 const body=`<p>Thank you for downloading <strong>WORLD TV v8.2.8</strong>! 🎉 Your download has started.</p><h3 style="margin-bottom:6px">Android phone / tablet</h3><ol style="padding-left:22px"><li>Open your <strong>Downloads</strong> or <strong>Files</strong> app.</li><li>Tap the WORLD TV APK file.</li><li>Follow the normal Android installation prompts.</li><li>Open WORLD TV and select <strong>Get Free Trial</strong>.</li></ol><h3 style="margin-bottom:6px">Android TV / Google TV</h3><ol style="padding-left:22px"><li>Open the <strong>Downloader</strong> app.</li><li>Enter Downloader code <strong>4193413</strong>.</li><li>Download the WORLD TV APK and follow the normal installation prompts.</li><li>Open WORLD TV and select <strong>Get Free Trial</strong>.</li></ol><p style="background:#fff3cd;border:1px solid #f1d58a;border-radius:10px;padding:12px"><strong>Security note:</strong> If Android or Play Protect blocks the app, do not override the warning. Contact WORLD TV support for a verified build or use the official app-store version when available.</p><p><strong>1-year subscription: US$23</strong><br><a href="${BASE}/subscribe.html">${BASE}/subscribe.html</a></p><p>Full installation page: <a href="${BASE}/download.html">${BASE}/download.html</a></p>`;
 await sendEmail(lead.email,'Thank you for downloading WORLD TV — installation guide',text,htmlShell('Thank You for Downloading WORLD TV',body,'Subscribe — US$23 / 1 Year',`${BASE}/subscribe.html`),`worldtv-download-thank-${lead.id}`);
 db.prepare('UPDATE download_email_leads SET thank_sent_at=CURRENT_TIMESTAMP WHERE id=?').run(lead.id);
}
async function sendTrialFollowup(lead){
 const text=`Your WORLD TV 3-day free trial is ending.\n\nCreate or sign in to your WORLD TV account and choose the 1-year subscription for US$23 here: ${BASE}/subscribe.html`;
 const body=`<p>Your <strong>3-day WORLD TV free trial</strong> is ending.</p><p>Create or sign in to your WORLD TV account and choose the <strong>1-year subscription for US$23</strong>.</p>`;
 await sendEmail(lead.email,'Your WORLD TV free trial is ending — subscribe for 1 year',text,htmlShell('Continue Watching WORLD TV',body,'Subscribe — US$23 / 1 Year',`${BASE}/subscribe.html`),`worldtv-trial-followup-${lead.id}`);
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
  return res.json({ok:true,email,download_url:'/api/app/download'});
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
