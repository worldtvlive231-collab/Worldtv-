"use strict";

require("dotenv").config();
const path=require("path");
const Database=require("better-sqlite3");

const db=new Database(path.join(process.cwd(),"data","worldtv.sqlite"));
db.pragma("journal_mode=WAL");
db.pragma("busy_timeout=5000");
const INTERVAL_MS=Math.max(15000,Number(process.env.PENDING_ACTIVATION_RECOVERY_MS||30000));
let running=false;

db.exec(`
CREATE TABLE IF NOT EXISTS activation_email_log(
  reference TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

function tableExists(name){
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function pendingRows(){
  if(!["checkout_requests","orders","subscription_codes","plans","users"].every(tableExists)) return [];
  return db.prepare(`
    SELECT c.id,c.reference,c.user_id,c.plan_id,c.coupon_code,
           c.final_amount_usd,c.final_amount_ghs,c.updated_at,
           p.duration_days,p.name AS plan_name,u.name AS customer_name,u.email,
           sp.amount_usd AS stripe_amount_usd,sp.status AS stripe_status
    FROM checkout_requests c
    JOIN plans p ON p.id=c.plan_id
    JOIN users u ON u.id=c.user_id
    LEFT JOIN stripe_payments sp ON sp.reference=c.reference
    WHERE c.status='payment_confirmed'
      AND NOT EXISTS(
        SELECT 1 FROM orders o WHERE o.reference=c.reference AND o.status='paid'
      )
    ORDER BY datetime(c.updated_at) ASC,c.id ASC
    LIMIT 100
  `).all();
}

function nextAdminCode(planId){
  return db.prepare(`
    SELECT id,code,cost_price_usd
    FROM subscription_codes
    WHERE plan_id=?
      AND status='unused'
      AND user_id IS NULL
      AND reseller_id IS NULL
      AND (expires_at IS NULL OR datetime(expires_at)>datetime('now'))
    ORDER BY id ASC
    LIMIT 1
  `).get(planId);
}

function expiryFor(userId,durationDays){
  let start=new Date();
  const current=db.prepare(`
    SELECT MAX(sc.expires_at) AS expiry
    FROM orders o
    JOIN subscription_codes sc ON sc.id=o.code_id
    WHERE o.user_id=? AND o.status='paid'
  `).get(userId);
  if(current?.expiry){
    const existing=new Date(current.expiry);
    if(!Number.isNaN(existing.getTime())&&existing>start) start=existing;
  }
  const expiry=new Date(start);
  expiry.setUTCDate(expiry.getUTCDate()+Number(durationDays||365));
  return expiry.toISOString();
}

function fulfillOne(row){
  const code=nextAdminCode(row.plan_id);
  if(!code) return null;
  const expiresAt=expiryFor(row.user_id,row.duration_days);
  const isStripe=Number(row.stripe_amount_usd)>0 && ["paid_pending_code","paid","fulfilled"].includes(String(row.stripe_status||""));
  const currency=isStripe?"USD":"GHS";
  const amountPesewas=isStripe
    ?Math.round(Number(row.stripe_amount_usd)*100)
    :Math.round(Number(row.final_amount_ghs||0)*100);
  if(!Number.isFinite(amountPesewas)||amountPesewas<=0) throw new Error(`Invalid paid amount for ${row.reference}`);
  const paidAt=new Date().toISOString();

  const tx=db.transaction(()=>{
    const existing=db.prepare("SELECT id FROM orders WHERE reference=? AND status='paid'").get(row.reference);
    if(existing) return {already:true};
    const fresh=db.prepare("SELECT status FROM checkout_requests WHERE id=?").get(row.id);
    if(!fresh||fresh.status!=="payment_confirmed") return {already:true};
    const assigned=db.prepare(`
      UPDATE subscription_codes
      SET status='used',user_id=?,expires_at=?
      WHERE id=? AND status='unused' AND user_id IS NULL AND reseller_id IS NULL
    `).run(row.user_id,expiresAt,code.id);
    if(assigned.changes!==1) throw new Error("Subscription code assignment conflict");

    db.prepare(`
      INSERT INTO orders(reference,user_id,plan_id,amount_pesewas,currency,status,code_id,paid_at)
      VALUES(?,?,?,?,?,'paid',?,?)
    `).run(row.reference,row.user_id,row.plan_id,amountPesewas,currency,code.id,paidAt);

    db.prepare("UPDATE checkout_requests SET status='fulfilled',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
    if(isStripe&&tableExists("stripe_payments")){
      db.prepare("UPDATE stripe_payments SET status='fulfilled',updated_at=CURRENT_TIMESTAMP WHERE reference=?").run(row.reference);
    }
    if(row.coupon_code&&tableExists("coupons")){
      db.prepare("UPDATE coupons SET used_count=used_count+1 WHERE code=?").run(row.coupon_code);
    }
    if(tableExists("notifications")){
      db.prepare("INSERT INTO notifications(user_id,title,message) VALUES(?,?,?)").run(
        row.user_id,
        "Subscription Activated",
        `Your WORLD TV payment has been activated automatically. Your subscription code is ${code.code}.`
      );
    }
    return {already:false,code:code.code,expiresAt};
  });

  const result=tx();
  return result?.already?null:{...result,row};
}

async function sendActivationEmail(item){
  const row=item?.row;
  if(!row?.email||!item?.code) return;
  if(db.prepare("SELECT 1 FROM activation_email_log WHERE reference=?").get(row.reference)) return;
  const apiKey=String(process.env.RESEND_API_KEY||"").trim();
  const from=String(process.env.EMAIL_FROM||"WORLD TV <support@myworldtvlive.com>").trim();
  if(!apiKey) return;
  const safe=v=>String(v||"").replace(/[<>&]/g,"");
  const expiry=new Date(item.expiresAt).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric",timeZone:"UTC"});
  const response=await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json","Idempotency-Key":`worldtv-activation-${row.reference}`},
    body:JSON.stringify({
      from,to:[row.email],subject:"Your WORLD TV subscription is active",
      html:`<!doctype html><html><body style="font-family:Arial,sans-serif;background:#fffaf0;color:#241b0c"><div style="max-width:620px;margin:auto;padding:28px"><h2>WORLD TV</h2><p>Hi ${safe(row.customer_name||"Customer")}, your payment has been activated automatically.</p><p>Your subscription code is <strong>${safe(item.code)}</strong>.</p><p>Valid until ${safe(expiry)}.</p><p><a href="https://myworldtvlive.com/account.html">Open My Account</a></p></div></body></html>`,
      text:`Hi ${safe(row.customer_name||"Customer")}, your WORLD TV subscription is active. Code: ${safe(item.code)}. Valid until ${expiry}. My Account: https://myworldtvlive.com/account.html`
    })
  });
  if(!response.ok) throw new Error(await response.text().catch(()=>"Activation email failed"));
  db.prepare("INSERT OR IGNORE INTO activation_email_log(reference) VALUES(?)").run(row.reference);
}

async function recoverPendingActivations(trigger="scheduled"){
  if(running) return {skipped:true};
  running=true;
  let fulfilled=0;
  try{
    for(const row of pendingRows()){
      const item=fulfillOne(row);
      if(!item) continue;
      fulfilled++;
      await sendActivationEmail(item).catch(error=>console.error("Pending activation email error:",error.message));
      console.log("Recovered paid WORLD TV subscription",{trigger,reference:row.reference,user_id:row.user_id,code:item.code});
    }
    return {fulfilled};
  }catch(error){
    console.error("Pending activation recovery failed:",error);
    return {fulfilled,error:error.message};
  }finally{
    running=false;
  }
}

setTimeout(()=>recoverPendingActivations("startup"),5000).unref?.();
const timer=setInterval(()=>recoverPendingActivations("scheduled"),INTERVAL_MS);
timer.unref?.();

module.exports={recoverPendingActivations};
