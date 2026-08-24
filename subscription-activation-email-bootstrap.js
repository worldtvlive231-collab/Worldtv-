"use strict";

const path=require("path");
const express=require("express");
const Database=require("better-sqlite3");
const db=new Database(path.join(process.cwd(),"data","worldtv.sqlite"));
db.pragma("journal_mode=WAL");
db.exec(`CREATE TABLE IF NOT EXISTS activation_email_log(reference TEXT PRIMARY KEY, sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);

async function sendActivationEmail(reference){
  if(!reference)return;
  const already=db.prepare("SELECT reference FROM activation_email_log WHERE reference=?").get(reference);
  if(already)return;
  const row=db.prepare(`SELECT u.name,u.email,sc.code,sc.expires_at FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN subscription_codes sc ON sc.id=o.code_id WHERE o.reference=? AND o.status='paid'`).get(reference);
  if(!row?.email||!row?.code)return;
  const apiKey=String(process.env.RESEND_API_KEY||"").trim();
  const from=String(process.env.EMAIL_FROM||"WORLD TV <support@myworldtvlive.com>").trim();
  if(!apiKey){console.warn("Activation email skipped: RESEND_API_KEY missing");return;}
  const safe=v=>String(v||"").replace(/[<>&]/g,"");
  const expiry=row.expires_at?new Date(row.expires_at).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric",timeZone:"UTC"}):"";
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[row.email],subject:"Your WORLD TV subscription code",html:`<!doctype html><html><body style="margin:0;background:#fffaf0;font-family:Arial,sans-serif;color:#241b0c"><div style="max-width:620px;margin:0 auto;padding:28px"><div style="background:#fff;border:1px solid #ead9aa;border-radius:18px;padding:28px;text-align:center"><img src="https://myworldtvlive.com/world-tv-logo.png" alt="WORLD TV" style="max-width:150px;height:auto"><h1 style="font-size:25px;margin:18px 0 8px">Payment successful ✅</h1><p>Hi ${safe(row.name||"Customer")}, your WORLD TV subscription is active.</p><div style="margin:22px auto;padding:18px;background:#fff5cf;border:1px solid #e7c766;border-radius:12px"><div style="font-size:13px;color:#73633a">YOUR SUBSCRIPTION CODE</div><div style="font-size:28px;font-weight:800;letter-spacing:2px;margin-top:7px">${safe(row.code)}</div>${expiry?`<div style="margin-top:8px;color:#73633a">Valid until ${expiry}</div>`:""}</div><p>Your code is also saved in your WORLD TV account.</p><p style="margin:22px 0"><a href="https://myworldtvlive.com/account.html" style="display:inline-block;background:#e3a400;color:#17120a;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:700">Open My Account</a></p><p style="font-size:13px;color:#756b58">Thank you for choosing WORLD TV.</p></div></div></body></html>`,text:`Hi ${safe(row.name||"Customer")}, your WORLD TV subscription is active. Your subscription code is ${safe(row.code)}${expiry?`. Valid until ${expiry}`:""}. Open your account: https://myworldtvlive.com/account.html`})});
  if(!response.ok){console.error("Activation email failed:",await response.text().catch(()=>""));return;}
  try{db.prepare("INSERT INTO activation_email_log(reference) VALUES(?)").run(reference);}catch(_){ }
  console.log("WORLD TV activation email sent",{reference,email:row.email});
}

const originalPost=express.application.post;
express.application.post=function worldTvActivationEmailPost(route,...handlers){
  if((route==="/api/payment/paypal/capture"||route==="/api/payment/paystack/verify")&&handlers.length){
    const finalHandler=handlers[handlers.length-1];
    if(typeof finalHandler==="function"){
      const wrapped=async function(req,res,next){
        const originalJson=res.json.bind(res);
        res.json=function(payload){
          try{
            const reference=String(req.body?.reference||"").trim();
            if(payload?.paid&&payload?.fulfilled&&payload?.code&&reference)setTimeout(()=>sendActivationEmail(reference).catch(e=>console.error("Activation email error:",e)),0);
          }catch(_){ }
          return originalJson(payload);
        };
        return finalHandler(req,res,next);
      };
      return originalPost.call(this,route,...handlers.slice(0,-1),wrapped);
    }
  }
  return originalPost.call(this,route,...handlers);
};

console.log("WORLD TV subscription activation email safeguard enabled");
