'use strict';

require('dotenv').config();
const path=require('path');
const crypto=require('crypto');
const bcrypt=require('bcryptjs');
const express=require('express');
const Database=require('better-sqlite3');
const db=new Database(path.join(__dirname,'data','worldtv.sqlite'));
db.pragma('journal_mode=WAL');
db.pragma('busy_timeout=5000');

const BASE=String(process.env.PUBLIC_BASE_URL||process.env.APP_URL||'https://myworldtvlive.com').replace(/\/+$/,'');
const RESEND_API_KEY=String(process.env.RESEND_API_KEY||'').trim();
const EMAIL_FROM=String(process.env.EMAIL_FROM||'').trim();
const CUSTOMER_SESSION_DAYS=30;
const WHATSAPP_NUMBER='233244909092';
const WHATSAPP_DISPLAY='+233 24 490 9092';
const WHATSAPP_URL=`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Hello WORLD TV, I need help with the app, subscription or WORLD TV Box.')}`;
const LOGO_URL=`${BASE}/assets/world-tv-logo.png`;

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
try{db.prepare('ALTER TABLE download_leads ADD COLUMN welcome_queue_id INTEGER').run()}catch(e){}
try{db.prepare('ALTER TABLE download_leads ADD COLUMN welcome_queued_at TEXT').run()}catch(e){}
try{db.prepare('ALTER TABLE download_leads ADD COLUMN welcome_sent_at TEXT').run()}catch(e){}

function clean(v,max=200){return String(v==null?'':v).trim().slice(0,max)}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)}
function ensureEmailQueue(){
 db.exec(`CREATE TABLE IF NOT EXISTS email_queue(
  id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,sent_at TEXT
 )`);
}
function ensureCustomer(name,email){
 let user=db.prepare('SELECT id,name,email,password_hash FROM users WHERE lower(email)=lower(?)').get(email);
 if(user) return user;
 const r=db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,NULL)').run(name,email);
 return db.prepare('SELECT id,name,email,password_hash FROM users WHERE id=?').get(r.lastInsertRowid);
}
function queueEmail(userId,email,subject,message){
 ensureEmailQueue();
 return db.prepare(`INSERT INTO email_queue(user_id,recipient_email,subject,message,status) VALUES(?,?,?,?, 'queued')`).run(userId||null,email,subject,message).lastInsertRowid;
}
function welcomeMessage(name,marketing){
 const first=`Hi ${name||'there'},\n\nThank you for downloading WORLD TV! 🎉\n\nInstall and open the app to enjoy your 3-day free trial — no credit card required. Explore live TV, movies, series, kids & anime, and live sports on supported Android devices.`;
 const links=`\n\nNeed help? Visit ${BASE}/download.html\nContact us on WhatsApp: ${WHATSAPP_DISPLAY} — ${WHATSAPP_URL}\nSubscribe when you are ready: ${BASE}/subscribe.html\nWORLD TV Box: ${BASE}/products.html`;
 const promo=marketing?`\n\nBecause you chose to receive WORLD TV offers and updates, we’ll also send helpful trial reminders, subscription offers and WORLD TV Box promotions.`:'';
 return first+links+promo+'\n\nThank you for choosing WORLD TV.';
}
function escapeHtml(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
function textToHtml(text){
 const body=escapeHtml(text).replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>');
 return `<!doctype html><html><body style="margin:0;background:#fffaf0;font-family:Arial,sans-serif;color:#17130a"><div style="max-width:640px;margin:0 auto;padding:26px 18px"><div style="background:#ffffff;border:1px solid #eadfc8;border-radius:18px;padding:28px;box-shadow:0 8px 28px rgba(79,55,0,.08)"><div style="text-align:center;margin-bottom:22px"><img src="${LOGO_URL}" alt="WORLD TV" width="150" style="display:inline-block;max-width:150px;height:auto;border:0"><div style="font-size:12px;color:#8a6b1d;margin-top:6px">Watch Anywhere. Enjoy More.</div></div><p style="font-size:16px;line-height:1.65">${body}</p><div style="margin:28px 0 8px;text-align:center"><a href="${WHATSAPP_URL}" style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px">💬 Contact us on WhatsApp</a></div><div style="text-align:center;color:#6d6658;font-size:13px;margin-top:10px">WhatsApp: ${WHATSAPP_DISPLAY}</div><div style="text-align:center;margin-top:18px"><a href="${BASE}/subscribe.html" style="display:inline-block;background:#d89a00;color:#17130a;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;margin:4px">Subscribe Now</a><a href="${BASE}/products.html" style="display:inline-block;background:#17130a;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;margin:4px">View WORLD TV Box</a></div></div></div></body></html>`;
}
async function sendQueuedEmailNow(queueId,leadId){
 if(!RESEND_API_KEY||!EMAIL_FROM) return false;
 const row=db.prepare("SELECT * FROM email_queue WHERE id=? AND status='queued'").get(queueId);
 if(!row) return false;
 const claimed=db.prepare("UPDATE email_queue SET status='sending' WHERE id=? AND status='queued'").run(queueId);
 if(!claimed.changes) return false;
 try{
  const response=await fetch('https://api.resend.com/emails',{
   method:'POST',headers:{Authorization:`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`worldtv-download-welcome-${queueId}`},
   body:JSON.stringify({from:EMAIL_FROM,to:[row.recipient_email],subject:row.subject,text:row.message,html:textToHtml(row.message)})
  });
  if(!response.ok) throw new Error(`Resend ${response.status}: ${(await response.text().catch(()=>'' )).slice(0,250)}`);
  db.prepare("UPDATE email_queue SET status='sent',sent_at=CURRENT_TIMESTAMP WHERE id=?").run(queueId);
  db.prepare('UPDATE download_leads SET welcome_sent_at=CURRENT_TIMESTAMP WHERE id=?').run(leadId);
  return true;
 }catch(e){
  console.error('Immediate download welcome email failed:',e.message);
  db.prepare("UPDATE email_queue SET status='queued',attempts=0 WHERE id=?").run(queueId);
  return false;
 }
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
  if(!lead){
   const r=db.prepare(`INSERT INTO download_leads(name,email,phone,country,marketing_consent) VALUES(?,?,?,?,?)`).run(name,email,phone,country,marketing);
   lead=db.prepare('SELECT * FROM download_leads WHERE id=?').get(r.lastInsertRowid);
  }else{
   db.prepare(`UPDATE download_leads SET name=?,phone=?,country=?,marketing_consent=MAX(marketing_consent,?),download_count=download_count+1,last_download_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(name,phone,country,marketing,lead.id);
   lead=db.prepare('SELECT * FROM download_leads WHERE id=?').get(lead.id);
  }

  const customer=ensureCustomer(name,email);
  let welcomeQueued=Boolean(lead.welcome_queue_id);
  let queueId=lead.welcome_queue_id;
  if(!queueId && !lead.welcome_sent_at){
   try{
    queueId=queueEmail(customer.id,email,'Welcome to WORLD TV — enjoy your 3-day free trial',welcomeMessage(name,marketing));
    db.prepare('UPDATE download_leads SET welcome_queue_id=?,welcome_queued_at=CURRENT_TIMESTAMP WHERE id=?').run(queueId,lead.id);
    welcomeQueued=true;
    setImmediate(()=>sendQueuedEmailNow(queueId,lead.id).catch(e=>console.error('Welcome delivery:',e.message)));
   }catch(mailErr){console.error('Download welcome email queue error:',mailErr.message)}
  }
  if(marketing){try{scheduleFollowups(lead.id)}catch(e){console.error('Download follow-up scheduling error:',e.message)}}

  return res.json({ok:true,lead_id:lead.id,customer_id:customer.id,registered:true,added_to_customer_management:true,welcome_queued:welcomeQueued,marketing_consent:Boolean(marketing),download_url:'/api/app/download'});
 }catch(e){
  console.error('Download registration error:',e);
  return res.status(500).json({error:'Could not save your registration. Please try again.'});
 }
}
function processFollowups(){
 try{
  ensureEmailQueue();
  const rows=db.prepare(`SELECT f.id,f.followup_type,l.id lead_id,l.name,l.email,u.id user_id FROM download_lead_followups f JOIN download_leads l ON l.id=f.lead_id LEFT JOIN users u ON lower(u.email)=lower(l.email) WHERE f.queued_at IS NULL AND l.marketing_consent=1 AND datetime(f.due_at)<=datetime('now') ORDER BY f.id LIMIT 10`).all();
  const mark=db.prepare('UPDATE download_lead_followups SET queued_at=CURRENT_TIMESTAMP,queue_id=? WHERE id=? AND queued_at IS NULL');
  for(const r of rows){
   let subject,message;
   if(r.followup_type==='trial_day_1'){
    subject='Enjoy your WORLD TV free trial';
    message=`Hi ${r.name},\n\nWe hope you are enjoying WORLD TV. Your 3-day free trial is a great time to explore the app.\n\nContact us on WhatsApp: ${WHATSAPP_DISPLAY} — ${WHATSAPP_URL}\nKeep watching after your trial: ${BASE}/subscribe.html\nWORLD TV Box: ${BASE}/products.html`;
   }else{
    subject='Keep watching WORLD TV after your trial';
    message=`Hi ${r.name},\n\nThank you for trying WORLD TV. Subscribe to continue watching or choose the WORLD TV Box for a complete TV setup.\n\nContact us on WhatsApp: ${WHATSAPP_DISPLAY} — ${WHATSAPP_URL}\nSubscribe: ${BASE}/subscribe.html\nWORLD TV Box: ${BASE}/products.html`;
   }
   const qid=queueEmail(r.user_id,r.email,subject,message);mark.run(qid,r.id);
  }
 }catch(e){console.error('Download follow-up worker:',e.message)}
}

async function upgradeDownloadLeadAccount(req,res,next){
 if(req.method!=='POST') return next();
 const email=clean(req.body&&req.body.email,200).toLowerCase();
 const password=String(req.body&&req.body.password||'');
 const name=clean(req.body&&req.body.name,120);
 if(!email||!password||password.length<8) return next();
 const user=db.prepare('SELECT id,password_hash FROM users WHERE lower(email)=lower(?)').get(email);
 if(!user || user.password_hash) return next();
 try{
  const hash=await bcrypt.hash(password,12);
  db.prepare('UPDATE users SET name=?,password_hash=? WHERE id=?').run(name||'WORLD TV Customer',hash,user.id);
  const token=crypto.randomBytes(32).toString('hex');
  const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt=new Date(Date.now()+CUSTOMER_SESSION_DAYS*86400000).toISOString();
  db.prepare('INSERT INTO customer_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(tokenHash,user.id,expiresAt);
  return res.json({token,upgraded_download_customer:true});
 }catch(e){console.error('Download lead account upgrade:',e.message);return next()}
}

const originalUse=express.application.use;
express.application.use=function patchedDownloadRegistrationUse(...args){
 if(!this.__wtvDownloadRegistrationRoutes){
  this.__wtvDownloadRegistrationRoutes=true;
  originalUse.call(this,'/api/download/register',express.json({limit:'64kb'}),(req,res,next)=>{
   if(req.method!=='POST') return next();
   return registerLead(req,res);
  });
  originalUse.call(this,'/api/customer/register',express.json({limit:'64kb'}),upgradeDownloadLeadAccount);
  originalUse.call(this,'/api/download/register/health',(req,res)=>res.json({ok:true,service:'download-registration',customer_management:true,immediate_welcome_email:Boolean(RESEND_API_KEY&&EMAIL_FROM)}));
 }
 return originalUse.apply(this,args);
};

setTimeout(processFollowups,20000).unref();
setInterval(processFollowups,60000).unref();
