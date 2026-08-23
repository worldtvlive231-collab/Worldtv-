'use strict';

require('dotenv').config();
const path=require('path');
const express=require('express');
const Database=require('better-sqlite3');
const db=new Database(path.join(process.cwd(),'data','worldtv.sqlite'));
db.pragma('journal_mode=WAL');
db.pragma('busy_timeout=5000');

const BASE=String(process.env.PUBLIC_BASE_URL||process.env.APP_URL||'https://myworldtvlive.com').replace(/\/+$/,'');

db.exec(`
CREATE TABLE IF NOT EXISTS download_leads(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 phone TEXT NOT NULL DEFAULT '',
 country TEXT NOT NULL DEFAULT '',
 marketing_consent INTEGER NOT NULL DEFAULT 0,
 download_count INTEGER NOT NULL DEFAULT 1,
 first_download_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_download_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS download_lead_followups(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 lead_id INTEGER NOT NULL,
 followup_type TEXT NOT NULL,
 due_at TEXT NOT NULL,
 queued_at TEXT,
 queue_id INTEGER,
 UNIQUE(lead_id,followup_type)
);
`);

function clean(v,max=200){return String(v==null?'':v).trim().slice(0,max)}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)}
function ensureEmailQueue(){
 db.exec(`CREATE TABLE IF NOT EXISTS email_queue(
  id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,sent_at TEXT
 )`);
}
function queueEmail(email,subject,message){
 ensureEmailQueue();
 return db.prepare(`INSERT INTO email_queue(user_id,recipient_email,subject,message,status) VALUES(NULL,?,?,?,'queued')`).run(email,subject,message).lastInsertRowid;
}
function welcomeMessage(name,marketing){
 const first=`Hi ${name||'there'},\n\nThank you for downloading WORLD TV! 🎉\n\nInstall and open the app to enjoy your 3-day free trial — no credit card required. Explore live TV, movies, series, kids & anime, and live sports on supported Android devices.`;
 const links=`\n\nNeed help? Visit ${BASE}/download.html\nSubscribe when you are ready: ${BASE}/subscribe.html\nWORLD TV Box: ${BASE}/products.html`;
 const promo=marketing?`\n\nBecause you chose to receive WORLD TV offers and updates, we’ll also send a few helpful trial and subscription reminders.`:'';
 return first+links+promo+'\n\nThank you for choosing WORLD TV.';
}
function scheduleFollowups(leadId){
 const ins=db.prepare(`INSERT OR IGNORE INTO download_lead_followups(lead_id,followup_type,due_at) VALUES(?,?,datetime('now',?))`);
 ins.run(leadId,'trial_day_1','+1 day');
 ins.run(leadId,'trial_day_3','+3 days');
}
function registerLead(req,res){
 try{
  const name=clean(req.body&&req.body.name,120),email=clean(req.body&&req.body.email,200).toLowerCase();
  const phone=clean(req.body&&req.body.phone,80),country=clean(req.body&&req.body.country,120);
  const marketing=(req.body&&(req.body.marketing_consent===true||req.body.marketing_consent===1||req.body.marketing_consent==='1'))?1:0;
  if(!name||!email)return res.status(400).json({error:'Name and email are required before downloading.'});
  if(!validEmail(email))return res.status(400).json({error:'Enter a valid email address.'});
  let lead=db.prepare('SELECT * FROM download_leads WHERE lower(email)=lower(?)').get(email);
  const isNew=!lead;
  if(isNew){
   const r=db.prepare(`INSERT INTO download_leads(name,email,phone,country,marketing_consent) VALUES(?,?,?,?,?)`).run(name,email,phone,country,marketing);
   lead=db.prepare('SELECT * FROM download_leads WHERE id=?').get(r.lastInsertRowid);
  }else{
   db.prepare(`UPDATE download_leads SET name=?,phone=?,country=?,marketing_consent=MAX(marketing_consent,?),download_count=download_count+1,last_download_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(name,phone,country,marketing,lead.id);
   lead=db.prepare('SELECT * FROM download_leads WHERE id=?').get(lead.id);
  }
  if(isNew){ queueEmail(email,'Welcome to WORLD TV — enjoy your 3-day free trial',welcomeMessage(name,marketing)); }
  if(marketing) scheduleFollowups(lead.id);
  res.json({ok:true,lead_id:lead.id,registered:true,welcome_queued:isNew,marketing_consent:Boolean(marketing),download_url:'/api/app/download'});
 }catch(e){console.error('Download registration error:',e);res.status(500).json({error:'Could not complete registration. Please try again.'})}
}
function processFollowups(){
 try{
  ensureEmailQueue();
  const rows=db.prepare(`SELECT f.id,f.followup_type,l.id lead_id,l.name,l.email FROM download_lead_followups f JOIN download_leads l ON l.id=f.lead_id WHERE f.queued_at IS NULL AND l.marketing_consent=1 AND datetime(f.due_at)<=datetime('now') ORDER BY f.id LIMIT 10`).all();
  const mark=db.prepare('UPDATE download_lead_followups SET queued_at=CURRENT_TIMESTAMP,queue_id=? WHERE id=? AND queued_at IS NULL');
  for(const r of rows){
   let subject,message;
   if(r.followup_type==='trial_day_1'){
    subject='Enjoy your WORLD TV free trial';
    message=`Hi ${r.name},\n\nWe hope you are enjoying WORLD TV. Your 3-day free trial is a great time to explore live TV, movies, series, kids & anime, and live sports.\n\nKeep watching after your trial by subscribing here: ${BASE}/subscribe.html\n\nNo Android or Google TV? Our WORLD TV Box can turn any TV with HDMI into an entertainment hub: ${BASE}/products.html`;
   }else{
    subject='Keep watching WORLD TV after your trial';
    message=`Hi ${r.name},\n\nThank you for trying WORLD TV. Don’t lose access to the entertainment you’ve been enjoying. Subscribe to continue watching, or choose the WORLD TV Box for a complete TV setup.\n\nSubscribe: ${BASE}/subscribe.html\nWORLD TV Box: ${BASE}/products.html`;
   }
   const qid=queueEmail(r.email,subject,message);mark.run(qid,r.id);
  }
 }catch(e){console.error('Download follow-up worker:',e.message)}
}

const originalListen=express.application.listen;
express.application.listen=function patchedDownloadRegistrationListen(...args){
 if(!this.__wtvDownloadRegistrationRoutes){
  this.post('/api/download/register',express.json(),registerLead);
  this.__wtvDownloadRegistrationRoutes=true;
 }
 return originalListen.apply(this,args);
};

setTimeout(processFollowups,20000).unref();
setInterval(processFollowups,60000).unref();
