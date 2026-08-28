"use strict";

require("dotenv").config();
const path=require("path");
const crypto=require("crypto");
const bcrypt=require("bcryptjs");
const express=require("express");
const Database=require("better-sqlite3");

const db=new Database(path.join(process.cwd(),"data","worldtv.sqlite"));
db.pragma("journal_mode=WAL");
db.pragma("busy_timeout=5000");
const CUSTOMER_SESSION_DAYS=30;

function tokenHash(token){return crypto.createHash("sha256").update(String(token)).digest("hex");}

async function upgradeLegacyDownloadCustomer(req,res,next){
  try{
    if(req.method!=="POST") return next();
    const email=String(req.body?.email||"").trim().toLowerCase();
    const password=String(req.body?.password||"");
    const name=String(req.body?.name||"").trim();
    if(!email||password.length<8) return next();

    const user=db.prepare("SELECT id,password_hash FROM users WHERE lower(email)=lower(?)").get(email);
    if(!user||user.password_hash) return next();

    const hash=await bcrypt.hash(password,12);
    db.prepare("UPDATE users SET name=?,password_hash=? WHERE id=?")
      .run(name||"WORLD TV Customer",hash,user.id);

    const token=crypto.randomBytes(32).toString("hex");
    const expiresAt=new Date(Date.now()+CUSTOMER_SESSION_DAYS*86400000).toISOString();
    db.prepare("INSERT INTO customer_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
      .run(tokenHash(token),user.id,expiresAt);

    return res.json({token,upgraded_download_customer:true});
  }catch(error){
    console.error("Legacy download customer upgrade failed:",error.message);
    return next();
  }
}

const originalPost=express.application.post;
express.application.post=function worldTvLegacyDownloadCustomerPost(route,...handlers){
  if(route==="/api/customer/register"){
    return originalPost.call(this,route,upgradeLegacyDownloadCustomer,...handlers);
  }
  return originalPost.call(this,route,...handlers);
};

console.log("WORLD TV legacy download customer upgrade compatibility enabled");
