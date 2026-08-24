require("dotenv").config();
const { getExchangeRates } = require('./exchange-rates');
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;
const SUBSCRIPTION_PROMO_USD = 23;
const CUSTOMER_SESSION_DAYS = 30;
const db = new Database(path.join(__dirname, 'data', 'worldtv.sqlite'));
const adminSessions = new Map();

const uploadDir = path.join(__dirname, "public", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req,file,cb)=>cb(null,uploadDir),
  filename: (req,file,cb)=>{
    const ext = path.extname(file.originalname || "").toLowerCase().replace(/[^.a-z0-9]/g,"");
    cb(null, Date.now()+"-"+crypto.randomBytes(6).toString("hex")+(ext||".jpg"));
  }
});
const upload = multer({
  storage,
  limits:{fileSize:4*1024*1024},
  fileFilter:(req,file,cb)=>{
    if(!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(new Error("Only image files are allowed"));
    cb(null,true);
  }
});

db.pragma("journal_mode=WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS plans(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 price_ghs INTEGER NOT NULL,
 price_usd REAL NOT NULL DEFAULT 23,
 duration_days INTEGER NOT NULL,
 active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS subscription_codes(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 code TEXT NOT NULL UNIQUE,
 plan_id INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'unused',
 user_id INTEGER,
 expires_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 reference TEXT NOT NULL UNIQUE,
 user_id INTEGER NOT NULL,
 plan_id INTEGER NOT NULL,
 amount_pesewas INTEGER NOT NULL,
 currency TEXT NOT NULL DEFAULT 'GHS',
 status TEXT NOT NULL DEFAULT 'pending',
 code_id INTEGER,
 paid_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customer_sessions(
 token_hash TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL,
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 price_ghs REAL,
 category TEXT NOT NULL DEFAULT 'General',
 image_url TEXT,
 stock_status TEXT NOT NULL DEFAULT 'in_stock',
 whatsapp_number TEXT,
 featured INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS expenses(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  amount_ghs REAL NOT NULL,
  description TEXT,
  expense_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS daily_stock_records(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  record_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);


db.exec(`
CREATE TABLE IF NOT EXISTS promotions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 message TEXT NOT NULL DEFAULT '',
 button_text TEXT,
 button_url TEXT,
 active INTEGER NOT NULL DEFAULT 1,
 starts_at TEXT,
 ends_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS services(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 icon TEXT NOT NULL DEFAULT '',
 title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 sort_order INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS support_messages(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT,
 phone TEXT,
 subject TEXT NOT NULL,
 message TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'new',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS site_settings(
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL DEFAULT ''
);
`);

// ============ LIVE ANALYTICS V2 TABLES ============
// V2 starts with clean analytics data once. It does NOT touch customers, codes,
// orders, subscriptions, products or any other business tables.
db.exec(`
CREATE TABLE IF NOT EXISTS analytics_v2_visitors(
  visitor_id TEXT PRIMARY KEY,
  country TEXT NOT NULL DEFAULT 'Unknown',
  country_code TEXT NOT NULL DEFAULT '',
  first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_path TEXT NOT NULL DEFAULT '/',
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_analytics_v2_visitors_last_seen
  ON analytics_v2_visitors(last_seen);

CREATE TABLE IF NOT EXISTS analytics_v2_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  page_path TEXT NOT NULL DEFAULT '/',
  referrer TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'Unknown',
  country_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_analytics_v2_events_visitor
  ON analytics_v2_events(visitor_id);
CREATE INDEX IF NOT EXISTS idx_analytics_v2_events_type
  ON analytics_v2_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_v2_events_created
  ON analytics_v2_events(created_at);

CREATE TABLE IF NOT EXISTS analytics_v2_presence(
  visitor_id TEXT PRIMARY KEY,
  last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  page_path TEXT NOT NULL DEFAULT '/',
  country TEXT NOT NULL DEFAULT 'Unknown',
  country_code TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_analytics_v2_presence_last_seen
  ON analytics_v2_presence(last_seen);
`);

const analyticsV2Migration = db.prepare(
  "SELECT value FROM site_settings WHERE key='analytics_v2_initialized'"
).get();

if(!analyticsV2Migration){
  const initializeAnalyticsV2 = db.transaction(()=>{
    // Delete only the old/broken analytics system.
    db.exec(`
      DROP TABLE IF EXISTS analytics_events;
      DROP TABLE IF EXISTS analytics_visitors;
      DELETE FROM analytics_v2_events;
      DELETE FROM analytics_v2_presence;
      DELETE FROM analytics_v2_visitors;
    `);

    db.prepare(`
      INSERT INTO site_settings(key,value)
      VALUES('analytics_v2_initialized',CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `).run();
  });
  initializeAnalyticsV2();
}

// IP -> country cache. Known results live for 24h; failed lookups retry sooner.
const analyticsGeoCache = new Map();
const ANALYTICS_GEO_OK_TTL = 24 * 60 * 60 * 1000;
const ANALYTICS_GEO_FAIL_TTL = 5 * 60 * 1000;
const ANALYTICS_ONLINE_WINDOW_SECONDS = 60;


// Keep the existing GHS column for historical reports while subscription
// checkout uses one USD base price worldwide. This migration only adds and
// backfills the new price field; it does not recreate any business table.
try{db.prepare("ALTER TABLE plans ADD COLUMN price_usd REAL").run();}catch(e){}

if(!db.prepare("SELECT id FROM plans WHERE name=?").get("1 Year")){
  db.prepare("INSERT INTO plans(name,price_ghs,price_usd,duration_days) VALUES(?,?,?,?)")
    .run("1 Year",299,SUBSCRIPTION_PROMO_USD,365);
}
db.prepare("UPDATE plans SET price_usd=? WHERE price_usd IS NULL OR price_usd<=0")
  .run(SUBSCRIPTION_PROMO_USD);


try{db.prepare("ALTER TABLE users ADD COLUMN referral_code TEXT").run();}catch(e){}
try{db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)").run();}catch(e){}
function ensureReferralCode(userId){
 let u=db.prepare("SELECT referral_code FROM users WHERE id=?").get(userId);
 if(u?.referral_code) return u.referral_code;
 let code;
 do{code="WTV"+crypto.randomBytes(4).toString("hex").toUpperCase()}while(db.prepare("SELECT 1 FROM users WHERE referral_code=?").get(code));
 db.prepare("UPDATE users SET referral_code=? WHERE id=?").run(code,userId);
 return code;
}

app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:true}));

// Analytics must run BEFORE express.static so real page loads are counted.
app.use(recordAnalyticsV2);
app.use(injectAnalyticsScriptV2);
app.use(express.static(__dirname));

app.get("/reseller", (req,res) => res.sendFile(__dirname + "/reseller.html"));
app.get("/admin", (req,res) => res.sendFile(__dirname + "/admin.html"));

/* Basic production hardening */
app.disable("x-powered-by");
app.use((req,res,next)=>{
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("X-Frame-Options","DENY");
  res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  next();
});

const loginAttempts=new Map();
function loginRateLimit(req,res,next){
  const key=req.ip+":"+(req.path||"");
  const now=Date.now();
  const rec=loginAttempts.get(key)||{count:0,start:now};
  if(now-rec.start>15*60*1000){rec.count=0;rec.start=now}
  rec.count++;
  loginAttempts.set(key,rec);
  if(rec.count>12) return res.status(429).json({error:"Too many login attempts. Please try again later."});
  next();
}


function adminOnly(req,res,next){
  const token=req.headers["x-admin-token"] || req.query.token;

  if(!token){
    return res.status(401).json({error:"Admin authentication required"});
  }

  const expected=crypto
    .createHmac("sha256",process.env.ADMIN_PASSWORD)
    .update(process.env.ADMIN_EMAIL)
    .digest("hex");

  if(token!==expected){
    return res.status(401).json({error:"Admin authentication required"});
  }

  next();
}
db.exec(`CREATE TABLE IF NOT EXISTS resellers(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,phone TEXT,password_hash TEXT NOT NULL,commission_percent REAL NOT NULL DEFAULT 10,status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);CREATE TABLE IF NOT EXISTS reseller_sales(id INTEGER PRIMARY KEY AUTOINCREMENT,reseller_id INTEGER NOT NULL,customer_id INTEGER NOT NULL,plan_id INTEGER NOT NULL,amount_ghs REAL NOT NULL,commission_ghs REAL NOT NULL,status TEXT NOT NULL DEFAULT 'completed',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);CREATE TABLE IF NOT EXISTS reseller_payouts(id INTEGER PRIMARY KEY AUTOINCREMENT,reseller_id INTEGER NOT NULL,amount_ghs REAL NOT NULL,status TEXT NOT NULL DEFAULT 'pending',payout_date TEXT,notes TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);CREATE TABLE IF NOT EXISTS reseller_code_allocation(id INTEGER PRIMARY KEY AUTOINCREMENT,reseller_id INTEGER NOT NULL UNIQUE,allocated_count INTEGER NOT NULL DEFAULT 0,used_count INTEGER NOT NULL DEFAULT 0,available_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);

// Reseller Management API
app.get("/api/admin/resellers", adminOnly, (req,res) => {
  const resellers = db.prepare(`
    SELECT r.id, r.name, r.email, r.phone, r.commission_percent, r.status, r.created_at,
           COUNT(DISTINCT rs.id) as total_sales,
           COALESCE(SUM(rs.commission_ghs), 0) as total_commissions,
           COALESCE(SUM(CASE WHEN rp.status='pending' THEN rp.amount_ghs ELSE 0 END), 0) as pending_payout
    FROM resellers r
    LEFT JOIN reseller_sales rs ON rs.reseller_id = r.id
    LEFT JOIN reseller_payouts rp ON rp.reseller_id = r.id
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `).all();
  res.json(resellers);
});

app.post("/api/admin/resellers", adminOnly, async (req,res) => {
  const { name, email, phone, commission_percent, password } = req.body || {};
  
  if (!name || !email || !commission_percent || !password) {
    return res.status(400).json({ error: "Name, email, commission, and password required" });
  }
  
  try {
    const hash = await bcrypt.hash(String(password), 12);
    const result = db.prepare(
      "INSERT INTO resellers(name, email, phone, commission_percent, password_hash, status) VALUES(?, ?, ?, ?, ?, 'active')"
    ).run(
      String(name).trim(),
      String(email).trim().toLowerCase(),
      String(phone || '').trim(),
      Number(commission_percent),
      hash
    );
    
    audit("reseller_created", "reseller", result.lastInsertRowid, `${name} - ${email}`);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/resellers/:id", adminOnly, (req,res) => {
  const reseller = db.prepare(
    "SELECT id, name, email, phone, commission_percent, status, created_at, updated_at FROM resellers WHERE id=?"
  ).get(req.params.id);

  if (!reseller) return res.status(404).json({ error: "Reseller not found" });

  const sales = db.prepare(`
    SELECT rs.id, rs.customer_id, u.name as customer_name, u.email as customer_email,
           rs.plan_id, p.name as plan_name, rs.amount_ghs, rs.commission_ghs, rs.status, rs.created_at
    FROM reseller_sales rs
    LEFT JOIN users u ON u.id = rs.customer_id
    LEFT JOIN plans p ON p.id = rs.plan_id
    WHERE rs.reseller_id = ?
    ORDER BY rs.created_at DESC
  `).all(req.params.id);

  const payouts = db.prepare(
    "SELECT id, reseller_id, amount_ghs, status, payout_date, notes, created_at FROM reseller_payouts WHERE reseller_id=? ORDER BY created_at DESC"
  ).all(req.params.id);

  res.json({ reseller, sales, payouts });
});

app.post("/api/admin/resellers/:id/allocate-codes", adminOnly, (req,res) => {
  const id = req.params.id;
  const { count } = req.body || {};
  const addCount = Number(count);

  if (!Number.isFinite(addCount) || addCount <= 0) {
    return res.status(400).json({ error: "A positive code count is required" });
  }

  const reseller = db.prepare("SELECT id FROM resellers WHERE id=?").get(id);
  if (!reseller) return res.status(404).json({ error: "Reseller not found" });

  try {
    const existing = db.prepare("SELECT * FROM reseller_code_allocation WHERE reseller_id=?").get(id);

    if (existing) {
      db.prepare(`
        UPDATE reseller_code_allocation
        SET allocated_count = allocated_count + ?,
            available_count = available_count + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE reseller_id = ?
      `).run(addCount, addCount, id);
    } else {
      db.prepare(`
        INSERT INTO reseller_code_allocation(reseller_id, allocated_count, used_count, available_count)
        VALUES(?, ?, 0, ?)
      `).run(id, addCount, addCount);
    }

    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/resellers/:id/code-quota", adminOnly, (req,res) => {
  const id = req.params.id;

  const reseller = db.prepare("SELECT id FROM resellers WHERE id=?").get(id);
  if (!reseller) return res.status(404).json({ error: "Reseller not found" });

  const quota = db.prepare(
    "SELECT allocated_count, used_count, available_count FROM reseller_code_allocation WHERE reseller_id=?"
  ).get(id) || { allocated_count: 0, used_count: 0, available_count: 0 };

  const codeStatus = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM subscription_codes
    GROUP BY status
  `).all();

  res.json({ quota, codeStatus });
});

app.get("/api/admin/resellers-with-quotas", adminOnly, (req,res) => {
  const resellers = db.prepare(`
    SELECT r.id, r.name, r.email, r.phone, r.commission_percent, r.status, r.created_at,
           COALESCE(rca.allocated_count, 0) as allocated_codes,
           COALESCE(rca.used_count, 0) as used_codes,
           COALESCE(rca.available_count, 0) as available_codes,
           COUNT(DISTINCT rs.id) as total_sales,
           COALESCE(SUM(rs.commission_ghs), 0) as total_commissions
    FROM resellers r
    LEFT JOIN reseller_code_allocation rca ON rca.reseller_id = r.id
    LEFT JOIN reseller_sales rs ON rs.reseller_id = r.id
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `).all();

  res.json(resellers);
});



// Reseller Authentication
// ============ RESELLER SESSION STORE WITH EXPIRATION ============
const resellerSessions = new Map(); // token -> { resellerId, createdAt, expiresAt }
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Clean up expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of resellerSessions.entries()) {
    if (session.expiresAt < now) {
      resellerSessions.delete(token);
    }
  }
}, 60 * 60 * 1000); // Every hour

// Middleware to validate reseller token
function resellerOnly(req, res, next) {
  const token = req.headers['x-reseller-token'];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  
  const session = resellerSessions.get(token);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  
  // Check if session expired
  if (session.expiresAt < Date.now()) {
    resellerSessions.delete(token);
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
  
  req.resellerId = session.resellerId;
  next();
}

// ============ RESELLER LOGIN ============
app.post("/api/reseller/login", async (req, res) => {
  const { email, password } = req.body || {};
  
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }
  
  try {
    const reseller = db.prepare("SELECT id, name, email, password_hash FROM resellers WHERE email = ? AND status = 'active'").get(email.toLowerCase());
    
    if (!reseller) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    
    const passwordMatch = await bcrypt.compare(password, reseller.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    
    // Generate token and store session with expiration
    const token = require('crypto').randomBytes(32).toString('hex');
    const now = Date.now();
    resellerSessions.set(token, { 
      resellerId: reseller.id, 
      createdAt: now,
      expiresAt: now + SESSION_DURATION_MS
    });
    
    res.json({ ok: true, token, resellerId: reseller.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ RESELLER DASHBOARD ============
app.get("/api/reseller/dashboard", resellerOnly, (req, res) => {
  try {
    const reseller = db.prepare("SELECT id, name, email FROM resellers WHERE id = ?").get(req.resellerId);
    if (!reseller) return res.status(401).json({ error: "Unauthorized" });
    
    const quota = db.prepare(
      "SELECT allocated_count, used_count, available_count FROM reseller_code_allocation WHERE reseller_id = ?"
    ).get(req.resellerId) || { allocated_count: 0, used_count: 0, available_count: 0 };
    
    const codes = db.prepare(
      "SELECT code, status, created_at, used_at FROM subscription_codes WHERE reseller_id = ? ORDER BY created_at DESC LIMIT 100"
    ).all(req.resellerId);
    
    res.json({ reseller, quota, codes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ RESELLER GENERATE CODES ============
app.post("/api/reseller/generate-codes", resellerOnly, (req, res) => {
  const { count } = req.body || {};
  const genCount = Number(count);
  
  if (!Number.isFinite(genCount) || genCount < 1 || genCount > 1000) {
    return res.status(400).json({ error: "Valid count required (1-1000)" });
  }
  
  try {
    const reseller = db.prepare("SELECT id FROM resellers WHERE id = ?").get(req.resellerId);
    if (!reseller) return res.status(401).json({ error: "Unauthorized" });
    
    const quota = db.prepare(
      "SELECT available_count FROM reseller_code_allocation WHERE reseller_id = ?"
    ).get(req.resellerId);
    
    if (!quota || quota.available_count < genCount) {
      const available = quota ? quota.available_count : 0;
      return res.status(400).json({ error: `Not enough codes available. You have ${available} codes available. Contact admin to allocate more.` });
    }
    
    // Generate codes
    const generated = [];
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    
    // Use a transaction for atomicity
    const insertStmt = db.prepare("INSERT INTO subscription_codes(code, status, reseller_id) VALUES(?, 'active', ?)");
    const updateStmt = db.prepare("UPDATE reseller_code_allocation SET available_count = available_count - ? WHERE reseller_id = ?");
    
    const transaction = db.transaction(() => {
      for (let i = 0; i < genCount; i++) {
        let code = '';
        for (let j = 0; j < 8; j++) {
          code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        insertStmt.run(code, req.resellerId);
        generated.push(code);
      }
      updateStmt.run(genCount, req.resellerId);
    });
    
    transaction();
    
    res.json({ ok: true, generated, count: genCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ RESELLER LOGOUT (OPTIONAL) ============
app.post("/api/reseller/logout", resellerOnly, (req, res) => {
  const token = req.headers['x-reseller-token'];
  if (token) {
    resellerSessions.delete(token);
  }
  res.json({ ok: true });
});


app.get("/api/health",(req,res)=>res.json({ok:true,service:"World TV"}));


// ============ LIVE ANALYTICS V2 ============

function readCookie(req, name){
  const raw = String(req.headers.cookie || "");
  for(const part of raw.split(";")){
    const i = part.indexOf("=");
    if(i < 0) continue;
    const key = part.slice(0,i).trim();
    if(key !== name) continue;
    try { return decodeURIComponent(part.slice(i+1).trim()); }
    catch(e){ return part.slice(i+1).trim(); }
  }
  return "";
}

function analyticsVisitorId(req, res){
  let visitorId = readCookie(req, "wtv_visitor_v2");
  if(!/^[a-f0-9]{32}$/i.test(visitorId)){
    visitorId = crypto.randomBytes(16).toString("hex");
    if(res && !res.headersSent){
      res.cookie("wtv_visitor_v2", visitorId, {
        maxAge: 365 * 24 * 60 * 60 * 1000,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        httpOnly: true
      });
    }
  }
  return visitorId;
}

function sanitizeAnalyticsPath(value){
  const s = String(value || "/").split("?")[0].split("#")[0];
  if(!s.startsWith("/")) return "/";
  return s.slice(0, 500) || "/";
}

function isAnalyticsBot(req){
  const ua = String(req.headers["user-agent"] || "");
  return /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|discordbot|preview|headless|lighthouse|pagespeed|uptimerobot|pingdom|monitoring/i.test(ua);
}

function shouldTrackAnalyticsPage(req){
  if(req.method !== "GET") return false;

  const pathname = sanitizeAnalyticsPath(req.path || "/");
  if(
    pathname.startsWith("/api/") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/reseller") ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/public/") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/favicon.ico"
  ) return false;

  const purpose = String(req.headers["purpose"] || req.headers["sec-purpose"] || "");
  if(/prefetch|prerender/i.test(purpose)) return false;
  if(isAnalyticsBot(req)) return false;

  const ext = path.extname(pathname).toLowerCase();
  if(ext && ext !== ".html" && ext !== ".htm") return false;

  const accept = String(req.headers.accept || "");
  if(pathname !== "/" && !ext && !accept.includes("text/html")) return false;

  return true;
}

function normalizeAnalyticsIp(raw){
  let ip = String(raw || "").trim();
  if(!ip) return "";
  if(ip.startsWith("::ffff:")) ip = ip.slice(7);
  if(/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.split(":")[0];
  if(ip.startsWith("[") && ip.includes("]")) ip = ip.slice(1, ip.indexOf("]"));
  return ip;
}

function isPublicAnalyticsIp(ip){
  ip = normalizeAnalyticsIp(ip);
  if(!ip) return false;

  if(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)){
    const p = ip.split(".").map(Number);
    if(p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    if(p[0] === 10 || p[0] === 127 || p[0] === 0) return false;
    if(p[0] === 169 && p[1] === 254) return false;
    if(p[0] === 192 && p[1] === 168) return false;
    if(p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
    if(p[0] === 100 && p[1] >= 64 && p[1] <= 127) return false;
    return true;
  }

  const low = ip.toLowerCase();
  if(low === "::1" || low === "::") return false;
  if(low.startsWith("fc") || low.startsWith("fd") || /^fe[89ab]/.test(low)) return false;
  return low.includes(":");
}

function getAnalyticsClientIp(req){
  const candidates = [];

  const cfIp = req.headers["cf-connecting-ip"];
  if(cfIp) candidates.push(cfIp);

  const trueClientIp = req.headers["true-client-ip"];
  if(trueClientIp) candidates.push(trueClientIp);

  const forwarded = req.headers["x-forwarded-for"];
  if(forwarded){
    String(forwarded).split(",").forEach(x => candidates.push(x));
  }

  const realIp = req.headers["x-real-ip"];
  if(realIp) candidates.push(realIp);

  if(req.socket && req.socket.remoteAddress) candidates.push(req.socket.remoteAddress);

  for(const raw of candidates){
    const ip = normalizeAnalyticsIp(raw);
    if(isPublicAnalyticsIp(ip)) return ip;
  }
  return "";
}

function countryNameFromCode(code){
  code = String(code || "").trim().toUpperCase();
  if(!/^[A-Z]{2}$/.test(code) || ["XX","T1"].includes(code)) return "";
  try {
    return new Intl.DisplayNames(["en"], {type:"region"}).of(code) || "";
  } catch(e) {
    return "";
  }
}

function analyticsGeoFromHeaders(req){
  const code = String(
    req.headers["cf-ipcountry"] ||
    req.headers["x-country-code"] ||
    req.headers["x-vercel-ip-country"] ||
    req.headers["x-appengine-country"] ||
    ""
  ).trim().toUpperCase();

  const country = countryNameFromCode(code);
  if(country) return {country, country_code:code};
  return null;
}

async function resolveAnalyticsGeo(req){
  const headerGeo = analyticsGeoFromHeaders(req);
  if(headerGeo) return headerGeo;

  const ip = getAnalyticsClientIp(req);
  if(!ip) return {country:"Unknown", country_code:""};

  const cached = analyticsGeoCache.get(ip);
  if(cached && cached.expiresAt > Date.now()){
    return {country:cached.country, country_code:cached.country_code};
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), 1500);
    const geoRes = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: controller.signal,
      headers: {"Accept":"application/json"}
    });
    clearTimeout(timer);

    if(!geoRes.ok) throw new Error(`Geo lookup failed: ${geoRes.status}`);
    const geoData = await geoRes.json();

    const country = String(geoData?.country || "").trim();
    const country_code = String(geoData?.country_code || "").trim().toUpperCase();

    if(country && /^[A-Z]{2}$/.test(country_code)){
      analyticsGeoCache.set(ip, {
        country,
        country_code,
        expiresAt: Date.now() + ANALYTICS_GEO_OK_TTL
      });
      return {country, country_code};
    }
  } catch(e) {
    // Analytics must never block or break the website.
  }

  analyticsGeoCache.set(ip, {
    country:"Unknown",
    country_code:"",
    expiresAt: Date.now() + ANALYTICS_GEO_FAIL_TTL
  });
  return {country:"Unknown", country_code:""};
}

function upsertAnalyticsVisitorV2(visitorId, geo, pagePath, userAgent){
  const existing = db.prepare(
    "SELECT visitor_id FROM analytics_v2_visitors WHERE visitor_id=?"
  ).get(visitorId);

  const country = geo?.country || "Unknown";
  const countryCode = geo?.country_code || "";

  if(existing){
    db.prepare(`
      UPDATE analytics_v2_visitors
      SET last_seen=CURRENT_TIMESTAMP,
          last_path=?,
          user_agent=?,
          country=CASE WHEN ? <> 'Unknown' THEN ? ELSE country END,
          country_code=CASE WHEN ? <> '' THEN ? ELSE country_code END
      WHERE visitor_id=?
    `).run(
      pagePath,
      String(userAgent || "").slice(0,500),
      country, country,
      countryCode, countryCode,
      visitorId
    );
  } else {
    db.prepare(`
      INSERT INTO analytics_v2_visitors(
        visitor_id,country,country_code,last_path,user_agent
      ) VALUES(?,?,?,?,?)
    `).run(
      visitorId,
      country,
      countryCode,
      pagePath,
      String(userAgent || "").slice(0,500)
    );
  }
}

function touchAnalyticsPresenceV2(visitorId, geo, pagePath){
  const country = geo?.country || "Unknown";
  const countryCode = geo?.country_code || "";

  db.prepare(`
    INSERT INTO analytics_v2_presence(
      visitor_id,last_seen,page_path,country,country_code
    ) VALUES(?,CURRENT_TIMESTAMP,?,?,?)
    ON CONFLICT(visitor_id) DO UPDATE SET
      last_seen=CURRENT_TIMESTAMP,
      page_path=excluded.page_path,
      country=CASE WHEN excluded.country <> 'Unknown' THEN excluded.country ELSE analytics_v2_presence.country END,
      country_code=CASE WHEN excluded.country_code <> '' THEN excluded.country_code ELSE analytics_v2_presence.country_code END
  `).run(visitorId, pagePath, country, countryCode);
}

function insertAnalyticsEventV2(visitorId, eventType, pagePath, referrer, geo){
  db.prepare(`
    INSERT INTO analytics_v2_events(
      visitor_id,event_type,page_path,referrer,country,country_code
    ) VALUES(?,?,?,?,?,?)
  `).run(
    visitorId,
    eventType,
    pagePath,
    String(referrer || "").slice(0,1000),
    geo?.country || "Unknown",
    geo?.country_code || ""
  );
}

async function recordAnalyticsEventV2(req, res, eventType, pagePath){
  if(isAnalyticsBot(req)) return null;

  const visitorId = analyticsVisitorId(req, res);
  const cleanPath = sanitizeAnalyticsPath(pagePath || req.path || "/");
  const geo = await resolveAnalyticsGeo(req);

  upsertAnalyticsVisitorV2(
    visitorId,
    geo,
    cleanPath,
    req.headers["user-agent"] || ""
  );
  touchAnalyticsPresenceV2(visitorId, geo, cleanPath);
  insertAnalyticsEventV2(
    visitorId,
    eventType,
    cleanPath,
    req.get("referrer") || "",
    geo
  );

  return {visitorId, geo};
}

// Runs before express.static. The request continues immediately; analytics records
// in the background so a slow country lookup never delays the website.
function recordAnalyticsV2(req, res, next){
  if(!shouldTrackAnalyticsPage(req)) return next();

  const visitorId = analyticsVisitorId(req, res);
  const pagePath = sanitizeAnalyticsPath(req.path || "/");
  const eventType =
    pagePath === "/download.html" || pagePath === "/download"
      ? "download_page_view"
      : "page_view";
  const userAgent = req.headers["user-agent"] || "";
  const referrer = req.get("referrer") || "";

  next();

  resolveAnalyticsGeo(req)
    .then(geo=>{
      upsertAnalyticsVisitorV2(visitorId, geo, pagePath, userAgent);
      touchAnalyticsPresenceV2(visitorId, geo, pagePath);
      insertAnalyticsEventV2(visitorId, eventType, pagePath, referrer, geo);
    })
    .catch(err=>console.error("Analytics V2 page tracking error:", err.message));
}

// Adds the heartbeat script to every public HTML page, including pages that were
// created before Analytics V2. Admin and reseller pages are intentionally excluded.
function injectAnalyticsScriptV2(req, res, next){
  if(req.method !== "GET") return next();

  const pagePath = sanitizeAnalyticsPath(req.path || "/");
  if(
    pagePath.startsWith("/admin") ||
    pagePath.startsWith("/reseller") ||
    pagePath.startsWith("/api/") ||
    pagePath.startsWith("/assets/") ||
    pagePath.startsWith("/public/")
  ) return next();

  let relativeFile = "";
  if(pagePath === "/") relativeFile = "index.html";
  else if(/\.html?$/i.test(pagePath)) relativeFile = pagePath.replace(/^\/+/,"");
  else return next();

  const root = path.resolve(__dirname);
  const filePath = path.resolve(root, relativeFile);
  if(filePath !== root && !filePath.startsWith(root + path.sep)) return next();
  if(!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return next();

  fs.readFile(filePath, "utf8", (err, html)=>{
    if(err) return next();

    // Upgrade any old analytics.js reference to the V2 cache-busted URL.
    html = html.replace(
      /(["'])\/assets\/analytics\.js\1/gi,
      '$1/assets/analytics.js?v=2$1'
    );

    if(!/\/assets\/analytics\.js\?v=2/i.test(html)){
      const tag = '<script src="/assets/analytics.js?v=2"></script>';
      if(/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${tag}</body>`);
      else html += tag;
    }

    res.type("html").send(html);
  });
}

// Browser heartbeat. It updates Online Now but does NOT create page-view events.
app.post("/api/analytics/v2/heartbeat", async (req,res)=>{
  try {
    if(isAnalyticsBot(req)) return res.json({ok:true,ignored:true});

    const visitorId = analyticsVisitorId(req,res);
    const pagePath = sanitizeAnalyticsPath(req.body?.pagePath || "/");
    const geo = await resolveAnalyticsGeo(req);

    upsertAnalyticsVisitorV2(
      visitorId,
      geo,
      pagePath,
      req.headers["user-agent"] || ""
    );
    touchAnalyticsPresenceV2(visitorId, geo, pagePath);

    res.setHeader("Cache-Control","no-store");
    res.json({ok:true});
  } catch(e) {
    console.error("Analytics V2 heartbeat error:", e);
    res.status(500).json({error:"Analytics heartbeat failed"});
  }
});

app.get("/api/admin/analytics/v2/summary", adminOnly, (req,res)=>{
  try {
    const visitors_today = db.prepare(`
      SELECT COUNT(DISTINCT visitor_id) AS count
      FROM analytics_v2_events
      WHERE created_at >= datetime('now','start of day')
    `).get().count;

    const visitors_24h = db.prepare(`
      SELECT COUNT(DISTINCT visitor_id) AS count
      FROM analytics_v2_events
      WHERE created_at >= datetime('now','-24 hours')
    `).get().count;

    const total_unique_visitors = db.prepare(`
      SELECT COUNT(*) AS count FROM analytics_v2_visitors
    `).get().count;

    const total_page_views = db.prepare(`
      SELECT COUNT(*) AS count
      FROM analytics_v2_events
      WHERE event_type IN ('page_view','download_page_view')
    `).get().count;

    const online_now = db.prepare(`
      SELECT COUNT(*) AS count
      FROM analytics_v2_presence
      WHERE last_seen >= datetime('now', '-' || ? || ' seconds')
    `).get(ANALYTICS_ONLINE_WINDOW_SECONDS).count;

    const download_page_visits = db.prepare(`
      SELECT COUNT(DISTINCT visitor_id) AS count
      FROM analytics_v2_events
      WHERE event_type='download_page_view'
    `).get().count;

    const download_clicks = db.prepare(`
      SELECT COUNT(*) AS count
      FROM analytics_v2_events
      WHERE event_type='download_click'
    `).get().count;

    const unknown_locations = db.prepare(`
      SELECT COUNT(*) AS count
      FROM analytics_v2_visitors
      WHERE country='Unknown' OR country_code=''
    `).get().count;

    res.setHeader("Cache-Control","no-store");
    res.json({
      version:2,
      visitors_today,
      visitors_24h,
      total_unique_visitors,
      total_page_views,
      online_now,
      download_page_visits,
      download_clicks,
      unknown_locations,
      online_window_seconds: ANALYTICS_ONLINE_WINDOW_SECONDS,
      server_time: new Date().toISOString()
    });
  } catch(e) {
    console.error("Analytics V2 summary error:", e);
    res.status(500).json({error:e.message});
  }
});

app.get("/api/admin/analytics/v2/countries", adminOnly, (req,res)=>{
  try {
    const countries = db.prepare(`
      WITH visitor_counts AS (
        SELECT country,country_code,COUNT(*) AS visitors
        FROM analytics_v2_visitors
        WHERE country <> 'Unknown' AND country_code <> ''
        GROUP BY country,country_code
      ),
      event_counts AS (
        SELECT country,country_code,
          SUM(CASE WHEN event_type IN ('page_view','download_page_view') THEN 1 ELSE 0 END) AS page_views,
          SUM(CASE WHEN event_type='download_click' THEN 1 ELSE 0 END) AS download_clicks
        FROM analytics_v2_events
        WHERE country <> 'Unknown' AND country_code <> ''
        GROUP BY country,country_code
      )
      SELECT
        v.country,
        v.country_code,
        v.visitors,
        COALESCE(e.page_views,0) AS page_views,
        COALESCE(e.download_clicks,0) AS download_clicks
      FROM visitor_counts v
      LEFT JOIN event_counts e
        ON e.country=v.country AND e.country_code=v.country_code
      ORDER BY v.visitors DESC, page_views DESC, v.country ASC
      LIMIT 100
    `).all();

    res.setHeader("Cache-Control","no-store");
    res.json(countries);
  } catch(e) {
    console.error("Analytics V2 countries error:", e);
    res.status(500).json({error:e.message});
  }
});

app.get("/api/admin/analytics/v2/recent", adminOnly, (req,res)=>{
  try {
    const recent = db.prepare(`
      SELECT event_type,page_path,country,country_code,created_at
      FROM analytics_v2_events
      ORDER BY id DESC
      LIMIT 50
    `).all();

    res.setHeader("Cache-Control","no-store");
    res.json(recent);
  } catch(e) {
    console.error("Analytics V2 recent error:", e);
    res.status(500).json({error:e.message});
  }
});

app.post("/api/admin/analytics/v2/reset", adminOnly, (req,res)=>{
  try {
    const reset = db.transaction(()=>{
      db.prepare("DELETE FROM analytics_v2_events").run();
      db.prepare("DELETE FROM analytics_v2_presence").run();
      db.prepare("DELETE FROM analytics_v2_visitors").run();
    });
    reset();
    analyticsGeoCache.clear();
    res.json({ok:true});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

setInterval(()=>{
  try {
    db.prepare(`
      DELETE FROM analytics_v2_presence
      WHERE last_seen < datetime('now','-1 day')
    `).run();
  } catch(e) {}
}, 60 * 60 * 1000);

app.get("/api/plans",(req,res)=>res.json(db.prepare("SELECT * FROM plans WHERE active=1 ORDER BY id").all()));
app.get("/api/products",(req,res)=>{
  res.json(db.prepare("SELECT * FROM products WHERE active=1 ORDER BY id").all());
});


/* App Download */
app.get("/api/app/info", (req,res)=>{
  res.json({
    name: "World TV",
    version: "8.2.7",
    releaseDate: "2026-08-14",
    size: "~45MB",
    description: "Watch live TV, movies, series and sports from around the world",
    features: [
      "4,000+ live TV channels",
      "Movies and series catalog",
      "Live football scores",
      "Multiple quality options",
      "Android TV, Smart TV & Phone compatible",
      "Free 3-day trial"
    ],
    downloadUrl: "/api/app/download",
    trialInfo: "Get 3 days free trial. No credit card required."
  });
});

app.get("/api/app/download", async (req,res)=>{
  try {
    // A download is counted when the browser requests the real APK endpoint.
    // Tracking runs in the background and never delays the file download.
    recordAnalyticsEventV2(req, res, "download_click", "/download.html")
      .catch(err=>console.error("Analytics V2 download tracking error:", err.message));

    const fs = require("fs");
    const path = require("path");
    const https = require("https");

    const appDir = path.join(__dirname, "public", "apps");
    if(!fs.existsSync(appDir)) fs.mkdirSync(appDir, {recursive: true});

    const appPath = path.join(appDir, "worldtv8.2.7-20260817.apk");

    if(fs.existsSync(appPath)) {
      res.setHeader("Content-Type", "application/vnd.android.package-archive");
      res.setHeader("Content-Disposition", "attachment; filename=worldtv8.2.7-20260817.apk");
      res.setHeader("Content-Length", fs.statSync(appPath).size);
      return res.sendFile(appPath);
    }

    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", "attachment; filename=worldtv8.2.7-20260817.apk");

    const externalUrl = "https://23s.tv/IPTV/worldtv8.2.7-20260817.apk";

    https.get(externalUrl, (remoteRes) => {
      if((remoteRes.statusCode || 500) >= 400){
        console.error("Remote app download failed:", remoteRes.statusCode);
        if(!res.headersSent) return res.status(503).json({error:"App download temporarily unavailable"});
        return res.end();
      }

      const cacheStream = fs.createWriteStream(appPath);
      remoteRes.pipe(cacheStream);
      remoteRes.pipe(res);
    }).on("error", (err) => {
      console.error("Failed to download app:", err);
      if(!res.headersSent) return res.status(503).json({error: "App download temporarily unavailable"});
      res.end();
    });
  } catch(e) {
    if(!res.headersSent) return res.status(500).json({error: e.message});
    res.end();
  }
});

/* App Download */
app.get("/api/app/info", (req,res)=>{
  res.json({
    name: "World TV",
    version: "8.2.7",
    releaseDate: "2026-08-17",
    size: "~29MB",
    description: "Watch live TV, movies, series and sports from around the world",
    features: [
      "4,000+ live TV channels",
      "4000 Movies and series catalog",
      "Live football scores",
      "Multiple quality options",
      "Android TV, Smart TV & Phone compatible",
      "Free 3-day trial"
    ],
    downloadUrl: "/api/app/download",
    trialInfo: "Get 3 days free trial. No credit card required."
  });
});


/* Customer auth */

function customerTokenHash(token){
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function createCustomerSession(user){
  const token=crypto.randomBytes(32).toString("hex");
  const expiresAt=new Date(Date.now()+CUSTOMER_SESSION_DAYS*86400000).toISOString();
  db.prepare("INSERT INTO customer_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
    .run(customerTokenHash(token),user.id,expiresAt);
  return token;
}

// Middleware to validate customer token
function customerOnly(req, res, next) {
  const token = req.headers["x-customer-token"];
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const session=db.prepare(`
    SELECT s.user_id AS userId,u.email
    FROM customer_sessions s
    JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP
  `).get(customerTokenHash(token));
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.customer=session;
  next();
}

app.post("/api/customer/register",async(req,res)=>{
  try{
    const {name,email,password,referral_code}=req.body||{};
    if(!name||!email||!password) return res.status(400).json({error:"Name, email and password are required"});
    if(String(password).length<8) return res.status(400).json({error:"Password must be at least 8 characters"});
    const cleanEmail=String(email).trim().toLowerCase();
    if(db.prepare("SELECT id FROM users WHERE email=?").get(cleanEmail)) return res.status(409).json({error:"An account with this email already exists"});
    const cleanReferral=String(referral_code||"").trim().toUpperCase();
    const referrer=cleanReferral?db.prepare("SELECT id,name FROM users WHERE referral_code=?").get(cleanReferral):null;
    if(cleanReferral&&!referrer)return res.status(400).json({error:"Referral code is invalid"});
    const hash=await bcrypt.hash(String(password),12);
    const result=db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)")
      .run(String(name).trim(),cleanEmail,hash);
    ensureReferralCode(result.lastInsertRowid);
   if(referrer){
  if(referrer.id!==result.lastInsertRowid){
    try{
      db.prepare("INSERT INTO referrals(referrer_user_id,referred_user_id,referral_code) VALUES(?,?,?)")
        .run(referrer.id,result.lastInsertRowid,cleanReferral);
    }catch(e){}
  }
}
    const token=createCustomerSession({id:result.lastInsertRowid});
    res.json({token});
  }catch(e){res.status(500).json({error:"Could not create account"});}
});
app.post("/api/customer/login",loginRateLimit,async(req,res)=>{
  try{
    const cleanEmail=String(req.body?.email||"").trim().toLowerCase();
    const user=db.prepare("SELECT id,email,password_hash FROM users WHERE email=?").get(cleanEmail);
    if(!user||!user.password_hash) return res.status(401).json({error:"Invalid email or password"});
    const ok=await bcrypt.compare(String(req.body?.password||""),user.password_hash);
    if(!ok) return res.status(401).json({error:"Invalid email or password"});
    db.prepare("DELETE FROM customer_sessions WHERE expires_at<=CURRENT_TIMESTAMP").run();
    const token=createCustomerSession(user);
    res.json({token});
  }catch(e){res.status(500).json({error:"Could not sign in"});}
});
app.post("/api/customer/logout",customerOnly,(req,res)=>{
  db.prepare("DELETE FROM customer_sessions WHERE token_hash=?")
    .run(customerTokenHash(req.headers["x-customer-token"]));
  res.json({ok:true});
});
app.get("/api/customer/me",customerOnly,(req,res)=>{
  const user=db.prepare("SELECT id,name,email,created_at FROM users WHERE id=?").get(req.customer.userId);
  const orders=db.prepare(`
    SELECT o.reference,o.status,o.amount_pesewas,o.currency,o.paid_at,o.created_at,
           p.name plan_name,p.price_ghs,c.code,c.expires_at
    FROM orders o
    JOIN plans p ON p.id=o.plan_id
    LEFT JOIN subscription_codes c ON c.id=o.code_id
    WHERE o.user_id=? ORDER BY o.id DESC
  `).all(req.customer.userId);
  const active=orders.find(o=>o.status==="paid"&&o.expires_at&&new Date(o.expires_at)>new Date())||null;
  res.json({user,active_subscription:active,orders});
});

/* Admin auth */
app.post("/api/admin/login",loginRateLimit,(req,res)=>{
  const {email,password}=req.body||{};

  if(
    email!==process.env.ADMIN_EMAIL ||
    password!==process.env.ADMIN_PASSWORD
  ){
    return res.status(401).json({
      error:"Invalid admin credentials"
    });
  }

  const token=crypto
    .createHmac("sha256",process.env.ADMIN_PASSWORD)
    .update(process.env.ADMIN_EMAIL)
    .digest("hex");

  res.json({token});
});

app.post("/api/admin/logout",adminOnly,(req,res)=>{
  res.json({ok:true});
});
 
/* Code manager */
app.get("/api/admin/stats",adminOnly,(req,res)=>{
  const q=s=>db.prepare(s).get().n;
  res.json({
    total:q("SELECT COUNT(*) n FROM subscription_codes"),
    unused:q("SELECT COUNT(*) n FROM subscription_codes WHERE status='unused'"),
    used:q("SELECT COUNT(*) n FROM subscription_codes WHERE status='used'"),
    disabled:q("SELECT COUNT(*) n FROM subscription_codes WHERE status='disabled'"),
    customers:q("SELECT COUNT(*) n FROM users"),
    products:q("SELECT COUNT(*) n FROM products WHERE active=1")
  }); 
  });
app.get("/api/admin/codes",adminOnly,(req,res)=>{
  res.json(db.prepare(`
    SELECT c.id,c.code,c.plan_id,c.status,c.expires_at,c.created_at,p.name plan_name
    FROM subscription_codes c
    JOIN plans p ON p.id=c.plan_id
    LEFT JOIN users u ON u.id=c.user_id
   WHERE c.status <> 'disabled'
     ORDER BY c.id DESC LIMIT 5000
  `).all());
});
app.get("/api/admin/codes/:id",adminOnly,(req,res)=>{
  const row=db.prepare(`
    SELECT
      c.id,
      c.code,
      c.plan_id,
      c.status,
      c.expires_at,
      c.created_at,
      p.name AS plan_name,
      u.email AS user_email
    FROM subscription_codes c
    JOIN plans p ON p.id=c.plan_id
    LEFT JOIN users u ON u.id=c.user_id
    WHERE c.id=?
  `).get(req.params.id);

  if(!row){
    return res.status(404).json({error:"Subscription code not found"});
  }

  res.json(row);
});
app.put("/api/admin/codes/:id",adminOnly,(req,res)=>{
  const existing=db.prepare(
    "SELECT * FROM subscription_codes WHERE id=?"
  ).get(req.params.id);

  if(!existing){
    return res.status(404).json({error:"Subscription code not found"});
  }

  const newCode=String(req.body.code||"").trim();
  const planId=Number(req.body.planId);
  const status=String(req.body.status||"").trim();
  const expiresAt=String(req.body.expires_at||"").trim()||null;

  if(!newCode){
    return res.status(400).json({error:"Code is required"});
  }

  if(!["unused","used","disabled"].includes(status)){
    return res.status(400).json({error:"Invalid status"});
  }

  const plan=db.prepare("SELECT id FROM plans WHERE id=?").get(planId);

  if(!plan){
    return res.status(400).json({error:"Invalid plan"});
  }

  const duplicate=db.prepare(
    "SELECT id FROM subscription_codes WHERE code=? AND id<>?"
  ).get(newCode,req.params.id);

  if(duplicate){
    return res.status(409).json({error:"That subscription code already exists"});
  }

  db.prepare(`
    UPDATE subscription_codes
    SET code=?,plan_id=?,status=?,expires_at=?
    WHERE id=?
  `).run(
    newCode,
    planId,
    status,
    expiresAt,
    req.params.id
  );

  res.json({ok:true});
});
app.delete("/api/admin/codes/:id",adminOnly,(req,res)=>{
  const existing=db.prepare(
    "SELECT * FROM subscription_codes WHERE id=?"
  ).get(req.params.id);

  if(!existing){
    return res.status(404).json({
      error:"Subscription code not found"
    });
  }

  const linkedOrder=db.prepare(
    "SELECT id FROM orders WHERE code_id=? LIMIT 1"
  ).get(req.params.id);

  if(existing.user_id || existing.status==="used"){
    return res.status(409).json({
      error:"Used or assigned codes cannot be deleted."
    });
  }

  if(linkedOrder){
    db.prepare(
      "UPDATE subscription_codes SET status='disabled' WHERE id=?"
    ).run(req.params.id);

    return res.json({
      ok:true,
      softDeleted:true
    });
  }

  db.prepare(
    "DELETE FROM subscription_codes WHERE id=?"
  ).run(req.params.id);

  res.json({ok:true});
});

function addCodes(planId,codes){
  const exists=db.prepare("SELECT 1 FROM subscription_codes WHERE code=?");
  const ins=db.prepare("INSERT INTO subscription_codes(code,plan_id) VALUES(?,?)");
  return db.transaction(list=>{
    let added=0,duplicates=0;
    for(const raw of list){
      const code=String(raw||"").trim();
      if(!code) continue;
      if(exists.get(code)){duplicates++;continue}
      ins.run(code,planId);added++;
    }
    return {added,duplicates};
  })(codes);
}
app.post("/api/admin/codes/text",adminOnly,(req,res)=>{
  const {planId,codes}=req.body||{};
  if(!planId||!codes) return res.status(400).json({error:"Plan and codes are required"});
  res.json(addCodes(Number(planId),String(codes).split(/[\r\n,;]+/)));
});
const memUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024}});
app.post("/api/admin/codes/csv",adminOnly,memUpload.single("file"),(req,res)=>{
  if(!req.file) return res.status(400).json({error:"CSV file is required"});
  const text=req.file.buffer.toString("utf8").replace(/^\uFEFF/,"");
  const codes=text.split(/\r?\n/).map(line=>line.split(",")[0].trim().replace(/^"|"$/g,"")).filter(x=>x&&!/^code$/i.test(x));
  res.json({...addCodes(Number(req.body.planId),codes),received:codes.length});
});

/* Product manager */
app.get("/api/admin/products",adminOnly,(req,res)=>{
  res.json(db.prepare("SELECT * FROM products ORDER BY id DESC").all());
});

app.post("/api/admin/products",adminOnly,upload.single("image"),(req,res)=>{
  try{
    const {name,description,price_ghs,category,stock_status,whatsapp_number,featured}=req.body;
    if(!name) return res.status(400).json({error:"Product name is required"});
    const imageUrl=req.file?"/uploads/"+req.file.filename:null;
    const info=db.prepare(`
      INSERT INTO products(name,description,price_ghs,category,image_url,stock_status,whatsapp_number,featured,active)
      VALUES(?,?,?,?,?,?,?,?,1)
    `).run(
      String(name).trim(),
      String(description||"").trim(),
      price_ghs!==""&&price_ghs!=null?Number(price_ghs):null,
      String(category||"General").trim(),
      imageUrl,
      ["in_stock","out_of_stock","preorder"].includes(stock_status)?stock_status:"in_stock",
      String(whatsapp_number||"+233244909092").trim(),
      String(featured)==="1"?1:0
    );
    res.json(db.prepare("SELECT * FROM products WHERE id=?").get(info.lastInsertRowid));
  }catch(e){res.status(500).json({error:e.message});}
});

app.put("/api/admin/products/:id",adminOnly,upload.single("image"),(req,res)=>{
  try{
    const old=db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
    if(!old) return res.status(404).json({error:"Product not found"});
    const imageUrl=req.file?"/uploads/"+req.file.filename:old.image_url;
    db.prepare(`
      UPDATE products
      SET name=?,description=?,price_ghs=?,category=?,image_url=?,stock_status=?,whatsapp_number=?,featured=?,active=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
      String(req.body.name||old.name).trim(),
      String(req.body.description??old.description).trim(),
      req.body.price_ghs!==""&&req.body.price_ghs!=null?Number(req.body.price_ghs):null,
      String(req.body.category||old.category).trim(),
      imageUrl,
      ["in_stock","out_of_stock","preorder"].includes(req.body.stock_status)?req.body.stock_status:old.stock_status,
      String(req.body.whatsapp_number||old.whatsapp_number||"+233244909092").trim(),
      String(req.body.featured)==="1"?1:0,
      String(req.body.active)==="0"?0:1,
      req.params.id
    );
    res.json(db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id));
  }catch(e){res.status(500).json({error:e.message});}
});

app.delete("/api/admin/products/:id",adminOnly,(req,res)=>{
  const row=db.prepare("SELECT image_url FROM products WHERE id=?").get(req.params.id);
  if(!row) return res.status(404).json({error:"Product not found"});
  db.prepare("DELETE FROM products WHERE id=?").run(req.params.id);
  if(row.image_url && row.image_url.startsWith("/uploads/")){
    const fp=path.join(__dirname,"public",row.image_url);
    if(fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  res.json({ok:true});
});

/* Pricing Manager API */
app.get("/api/admin/pricing/plans", adminOnly, (req,res)=>{
  res.json(db.prepare("SELECT id,name,price_usd,duration_days,active FROM plans ORDER BY id").all());
});

app.get("/api/admin/pricing/products", adminOnly, (req,res)=>{
  res.json(db.prepare("SELECT id,name,price_ghs,stock_status FROM products WHERE active=1 ORDER BY id DESC").all());
});

app.patch("/api/admin/pricing/plans/:planId", adminOnly, (req,res)=>{
  const {price_usd} = req.body || {};
  const nextPrice = Number(price_usd);
  if(!Number.isFinite(nextPrice) || nextPrice <= 0) return res.status(400).json({error: "A valid USD price is required"});
  
  const plan = db.prepare("SELECT * FROM plans WHERE id=?").get(req.params.planId);
  if(!plan) return res.status(404).json({error: "Plan not found"});
  
  db.prepare("UPDATE plans SET price_usd=? WHERE id=?").run(nextPrice, req.params.planId);
  audit("plan_price_updated", "plan", req.params.planId, `USD price changed from $${Number(plan.price_usd).toFixed(2)} to $${nextPrice.toFixed(2)}`);
  
  res.json(db.prepare("SELECT * FROM plans WHERE id=?").get(req.params.planId));
});

app.patch("/api/admin/pricing/products/:productId", adminOnly, (req,res)=>{
  const {price_ghs} = req.body || {};
  if(price_ghs === undefined || price_ghs === null) return res.status(400).json({error: "Price is required"});
  
  const product = db.prepare("SELECT * FROM products WHERE id=?").get(req.params.productId);
  if(!product) return res.status(404).json({error: "Product not found"});
  
  db.prepare("UPDATE products SET price_ghs=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Math.max(0, Number(price_ghs)), req.params.productId);
  audit("product_price_updated", "product", req.params.productId, `Price changed from GH₵${product.price_ghs || 0} to GH₵${price_ghs}`);
  
  res.json(db.prepare("SELECT * FROM products WHERE id=?").get(req.params.productId));
});

app.post("/api/admin/pricing/bulk-update", adminOnly, (req,res)=>{
  const {category, percent} = req.body || {};
  if(percent === undefined || percent === null) return res.status(400).json({error: "Percent is required"});
  
  let sql = "SELECT id,price_ghs FROM products WHERE active=1";
  if(category === "featured") sql += " AND featured=1";
  
  const products = db.prepare(sql).all();
  let updatedCount = 0;
  
  const tx = db.transaction(()=>{
    for(const prod of products) {
      const oldPrice = prod.price_ghs || 0;
      const newPrice = Math.max(0, oldPrice * (1 + percent/100));
      db.prepare("UPDATE products SET price_ghs=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(newPrice, prod.id);
      updatedCount++;
    }
  });
  
  try { tx(); } catch(e) { return res.status(500).json({error: e.message}); }
  
  audit("bulk_price_update", "product", "multiple", `Applied ${percent}% change to ${category} products`);
  res.json({ok: true, updatedCount});
});

/* Live Sales Dashboard APIs */

// Get live sales summary stats
app.get("/api/admin/dashboard/live-summary", adminOnly, (req,res)=>{
  const today = new Date().toISOString().split('T')[0];
  
  // Today's sales
  const todaySales = db.prepare(`
    SELECT 
      COUNT(*) as transaction_count,
      SUM(amount_pesewas)/100 as total_revenue,
      COUNT(DISTINCT user_id) as unique_customers
    FROM orders 
    WHERE status='paid' AND DATE(paid_at)=?
  `).get(today);
  
  // Today's product orders
  const todayProductOrders = db.prepare(`
    SELECT 
      COUNT(*) as order_count,
      SUM(total_ghs) as total_sales,
      SUM(quantity) as items_sold
    FROM product_orders po
    WHERE EXISTS (
      SELECT 1 FROM product_payment_attempts ppa
      WHERE ppa.order_number=po.order_number
        AND ppa.status='paid'
        AND DATE(ppa.updated_at)=?
    )
  `).get(today);
  
  // Expenses today
  const todayExpenses = db.prepare(`
    SELECT SUM(amount_ghs) as total_expenses
    FROM expenses
    WHERE DATE(expense_date)=?
  `).get(today);
  
  // Total products in stock
  const stockCount = db.prepare(`
    SELECT 
      COUNT(*) as total_products,
      SUM(CASE WHEN stock_status='in_stock' THEN 1 ELSE 0 END) as in_stock_count,
      SUM(CASE WHEN stock_status='out_of_stock' THEN 1 ELSE 0 END) as out_of_stock_count
    FROM products WHERE active=1
  `).get();
  
  res.json({
    today: {
      date: today,
      subscriptions: todaySales,
      product_orders: todayProductOrders,
      expenses: todayExpenses
    },
    inventory: stockCount
  });
});

// Get recent sales transactions (limit 50)
app.get("/api/admin/dashboard/recent-sales", adminOnly, (req,res)=>{
  const sales = db.prepare(`
    SELECT 
      'subscription' as type,
      o.reference as ref_id,
      o.amount_pesewas/100 as amount_ghs,
      o.status,
      o.paid_at as timestamp,
      u.name as customer_name,
      p.name as product_name
    FROM orders o
    JOIN users u ON u.id = o.user_id
    JOIN plans p ON p.id = o.plan_id
    WHERE o.status='paid'
    
    UNION ALL
    
    SELECT 
      'product' as type,
      po.order_number as ref_id,
      po.total_ghs as amount_ghs,
      'paid' as status,
      MAX(ppa.updated_at) as timestamp,
      po.customer_name,
      pr.name as product_name
    FROM product_orders po
    JOIN product_payment_attempts ppa
      ON ppa.order_number=po.order_number AND ppa.status='paid'
    LEFT JOIN products pr ON pr.id = po.product_id
    GROUP BY po.id
    
    ORDER BY timestamp DESC
    LIMIT 50
  `).all();
  
  res.json(sales);
});

// Get daily summary for last 30 days
app.get("/api/admin/dashboard/daily-report", adminOnly, (req,res)=>{
  const daily = db.prepare(`
    WITH RECURSIVE dates(date) AS (
      SELECT DATE('now', '-30 days')
      UNION ALL
      SELECT DATE(date, '+1 day') FROM dates 
      WHERE date < DATE('now')
    )
    , subscription_daily AS (
      SELECT DATE(paid_at) date,
             SUM(amount_pesewas)/100.0 revenue,
             COUNT(DISTINCT user_id) customers
      FROM orders
      WHERE status='paid' AND paid_at IS NOT NULL
      GROUP BY DATE(paid_at)
    ), paid_product_orders AS (
      SELECT po.id, po.total_ghs, MAX(ppa.updated_at) paid_at
      FROM product_orders po
      JOIN product_payment_attempts ppa
        ON ppa.order_number=po.order_number AND ppa.status='paid'
      GROUP BY po.id
    ), product_daily AS (
      SELECT DATE(paid_at) date, SUM(total_ghs) revenue
      FROM paid_product_orders GROUP BY DATE(paid_at)
    ), expense_daily AS (
      SELECT DATE(expense_date) date, SUM(amount_ghs) total
      FROM expenses GROUP BY DATE(expense_date)
    )
    SELECT
      d.date,
      COALESCE(sd.revenue, 0) as subscription_revenue,
      COALESCE(pd.revenue, 0) as product_revenue,
      COALESCE(ed.total, 0) as expenses,
      COALESCE(sd.customers, 0) as customers
    FROM dates d
    LEFT JOIN subscription_daily sd ON sd.date=d.date
    LEFT JOIN product_daily pd ON pd.date=d.date
    LEFT JOIN expense_daily ed ON ed.date=d.date
    ORDER BY d.date DESC
  `).all();
  
  res.json(daily);
});

// Get product stock status
app.get("/api/admin/dashboard/stock-status", adminOnly, (req,res)=>{
  const stock = db.prepare(`
    SELECT 
      id,
      name,
      price_ghs,
      stock_status,
      featured,
      (SELECT COUNT(*) FROM product_orders WHERE product_id=p.id AND status NOT IN ('cancelled')) as units_sold
    FROM products p
    WHERE active=1
    ORDER BY stock_status ASC, featured DESC
  `).all();
  
  res.json(stock);
});

// Add expense record
app.post("/api/admin/dashboard/expenses", adminOnly, (req,res)=>{
  const {category, amount_ghs, description, expense_date} = req.body || {};
  
  if(!category || !amount_ghs || amount_ghs <= 0) {
    return res.status(400).json({error: "Category and valid amount are required"});
  }
  
  const chosenDate = /^\d{4}-\d{2}-\d{2}$/.test(String(expense_date || ''))
    ? `${expense_date} 12:00:00`
    : new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO expenses(category, amount_ghs, description, expense_date)
    VALUES(?, ?, ?, ?)
  `).run(String(category).trim(), Number(amount_ghs), String(description || '').trim(), chosenDate);
  
  audit("expense_recorded", "expense", result.lastInsertRowid, `${category}: GH₵${amount_ghs}`);
  
  res.json({ok: true, id: result.lastInsertRowid});
});

// Get expenses for a date range
app.get("/api/admin/dashboard/expenses", adminOnly, (req,res)=>{
  const startDate = req.query.start || new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];
  const endDate = req.query.end || new Date().toISOString().split('T')[0];
  
  const expenses = db.prepare(`
    SELECT 
      id,
      category,
      amount_ghs,
      description,
      DATE(expense_date) as date,
      expense_date as timestamp
    FROM expenses
    WHERE DATE(expense_date) BETWEEN ? AND ?
    ORDER BY expense_date DESC
  `).all(startDate, endDate);
  
  res.json(expenses);
});

app.delete("/api/admin/dashboard/expenses/:id", adminOnly, (req,res)=>{
  const expense = db.prepare("SELECT * FROM expenses WHERE id=?").get(req.params.id);
  if(!expense) return res.status(404).json({error:"Expense not found"});
  db.prepare("DELETE FROM expenses WHERE id=?").run(req.params.id);
  audit("expense_deleted", "expense", expense.id, `${expense.category}: GH₵${expense.amount_ghs}`);
  res.json({ok:true});
});

// Get profit calculation (revenue - expenses)
app.get("/api/admin/dashboard/profit-summary", adminOnly, (req,res)=>{
  const today = new Date().toISOString().split('T')[0];
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  const monthStart = startOfMonth.toISOString().split('T')[0];
  
  const calculate = (start, end) => {
    const subscription = db.prepare(`SELECT COALESCE(SUM(amount_pesewas),0)/100.0 total FROM orders WHERE status='paid' AND DATE(paid_at) BETWEEN ? AND ?`).get(start,end).total;
    const products = db.prepare(`
      SELECT COALESCE(SUM(po.total_ghs),0) total FROM product_orders po
      WHERE EXISTS (SELECT 1 FROM product_payment_attempts ppa WHERE ppa.order_number=po.order_number AND ppa.status='paid' AND DATE(ppa.updated_at) BETWEEN ? AND ?)
    `).get(start,end).total;
    const expenses = db.prepare(`SELECT COALESCE(SUM(amount_ghs),0) total FROM expenses WHERE DATE(expense_date) BETWEEN ? AND ?`).get(start,end).total;
    return {subscription_revenue:subscription, product_revenue:products, revenue:subscription+products, expenses, profit:subscription+products-expenses};
  };
  const todayProfit = calculate(today,today);
  const monthProfit = calculate(monthStart,today);
  
  res.json({
    today: todayProfit,
    this_month: monthProfit
  });
});



/* Admin customer management */
app.get("/api/admin/customers", adminOnly, (req,res)=>{
  const q=(req.query.q||"").trim();
  let sql=`
    SELECT u.id,u.name,u.email,u.created_at,
           COUNT(o.id) AS order_count,
           SUM(CASE WHEN o.status='paid' THEN 1 ELSE 0 END) AS paid_orders,
           MAX(c.expires_at) AS latest_expiry
    FROM users u
    LEFT JOIN orders o ON o.user_id=u.id
    LEFT JOIN subscription_codes c ON c.id=o.code_id
  `;
  const params={};
  if(q){
    sql+=" WHERE u.name LIKE @q OR u.email LIKE @q";
    params.q=`%${q}%`;
  }
  sql+=" GROUP BY u.id ORDER BY u.id DESC";
  res.json(db.prepare(sql).all(params));
});

app.get("/api/admin/customers/:id", adminOnly, (req,res)=>{
  const user=db.prepare("SELECT id,name,email,created_at FROM users WHERE id=?").get(req.params.id);
  if(!user) return res.status(404).json({error:"Customer not found"});
  const orders=db.prepare(`
    SELECT o.id,o.reference,o.status,o.amount_pesewas,o.currency,o.paid_at,o.created_at,
           p.id plan_id,p.name plan_name,p.price_ghs,p.duration_days,
           c.id code_id,c.code,c.expires_at
    FROM orders o
    JOIN plans p ON p.id=o.plan_id
    LEFT JOIN subscription_codes c ON c.id=o.code_id
    WHERE o.user_id=?
    ORDER BY o.id DESC
  `).all(req.params.id);
  res.json({user,orders});
});

app.post("/api/admin/customers/:id/activate", adminOnly, (req,res)=>{
  const user=db.prepare("SELECT id,email FROM users WHERE id=?").get(req.params.id);
  if(!user) return res.status(404).json({error:"Customer not found"});
  const planId=Number(req.body?.planId||1);
  const plan=db.prepare("SELECT * FROM plans WHERE id=? AND active=1").get(planId);
  if(!plan) return res.status(400).json({error:"Invalid plan"});

  const code=db.prepare(`
    SELECT id,code FROM subscription_codes
    WHERE plan_id=? AND status='unused'
    ORDER BY id ASC LIMIT 1
  `).get(planId);
  if(!code) return res.status(409).json({error:"No unused subscription codes are available"});

  const expiry=new Date();
  expiry.setUTCDate(expiry.getUTCDate()+plan.duration_days);
  const expiresAt=expiry.toISOString();
  const reference="WTV-MANUAL-"+Date.now()+"-"+crypto.randomBytes(3).toString("hex");

  const tx=db.transaction(()=>{
    const changed=db.prepare(`
      UPDATE subscription_codes
      SET status='used',user_id=?,expires_at=?
      WHERE id=? AND status='unused'
    `).run(user.id,expiresAt,code.id);
    if(changed.changes!==1) throw new Error("Code assignment conflict");

    db.prepare(`
      INSERT INTO orders(reference,user_id,plan_id,amount_pesewas,currency,status,code_id,paid_at)
      VALUES(?,?,?,?,?,'paid',?,?)
    `).run(reference,user.id,plan.id,plan.price_ghs*100,"GHS",code.id,new Date().toISOString());
  });

  try{tx();}catch(e){return res.status(409).json({error:e.message})}
  audit("customer_subscription_activated","user",user.id,`Code ${code.code}`); audit("customer_subscription_renewed","user",user.id,`Code ${code.code}`); res.json({ok:true,reference,code:code.code,expires_at:expiresAt});
});

app.post("/api/admin/customers/:id/renew", adminOnly, (req,res)=>{
  const user=db.prepare("SELECT id,email FROM users WHERE id=?").get(req.params.id);
  if(!user) return res.status(404).json({error:"Customer not found"});
  const planId=Number(req.body?.planId||1);
  const plan=db.prepare("SELECT * FROM plans WHERE id=? AND active=1").get(planId);
  if(!plan) return res.status(400).json({error:"Invalid plan"});

  const code=db.prepare(`
    SELECT id,code FROM subscription_codes
    WHERE plan_id=? AND status='unused'
    ORDER BY id ASC LIMIT 1
  `).get(planId);
  if(!code) return res.status(409).json({error:"No unused subscription codes are available"});

  const current=db.prepare(`
    SELECT MAX(c.expires_at) expiry
    FROM orders o
    JOIN subscription_codes c ON c.id=o.code_id
    WHERE o.user_id=? AND o.status='paid'
  `).get(user.id);

  let start=new Date();
  if(current?.expiry){
    const e=new Date(current.expiry);
    if(e>start) start=e;
  }
  const expiry=new Date(start);
  expiry.setUTCDate(expiry.getUTCDate()+plan.duration_days);
  const expiresAt=expiry.toISOString();
  const reference="WTV-RENEW-"+Date.now()+"-"+crypto.randomBytes(3).toString("hex");

  const tx=db.transaction(()=>{
    const changed=db.prepare(`
      UPDATE subscription_codes
      SET status='used',user_id=?,expires_at=?
      WHERE id=? AND status='unused'
    `).run(user.id,expiresAt,code.id);
    if(changed.changes!==1) throw new Error("Code assignment conflict");

    db.prepare(`
      INSERT INTO orders(reference,user_id,plan_id,amount_pesewas,currency,status,code_id,paid_at)
      VALUES(?,?,?,?,?,'paid',?,?)
    `).run(reference,user.id,plan.id,plan.price_ghs*100,"GHS",code.id,new Date().toISOString());
  });

  try{tx();}catch(e){return res.status(409).json({error:e.message})}
  res.json({ok:true,reference,code:code.code,expires_at:expiresAt});
});

app.delete("/api/admin/orders/:orderId", adminOnly, (req,res)=>{
  const order=db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.orderId);
  if(!order) return res.status(404).json({error:"Order not found"});

  const tx=db.transaction(()=>{
    db.prepare("UPDATE orders SET status='revoked' WHERE id=?").run(order.id);
    if(order.code_id){
      db.prepare(`
        UPDATE subscription_codes
        SET status='unused',user_id=NULL,expires_at=NULL
        WHERE id=?
      `).run(order.code_id);
    }
  });

  try{tx();}catch(e){return res.status(500).json({error:e.message})}
  audit("subscription_order_revoked","order",order.id,`Reference ${order.reference}`);
  res.json({ok:true});
});

app.post("/api/admin/customers/:id/reset-password", adminOnly, async (req,res)=>{
  const {newPassword}=req.body||{};
  if(!newPassword || String(newPassword).length<8) return res.status(400).json({error:"Password must be at least 8 characters"});
  const user=db.prepare("SELECT id FROM users WHERE id=?").get(req.params.id);
  if(!user) return res.status(404).json({error:"Customer not found"});
  const hash=await bcrypt.hash(String(newPassword),12);
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash,user.id);
  res.json({ok:true});
});



db.exec(`
CREATE TABLE IF NOT EXISTS notifications(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 title TEXT NOT NULL,
 message TEXT NOT NULL,
 is_read INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);


db.exec(`
CREATE TABLE IF NOT EXISTS pages(
 slug TEXT PRIMARY KEY,
 title TEXT NOT NULL,
 content TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS faqs(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 question TEXT NOT NULL,
 answer TEXT NOT NULL,
 sort_order INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);


db.exec(`
CREATE TABLE IF NOT EXISTS product_orders(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_number TEXT NOT NULL UNIQUE,
 user_id INTEGER,
 customer_name TEXT NOT NULL,
 email TEXT,
 phone TEXT NOT NULL,
 product_id INTEGER NOT NULL,
 quantity INTEGER NOT NULL DEFAULT 1,
 unit_price_ghs REAL,
 total_ghs REAL,
 delivery_location TEXT,
 notes TEXT,
 status TEXT NOT NULL DEFAULT 'new',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);


db.exec(`
CREATE TABLE IF NOT EXISTS coupons(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 code TEXT NOT NULL UNIQUE,
 discount_type TEXT NOT NULL DEFAULT 'fixed',
 discount_value REAL NOT NULL DEFAULT 0,
 applies_to TEXT NOT NULL DEFAULT 'subscription',
 active INTEGER NOT NULL DEFAULT 1,
 max_uses INTEGER,
 used_count INTEGER NOT NULL DEFAULT 0,
 expires_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS referrals(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 referrer_user_id INTEGER NOT NULL,
 referred_user_id INTEGER NOT NULL UNIQUE,
 referral_code TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// Safe, additive migrations for installations created before scheduled
// promotions and editable coupons were introduced.
try{db.prepare("ALTER TABLE promotions ADD COLUMN starts_at TEXT").run();}catch(e){}
try{db.prepare("ALTER TABLE promotions ADD COLUMN ends_at TEXT").run();}catch(e){}
try{db.prepare("ALTER TABLE promotions ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP").run();}catch(e){}
try{db.prepare("ALTER TABLE coupons ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP").run();}catch(e){}
try{db.prepare("ALTER TABLE promotions ADD COLUMN updated_at TEXT").run();}catch(e){}
try{db.prepare("ALTER TABLE coupons ADD COLUMN updated_at TEXT").run();}catch(e){}


db.exec(`
CREATE TABLE IF NOT EXISTS checkout_requests(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 reference TEXT NOT NULL UNIQUE,
 user_id INTEGER NOT NULL,
 plan_id INTEGER NOT NULL,
 coupon_code TEXT,
 original_amount_usd REAL,
 discount_usd REAL,
 final_amount_usd REAL,
 fx_ghs_per_usd REAL,
 original_amount_ghs REAL NOT NULL,
 discount_ghs REAL NOT NULL DEFAULT 0,
 final_amount_ghs REAL NOT NULL,
 status TEXT NOT NULL DEFAULT 'awaiting_payment',
 notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// Preserve every existing checkout while adding USD snapshots for the new
// worldwide subscription price. Older pending checkouts continue to use their
// original stored GHS amount.
for(const column of [
  "original_amount_usd REAL",
  "discount_usd REAL",
  "final_amount_usd REAL",
  "fx_ghs_per_usd REAL"
]){
  try{db.prepare(`ALTER TABLE checkout_requests ADD COLUMN ${column}`).run();}catch(e){}
}


db.exec(`
CREATE TABLE IF NOT EXISTS audit_logs(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_type TEXT NOT NULL DEFAULT 'admin',
 action TEXT NOT NULL,
 entity_type TEXT,
 entity_id TEXT,
 details TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
function audit(action,entityType="",entityId="",details=""){
 try{db.prepare("INSERT INTO audit_logs(action,entity_type,entity_id,details) VALUES(?,?,?,?)").run(action,String(entityType||""),String(entityId||""),String(details||""))}catch(e){}
}


db.exec(`
CREATE TABLE IF NOT EXISTS email_queue(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER,
 recipient_email TEXT NOT NULL,
 subject TEXT NOT NULL,
 message TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',
 attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 sent_at TEXT
);
`);
function queueEmail(userId,email,subject,message){
 if(!email)return;
 try{db.prepare("INSERT INTO email_queue(user_id,recipient_email,subject,message) VALUES(?,?,?,?)")
 .run(userId||null,String(email).trim(),String(subject).trim(),String(message).trim())}catch(e){}
}


db.exec(`
CREATE TABLE IF NOT EXISTS password_reset_tokens(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 expires_at TEXT NOT NULL,
 used_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

/* Public promotions and support */
app.get("/api/promotions",(req,res)=>{
  res.set("Cache-Control","no-store, max-age=0");
  res.json(db.prepare(`
    SELECT id,title,message,button_text,button_url
    FROM promotions
    WHERE active=1
      AND (starts_at IS NULL OR starts_at='' OR datetime(starts_at)<=datetime('now'))
      AND (ends_at IS NULL OR ends_at='' OR datetime(ends_at)>datetime('now'))
    ORDER BY id DESC
    LIMIT 10
  `).all());
});

app.get("/api/services",(req,res)=>{
  res.json(db.prepare(`
    SELECT id,icon,title,description
    FROM services
    WHERE active=1
    ORDER BY sort_order,id
  `).all());
});

app.post("/api/support",(req,res)=>{
  const {name,email,phone,subject,message}=req.body||{};
  if(!name || !subject || !message) return res.status(400).json({error:"Name, subject and message are required"});
  db.prepare(`
    INSERT INTO support_messages(name,email,phone,subject,message,status)
    VALUES(?,?,?,?,?,'new')
  `).run(
    String(name).trim(),
    String(email||"").trim(),
    String(phone||"").trim(),
    String(subject).trim(),
    String(message).trim()
  );
  res.json({ok:true,message:"Your message has been sent to World TV support."});
});

app.get("/api/site-settings",(req,res)=>{
  const rows=db.prepare("SELECT key,value FROM site_settings").all();
  const settings={};
  for(const r of rows) settings[r.key]=r.value;
  res.json(settings);
});

/* Admin promotions */
app.get("/api/admin/promotions",adminOnly,(req,res)=>{
  res.json(db.prepare("SELECT * FROM promotions ORDER BY id DESC").all());
});

app.post("/api/admin/promotions",adminOnly,(req,res)=>{
  const {title,message,button_text,button_url,active,starts_at,ends_at}=req.body||{};
  if(!title) return res.status(400).json({error:"Promotion title is required"});
  const cleanButtonUrl=String(button_url||"").trim();
  if(cleanButtonUrl&&!cleanButtonUrl.startsWith("/")&&!/^https?:\/\//i.test(cleanButtonUrl))return res.status(400).json({error:"Button URL must begin with /, http:// or https://"});
  if(starts_at&&ends_at&&new Date(starts_at)>=new Date(ends_at))return res.status(400).json({error:"End date must be after the start date"});
  const info=db.prepare(`
    INSERT INTO promotions(title,message,button_text,button_url,active,starts_at,ends_at)
    VALUES(?,?,?,?,?,?,?)
  `).run(
    String(title).trim(),
    String(message||"").trim(),
    String(button_text||"").trim(),
    cleanButtonUrl,
    String(active)==="0"?0:1,
    starts_at||null,
    ends_at||null
  );
  res.json(db.prepare("SELECT * FROM promotions WHERE id=?").get(info.lastInsertRowid));
});

app.put("/api/admin/promotions/:id",adminOnly,(req,res)=>{
  const old=db.prepare("SELECT * FROM promotions WHERE id=?").get(req.params.id);
  if(!old) return res.status(404).json({error:"Promotion not found"});
  const nextTitle=String(req.body.title??old.title).trim();
  const nextButtonUrl=String(req.body.button_url??old.button_url??"").trim();
  const nextStart=req.body.starts_at===undefined?old.starts_at:(req.body.starts_at||null);
  const nextEnd=req.body.ends_at===undefined?old.ends_at:(req.body.ends_at||null);
  if(!nextTitle)return res.status(400).json({error:"Promotion title is required"});
  if(nextButtonUrl&&!nextButtonUrl.startsWith("/")&&!/^https?:\/\//i.test(nextButtonUrl))return res.status(400).json({error:"Button URL must begin with /, http:// or https://"});
  if(nextStart&&nextEnd&&new Date(nextStart)>=new Date(nextEnd))return res.status(400).json({error:"End date must be after the start date"});
  db.prepare(`
    UPDATE promotions
    SET title=?,message=?,button_text=?,button_url=?,active=?,starts_at=?,ends_at=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    nextTitle,
    String(req.body.message??old.message).trim(),
    String(req.body.button_text??old.button_text??"").trim(),
    nextButtonUrl,
    String(req.body.active)==="0"?0:1,
    nextStart,
    nextEnd,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM promotions WHERE id=?").get(req.params.id));
});

app.post("/api/admin/promotions/:id/toggle",adminOnly,(req,res)=>{
  const result=db.prepare("UPDATE promotions SET active=CASE active WHEN 1 THEN 0 ELSE 1 END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  if(!result.changes)return res.status(404).json({error:"Promotion not found"});
  res.json(db.prepare("SELECT * FROM promotions WHERE id=?").get(req.params.id));
});

app.delete("/api/admin/promotions/:id",adminOnly,(req,res)=>{
  const r=db.prepare("DELETE FROM promotions WHERE id=?").run(req.params.id);
  if(!r.changes) return res.status(404).json({error:"Promotion not found"});
  res.json({ok:true});
});

/* Admin services */
app.get("/api/admin/services",adminOnly,(req,res)=>{
  res.json(db.prepare("SELECT * FROM services ORDER BY sort_order,id").all());
});

app.post("/api/admin/services",adminOnly,(req,res)=>{
  const {icon,title,description,sort_order,active}=req.body||{};
  if(!title) return res.status(400).json({error:"Service title is required"});
  const info=db.prepare(`
    INSERT INTO services(icon,title,description,sort_order,active)
    VALUES(?,?,?,?,?)
  `).run(
    String(icon||"").trim(),
    String(title).trim(),
    String(description||"").trim(),
    Number(sort_order||0),
    String(active)==="0"?0:1
  );
  res.json(db.prepare("SELECT * FROM services WHERE id=?").get(info.lastInsertRowid));
});

app.put("/api/admin/services/:id",adminOnly,(req,res)=>{
  const old=db.prepare("SELECT * FROM services WHERE id=?").get(req.params.id);
  if(!old) return res.status(404).json({error:"Service not found"});
  db.prepare(`
    UPDATE services
    SET icon=?,title=?,description=?,sort_order=?,active=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    String(req.body.icon??old.icon).trim(),
    String(req.body.title??old.title).trim(),
    String(req.body.description??old.description).trim(),
    Number(req.body.sort_order??old.sort_order),
    String(req.body.active)==="0"?0:1,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM services WHERE id=?").get(req.params.id));
});

app.delete("/api/admin/services/:id",adminOnly,(req,res)=>{
  const r=db.prepare("DELETE FROM services WHERE id=?").run(req.params.id);
  if(!r.changes) return res.status(404).json({error:"Service not found"});
  res.json({ok:true});
});

/* Admin support inbox */
app.get("/api/admin/support",adminOnly,(req,res)=>{
  const status=(req.query.status||"").trim();
  if(status){
    return res.json(db.prepare("SELECT * FROM support_messages WHERE status=? ORDER BY id DESC").all(status));
  }
  res.json(db.prepare("SELECT * FROM support_messages ORDER BY id DESC").all());
});

app.post("/api/admin/support/:id/status",adminOnly,(req,res)=>{
  const status=String(req.body?.status||"").trim();
  if(!["new","open","resolved"].includes(status)) return res.status(400).json({error:"Invalid support status"});
  const r=db.prepare("UPDATE support_messages SET status=? WHERE id=?").run(status,req.params.id);
  if(!r.changes) return res.status(404).json({error:"Message not found"});
  res.json({ok:true});
});

app.delete("/api/admin/support/:id",adminOnly,(req,res)=>{
  const r=db.prepare("DELETE FROM support_messages WHERE id=?").run(req.params.id);
  if(!r.changes) return res.status(404).json({error:"Message not found"});
  res.json({ok:true});
});

/* Admin site settings */
app.get("/api/admin/site-settings",adminOnly,(req,res)=>{
  const rows=db.prepare("SELECT key,value FROM site_settings").all();
  const settings={};
  for(const r of rows) settings[r.key]=r.value;
  res.json(settings);
});

app.post("/api/admin/site-settings",adminOnly,(req,res)=>{
  const allowed=["app_download_url","app_version","support_whatsapp","support_email","homepage_notice"];
  const tx=db.transaction((obj)=>{
    const up=db.prepare(`
      INSERT INTO site_settings(key,value) VALUES(?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `);
    for(const k of allowed){
      if(Object.prototype.hasOwnProperty.call(obj,k)) up.run(k,String(obj[k]||""));
    }
  });
  tx(req.body||{});
  res.json({ok:true});
});


/* Customer notifications */
app.get("/api/customer/notifications",customerOnly,(req,res)=>{
  res.json(db.prepare(`
    SELECT id,title,message,is_read,created_at
    FROM notifications WHERE user_id=?
    ORDER BY id DESC LIMIT 100
  `).all(req.customer.userId));
});
app.post("/api/customer/notifications/:id/read",customerOnly,(req,res)=>{
  db.prepare("UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?")
    .run(req.params.id,req.customer.userId);
  res.json({ok:true});
});

/* Admin notifications */
app.post("/api/admin/customers/:id/notification",adminOnly,(req,res)=>{
  const user=db.prepare("SELECT id FROM users WHERE id=?").get(req.params.id);
  if(!user) return res.status(404).json({error:"Customer not found"});
  const {title,message}=req.body||{};
  if(!title||!message) return res.status(400).json({error:"Title and message are required"});
  db.prepare("INSERT INTO notifications(user_id,title,message) VALUES(?,?,?)")
    .run(user.id,String(title).trim(),String(message).trim());
  res.json({ok:true});
});
app.post("/api/admin/notifications/broadcast",adminOnly,(req,res)=>{
  const {title,message}=req.body||{};
  if(!title||!message) return res.status(400).json({error:"Title and message are required"});
  const users=db.prepare("SELECT id FROM users").all();
  const ins=db.prepare("INSERT INTO notifications(user_id,title,message) VALUES(?,?,?)");
  const tx=db.transaction(()=>{for(const u of users) ins.run(u.id,String(title).trim(),String(message).trim())});
  tx(); res.json({ok:true,recipients:users.length});
});

/* Admin reports */
app.get("/api/admin/reports",adminOnly,(req,res)=>{
  const totalCustomers=db.prepare("SELECT COUNT(*) n FROM users").get().n;
  const totalProducts=db.prepare("SELECT COUNT(*) n FROM products WHERE active=1").get().n;
  const unusedCodes=db.prepare("SELECT COUNT(*) n FROM subscription_codes WHERE status='unused'").get().n;
  const usedCodes=db.prepare("SELECT COUNT(*) n FROM subscription_codes WHERE status='used'").get().n;
  const activeSubscriptions=db.prepare(`
    SELECT COUNT(*) n FROM subscription_codes
    WHERE status='used' AND expires_at IS NOT NULL AND datetime(expires_at)>datetime('now')
  `).get().n;
  const expiredSubscriptions=db.prepare(`
    SELECT COUNT(*) n FROM subscription_codes
    WHERE status='used' AND expires_at IS NOT NULL AND datetime(expires_at)<=datetime('now')
  `).get().n;
  const newSupport=db.prepare("SELECT COUNT(*) n FROM support_messages WHERE status='new'").get().n;
  const manualRevenue=db.prepare("SELECT COALESCE(SUM(amount_pesewas),0) n FROM orders WHERE status='paid'").get().n;
  const recentOrders=db.prepare(`
    SELECT o.reference,o.status,o.amount_pesewas,o.created_at,u.name,u.email,p.name plan_name
    FROM orders o JOIN users u ON u.id=o.user_id JOIN plans p ON p.id=o.plan_id
    ORDER BY o.id DESC LIMIT 20
  `).all();
  res.json({totalCustomers,totalProducts,unusedCodes,usedCodes,activeSubscriptions,expiredSubscriptions,newSupport,revenue_ghs:manualRevenue/100,recentOrders});
});


/* Admin backup and export */
app.get("/api/admin/export/customers.csv",adminOnly,(req,res)=>{
  const rows=db.prepare(`
    SELECT u.id,u.name,u.email,u.created_at,
           COUNT(o.id) order_count,
           SUM(CASE WHEN o.status='paid' THEN 1 ELSE 0 END) paid_orders,
           MAX(c.expires_at) latest_expiry
    FROM users u
    LEFT JOIN orders o ON o.user_id=u.id
    LEFT JOIN subscription_codes c ON c.id=o.code_id
    GROUP BY u.id ORDER BY u.id DESC
  `).all();
  const esc=v=>`"${String(v??"").replace(/"/g,'""')}"`;
  const csv=["ID,Name,Email,Created At,Orders,Paid Orders,Latest Expiry",
    ...rows.map(r=>[r.id,r.name,r.email,r.created_at,r.order_count,r.paid_orders,r.latest_expiry].map(esc).join(","))
  ].join("\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition","attachment; filename=world-tv-customers.csv");
  res.send("\uFEFF"+csv);
});

app.get("/api/admin/export/codes.csv",adminOnly,(req,res)=>{
  const rows=db.prepare(`
    SELECT c.id,c.code,c.status,c.expires_at,c.created_at,p.name plan_name,u.email customer_email
    FROM subscription_codes c
    JOIN plans p ON p.id=c.plan_id
    LEFT JOIN users u ON u.id=c.user_id
    ORDER BY c.id DESC
  `).all();
  const esc=v=>`"${String(v??"").replace(/"/g,'""')}"`;
  const csv=["ID,Code,Plan,Status,Customer Email,Expiry,Created At",
    ...rows.map(r=>[r.id,r.code,r.plan_name,r.status,r.customer_email,r.expires_at,r.created_at].map(esc).join(","))
  ].join("\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition","attachment; filename=world-tv-subscription-codes.csv");
  res.send("\uFEFF"+csv);
});

app.get("/api/admin/export/orders.csv",adminOnly,(req,res)=>{
  const rows=db.prepare(`
    SELECT o.reference,u.name customer_name,u.email,p.name plan_name,
           o.amount_pesewas,o.currency,o.status,o.paid_at,o.created_at
    FROM orders o JOIN users u ON u.id=o.user_id JOIN plans p ON p.id=o.plan_id
    ORDER BY o.id DESC
  `).all();
  const esc=v=>`"${String(v??"").replace(/"/g,'""')}"`;
  const csv=["Reference,Customer,Email,Plan,Amount GHS,Currency,Status,Paid At,Created At",
    ...rows.map(r=>[r.reference,r.customer_name,r.email,r.plan_name,(r.amount_pesewas/100).toFixed(2),r.currency,r.status,r.paid_at,r.created_at].map(esc).join(","))
  ].join("\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition","attachment; filename=world-tv-orders.csv");
  res.send("\uFEFF"+csv);
});

app.get("/api/admin/backup/database",adminOnly,(req,res)=>{
  try{
    db.pragma("wal_checkpoint(FULL)");
    const dbPath="path.join(__dirname, 'data', 'worldtv.sqlite')";
    if(!fs.existsSync(dbPath)) return res.status(404).json({error:"Database file not found"});
    res.download(dbPath,"world-tv-backup-"+new Date().toISOString().slice(0,10)+".sqlite");
  }catch(e){res.status(500).json({error:"Could not create database backup"});}
});


/* Public editable content */
app.get("/api/pages/:slug",(req,res)=>{
 const row=db.prepare("SELECT slug,title,content,updated_at FROM pages WHERE slug=?").get(req.params.slug);
 if(!row) return res.status(404).json({error:"Page not found"});
 res.json(row);
});
app.get("/api/faqs",(req,res)=>{
 res.json(db.prepare("SELECT id,question,answer FROM faqs WHERE active=1 ORDER BY sort_order,id").all());
});

/* Admin content manager */
app.get("/api/admin/pages",adminOnly,(req,res)=>res.json(db.prepare("SELECT * FROM pages ORDER BY slug").all()));
app.post("/api/admin/pages",adminOnly,(req,res)=>{
 const slug=String(req.body?.slug||"").trim().toLowerCase().replace(/[^a-z0-9-]/g,"");
 const title=String(req.body?.title||"").trim(), content=String(req.body?.content||"").trim();
 if(!slug||!title) return res.status(400).json({error:"Slug and title are required"});
 db.prepare(`INSERT INTO pages(slug,title,content) VALUES(?,?,?)
 ON CONFLICT(slug) DO UPDATE SET title=excluded.title,content=excluded.content,updated_at=CURRENT_TIMESTAMP`)
 .run(slug,title,content);
 res.json({ok:true});
});
app.get("/api/admin/faqs",adminOnly,(req,res)=>res.json(db.prepare("SELECT * FROM faqs ORDER BY sort_order,id").all()));
app.post("/api/admin/faqs",adminOnly,(req,res)=>{
 const {question,answer,sort_order}=req.body||{};
 if(!question||!answer) return res.status(400).json({error:"Question and answer are required"});
 const x=db.prepare("INSERT INTO faqs(question,answer,sort_order,active) VALUES(?,?,?,1)")
 .run(String(question).trim(),String(answer).trim(),Number(sort_order||0));
 res.json({id:x.lastInsertRowid});
});
app.delete("/api/admin/faqs/:id",adminOnly,(req,res)=>{
 db.prepare("DELETE FROM faqs WHERE id=?").run(req.params.id);res.json({ok:true});
});


/* Product orders */
app.post("/api/product-orders",(req,res)=>{
 const {customer_name,email,phone,product_id,quantity,delivery_location,notes}=req.body||{};
 if(!customer_name||!phone||!product_id) return res.status(400).json({error:"Name, phone and product are required"});
 const product=db.prepare("SELECT id,name,price_ghs,stock_status FROM products WHERE id=? AND active=1").get(product_id);
 if(!product) return res.status(404).json({error:"Product not found"});
 if(product.stock_status==="out_of_stock") return res.status(409).json({error:"This product is currently out of stock"});
 const qty=Math.max(1,Math.min(100,Number(quantity||1)));
 const unit=product.price_ghs==null?null:Number(product.price_ghs);
 const total=unit==null?null:Number((unit*qty).toFixed(2));
 const orderNo="WTV-"+Date.now()+"-"+crypto.randomBytes(3).toString("hex").toUpperCase();
 db.prepare(`INSERT INTO product_orders(order_number,customer_name,email,phone,product_id,quantity,unit_price_ghs,total_ghs,delivery_location,notes)
 VALUES(?,?,?,?,?,?,?,?,?,?)`).run(orderNo,String(customer_name).trim(),String(email||"").trim(),String(phone).trim(),product.id,qty,unit,total,String(delivery_location||"").trim(),String(notes||"").trim());
 res.json({ok:true,order_number:orderNo,product:product.name,total_ghs:total});
});
app.get("/api/product-orders/:orderNumber",(req,res)=>{
 const row=db.prepare(`SELECT po.order_number,po.customer_name,po.quantity,po.total_ghs,po.delivery_location,po.status,po.created_at,p.name product_name
 FROM product_orders po JOIN products p ON p.id=po.product_id WHERE po.order_number=?`).get(req.params.orderNumber);
 if(!row) return res.status(404).json({error:"Order not found"});
 res.json(row);
});
app.get("/api/admin/product-orders",adminOnly,(req,res)=>{
 const status=String(req.query.status||"").trim();
 let sql=`SELECT po.*,p.name product_name FROM product_orders po JOIN products p ON p.id=po.product_id`;
 const args=[];
 if(status){sql+=" WHERE po.status=?";args.push(status)}
 sql+=" ORDER BY po.id DESC";
 res.json(db.prepare(sql).all(...args));
});
app.post("/api/admin/product-orders/:id/status",adminOnly,(req,res)=>{
 const status=String(req.body?.status||"");
 if(!["new","confirmed","processing","ready","delivered","cancelled"].includes(status)) return res.status(400).json({error:"Invalid order status"});
 const r=db.prepare("UPDATE product_orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status,req.params.id);
 if(!r.changes)return res.status(404).json({error:"Order not found"});
 res.json({ok:true});
});


/* Coupons */
app.post("/api/coupons/validate",async(req,res)=>{
 const code=String(req.body?.code||"").trim().toUpperCase();
 const applies=String(req.body?.applies_to||"subscription");
 const amount=Number(req.body?.amount||0);
 const currency=String(req.body?.currency||"GHS").trim().toUpperCase();
 if(!code)return res.status(400).json({error:"Enter a coupon code"});
 if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:"A valid purchase amount is required"});
 const c=db.prepare("SELECT * FROM coupons WHERE code=? AND active=1").get(code);
 if(!c) return res.status(404).json({error:"Invalid coupon code"});
 if(c.applies_to!==applies && c.applies_to!=="all") return res.status(400).json({error:"Coupon does not apply to this purchase"});
 if(c.expires_at && new Date(c.expires_at)<=new Date()) return res.status(400).json({error:"Coupon has expired"});
 if(c.max_uses!=null && c.used_count>=c.max_uses) return res.status(400).json({error:"Coupon usage limit reached"});
 let fixedValue=Number(c.discount_value);
 if(c.discount_type==="fixed"&&currency==="USD"){
   try{
     const ratesResult=await getExchangeRates();
     const usdPerGhs=Number(ratesResult?.rates?.USD||ratesResult?.data?.rates?.USD);
     if(!Number.isFinite(usdPerGhs)||usdPerGhs<=0)throw new Error("rate unavailable");
     fixedValue*=usdPerGhs;
   }catch(error){return res.status(503).json({error:"The current exchange rate is unavailable. Please try again."});}
 }
 let discount=c.discount_type==="percent"?amount*(c.discount_value/100):fixedValue;
 discount=Math.max(0,Math.min(amount,discount));
 const roundedDiscount=Number(discount.toFixed(2)),roundedTotal=Number(Math.max(0,amount-discount).toFixed(2));
 res.set("Cache-Control","no-store, max-age=0");
 res.json({valid:true,code:c.code,currency,discount:roundedDiscount,new_total:roundedTotal,discount_ghs:currency==="GHS"?roundedDiscount:null,new_total_ghs:currency==="GHS"?roundedTotal:null,discount_usd:currency==="USD"?roundedDiscount:null,new_total_usd:currency==="USD"?roundedTotal:null});
});
app.get("/api/admin/coupons",adminOnly,(req,res)=>res.json(db.prepare("SELECT * FROM coupons ORDER BY id DESC").all()));
app.post("/api/admin/coupons",adminOnly,(req,res)=>{
 const {code,discount_type,discount_value,applies_to,max_uses,expires_at}=req.body||{};
 const clean=String(code||"").trim().toUpperCase();
 const value=Number(discount_value);
 if(!clean||!Number.isFinite(value)||value<=0)return res.status(400).json({error:"Code and a positive discount value are required"});
 if(discount_type==="percent"&&value>100)return res.status(400).json({error:"Percentage discount cannot exceed 100%"});
 try{
  db.prepare(`INSERT INTO coupons(code,discount_type,discount_value,applies_to,max_uses,expires_at)
  VALUES(?,?,?,?,?,?)`).run(clean,discount_type==="percent"?"percent":"fixed",Number(discount_value),["subscription","product","all"].includes(applies_to)?applies_to:"subscription",max_uses?Number(max_uses):null,expires_at||null);
  res.json({ok:true});
 }catch(e){res.status(409).json({error:"Coupon code already exists"});}
});
app.put("/api/admin/coupons/:id",adminOnly,(req,res)=>{
 const old=db.prepare("SELECT * FROM coupons WHERE id=?").get(req.params.id);
 if(!old)return res.status(404).json({error:"Coupon not found"});
 const code=String(req.body?.code??old.code).trim().toUpperCase();
 const type=req.body?.discount_type==="percent"?"percent":"fixed";
 const value=Number(req.body?.discount_value??old.discount_value);
 const applies=["subscription","product","all"].includes(req.body?.applies_to)?req.body.applies_to:old.applies_to;
 const maxUses=req.body?.max_uses===""||req.body?.max_uses==null?null:Number(req.body.max_uses);
 const expiresAt=req.body?.expires_at===undefined?old.expires_at:(req.body.expires_at||null);
 const active=req.body?.active===undefined?old.active:(String(req.body.active)==="0"?0:1);
 if(!code||!Number.isFinite(value)||value<=0)return res.status(400).json({error:"Code and a positive discount value are required"});
 if(type==="percent"&&value>100)return res.status(400).json({error:"Percentage discount cannot exceed 100%"});
 if(maxUses!=null&&(!Number.isInteger(maxUses)||maxUses<old.used_count))return res.status(400).json({error:`Maximum uses cannot be less than the ${old.used_count} uses already recorded`});
 try{
   db.prepare(`UPDATE coupons SET code=?,discount_type=?,discount_value=?,applies_to=?,max_uses=?,expires_at=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(code,type,value,applies,maxUses,expiresAt,active,req.params.id);
   res.json(db.prepare("SELECT * FROM coupons WHERE id=?").get(req.params.id));
 }catch(error){res.status(409).json({error:"Coupon code already exists"});}
});
app.post("/api/admin/coupons/:id/toggle",adminOnly,(req,res)=>{
 const result=db.prepare("UPDATE coupons SET active=CASE active WHEN 1 THEN 0 ELSE 1 END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
 if(!result.changes)return res.status(404).json({error:"Coupon not found"});res.json({ok:true});
});
app.delete("/api/admin/coupons/:id",adminOnly,(req,res)=>{const result=db.prepare("DELETE FROM coupons WHERE id=?").run(req.params.id);if(!result.changes)return res.status(404).json({error:"Coupon not found"});res.json({ok:true})});

/* Referrals */
app.get("/api/referrals/validate",(req,res)=>{
 const code=String(req.query?.code||"").trim().toUpperCase();
 if(!code)return res.status(400).json({valid:false,error:"Enter a referral code"});
 const referrer=db.prepare("SELECT name FROM users WHERE referral_code=?").get(code);
 if(!referrer)return res.status(404).json({valid:false,error:"Referral code is invalid"});
 res.set("Cache-Control","no-store, max-age=0");
 res.json({valid:true,code,referrer_name:referrer.name});
});
app.get("/api/customer/referral",customerOnly,(req,res)=>{
 const code=ensureReferralCode(req.customer.userId);
 const count=db.prepare("SELECT COUNT(*) n FROM referrals WHERE referrer_user_id=?").get(req.customer.userId).n;
 res.json({referral_code:code,referrals:count});
});
app.get("/api/admin/referrals",adminOnly,(req,res)=>{
 res.json(db.prepare(`SELECT r.id,r.referral_code,r.created_at,a.name referrer_name,a.email referrer_email,b.name referred_name,b.email referred_email
 FROM referrals r JOIN users a ON a.id=r.referrer_user_id JOIN users b ON b.id=r.referred_user_id ORDER BY r.id DESC`).all());
});


/* Subscription checkout requests — US$23 worldwide base price */
app.post("/api/customer/checkout-request",customerOnly,async(req,res)=>{
 try{
   const planId=Number(req.body?.planId||1);
   const couponCode=String(req.body?.coupon_code||"").trim().toUpperCase();
   const ratesResult=await getExchangeRates();
   const usdPerGhs=Number(ratesResult?.rates?.USD||ratesResult?.data?.rates?.USD);
   if(!Number.isFinite(usdPerGhs)||usdPerGhs<=0){
     return res.status(503).json({error:"The current USD exchange rate is unavailable. Please try again."});
   }

   const plan=db.prepare("SELECT * FROM plans WHERE id=? AND active=1").get(planId);
   if(!plan) return res.status(400).json({error:"Invalid subscription plan"});

   const ghsPerUsd=1/usdPerGhs;
   const originalUsd=Number(plan.price_usd||SUBSCRIPTION_PROMO_USD);
   if(!Number.isFinite(originalUsd)||originalUsd<=0){
     return res.status(500).json({error:"Subscription price is not configured"});
   }

   let discountUsd=0,coupon=null;
   if(couponCode){
     coupon=db.prepare("SELECT * FROM coupons WHERE code=? AND active=1").get(couponCode);
     if(!coupon) return res.status(400).json({error:"Invalid coupon code"});
     if(!["subscription","all"].includes(coupon.applies_to)) return res.status(400).json({error:"Coupon does not apply to subscriptions"});
     if(coupon.expires_at && new Date(coupon.expires_at)<=new Date()) return res.status(400).json({error:"Coupon has expired"});
     if(coupon.max_uses!=null && coupon.used_count>=coupon.max_uses) return res.status(400).json({error:"Coupon usage limit reached"});
     // Existing fixed-value coupons remain denominated in GHS; percentage
     // coupons apply directly to the new USD base price.
     discountUsd=coupon.discount_type==="percent"
       ? originalUsd*(Number(coupon.discount_value)/100)
       : Number(coupon.discount_value)*usdPerGhs;
     discountUsd=Math.max(0,Math.min(originalUsd,discountUsd));
   }

   const finalUsd=Number((originalUsd-discountUsd).toFixed(2));
   const originalGhs=Number((originalUsd*ghsPerUsd).toFixed(2));
   const discountGhs=Number((discountUsd*ghsPerUsd).toFixed(2));
   const finalGhs=Number((finalUsd*ghsPerUsd).toFixed(2));
   const reference="WTV-SUB-"+Date.now()+"-"+crypto.randomBytes(3).toString("hex").toUpperCase();

   db.prepare(`INSERT INTO checkout_requests(
     reference,user_id,plan_id,coupon_code,
     original_amount_usd,discount_usd,final_amount_usd,fx_ghs_per_usd,
     original_amount_ghs,discount_ghs,final_amount_ghs
   ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
     reference,req.customer.userId,plan.id,couponCode||null,
     originalUsd,Number(discountUsd.toFixed(2)),finalUsd,Number(ghsPerUsd.toFixed(6)),
     originalGhs,discountGhs,finalGhs
   );

   res.json({
     ok:true,
     reference,
     plan:plan.name,
     currency:"USD",
     original_amount_usd:originalUsd,
     discount_usd:Number(discountUsd.toFixed(2)),
     final_amount_usd:finalUsd,
     paystack_amount_ghs:finalGhs,
     status:"awaiting_payment"
   });
 }catch(error){
   console.error("Subscription checkout request error:",error);
   res.status(500).json({error:"Could not create the subscription checkout"});
 }
});

app.get("/api/customer/checkout-requests",customerOnly,(req,res)=>{
 res.json(db.prepare(`SELECT c.reference,c.original_amount_ghs,c.discount_ghs,c.final_amount_ghs,c.status,c.created_at,p.name plan_name
 FROM checkout_requests c JOIN plans p ON p.id=c.plan_id WHERE c.user_id=? ORDER BY c.id DESC`).all(req.customer.userId));
});

app.get("/api/admin/checkout-requests",adminOnly,(req,res)=>{
 res.json(db.prepare(`SELECT c.*,u.name customer_name,u.email,p.name plan_name,p.duration_days
 FROM checkout_requests c JOIN users u ON u.id=c.user_id JOIN plans p ON p.id=c.plan_id ORDER BY c.id DESC`).all());
});

app.post("/api/admin/checkout-requests/:id/status",adminOnly,(req,res)=>{
 const status=String(req.body?.status||"");
 if(!["awaiting_payment","payment_confirmed","cancelled"].includes(status)) return res.status(400).json({error:"Invalid status"});
 const r=db.prepare("UPDATE checkout_requests SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status,req.params.id);
 if(!r.changes)return res.status(404).json({error:"Checkout request not found"});
 res.json({ok:true});
});

app.post("/api/admin/checkout-requests/:id/fulfill",adminOnly,(req,res)=>{
 const cr=db.prepare(`SELECT c.*,p.duration_days,p.price_ghs FROM checkout_requests c JOIN plans p ON p.id=c.plan_id WHERE c.id=?`).get(req.params.id);
 if(!cr)return res.status(404).json({error:"Checkout request not found"});
 if(cr.status!=="payment_confirmed")return res.status(409).json({error:"Confirm payment before issuing a subscription code"});
 const existing=db.prepare("SELECT id FROM orders WHERE reference=?").get(cr.reference);
 if(existing)return res.status(409).json({error:"This request has already been fulfilled"});
 const code=db.prepare("SELECT id,code FROM subscription_codes WHERE plan_id=? AND status='unused' ORDER BY id LIMIT 1").get(cr.plan_id);
 if(!code)return res.status(409).json({error:"No unused subscription codes available"});
 let start=new Date();
 const cur=db.prepare(`SELECT MAX(c.expires_at) expiry FROM orders o JOIN subscription_codes c ON c.id=o.code_id WHERE o.user_id=? AND o.status='paid'`).get(cr.user_id);
 if(cur?.expiry && new Date(cur.expiry)>start)start=new Date(cur.expiry);
 const exp=new Date(start);exp.setUTCDate(exp.getUTCDate()+cr.duration_days);
 const expiresAt=exp.toISOString();
 const tx=db.transaction(()=>{
   const changed=db.prepare("UPDATE subscription_codes SET status='used',user_id=?,expires_at=? WHERE id=? AND status='unused'").run(cr.user_id,expiresAt,code.id);
   if(changed.changes!==1)throw new Error("Code assignment conflict");
   db.prepare(`INSERT INTO orders(reference,user_id,plan_id,amount_pesewas,currency,status,code_id,paid_at)
   VALUES(?,?,?,?,?,'paid',?,?)`).run(cr.reference,cr.user_id,cr.plan_id,Math.round(cr.final_amount_ghs*100),"GHS",code.id,new Date().toISOString());
   db.prepare("UPDATE checkout_requests SET status='fulfilled',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(cr.id);
   if(cr.coupon_code)db.prepare("UPDATE coupons SET used_count=used_count+1 WHERE code=?").run(cr.coupon_code);
   db.prepare("INSERT INTO notifications(user_id,title,message) VALUES(?,?,?)").run(cr.user_id,"Subscription Activated",`Your World TV subscription has been activated. Your code is ${code.code}.`);
   const mailUser=db.prepare("SELECT email FROM users WHERE id=?").get(cr.user_id);
   queueEmail(cr.user_id,mailUser?.email,"Your World TV subscription is active",`Your World TV subscription has been activated. Subscription code: ${code.code}. Expiry: ${expiresAt}.`);
 });
 try{tx();audit("subscription_request_fulfilled","checkout_request",cr.id,`Code ${code.code}`);res.json({ok:true,code:code.code,expires_at:expiresAt})}catch(e){res.status(409).json({error:e.message})}
});


/* Admin audit trail */
app.get("/api/admin/audit-logs",adminOnly,(req,res)=>{
 const q=String(req.query.q||"").trim();
 if(q){
   return res.json(db.prepare(`SELECT * FROM audit_logs WHERE action LIKE ? OR entity_type LIKE ? OR details LIKE ? ORDER BY id DESC LIMIT 1000`)
     .all(`%${q}%`,`%${q}%`,`%${q}%`));
 }
 res.json(db.prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 1000").all());
});

/* Inventory alerts */
app.get("/api/admin/alerts",adminOnly,(req,res)=>{
 const unused=db.prepare("SELECT COUNT(*) n FROM subscription_codes WHERE status='unused'").get().n;
 const newSupport=db.prepare("SELECT COUNT(*) n FROM support_messages WHERE status='new'").get().n;
 const pendingSubs=db.prepare("SELECT COUNT(*) n FROM checkout_requests WHERE status IN ('awaiting_payment','payment_confirmed')").get().n;
 const newOrders=db.prepare("SELECT COUNT(*) n FROM product_orders WHERE status='new'").get().n;
 const expiring=db.prepare(`SELECT COUNT(*) n FROM subscription_codes WHERE status='used' AND expires_at IS NOT NULL
 AND datetime(expires_at)>datetime('now') AND datetime(expires_at)<=datetime('now','+30 days')`).get().n;
 const alerts=[];
 if(unused<20)alerts.push({level:unused<5?"urgent":"warning",title:"Subscription codes running low",message:`Only ${unused} unused codes remain.`});
 if(newSupport)alerts.push({level:"info",title:"New support messages",message:`${newSupport} support message(s) need attention.`});
 if(pendingSubs)alerts.push({level:"info",title:"Subscription requests waiting",message:`${pendingSubs} subscription request(s) are pending.`});
 if(newOrders)alerts.push({level:"info",title:"New product orders",message:`${newOrders} product order(s) are new.`});
 if(expiring)alerts.push({level:"warning",title:"Subscriptions expiring soon",message:`${expiring} subscription(s) expire within 30 days.`});
 res.json({alerts,counts:{unused,newSupport,pendingSubs,newOrders,expiring}});
});


/* Email notification queue — ready for a provider after hosting */
app.get("/api/admin/email-queue",adminOnly,(req,res)=>{
 res.json(db.prepare("SELECT * FROM email_queue ORDER BY id DESC LIMIT 1000").all());
});
app.post("/api/admin/email-queue/:id/status",adminOnly,(req,res)=>{
 const status=String(req.body?.status||"");
 if(!["queued","sent","failed"].includes(status))return res.status(400).json({error:"Invalid status"});
 db.prepare("UPDATE email_queue SET status=?,sent_at=CASE WHEN ?='sent' THEN CURRENT_TIMESTAMP ELSE sent_at END WHERE id=?").run(status,status,req.params.id);
 res.json({ok:true});
});
app.post("/api/admin/customers/:id/email",adminOnly,(req,res)=>{
 const u=db.prepare("SELECT id,email FROM users WHERE id=?").get(req.params.id);
 if(!u)return res.status(404).json({error:"Customer not found"});
 const {subject,message}=req.body||{};
 if(!subject||!message)return res.status(400).json({error:"Subject and message are required"});
 queueEmail(u.id,u.email,subject,message);
 audit("customer_email_queued","user",u.id,subject);
 res.json({ok:true});
});
app.post("/api/admin/email/broadcast",adminOnly,(req,res)=>{
 const {subject,message}=req.body||{};
 if(!subject||!message)return res.status(400).json({error:"Subject and message are required"});
 const users=db.prepare("SELECT id,email FROM users WHERE email IS NOT NULL AND email<>''").all();
 const tx=db.transaction(()=>{for(const u of users)queueEmail(u.id,u.email,subject,message)});
 tx();audit("email_broadcast_queued","users","all",`${users.length} recipients`);
 res.json({ok:true,recipients:users.length});
});


/* Secure customer password reset */
app.post("/api/customer/forgot-password",loginRateLimit,(req,res)=>{
 const email=String(req.body?.email||"").trim().toLowerCase();
 const generic={ok:true,message:"If that email is registered, password-reset instructions have been prepared."};
 if(!email)return res.json(generic);
 const u=db.prepare("SELECT id,email FROM users WHERE lower(email)=?").get(email);
 if(!u)return res.json(generic);
 const raw=crypto.randomBytes(32).toString("hex");
 const hash=crypto.createHash("sha256").update(raw).digest("hex");
 const exp=new Date(Date.now()+60*60*1000).toISOString();
 db.prepare("UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE user_id=? AND used_at IS NULL").run(u.id);
 db.prepare("INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES(?,?,?)").run(u.id,hash,exp);
 const base=String(process.env.PUBLIC_BASE_URL||"").replace(/\/$/,"");
 const resetUrl=(base||"http://localhost:"+PORT)+"/reset-password.html?token="+raw;
 queueEmail(u.id,u.email,"Reset your World TV password",`Use this secure link within 1 hour to reset your World TV password: ${resetUrl}`);
 audit("password_reset_requested","user",u.id,"Reset email queued");
 res.json(generic);
});

app.post("/api/customer/reset-password",loginRateLimit,async(req,res)=>{
 const token=String(req.body?.token||"");
 const password=String(req.body?.password||"");
 if(!token||password.length<8)return res.status(400).json({error:"A valid reset token and password of at least 8 characters are required"});
 const hash=crypto.createHash("sha256").update(token).digest("hex");
 const row=db.prepare("SELECT * FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL").get(hash);
 if(!row||new Date(row.expires_at)<=new Date())return res.status(400).json({error:"This reset link is invalid or has expired"});
 const passwordHash=await bcrypt.hash(password,12);
 const tx=db.transaction(()=>{
   db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(passwordHash,row.user_id);
   db.prepare("UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
 });
 tx();
 audit("customer_password_reset","user",row.user_id,"Password reset completed");
 res.json({ok:true,message:"Password changed successfully. You can now sign in."});
});


/* Hosting / production readiness */
app.get("/health",(req,res)=>{
  try{
    db.prepare("SELECT 1").get();
    res.json({ok:true,service:"World TV",database:"ok",time:new Date().toISOString()});
  }catch(e){
    res.status(503).json({ok:false,service:"World TV",database:"error"});
  }
});

app.get("/api/public-config",(req,res)=>{
  res.json({
    site_name:"World TV",
    subscription_price_usd:SUBSCRIPTION_PROMO_USD,
    subscription_currency:"USD",
    subscription_promotion:{active:true,label:"Limited-Time Worldwide Price Drop"},
    domain:process.env.PUBLIC_BASE_URL||"",
    payments_enabled:Boolean(process.env.PAYSTACK_SECRET_KEY||process.env.PAYPAL_CLIENT_ID)
  });
});

function productionChecks(){
  const warnings=[];
  if(process.env.NODE_ENV==="production"){
    if(!process.env.PUBLIC_BASE_URL)warnings.push("PUBLIC_BASE_URL is not configured");
    if(!process.env.ADMIN_EMAIL)warnings.push("ADMIN_EMAIL is not configured");
    if(!process.env.ADMIN_PASSWORD)warnings.push("ADMIN_PASSWORD is not configured");
    if(String(process.env.PUBLIC_BASE_URL||"").startsWith("http://"))warnings.push("PUBLIC_BASE_URL should use HTTPS");
  }
  if(warnings.length){
    console.warn("\\nWORLD TV PRODUCTION WARNINGS:");
    warnings.forEach(x=>console.warn("- "+x));
  }
}
productionChecks();


app.get("/api/launch-readiness",(req,res)=>{
 const base=String(process.env.PUBLIC_BASE_URL||"");
 res.json({
   website:true,
   customer_accounts:true,
   subscriptions:true,
   product_orders:true,
   support:true,
   admin_dashboard:true,
   pwa:true,
   https_configured:base.startsWith("https://"),
   external_email:false,
   online_payments:false
 });
});


// ==========================================
// FOOTBALL API - RapidAPI INTEGRATION
// ==========================================

const footballCache = new Map();

async function callFootballApi(endpoint) {
  if (!process.env.FOOTBALL_API_KEY) throw new Error("FOOTBALL_API_KEY not configured");
  if (!process.env.FOOTBALL_API_HOST) throw new Error("FOOTBALL_API_HOST not configured");

  const url = `https://${process.env.FOOTBALL_API_HOST}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      "x-rapidapi-key": process.env.FOOTBALL_API_KEY,
      "x-rapidapi-host": process.env.FOOTBALL_API_HOST
    }
  });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}

async function getCachedFootball(key, endpoint, ttl = 30000) {
  const cached = footballCache.get(key);
  if (cached && Date.now() - cached.time < ttl) return cached.data;
  const data = await callFootballApi(endpoint);
  footballCache.set(key, { time: Date.now(), data });
  return data;
}

// Test connection
app.get("/api/football/test", async (req, res) => {
  try {
    if (!process.env.FOOTBALL_API_KEY || !process.env.FOOTBALL_API_HOST) {
      return res.status(400).json({ ok: false, error: "Missing environment variables" });
    }
    const data = await callFootballApi("/matches?live=all&limit=1");
    res.json({ ok: true, message: "API working", has_data: !!data.response });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Live matches
app.get("/api/football/live", async (req, res) => {
  try {
    const data = await getCachedFootball("football-live", "/matches?live=all", 30000);
    const matches = (data.response || [])
      .filter(m => m && m.fixture && m.teams && m.goals)
      .slice(0, 20)
      .map(m => ({
        fixture_id: m.fixture?.id,
        league: m.league?.name || "Unknown",
        league_logo: m.league?.logo,
        home_team: m.teams?.home?.name,
        home_logo: m.teams?.home?.logo,
        away_team: m.teams?.away?.name,
        away_logo: m.teams?.away?.logo,
        home_score: m.goals?.home,
        away_score: m.goals?.away,
        minute: m.fixture?.status?.elapsed,
        status: m.fixture?.status?.short,
        kickoff: m.fixture?.date
      }));
    res.json({ ok: true, count: matches.length, matches });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Today's matches
app.get("/api/football/today", async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const data = await getCachedFootball(`football-today-${today}`, `/matches?date=${today}`, 120000);
    const matches = (data.response || [])
      .filter(m => m && m.fixture && m.teams && m.goals)
      .map(m => ({
        fixture_id: m.fixture?.id,
        league: m.league?.name || "Unknown",
        league_logo: m.league?.logo,
        home_team: m.teams?.home?.name,
        home_logo: m.teams?.home?.logo,
        away_team: m.teams?.away?.name,
        away_logo: m.teams?.away?.logo,
        home_score: m.goals?.home,
        away_score: m.goals?.away,
        minute: m.fixture?.status?.elapsed,
        status: m.fixture?.status?.short,
        kickoff: m.fixture?.date
      }));
    res.json({ ok: true, date: today, count: matches.length, matches });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Upcoming matches
app.get("/api/football/upcoming", async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const data = await getCachedFootball("football-upcoming", `/matches?dateFrom=${today}&dateTo=${nextWeek}`, 600000);
    const matches = (data.response || [])
      .filter(m => m && m.fixture && m.teams)
      .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date))
      .slice(0, 20)
      .map(m => ({
        fixture_id: m.fixture?.id,
        league: m.league?.name || "Unknown",
        league_logo: m.league?.logo,
        home_team: m.teams?.home?.name,
        home_logo: m.teams?.home?.logo,
        away_team: m.teams?.away?.name,
        away_logo: m.teams?.away?.logo,
        home_score: m.goals?.home,
        away_score: m.goals?.away,
        minute: m.fixture?.status?.elapsed,
        status: m.fixture?.status?.short,
        kickoff: m.fixture?.date
      }));
    res.json({ ok: true, period: `${today} to ${nextWeek}`, count: matches.length, matches });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});


// Finished matches (past 7 days)
app.get("/api/football/finished", async (req, res) => {
  try {
    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const todayStr = today.toISOString().split('T')[0];
    const data = await getCachedFootball("football-finished", `/matches?dateFrom=${sevenDaysAgo}&dateTo=${todayStr}&status=FT`, 600000);
    const matches = (data.response || [])
      .filter(m => m && m.fixture && m.teams && m.fixture.status.short === 'FT')
      .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
      .slice(0, 20)
      .map(m => ({
        fixture_id: m.fixture?.id,
        league: m.league?.name || "Unknown",
        league_logo: m.league?.logo,
        home_team: m.teams?.home?.name,
        home_logo: m.teams?.home?.logo,
        away_team: m.teams?.away?.name,
        away_logo: m.teams?.away?.logo,
        home_score: m.goals?.home,
        away_score: m.goals?.away,
        minute: "FT",
        status: "FT",
        kickoff: m.fixture?.date
      }));
    res.json({ ok: true, period: `Last 7 days (${sevenDaysAgo} to ${todayStr})`, count: matches.length, matches });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});


// Tomorrow matches
app.get("/api/football/tomorrow", async (req, res) => {
  try {
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    const data = await getCachedFootball("football-tomorrow", `/matches?dateFrom=${tomorrowStr}&dateTo=${tomorrowStr}`, 600000);
    const matches = (data.response || [])
      .filter(m => m && m.fixture && m.teams)
      .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date))
      .slice(0, 20)
      .map(m => ({
        fixture_id: m.fixture?.id,
        league: m.league?.name || "Unknown",
        league_logo: m.league?.logo,
        home_team: m.teams?.home?.name,
        home_logo: m.teams?.home?.logo,
        away_team: m.teams?.away?.name,
        away_logo: m.teams?.away?.logo,
        home_score: m.goals?.home,
        away_score: m.goals?.away,
        minute: null,
        status: m.fixture?.status?.short || "NS",
        kickoff: m.fixture?.date
      }));
    res.json({ ok: true, date: tomorrowStr, count: matches.length, matches });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});


// Start server

/* Paystack payment integration */
app.post("/api/payment/paystack/initialize", customerOnly, async (req, res) => {
  try {
    const reference = String(req.body?.reference || "").trim();

    if (!reference) {
      return res.status(400).json({ error: "Payment reference required" });
    }

    const checkout = db.prepare(`
      SELECT
        c.*,
        p.name AS plan_name,
        u.email,
        u.name AS customer_name
      FROM checkout_requests c
      JOIN plans p ON p.id = c.plan_id
      JOIN users u ON u.id = c.user_id
      WHERE c.reference = ?
        AND c.user_id = ?
    `).get(reference, req.customer.userId);

    if (!checkout) {
      return res.status(404).json({ error: "Subscription request not found" });
    }

    if (checkout.status !== "awaiting_payment") {
      return res.status(409).json({
        error: "This payment request is no longer awaiting payment"
      });
    }

    const paystackKey = process.env.PAYSTACK_SECRET_KEY;

    if (!paystackKey) {
      return res.status(500).json({
        error: "Paystack is not configured"
      });
    }

    const amountPesewas =
      Math.round(Number(checkout.final_amount_ghs) * 100);

    const baseUrl = String(
      process.env.PUBLIC_BASE_URL || "https://myworldtvlive.com"
    ).replace(/\/+$/, "");

    const paystackResponse = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${paystackKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: checkout.email,
          amount: String(amountPesewas),
          currency: "GHS",
          reference: checkout.reference,
          callback_url: `${baseUrl}/subscribe.html`,
          metadata: JSON.stringify({
            plan_id: checkout.plan_id,
            plan_name: checkout.plan_name,
            customer_name: checkout.customer_name
          })
        })
      }
    );

    const paystack = await paystackResponse.json();

    if (
      !paystackResponse.ok ||
      !paystack.status ||
      !paystack.data?.authorization_url
    ) {
      console.error("Paystack initialization error:", paystack);

      return res.status(502).json({
        error: paystack.message || "Could not start Paystack payment"
      });
    }

    res.json({
      ok: true,
      reference: checkout.reference,
      authorization_url: paystack.data.authorization_url,
      access_code: paystack.data.access_code,
      amount_ghs: checkout.final_amount_ghs
    });

  } catch (error) {
    console.error("Paystack initialize error:", error);

    res.status(500).json({
      error: "Could not start payment"
    });
  }
});
app.post("/api/payment/paystack/verify", async (req, res) => {
  try {
    const reference = String(
      req.body?.reference || req.query?.reference || ""
    ).trim();

    if (!reference) {
      return res.status(400).json({ error: "Reference required" });
    }

    const checkout = db.prepare(`
      SELECT
        c.*,
        p.name AS plan_name,
        p.duration_days,
        u.email
      FROM checkout_requests c
      JOIN plans p ON p.id = c.plan_id
      JOIN users u ON u.id = c.user_id
      WHERE c.reference = ?
    `).get(reference);

    if (!checkout) {
      return res.status(404).json({ error: "Checkout not found" });
    }

    // Prevent the same payment from being fulfilled twice
    const existingOrder = db.prepare(`
      SELECT o.*, sc.code, sc.expires_at
      FROM orders o
      LEFT JOIN subscription_codes sc ON sc.id = o.code_id
      WHERE o.reference = ?
    `).get(reference);

    if (existingOrder) {
      return res.json({
        ok: true,
        paid: true,
        already_processed: true,
        code: existingOrder.code || null,
        expires_at: existingOrder.expires_at || null
      });
    }

    const paystackKey = process.env.PAYSTACK_SECRET_KEY;

    if (!paystackKey) {
      return res.status(500).json({
        error: "Paystack is not configured"
      });
    }

    const verifyResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${paystackKey}`,
          Accept: "application/json"
        }
      }
    );

    const paystack = await verifyResponse.json();

    if (!verifyResponse.ok || !paystack.status || !paystack.data) {
      console.error("Paystack verification error:", paystack);

      return res.status(502).json({
        error: paystack.message || "Could not verify payment"
      });
    }

    const payment = paystack.data;

    if (payment.status !== "success") {
      return res.status(400).json({
        error: "Payment has not been completed",
        payment_status: payment.status
      });
    }

    const expectedAmount =
      Math.round(Number(checkout.final_amount_ghs) * 100);

    if (
      payment.reference !== reference ||
      Number(payment.amount) !== expectedAmount ||
      payment.currency !== "GHS"
    ) {
      console.error("Paystack payment mismatch:", {
        reference,
        expectedAmount,
        receivedAmount: payment.amount,
        currency: payment.currency
      });

      return res.status(400).json({
        error: "Payment details do not match this subscription"
      });
    }

    const code = db.prepare(`
      SELECT id, code
      FROM subscription_codes
      WHERE plan_id = ?
        AND status = 'unused'
      ORDER BY id
      LIMIT 1
    `).get(checkout.plan_id);

    // Payment succeeded but no subscription code is available
    if (!code) {
      db.prepare(`
        UPDATE checkout_requests
        SET status='payment_confirmed',
            updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(checkout.id);

      return res.json({
        ok: true,
        paid: true,
        fulfilled: false,
        message:
          "Payment received successfully. Subscription activation is pending."
      });
    }

    let start = new Date();

    const current = db.prepare(`
      SELECT MAX(sc.expires_at) AS expiry
      FROM orders o
      JOIN subscription_codes sc ON sc.id = o.code_id
      WHERE o.user_id = ?
        AND o.status = 'paid'
    `).get(checkout.user_id);

    if (
      current?.expiry &&
      new Date(current.expiry) > start
    ) {
      start = new Date(current.expiry);
    }

    const expiry = new Date(start);

    expiry.setUTCDate(
      expiry.getUTCDate() + Number(checkout.duration_days)
    );

    const expiresAt = expiry.toISOString();

    const paidAt =
      payment.paid_at || new Date().toISOString();

    const activateSubscription = db.transaction(() => {
      const assigned = db.prepare(`
        UPDATE subscription_codes
        SET status='used',
            user_id=?,
            expires_at=?
        WHERE id=?
          AND status='unused'
      `).run(
        checkout.user_id,
        expiresAt,
        code.id
      );

      if (assigned.changes !== 1) {
        throw new Error("Subscription code assignment failed");
      }

      db.prepare(`
        INSERT INTO orders(
          reference,
          user_id,
          plan_id,
          amount_pesewas,
          currency,
          status,
          code_id,
          paid_at
        )
        VALUES(?,?,?,?,?,'paid',?,?)
      `).run(
        reference,
        checkout.user_id,
        checkout.plan_id,
        expectedAmount,
        "GHS",
        code.id,
        paidAt
      );

      db.prepare(`
        UPDATE checkout_requests
        SET status='fulfilled',
            updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(checkout.id);

      if (checkout.coupon_code) {
        db.prepare(`
          UPDATE coupons
          SET used_count = used_count + 1
          WHERE code=?
        `).run(checkout.coupon_code);
      }

      db.prepare(`
        INSERT INTO notifications(user_id,title,message)
        VALUES(?,?,?)
      `).run(
        checkout.user_id,
        "Subscription Activated",
        `Your World TV subscription has been activated. Your code is ${code.code}.`
      );

      queueEmail(
        checkout.user_id,
        checkout.email,
        "Your World TV subscription is active",
        `Your World TV subscription has been activated. Subscription code: ${code.code}. Expiry: ${expiresAt}.`
      );
    });

    activateSubscription();

    audit(
      "paystack_subscription_payment",
      "checkout_request",
      checkout.id,
      `Reference ${reference}`
    );

    res.json({
      ok: true,
      paid: true,
      fulfilled: true,
      message: "Payment verified and subscription activated",
      code: code.code,
      expires_at: expiresAt
    });

  } catch (error) {
    console.error("Paystack verify error:", error);

    res.status(500).json({
      error: "Could not verify payment"
    });
  }
});




// ============ CURRENCY CONVERTER ENDPOINTS ============

// GET /api/exchange-rates - Returns cached exchange rates
app.get("/api/exchange-rates", async (req, res) => {
  try {
    const result = await getExchangeRates();
    res.json(result);
  } catch (error) {
    console.error("Exchange rates error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/visitor-country
// Uses the same real-client-IP and country resolver as Live Analytics V2.
app.get("/api/visitor-country", async (req, res) => {
  try {
    const geo = await resolveAnalyticsGeo(req);
    res.setHeader("Cache-Control","no-store");
    res.json(geo);
  } catch (error) {
    console.error("Visitor country error:", error);
    res.json({ country: "Unknown", country_code: "" });
  }
});
// 404 Handler
app.use((req,res,next)=>{
  if(req.path.startsWith("/api/")) {
    return res.status(404).json({error:"Not found"});
  }
  res.status(404).sendFile(path.join(__dirname,"404.html"));
});
app.listen(PORT,"0.0.0.0",()=>console.log(`World TV running on port ${PORT}`));
// trigger Railway redeploy
