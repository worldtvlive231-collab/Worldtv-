require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "data");
const logoDir = path.join(dataDir, "tv-channel-logos");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(logoDir, { recursive: true });

const tvDb = new Database(path.join(dataDir, "worldtv.sqlite"));
tvDb.pragma("journal_mode=WAL");

tvDb.exec(`
CREATE TABLE IF NOT EXISTS tv_channels(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  logo_url TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS match_tv_channels(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_key TEXT NOT NULL,
  fixture_id TEXT,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  league TEXT NOT NULL DEFAULT '',
  kickoff TEXT,
  channel_id INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(match_key, channel_id),
  FOREIGN KEY(channel_id) REFERENCES tv_channels(id)
);
CREATE INDEX IF NOT EXISTS idx_match_tv_channels_key ON match_tv_channels(match_key);
CREATE INDEX IF NOT EXISTS idx_match_tv_channels_kickoff ON match_tv_channels(kickoff);
CREATE INDEX IF NOT EXISTS idx_match_tv_channels_channel ON match_tv_channels(channel_id);
`);

function expectedAdminToken(){
  const email = process.env.ADMIN_EMAIL || "";
  const password = process.env.ADMIN_PASSWORD || "";
  if(!email || !password) return "";
  return crypto.createHmac("sha256", password).update(email).digest("hex");
}

function adminOnly(req,res,next){
  const supplied = String(req.headers["x-admin-token"] || req.query.token || "");
  const expected = expectedAdminToken();
  if(!supplied || !expected || supplied.length !== expected.length){
    return res.status(401).json({error:"Admin authentication required"});
  }
  const ok = crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if(!ok) return res.status(401).json({error:"Admin authentication required"});
  next();
}

function clean(value,max=300){ return String(value ?? "").trim().slice(0,max); }
function cleanUrl(value){
  const raw = clean(value,1000);
  if(!raw) return "";
  if(/^\/uploads\/tv-channels\/[A-Za-z0-9._-]+$/.test(raw)) return raw;
  try{
    const u = new URL(raw);
    return (u.protocol === "https:" || u.protocol === "http:") ? u.toString() : "";
  }catch{ return ""; }
}
function localLogoFilename(value){
  const m = String(value||"").match(/^\/uploads\/tv-channels\/([A-Za-z0-9._-]+)$/);
  return m ? m[1] : "";
}
function removeLocalLogo(value){
  const filename = localLogoFilename(value);
  if(!filename) return;
  try{ fs.unlinkSync(path.join(logoDir, filename)); }catch(e){ if(e.code!=="ENOENT") console.warn("TV logo cleanup failed", e.message); }
}

const logoStorage = multer.diskStorage({
  destination:(req,file,cb)=>cb(null,logoDir),
  filename:(req,file,cb)=>{
    const extMap={"image/png":".png","image/jpeg":".jpg","image/webp":".webp","image/gif":".gif"};
    cb(null, `channel-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extMap[file.mimetype]||".img"}`);
  }
});
const uploadLogo = multer({
  storage:logoStorage,
  limits:{fileSize:4*1024*1024,files:1},
  fileFilter:(req,file,cb)=>{
    if(!["image/png","image/jpeg","image/webp","image/gif"].includes(file.mimetype)){
      return cb(new Error("Logo must be PNG, JPG, WEBP or GIF"));
    }
    cb(null,true);
  }
});

function makeMatchKey(body){
  const fixture = clean(body.fixture_id || body.fixtureId || "",120);
  if(fixture) return `fixture:${fixture}`;
  const league = clean(body.league,160).toLowerCase();
  const home = clean(body.home_team || body.homeTeam,160).toLowerCase();
  const away = clean(body.away_team || body.awayTeam,160).toLowerCase();
  const kickoff = clean(body.kickoff,80).slice(0,16);
  return `match:${league}|${home}|${away}|${kickoff}`;
}

function registerRoutes(app){
  app.get("/uploads/tv-channels/:filename", (req,res)=>{
    const filename = path.basename(String(req.params.filename||""));
    if(!/^[A-Za-z0-9._-]+$/.test(filename)) return res.status(404).end();
    res.setHeader("Cache-Control","public, max-age=86400");
    res.sendFile(path.join(logoDir,filename),err=>{ if(err && !res.headersSent) res.status(err.statusCode||404).end(); });
  });

  app.post("/api/admin/tv-channels/logo-upload", adminOnly, (req,res)=>{
    uploadLogo.single("logo")(req,res,err=>{
      if(err) return res.status(400).json({error:err.message||"Could not upload logo"});
      if(!req.file) return res.status(400).json({error:"Choose a channel logo image"});
      res.json({ok:true,logo_url:`/uploads/tv-channels/${req.file.filename}`});
    });
  });

  app.get("/api/match-tv-channels", (req,res)=>{
    const rows = tvDb.prepare(`
      SELECT a.id,a.match_key,a.fixture_id,a.home_team,a.away_team,a.league,a.kickoff,a.note,
             c.id AS channel_id,c.name AS channel_name,c.logo_url AS channel_logo,c.country AS channel_country
      FROM match_tv_channels a
      JOIN tv_channels c ON c.id=a.channel_id
      WHERE a.active=1 AND c.active=1
        AND (a.kickoff IS NULL OR a.kickoff='' OR datetime(a.kickoff) >= datetime('now','-8 hours'))
      ORDER BY CASE WHEN a.kickoff IS NULL OR a.kickoff='' THEN 1 ELSE 0 END,
               datetime(a.kickoff), c.name
      LIMIT 500
    `).all();
    res.setHeader("Cache-Control","no-store");
    res.json({ok:true,assignments:rows});
  });

  app.get("/api/admin/tv-channels", adminOnly, (req,res)=>{
    res.json(tvDb.prepare(`SELECT * FROM tv_channels ORDER BY active DESC,name COLLATE NOCASE`).all());
  });

  app.post("/api/admin/tv-channels", adminOnly, (req,res)=>{
    const name = clean(req.body?.name,120);
    const logoUrl = cleanUrl(req.body?.logo_url);
    const country = clean(req.body?.country,80);
    const active = String(req.body?.active ?? "1") === "0" ? 0 : 1;
    if(!name) return res.status(400).json({error:"Channel name is required"});
    try{
      const info = tvDb.prepare(`INSERT INTO tv_channels(name,logo_url,country,active) VALUES(?,?,?,?)`).run(name,logoUrl,country,active);
      res.json(tvDb.prepare("SELECT * FROM tv_channels WHERE id=?").get(info.lastInsertRowid));
    }catch(e){
      if(String(e.message).includes("UNIQUE")) return res.status(409).json({error:"A channel with this name already exists"});
      res.status(500).json({error:"Could not add TV channel"});
    }
  });

  app.put("/api/admin/tv-channels/:id", adminOnly, (req,res)=>{
    const old = tvDb.prepare("SELECT * FROM tv_channels WHERE id=?").get(req.params.id);
    if(!old) return res.status(404).json({error:"TV channel not found"});
    const name = clean(req.body?.name ?? old.name,120);
    const logoUrl = req.body?.logo_url === undefined ? old.logo_url : cleanUrl(req.body.logo_url);
    const country = clean(req.body?.country ?? old.country,80);
    const active = req.body?.active === undefined ? old.active : (String(req.body.active)==="0" ? 0 : 1);
    if(!name) return res.status(400).json({error:"Channel name is required"});
    try{
      tvDb.prepare(`UPDATE tv_channels SET name=?,logo_url=?,country=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(name,logoUrl,country,active,old.id);
      if(old.logo_url && old.logo_url!==logoUrl) removeLocalLogo(old.logo_url);
      res.json(tvDb.prepare("SELECT * FROM tv_channels WHERE id=?").get(old.id));
    }catch(e){
      if(String(e.message).includes("UNIQUE")) return res.status(409).json({error:"A channel with this name already exists"});
      res.status(500).json({error:"Could not update TV channel"});
    }
  });

  app.delete("/api/admin/tv-channels/:id", adminOnly, (req,res)=>{
    const channel = tvDb.prepare("SELECT * FROM tv_channels WHERE id=?").get(req.params.id);
    if(!channel) return res.status(404).json({error:"TV channel not found"});
    const tx = tvDb.transaction(()=>{
      tvDb.prepare("DELETE FROM match_tv_channels WHERE channel_id=?").run(channel.id);
      tvDb.prepare("DELETE FROM tv_channels WHERE id=?").run(channel.id);
    });
    tx();
    removeLocalLogo(channel.logo_url);
    res.json({ok:true});
  });

  app.get("/api/admin/match-tv-channels", adminOnly, (req,res)=>{
    const rows = tvDb.prepare(`
      SELECT a.*,c.name AS channel_name,c.logo_url AS channel_logo,c.country AS channel_country
      FROM match_tv_channels a JOIN tv_channels c ON c.id=a.channel_id
      ORDER BY CASE WHEN a.kickoff IS NULL OR a.kickoff='' THEN 1 ELSE 0 END, datetime(a.kickoff), a.id DESC
      LIMIT 1000
    `).all();
    res.json(rows);
  });

  app.post("/api/admin/match-tv-channels", adminOnly, (req,res)=>{
    const channelId = Number(req.body?.channel_id);
    const channel = tvDb.prepare("SELECT id FROM tv_channels WHERE id=? AND active=1").get(channelId);
    if(!channel) return res.status(400).json({error:"Select an active TV channel"});
    const home = clean(req.body?.home_team,160), away = clean(req.body?.away_team,160);
    if(!home || !away) return res.status(400).json({error:"Home and away teams are required"});
    const fixtureId = clean(req.body?.fixture_id,120) || null;
    const league = clean(req.body?.league,160);
    const kickoff = clean(req.body?.kickoff,80) || null;
    const note = clean(req.body?.note,240);
    const matchKey = clean(req.body?.match_key,500) || makeMatchKey(req.body||{});
    tvDb.prepare(`
      INSERT INTO match_tv_channels(match_key,fixture_id,home_team,away_team,league,kickoff,channel_id,note,active)
      VALUES(?,?,?,?,?,?,?,?,1)
      ON CONFLICT(match_key,channel_id) DO UPDATE SET fixture_id=excluded.fixture_id,home_team=excluded.home_team,
        away_team=excluded.away_team,league=excluded.league,kickoff=excluded.kickoff,note=excluded.note,active=1,updated_at=CURRENT_TIMESTAMP
    `).run(matchKey,fixtureId,home,away,league,kickoff,channelId,note);
    const row = tvDb.prepare(`SELECT a.*,c.name AS channel_name,c.logo_url AS channel_logo,c.country AS channel_country FROM match_tv_channels a JOIN tv_channels c ON c.id=a.channel_id WHERE a.match_key=? AND a.channel_id=?`).get(matchKey,channelId);
    res.json(row);
  });

  app.delete("/api/admin/match-tv-channels/:id", adminOnly, (req,res)=>{
    const info = tvDb.prepare("DELETE FROM match_tv_channels WHERE id=?").run(req.params.id);
    if(!info.changes) return res.status(404).json({error:"Match channel assignment not found"});
    res.json({ok:true});
  });
}

const originalListen = express.application.listen;
express.application.listen = function patchedListen(...args){
  if(!this.__tvChannelManagerInstalled){
    this.__tvChannelManagerInstalled = true;
    const router = this._router;
    if(router && Array.isArray(router.stack)){
      const before = router.stack.length;
      registerRoutes(this);
      const added = router.stack.splice(before);
      const insertAt = Math.max(0, router.stack.length - 1);
      router.stack.splice(insertAt,0,...added);
    }else registerRoutes(this);
  }
  return originalListen.apply(this,args);
};
