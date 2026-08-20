"use strict";

require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "data", "worldtv.sqlite");
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || process.env.APP_URL || "https://myworldtvlive.com").replace(/\/+$/, "");
const REFERRAL_REWARD_DAYS = Math.min(365, Math.max(1, Number(process.env.REFERRAL_REWARD_DAYS || 30)));
const db = new Database(DB_PATH);
db.pragma("journal_mode=WAL");
db.pragma("busy_timeout=5000");

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function initMarketingTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketing_visits(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'direct',
      medium TEXT,
      campaign TEXT,
      content TEXT,
      term TEXT,
      referral_code TEXT,
      landing_path TEXT NOT NULL DEFAULT '/',
      referrer TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_marketing_visits_visitor ON marketing_visits(visitor_id);
    CREATE INDEX IF NOT EXISTS idx_marketing_visits_source ON marketing_visits(source);
    CREATE INDEX IF NOT EXISTS idx_marketing_visits_campaign ON marketing_visits(campaign);
    CREATE INDEX IF NOT EXISTS idx_marketing_visits_created ON marketing_visits(created_at);

    CREATE TABLE IF NOT EXISTS marketing_customer_attribution(
      user_id INTEGER PRIMARY KEY,
      visitor_id TEXT,
      first_source TEXT NOT NULL DEFAULT 'direct',
      first_medium TEXT,
      first_campaign TEXT,
      first_content TEXT,
      first_term TEXT,
      first_referral_code TEXT,
      first_referrer_user_id INTEGER,
      first_touch_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_source TEXT NOT NULL DEFAULT 'direct',
      last_medium TEXT,
      last_campaign TEXT,
      last_content TEXT,
      last_term TEXT,
      last_referral_code TEXT,
      last_touch_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_marketing_customer_source ON marketing_customer_attribution(first_source);
    CREATE INDEX IF NOT EXISTS idx_marketing_customer_campaign ON marketing_customer_attribution(first_campaign);

    CREATE TABLE IF NOT EXISTS referral_rewards(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referral_id INTEGER NOT NULL UNIQUE,
      referrer_user_id INTEGER NOT NULL,
      referred_user_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL UNIQUE,
      reward_days INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'earned',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      applied_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON referral_rewards(referrer_user_id);
    CREATE INDEX IF NOT EXISTS idx_referral_rewards_status ON referral_rewards(status);
  `);
}
initMarketingTables();

function clean(value, max = 120) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function cleanSource(value) {
  return clean(value || "direct", 80).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "direct";
}

function cleanVisitor(value) {
  const v = clean(value, 100);
  return /^[a-zA-Z0-9._:-]{8,100}$/.test(v) ? v : crypto.randomBytes(16).toString("hex");
}

function adminOnly(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!token || !email || !password) return res.status(401).json({ error: "Admin authentication required" });
  const expected = crypto.createHmac("sha256", password).update(email).digest("hex");
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "Admin authentication required" });
  next();
}

function customerFromToken(token) {
  if (!token || !tableExists("customer_sessions") || !tableExists("users")) return null;
  const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");
  return db.prepare(`
    SELECT s.user_id AS userId,u.email,u.name
    FROM customer_sessions s
    JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now')
  `).get(tokenHash) || null;
}

function customerOnly(req, res, next) {
  const customer = customerFromToken(req.headers["x-customer-token"]);
  if (!customer) return res.status(401).json({ error: "Unauthorized" });
  req.customer = customer;
  next();
}

function normalizeAttribution(body) {
  body = body || {};
  return {
    visitor_id: cleanVisitor(body.visitor_id),
    source: cleanSource(body.source || body.utm_source),
    medium: clean(body.medium || body.utm_medium, 80),
    campaign: clean(body.campaign || body.utm_campaign, 120),
    content: clean(body.content || body.utm_content, 120),
    term: clean(body.term || body.utm_term, 120),
    referral_code: clean(body.referral_code || body.ref || body.referral, 40).toUpperCase(),
    landing_path: clean(body.landing_path || "/", 300),
    referrer: clean(body.referrer, 500)
  };
}

function resolveReferrer(userId, referralCode) {
  if (!referralCode || !tableExists("users")) return null;
  const ref = db.prepare("SELECT id FROM users WHERE referral_code=?").get(referralCode);
  return ref && Number(ref.id) !== Number(userId) ? Number(ref.id) : null;
}

function bindCustomerAttribution(userId, raw) {
  const a = normalizeAttribution(raw);
  const referrerUserId = resolveReferrer(userId, a.referral_code);
  const existing = db.prepare("SELECT user_id FROM marketing_customer_attribution WHERE user_id=?").get(userId);

  if (!existing) {
    db.prepare(`
      INSERT INTO marketing_customer_attribution(
        user_id,visitor_id,first_source,first_medium,first_campaign,first_content,first_term,
        first_referral_code,first_referrer_user_id,last_source,last_medium,last_campaign,last_content,last_term,last_referral_code
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      userId,a.visitor_id,a.source,a.medium||null,a.campaign||null,a.content||null,a.term||null,
      a.referral_code||null,referrerUserId,a.source,a.medium||null,a.campaign||null,a.content||null,a.term||null,a.referral_code||null
    );
  } else {
    db.prepare(`
      UPDATE marketing_customer_attribution SET
        visitor_id=?,last_source=?,last_medium=?,last_campaign=?,last_content=?,last_term=?,last_referral_code=?,last_touch_at=CURRENT_TIMESTAMP
      WHERE user_id=?
    `).run(a.visitor_id,a.source,a.medium||null,a.campaign||null,a.content||null,a.term||null,a.referral_code||null,userId);
  }

  if (referrerUserId && tableExists("referrals")) {
    const already = db.prepare("SELECT id FROM referrals WHERE referred_user_id=?").get(userId);
    if (!already) {
      try {
        db.prepare("INSERT INTO referrals(referrer_user_id,referred_user_id,referral_code) VALUES(?,?,?)")
          .run(referrerUserId,userId,a.referral_code);
      } catch (_) {}
    }
  }
  return a;
}

function queueNotification(userId, title, message) {
  if (!tableExists("notifications")) return;
  try { db.prepare("INSERT INTO notifications(user_id,title,message) VALUES(?,?,?)").run(userId,title,message); }
  catch (_) {}
}

function applyReward(reward) {
  if (!reward || reward.status === "applied" || !tableExists("subscription_codes")) return false;
  const active = db.prepare(`
    SELECT id,expires_at FROM subscription_codes
    WHERE user_id=? AND status='used' AND expires_at IS NOT NULL AND datetime(expires_at)>datetime('now')
    ORDER BY datetime(expires_at) DESC,id DESC LIMIT 1
  `).get(reward.referrer_user_id);
  if (!active) return false;

  const raw = String(active.expires_at || "");
  const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  if (Number.isNaN(parsed.getTime())) return false;
  parsed.setUTCDate(parsed.getUTCDate() + Number(reward.reward_days || REFERRAL_REWARD_DAYS));

  const tx = db.transaction(() => {
    db.prepare("UPDATE subscription_codes SET expires_at=? WHERE id=?").run(parsed.toISOString(), active.id);
    db.prepare("UPDATE referral_rewards SET status='applied',applied_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'applied'").run(reward.id);
  });
  tx();
  queueNotification(reward.referrer_user_id,"Referral reward applied",`Thank you for referring a friend to WORLD TV. ${reward.reward_days} bonus subscription days were added to your active subscription.`);
  return true;
}

function syncReferralRewards() {
  if (!["referrals","orders"].every(tableExists)) return { created: 0, applied: 0 };
  const rows = db.prepare(`
    SELECT r.id AS referral_id,r.referrer_user_id,r.referred_user_id,
      (SELECT o.id FROM orders o WHERE o.user_id=r.referred_user_id AND o.status='paid' ORDER BY datetime(COALESCE(o.paid_at,o.created_at)) ASC,o.id ASC LIMIT 1) AS order_id
    FROM referrals r
    WHERE EXISTS(SELECT 1 FROM orders o WHERE o.user_id=r.referred_user_id AND o.status='paid')
      AND NOT EXISTS(SELECT 1 FROM referral_rewards rr WHERE rr.referral_id=r.id)
  `).all();

  let created = 0;
  for (const row of rows) {
    if (!row.order_id) continue;
    try {
      db.prepare(`INSERT INTO referral_rewards(referral_id,referrer_user_id,referred_user_id,order_id,reward_days,status) VALUES(?,?,?,?,?,'earned')`)
        .run(row.referral_id,row.referrer_user_id,row.referred_user_id,row.order_id,REFERRAL_REWARD_DAYS);
      created += 1;
      queueNotification(row.referrer_user_id,"You earned a referral reward",`Your friend completed a paid WORLD TV subscription. You earned ${REFERRAL_REWARD_DAYS} bonus subscription days.`);
    } catch (_) {}
  }

  let applied = 0;
  const earned = db.prepare("SELECT * FROM referral_rewards WHERE status='earned' ORDER BY id ASC LIMIT 100").all();
  for (const reward of earned) {
    try { if (applyReward(reward)) applied += 1; }
    catch (error) { console.error("Referral reward apply error:", error.message); }
  }
  return { created, applied };
}

function referralSummary(userId) {
  if (!tableExists("users")) return null;
  let user = db.prepare("SELECT referral_code FROM users WHERE id=?").get(userId);
  if (!user) return null;
  if (!user.referral_code) {
    let code;
    do { code = "WTV" + crypto.randomBytes(4).toString("hex").toUpperCase(); }
    while (db.prepare("SELECT 1 FROM users WHERE referral_code=?").get(code));
    db.prepare("UPDATE users SET referral_code=? WHERE id=?").run(code,userId);
    user.referral_code = code;
  }
  syncReferralRewards();
  const referrals = tableExists("referrals") ? db.prepare("SELECT COUNT(*) n FROM referrals WHERE referrer_user_id=?").get(userId).n : 0;
  const paid = tableExists("referrals") && tableExists("orders") ? db.prepare(`SELECT COUNT(DISTINCT r.referred_user_id) n FROM referrals r WHERE r.referrer_user_id=? AND EXISTS(SELECT 1 FROM orders o WHERE o.user_id=r.referred_user_id AND o.status='paid')`).get(userId).n : 0;
  const rewards = db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status='earned' THEN 1 ELSE 0 END) waiting,SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) applied,SUM(CASE WHEN status='applied' THEN reward_days ELSE 0 END) days_applied FROM referral_rewards WHERE referrer_user_id=?`).get(userId);
  return {
    referral_code: user.referral_code,
    referral_link: `${PUBLIC_BASE_URL}/register.html?ref=${encodeURIComponent(user.referral_code)}&utm_source=referral&utm_medium=customer&utm_campaign=customer-referral`,
    referrals: Number(referrals || 0),
    paid_referrals: Number(paid || 0),
    reward_days: REFERRAL_REWARD_DAYS,
    rewards_earned: Number(rewards.total || 0),
    rewards_waiting: Number(rewards.waiting || 0),
    rewards_applied: Number(rewards.applied || 0),
    bonus_days_applied: Number(rewards.days_applied || 0)
  };
}

function getCampaignRows() {
  const visits = db.prepare(`SELECT source,COALESCE(medium,'') medium,COALESCE(campaign,'') campaign,COUNT(*) visits,COUNT(DISTINCT visitor_id) visitors FROM marketing_visits GROUP BY source,COALESCE(medium,''),COALESCE(campaign,'')`).all();
  const customers = db.prepare(`SELECT first_source source,COALESCE(first_medium,'') medium,COALESCE(first_campaign,'') campaign,COUNT(*) registrations,COUNT(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM orders o WHERE o.user_id=a.user_id AND o.status='paid') THEN a.user_id END) paid_customers FROM marketing_customer_attribution a GROUP BY first_source,COALESCE(first_medium,''),COALESCE(first_campaign,'')`).all();
  const revenue = tableExists("orders") ? db.prepare(`SELECT a.first_source source,COALESCE(a.first_medium,'') medium,COALESCE(a.first_campaign,'') campaign,COUNT(o.id) paid_orders,SUM(CASE WHEN UPPER(COALESCE(o.currency,'GHS'))='USD' THEN o.amount_pesewas/100.0 ELSE 0 END) revenue_usd,SUM(CASE WHEN UPPER(COALESCE(o.currency,'GHS'))='GHS' THEN o.amount_pesewas/100.0 ELSE 0 END) revenue_ghs FROM marketing_customer_attribution a JOIN orders o ON o.user_id=a.user_id AND o.status='paid' GROUP BY a.first_source,COALESCE(a.first_medium,''),COALESCE(a.first_campaign,'')`).all() : [];
  const map = new Map();
  const key = r => `${r.source || 'direct'}\u0001${r.medium || ''}\u0001${r.campaign || ''}`;
  const ensure = r => { const k=key(r); if(!map.has(k)) map.set(k,{source:r.source||"direct",medium:r.medium||"",campaign:r.campaign||"",visits:0,visitors:0,registrations:0,paid_customers:0,paid_orders:0,revenue_usd:0,revenue_ghs:0}); return map.get(k); };
  visits.forEach(r=>Object.assign(ensure(r),{visits:Number(r.visits||0),visitors:Number(r.visitors||0)}));
  customers.forEach(r=>Object.assign(ensure(r),{registrations:Number(r.registrations||0),paid_customers:Number(r.paid_customers||0)}));
  revenue.forEach(r=>Object.assign(ensure(r),{paid_orders:Number(r.paid_orders||0),revenue_usd:Number(r.revenue_usd||0),revenue_ghs:Number(r.revenue_ghs||0)}));
  return [...map.values()].sort((a,b)=>b.paid_customers-a.paid_customers || b.registrations-a.registrations || b.visits-a.visits);
}

function getAdminSummary() {
  syncReferralRewards();
  const visits = db.prepare("SELECT COUNT(*) n,COUNT(DISTINCT visitor_id) visitors FROM marketing_visits").get();
  const attributed = db.prepare("SELECT COUNT(*) n FROM marketing_customer_attribution").get().n;
  const paid = tableExists("orders") ? db.prepare(`SELECT COUNT(DISTINCT a.user_id) n FROM marketing_customer_attribution a WHERE EXISTS(SELECT 1 FROM orders o WHERE o.user_id=a.user_id AND o.status='paid')`).get().n : 0;
  const refs = tableExists("referrals") ? db.prepare("SELECT COUNT(*) n FROM referrals").get().n : 0;
  const paidRefs = tableExists("referrals") && tableExists("orders") ? db.prepare(`SELECT COUNT(DISTINCT r.referred_user_id) n FROM referrals r WHERE EXISTS(SELECT 1 FROM orders o WHERE o.user_id=r.referred_user_id AND o.status='paid')`).get().n : 0;
  const rewards = db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status='earned' THEN 1 ELSE 0 END) waiting,SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) applied,SUM(CASE WHEN status='applied' THEN reward_days ELSE 0 END) days FROM referral_rewards`).get();
  return { tracked_clicks:Number(visits.n||0),tracked_visitors:Number(visits.visitors||0),attributed_customers:Number(attributed||0),paid_attributed_customers:Number(paid||0),referrals:Number(refs||0),paid_referrals:Number(paidRefs||0),rewards:{total:Number(rewards.total||0),waiting:Number(rewards.waiting||0),applied:Number(rewards.applied||0),bonus_days_applied:Number(rewards.days||0)},referral_reward_days:REFERRAL_REWARD_DAYS,base_url:PUBLIC_BASE_URL };
}

function getReferralRows() {
  if (!tableExists("referrals")) return [];
  syncReferralRewards();
  return db.prepare(`SELECT r.id,r.referral_code,r.created_at,r.referrer_user_id,r.referred_user_id,a.name referrer_name,a.email referrer_email,b.name referred_name,b.email referred_email,CASE WHEN EXISTS(SELECT 1 FROM orders o WHERE o.user_id=r.referred_user_id AND o.status='paid') THEN 1 ELSE 0 END paid,rr.id reward_id,rr.reward_days,rr.status reward_status,rr.applied_at,m.first_source,m.first_medium,m.first_campaign FROM referrals r JOIN users a ON a.id=r.referrer_user_id JOIN users b ON b.id=r.referred_user_id LEFT JOIN referral_rewards rr ON rr.referral_id=r.id LEFT JOIN marketing_customer_attribution m ON m.user_id=r.referred_user_id ORDER BY r.id DESC LIMIT 500`).all();
}

function installRoutes(app, expressLib) {
  const json = expressLib.json({ limit: "100kb" });
  app.post("/api/marketing/visit", json, (req,res) => {
    try { const a=normalizeAttribution(req.body); db.prepare(`INSERT INTO marketing_visits(visitor_id,source,medium,campaign,content,term,referral_code,landing_path,referrer) VALUES(?,?,?,?,?,?,?,?,?)`).run(a.visitor_id,a.source,a.medium||null,a.campaign||null,a.content||null,a.term||null,a.referral_code||null,a.landing_path,a.referrer||null); res.json({ok:true}); }
    catch (error) { res.status(500).json({ error:"Could not record campaign visit" }); }
  });
  app.post("/api/customer/marketing-attribution", json, customerOnly, (req,res) => {
    try { const a=bindCustomerAttribution(req.customer.userId,req.body); res.json({ok:true,attribution:a,referral:referralSummary(req.customer.userId)}); }
    catch (error) { res.status(500).json({ error:"Could not save campaign attribution" }); }
  });
  app.get("/api/customer/referral", customerOnly, (req,res) => { try { res.json(referralSummary(req.customer.userId)); } catch(error) { res.status(500).json({error:error.message}); } });
  app.get("/api/admin/marketing/summary", adminOnly, (req,res) => { try { res.json(getAdminSummary()); } catch(error) { res.status(500).json({error:error.message}); } });
  app.get("/api/admin/marketing/campaigns", adminOnly, (req,res) => { try { res.json(getCampaignRows()); } catch(error) { res.status(500).json({error:error.message}); } });
  app.get("/api/admin/marketing/referrals", adminOnly, (req,res) => { try { res.json(getReferralRows()); } catch(error) { res.status(500).json({error:error.message}); } });
  app.post("/api/admin/marketing/rewards/:id/apply", adminOnly, (req,res) => {
    try { const reward=db.prepare("SELECT * FROM referral_rewards WHERE id=?").get(Number(req.params.id)); if(!reward)return res.status(404).json({error:"Reward not found"}); if(reward.status==="applied")return res.json({ok:true,already_applied:true}); if(!applyReward(reward))return res.status(409).json({error:"The referrer does not have an active subscription yet. The reward remains earned and will apply automatically later."}); res.json({ok:true}); }
    catch(error){res.status(500).json({error:error.message});}
  });
  app.post("/api/admin/marketing/sync", adminOnly, (req,res) => { try { res.json({ok:true,...syncReferralRewards()}); } catch(error) { res.status(500).json({error:error.message}); } });
}

const expressPath = require.resolve("express");
const originalExpress = require(expressPath);
function wrappedExpress(...args) { const app=originalExpress(...args); installRoutes(app,originalExpress); return app; }
Object.assign(wrappedExpress, originalExpress);
Object.setPrototypeOf(wrappedExpress, Object.getPrototypeOf(originalExpress));
require.cache[expressPath].exports = wrappedExpress;

setTimeout(()=>{try{syncReferralRewards()}catch(error){console.error("Referral reward startup sync error:",error.message)}},15000).unref();
setInterval(()=>{try{syncReferralRewards()}catch(error){console.error("Referral reward sync error:",error.message)}},5*60*1000).unref();

module.exports = { syncReferralRewards, getAdminSummary, getCampaignRows, referralSummary };
