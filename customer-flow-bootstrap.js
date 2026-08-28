"use strict";

const path = require("path");
const express = require("express");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const db = new Database(path.join(process.cwd(), "data", "worldtv.sqlite"));
db.pragma("journal_mode=WAL");
db.pragma("busy_timeout=5000");

function customerTokenHash(token){
  return crypto.createHash("sha256").update(String(token||"")).digest("hex");
}

function customerFromRequest(req){
  const token=String(req.headers["x-customer-token"]||"").trim();
  if(!token)return null;
  return db.prepare(`
    SELECT s.user_id AS userId
    FROM customer_sessions s
    WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP
  `).get(customerTokenHash(token))||null;
}

function pendingPayments(userId){
  const hasCheckout=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='checkout_requests'").get();
  if(!hasCheckout)return [];
  const hasStripe=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='stripe_payments'").get();
  const stripeJoin=hasStripe?"LEFT JOIN stripe_payments sp ON sp.reference=c.reference":"";
  const amountSql=hasStripe?"CASE WHEN sp.reference IS NOT NULL THEN CAST(ROUND(sp.amount_usd*100) AS INTEGER) ELSE CAST(ROUND(c.final_amount_usd*100) AS INTEGER) END":"CAST(ROUND(c.final_amount_usd*100) AS INTEGER)";
  return db.prepare(`
    SELECT
      c.reference,
      'paid_pending_activation' AS status,
      ${amountSql} AS amount_pesewas,
      'USD' AS currency,
      c.updated_at AS paid_at,
      c.created_at,
      p.name AS plan_name,
      NULL AS price_ghs,
      NULL AS code,
      NULL AS expires_at,
      1 AS activation_pending
    FROM checkout_requests c
    JOIN plans p ON p.id=c.plan_id
    ${stripeJoin}
    WHERE c.user_id=?
      AND c.status='payment_confirmed'
      AND NOT EXISTS(
        SELECT 1 FROM orders o WHERE o.reference=c.reference AND o.status='paid'
      )
    ORDER BY c.updated_at DESC
  `).all(userId);
}

function enhancedCustomerMe(req,res){
  try{
    const customer=customerFromRequest(req);
    if(!customer)return res.status(401).json({error:"Unauthorized"});
    const user=db.prepare("SELECT id,name,email,created_at FROM users WHERE id=?").get(customer.userId);
    if(!user)return res.status(404).json({error:"Customer not found"});
    const orders=db.prepare(`
      SELECT o.reference,o.status,o.amount_pesewas,o.currency,o.paid_at,o.created_at,
             p.name plan_name,p.price_ghs,c.code,c.expires_at,0 AS activation_pending
      FROM orders o
      JOIN plans p ON p.id=o.plan_id
      LEFT JOIN subscription_codes c ON c.id=o.code_id
      WHERE o.user_id=? ORDER BY o.id DESC
    `).all(customer.userId);
    const pending=pendingPayments(customer.userId);
    const combined=[...orders,...pending].sort((a,b)=>new Date(b.paid_at||b.created_at)-new Date(a.paid_at||a.created_at));
    const active=orders.find(o=>o.status==="paid"&&o.expires_at&&new Date(o.expires_at)>new Date())||null;
    res.setHeader("Cache-Control","no-store");
    res.json({user,active_subscription:active,orders:combined,pending_activation_count:pending.length,pending_activations:pending});
  }catch(error){
    console.error("Enhanced customer account flow failed:",error);
    res.status(500).json({error:"Could not load customer account"});
  }
}

const originalGet=express.application.get;
express.application.get=function worldTvCustomerFlowGet(route,...handlers){
  if(route==="/api/customer/me"&&handlers.length){
    handlers[handlers.length-1]=enhancedCustomerMe;
  }
  return originalGet.call(this,route,...handlers);
};

console.log("WORLD TV customer account flow enhancements enabled");
