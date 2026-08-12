require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database("/app/data/worldtv.sqlite");
const adminSessions = new Map();
const customerSessions = new Map();

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
CREATE TABLE IF NOT EXISTS promotions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 message TEXT NOT NULL DEFAULT '',
 button_text TEXT,
 button_url TEXT,
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

if(!db.prepare("SELECT id FROM plans WHERE name=?").get("1 Year")){
  db.prepare("INSERT INTO plans(name,price_ghs,duration_days) VALUES(?,?,?)").run("1 Year",299,365);
}


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
app.use(express.static(__dirname));

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
  if(!token || !adminSessions.has(token)) return res.status(401).json({error:"Admin authentication required"});
  next();
}
function customerOnly(req,res,next){
  const token=req.headers["x-customer-token"];
  if(!token || !customerSessions.has(token)) return res.status(401).json({error:"Customer authentication required"});
  req.customer=customerSessions.get(token);
  next();
}

/* Public */
app.get("/api/health",(req,res)=>res.json({ok:true,service:"World TV"}));
app.get("/api/plans",(req,res)=>res.json(db.prepare("SELECT * FROM plans WHERE active=1 ORDER BY id").all()));
app.get("/api/products",(req,res)=>{
  const rows=db.prepare(`
    SELECT id,name,description,price_ghs,category,image_url,stock_status,whatsapp_number,featured
    FROM products
    WHERE active=1
    ORDER BY featured DESC,id DESC
  `).all();
  res.json(rows);
});

/* Customer auth */
app.post("/api/customer/register",async(req,res)=>{
  try{
    const {name,email,password,referral_code}=req.body||{};
    if(!name||!email||!password) return res.status(400).json({error:"Name, email and password are required"});
    if(String(password).length<8) return res.status(400).json({error:"Password must be at least 8 characters"});
    const cleanEmail=String(email).trim().toLowerCase();
    if(db.prepare("SELECT id FROM users WHERE email=?").get(cleanEmail)) return res.status(409).json({error:"An account with this email already exists"});
    const hash=await bcrypt.hash(String(password),12);
    const result=db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)")
      .run(String(name).trim(),cleanEmail,hash);
    ensureReferralCode(result.lastInsertRowid);
    if(referral_code){
      const ref=db.prepare("SELECT id FROM users WHERE referral_code=?").get(String(referral_code).trim().toUpperCase());
      if(ref && ref.id!==result.lastInsertRowid){
        try{db.prepare("INSERT INTO referrals(referrer_user_id,referred_user_id,referral_code) VALUES(?,?,?)").run(ref.id,result.lastInsertRowid,String(referral_code).trim().toUpperCase())}catch(e){}
      }
    }
    const token=crypto.randomBytes(32).toString("hex");
    customerSessions.set(token,{userId:result.lastInsertRowid,email:cleanEmail});
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
    const token=crypto.randomBytes(32).toString("hex");
    customerSessions.set(token,{userId:user.id,email:user.email});
    res.json({token});
  }catch(e){res.status(500).json({error:"Could not sign in"});}
});
app.post("/api/customer/logout",customerOnly,(req,res)=>{
  customerSessions.delete(req.headers["x-customer-token"]);
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
  if(email!==process.env.ADMIN_EMAIL || password!==process.env.ADMIN_PASSWORD){
    return res.status(401).json({error:"Invalid admin credentials"});
  }
  const token=crypto.randomBytes(32).toString("hex");
  adminSessions.set(token,{createdAt:Date.now()});
  res.json({token});
});
app.post("/api/admin/logout",adminOnly,(req,res)=>{
  adminSessions.delete(req.headers["x-admin-token"]);
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
    SELECT c.id,c.code,c.status,c.expires_at,c.created_at,p.name plan_name,u.email user_email
    FROM subscription_codes c
    JOIN plans p ON p.id=c.plan_id
    LEFT JOIN users u ON u.id=c.user_id
    ORDER BY c.id DESC LIMIT 5000
  `).all());
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


db.exec(`
CREATE TABLE IF NOT EXISTS checkout_requests(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 reference TEXT NOT NULL UNIQUE,
 user_id INTEGER NOT NULL,
 plan_id INTEGER NOT NULL,
 coupon_code TEXT,
 original_amount_ghs REAL NOT NULL,
 discount_ghs REAL NOT NULL DEFAULT 0,
 final_amount_ghs REAL NOT NULL,
 status TEXT NOT NULL DEFAULT 'awaiting_payment',
 notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);


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
  res.json(db.prepare(`
    SELECT id,title,message,button_text,button_url
    FROM promotions
    WHERE active=1
    ORDER BY id DESC
    LIMIT 10
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
  const {title,message,button_text,button_url,active}=req.body||{};
  if(!title) return res.status(400).json({error:"Promotion title is required"});
  const info=db.prepare(`
    INSERT INTO promotions(title,message,button_text,button_url,active)
    VALUES(?,?,?,?,?)
  `).run(
    String(title).trim(),
    String(message||"").trim(),
    String(button_text||"").trim(),
    String(button_url||"").trim(),
    String(active)==="0"?0:1
  );
  res.json(db.prepare("SELECT * FROM promotions WHERE id=?").get(info.lastInsertRowid));
});

app.put("/api/admin/promotions/:id",adminOnly,(req,res)=>{
  const old=db.prepare("SELECT * FROM promotions WHERE id=?").get(req.params.id);
  if(!old) return res.status(404).json({error:"Promotion not found"});
  db.prepare(`
    UPDATE promotions
    SET title=?,message=?,button_text=?,button_url=?,active=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    String(req.body.title??old.title).trim(),
    String(req.body.message??old.message).trim(),
    String(req.body.button_text??old.button_text??"").trim(),
    String(req.body.button_url??old.button_url??"").trim(),
    String(req.body.active)==="0"?0:1,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM promotions WHERE id=?").get(req.params.id));
});

app.delete("/api/admin/promotions/:id",adminOnly,(req,res)=>{
  const r=db.prepare("DELETE FROM promotions WHERE id=?").run(req.params.id);
  if(!r.changes) return res.status(404).json({error:"Promotion not found"});
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
    const dbPath="/app/data/worldtv.sqlite";
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
app.post("/api/coupons/validate",(req,res)=>{
 const code=String(req.body?.code||"").trim().toUpperCase();
 const applies=String(req.body?.applies_to||"subscription");
 const amount=Number(req.body?.amount||0);
 const c=db.prepare("SELECT * FROM coupons WHERE code=? AND active=1").get(code);
 if(!c) return res.status(404).json({error:"Invalid coupon code"});
 if(c.applies_to!==applies && c.applies_to!=="all") return res.status(400).json({error:"Coupon does not apply to this purchase"});
 if(c.expires_at && new Date(c.expires_at)<=new Date()) return res.status(400).json({error:"Coupon has expired"});
 if(c.max_uses!=null && c.used_count>=c.max_uses) return res.status(400).json({error:"Coupon usage limit reached"});
 let discount=c.discount_type==="percent"?amount*(c.discount_value/100):c.discount_value;
 discount=Math.max(0,Math.min(amount,discount));
 res.json({valid:true,code:c.code,discount_ghs:Number(discount.toFixed(2)),new_total_ghs:Number(Math.max(0,amount-discount).toFixed(2))});
});
app.get("/api/admin/coupons",adminOnly,(req,res)=>res.json(db.prepare("SELECT * FROM coupons ORDER BY id DESC").all()));
app.post("/api/admin/coupons",adminOnly,(req,res)=>{
 const {code,discount_type,discount_value,applies_to,max_uses,expires_at}=req.body||{};
 const clean=String(code||"").trim().toUpperCase();
 if(!clean||!discount_value)return res.status(400).json({error:"Code and discount value are required"});
 try{
  db.prepare(`INSERT INTO coupons(code,discount_type,discount_value,applies_to,max_uses,expires_at)
  VALUES(?,?,?,?,?,?)`).run(clean,discount_type==="percent"?"percent":"fixed",Number(discount_value),["subscription","product","all"].includes(applies_to)?applies_to:"subscription",max_uses?Number(max_uses):null,expires_at||null);
  res.json({ok:true});
 }catch(e){res.status(409).json({error:"Coupon code already exists"});}
});
app.post("/api/admin/coupons/:id/toggle",adminOnly,(req,res)=>{
 db.prepare("UPDATE coupons SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?").run(req.params.id);res.json({ok:true});
});
app.delete("/api/admin/coupons/:id",adminOnly,(req,res)=>{db.prepare("DELETE FROM coupons WHERE id=?").run(req.params.id);res.json({ok:true})});

/* Referrals */
app.get("/api/customer/referral",customerOnly,(req,res)=>{
 const code=ensureReferralCode(req.customer.userId);
 const count=db.prepare("SELECT COUNT(*) n FROM referrals WHERE referrer_user_id=?").get(req.customer.userId).n;
 res.json({referral_code:code,referrals:count});
});
app.get("/api/admin/referrals",adminOnly,(req,res)=>{
 res.json(db.prepare(`SELECT r.id,r.referral_code,r.created_at,a.name referrer_name,a.email referrer_email,b.name referred_name,b.email referred_email
 FROM referrals r JOIN users a ON a.id=r.referrer_user_id JOIN users b ON b.id=r.referred_user_id ORDER BY r.id DESC`).all());
});


/* Subscription checkout requests — payment gateway intentionally deferred */
app.post("/api/customer/checkout-request",customerOnly,(req,res)=>{
 const planId=Number(req.body?.planId||1);
 const couponCode=String(req.body?.coupon_code||"").trim().toUpperCase();
 const plan=db.prepare("SELECT * FROM plans WHERE id=? AND active=1").get(planId);
 if(!plan) return res.status(400).json({error:"Invalid subscription plan"});
 let discount=0,coupon=null;
 if(couponCode){
   coupon=db.prepare("SELECT * FROM coupons WHERE code=? AND active=1").get(couponCode);
   if(!coupon) return res.status(400).json({error:"Invalid coupon code"});
   if(!["subscription","all"].includes(coupon.applies_to)) return res.status(400).json({error:"Coupon does not apply to subscriptions"});
   if(coupon.expires_at && new Date(coupon.expires_at)<=new Date()) return res.status(400).json({error:"Coupon has expired"});
   if(coupon.max_uses!=null && coupon.used_count>=coupon.max_uses) return res.status(400).json({error:"Coupon usage limit reached"});
   discount=coupon.discount_type==="percent"?plan.price_ghs*(coupon.discount_value/100):coupon.discount_value;
   discount=Math.max(0,Math.min(plan.price_ghs,discount));
 }
 const finalAmount=Number((plan.price_ghs-discount).toFixed(2));
 const reference="WTV-SUB-"+Date.now()+"-"+crypto.randomBytes(3).toString("hex").toUpperCase();
 db.prepare(`INSERT INTO checkout_requests(reference,user_id,plan_id,coupon_code,original_amount_ghs,discount_ghs,final_amount_ghs)
 VALUES(?,?,?,?,?,?,?)`).run(reference,req.customer.userId,plan.id,couponCode||null,plan.price_ghs,Number(discount.toFixed(2)),finalAmount);
 res.json({ok:true,reference,plan:plan.name,original_amount_ghs:plan.price_ghs,discount_ghs:Number(discount.toFixed(2)),final_amount_ghs:finalAmount,status:"awaiting_payment"});
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
    subscription_price_ghs:299,
    domain:process.env.PUBLIC_BASE_URL||"",
    payments_enabled:false
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

app.use((req,res,next)=>{
  if(req.path.startsWith("/api/")) return res.status(404).json({error:"Not found"});
  res.status(404).sendFile(path.join(__dirname,"404.html"));
});
app.listen(PORT,"0.0.0.0",()=>console.log(`World TV running on port ${PORT}`));
