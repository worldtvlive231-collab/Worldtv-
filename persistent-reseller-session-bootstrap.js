"use strict";

const path=require("path");
const crypto=require("crypto");
const bcrypt=require("bcryptjs");
const express=require("express");
const Database=require("better-sqlite3");

const db=new Database(path.join(process.cwd(),"data","worldtv.sqlite"));
db.pragma("journal_mode=WAL");
db.pragma("busy_timeout=5000");
const SESSION_HOURS=24;

db.exec(`
CREATE TABLE IF NOT EXISTS reseller_sessions(
  token_hash TEXT PRIMARY KEY,
  reseller_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reseller_sessions_reseller ON reseller_sessions(reseller_id);
CREATE INDEX IF NOT EXISTS idx_reseller_sessions_expires ON reseller_sessions(expires_at);
`);

function hashToken(token){return crypto.createHash("sha256").update(String(token||"")).digest("hex");}
function persistentResellerOnly(req,res,next){
  const token=String(req.headers["x-reseller-token"]||"").trim();
  if(!token)return res.status(401).json({error:"Unauthorized"});
  const session=db.prepare(`
    SELECT rs.reseller_id AS resellerId
    FROM reseller_sessions rs
    JOIN resellers r ON r.id=rs.reseller_id
    WHERE rs.token_hash=? AND datetime(rs.expires_at)>datetime('now') AND r.status='active'
  `).get(hashToken(token));
  if(!session)return res.status(401).json({error:"Session expired. Please log in again."});
  req.resellerId=session.resellerId;
  next();
}

async function persistentLogin(req,res){
  try{
    const email=String(req.body?.email||"").trim().toLowerCase();
    const password=String(req.body?.password||"");
    if(!email||!password)return res.status(400).json({error:"Email and password required"});
    const reseller=db.prepare("SELECT id,name,email,password_hash FROM resellers WHERE email=? AND status='active'").get(email);
    if(!reseller||!await bcrypt.compare(password,reseller.password_hash))return res.status(401).json({error:"Invalid email or password"});
    db.prepare("DELETE FROM reseller_sessions WHERE datetime(expires_at)<=datetime('now')").run();
    const token=crypto.randomBytes(32).toString("hex");
    const expiresAt=new Date(Date.now()+SESSION_HOURS*60*60*1000).toISOString();
    db.prepare("INSERT INTO reseller_sessions(token_hash,reseller_id,expires_at) VALUES(?,?,?)").run(hashToken(token),reseller.id,expiresAt);
    res.setHeader("Cache-Control","no-store");
    res.json({ok:true,token,resellerId:reseller.id,expires_at:expiresAt});
  }catch(error){
    console.error("Persistent reseller login failed:",error);
    res.status(500).json({error:"Could not log in"});
  }
}

function persistentLogout(req,res){
  try{
    const token=String(req.headers["x-reseller-token"]||"").trim();
    if(token)db.prepare("DELETE FROM reseller_sessions WHERE token_hash=?").run(hashToken(token));
    res.json({ok:true});
  }catch(error){res.status(500).json({error:"Could not log out"});}
}

const originalPost=express.application.post;
express.application.post=function worldTvPersistentResellerPost(route,...handlers){
  if(route==="/api/reseller/login")return originalPost.call(this,route,persistentLogin);
  if(route==="/api/reseller/logout")return originalPost.call(this,route,persistentResellerOnly,persistentLogout);
  if(String(route||"").startsWith("/api/reseller/")&&handlers.length){handlers[0]=persistentResellerOnly;}
  return originalPost.call(this,route,...handlers);
};

const originalGet=express.application.get;
express.application.get=function worldTvPersistentResellerGet(route,...handlers){
  if(String(route||"").startsWith("/api/reseller/")&&handlers.length){handlers[0]=persistentResellerOnly;}
  return originalGet.call(this,route,...handlers);
};

setInterval(()=>{try{db.prepare("DELETE FROM reseller_sessions WHERE datetime(expires_at)<=datetime('now')").run();}catch(_){ }},60*60*1000).unref?.();
console.log("WORLD TV persistent reseller sessions enabled");
