"use strict";

require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "data", "worldtv.sqlite");
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || process.env.APP_URL || "https://myworldtvlive.com").replace(/\/+$/, "");
const SUBSCRIPTION_PRICE_USD = Number(process.env.SUBSCRIPTION_PROMO_USD || 23);
const RECOVERY_INTERVAL_MINUTES = Math.max(15, Number(process.env.SALES_RECOVERY_INTERVAL_MINUTES || 30));
const EMAIL_INTERVAL_SECONDS = Math.max(30, Number(process.env.EMAIL_QUEUE_INTERVAL_SECONDS || 60));
const MAX_EMAILS_PER_BATCH = Math.min(50, Math.max(1, Number(process.env.EMAIL_QUEUE_BATCH_SIZE || 15)));
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const EMAIL_FROM = String(process.env.EMAIL_FROM || "").trim();
const SIGNING_SECRET = String(process.env.SALES_RECOVERY_SIGNING_SECRET || process.env.ADMIN_PASSWORD || "worldtv-sales-recovery");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode=WAL");
db.pragma("busy_timeout=5000");

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function initializeRecoveryTables() {
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

    CREATE TABLE IF NOT EXISTS sales_recovery_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      recovery_type TEXT NOT NULL,
      source_key TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      queue_id INTEGER,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at TEXT,
      converted_at TEXT,
      converted_order_id INTEGER,
      last_error TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_recovery_unique
      ON sales_recovery_events(user_id,recovery_type,source_key);
    CREATE INDEX IF NOT EXISTS idx_sales_recovery_created
      ON sales_recovery_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_recovery_status
      ON sales_recovery_events(status);

    CREATE TABLE IF NOT EXISTS sales_recovery_runs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      candidates INTEGER NOT NULL DEFAULT 0,
      queued INTEGER NOT NULL DEFAULT 0,
      converted INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS sales_recovery_opt_outs(
      user_id INTEGER PRIMARY KEY,
      email TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
initializeRecoveryTables();

function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || "");
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function subscribeUrl() {
  return `${PUBLIC_BASE_URL}/subscribe.html`;
}

function signUnsubscribe(userId, email) {
  return crypto.createHmac("sha256", SIGNING_SECRET).update(`${userId}:${String(email || "").toLowerCase()}`).digest("hex");
}

function unsubscribeUrl(userId, email) {
  const sig = signUnsubscribe(userId, email);
  return `${PUBLIC_BASE_URL}/sales-recovery/unsubscribe?u=${encodeURIComponent(userId)}&e=${encodeURIComponent(email)}&sig=${sig}`;
}

function isOptedOut(userId) {
  return !!db.prepare("SELECT 1 FROM sales_recovery_opt_outs WHERE user_id=?").get(userId);
}

function queueRecoveryEmail(candidate) {
  if (!candidate || !candidate.user_id || !candidate.email || !candidate.recovery_type || !candidate.source_key) return false;
  if (isOptedOut(candidate.user_id)) return false;

  const existing = db.prepare(`
    SELECT id FROM sales_recovery_events
    WHERE user_id=? AND recovery_type=? AND source_key=?
  `).get(candidate.user_id, candidate.recovery_type, candidate.source_key);
  if (existing) return false;

  const message = `${candidate.message}\n\nSubscribe / renew: ${subscribeUrl()}\n\nTo stop sales-recovery reminders: ${unsubscribeUrl(candidate.user_id, candidate.email)}`;

  const tx = db.transaction(() => {
    const event = db.prepare(`
      INSERT INTO sales_recovery_events(user_id,recovery_type,source_key,subject,message,status)
      VALUES(?,?,?,?,?,'queued')
    `).run(candidate.user_id, candidate.recovery_type, candidate.source_key, candidate.subject, message);

    const queued = db.prepare(`
      INSERT INTO email_queue(user_id,recipient_email,subject,message,status)
      VALUES(?,?,?,?, 'queued')
    `).run(candidate.user_id, String(candidate.email).trim(), candidate.subject, message);

    db.prepare("UPDATE sales_recovery_events SET queue_id=? WHERE id=?")
      .run(queued.lastInsertRowid, event.lastInsertRowid);
  });

  try {
    tx();
    return true;
  } catch (error) {
    if (String(error && error.message || "").includes("UNIQUE")) return false;
    throw error;
  }
}

function collectCandidates() {
  if (!["users", "orders", "subscription_codes"].every(tableExists)) return [];
  const candidates = [];
  const abandonedUsers = new Set();

  // Use only the latest qualifying checkout per customer so repeated clicks cannot
  // generate a burst of reminders.
  if (tableExists("checkout_requests")) {
    const abandoned = db.prepare(`
      SELECT c.reference,c.user_id,c.created_at,u.name,u.email
      FROM checkout_requests c
      JOIN users u ON u.id=c.user_id
      WHERE c.status='awaiting_payment'
        AND datetime(c.created_at) <= datetime('now','-1 hour')
        AND datetime(c.created_at) >= datetime('now','-7 days')
        AND u.email IS NOT NULL AND TRIM(u.email)<>''
        AND c.id=(
          SELECT c2.id FROM checkout_requests c2
          WHERE c2.user_id=c.user_id AND c2.status='awaiting_payment'
            AND datetime(c2.created_at) <= datetime('now','-1 hour')
            AND datetime(c2.created_at) >= datetime('now','-7 days')
          ORDER BY c2.id DESC LIMIT 1
        )
        AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.reference=c.reference AND o.status='paid')
        AND NOT EXISTS(SELECT 1 FROM sales_recovery_opt_outs x WHERE x.user_id=c.user_id)
    `).all();

    for (const c of abandoned) {
      abandonedUsers.add(Number(c.user_id));
      candidates.push({
        user_id: c.user_id,
        email: c.email,
        recovery_type: "abandoned_checkout",
        source_key: c.reference,
        subject: `Complete your WORLD TV $${SUBSCRIPTION_PRICE_USD.toFixed(0)} subscription`,
        message: `Hi ${c.name || "there"}, your WORLD TV checkout was not completed. You can return to the website and finish your subscription whenever you are ready.`
      });
    }
  }

  // Registered customers who have never paid. The specific abandoned-checkout
  // reminder takes priority when both states apply.
  const registered = db.prepare(`
    SELECT u.id AS user_id,u.name,u.email,u.created_at
    FROM users u
    WHERE u.email IS NOT NULL AND TRIM(u.email)<>''
      AND datetime(u.created_at) <= datetime('now','-2 hours')
      AND datetime(u.created_at) >= datetime('now','-30 days')
      AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.user_id=u.id AND o.status='paid')
      AND NOT EXISTS(SELECT 1 FROM sales_recovery_opt_outs x WHERE x.user_id=u.id)
  `).all();

  for (const u of registered) {
    if (abandonedUsers.has(Number(u.user_id))) continue;
    candidates.push({
      user_id: u.user_id,
      email: u.email,
      recovery_type: "registered_no_purchase",
      source_key: `signup:${String(u.created_at).slice(0, 10)}`,
      subject: "Finish setting up WORLD TV",
      message: `Hi ${u.name || "there"}, your WORLD TV account is ready. Complete your subscription for $${SUBSCRIPTION_PRICE_USD.toFixed(0)} to start watching.`
    });
  }

  const expiring = db.prepare(`
    SELECT sc.id AS code_id,sc.user_id,sc.expires_at,u.name,u.email
    FROM subscription_codes sc
    JOIN users u ON u.id=sc.user_id
    WHERE sc.status='used'
      AND sc.expires_at IS NOT NULL
      AND datetime(sc.expires_at) > datetime('now')
      AND datetime(sc.expires_at) <= datetime('now','+3 days')
      AND u.email IS NOT NULL AND TRIM(u.email)<>''
      AND NOT EXISTS(
        SELECT 1 FROM subscription_codes newer
        WHERE newer.user_id=sc.user_id AND newer.status='used'
          AND newer.expires_at IS NOT NULL
          AND datetime(newer.expires_at) > datetime(sc.expires_at)
      )
      AND NOT EXISTS(SELECT 1 FROM sales_recovery_opt_outs x WHERE x.user_id=sc.user_id)
  `).all();

  for (const s of expiring) {
    candidates.push({
      user_id: s.user_id,
      email: s.email,
      recovery_type: "expiring_subscription",
      source_key: `code:${s.code_id}:${s.expires_at}`,
      subject: "Your WORLD TV subscription expires soon",
      message: `Hi ${s.name || "there"}, your WORLD TV subscription expires on ${formatDate(s.expires_at)}. Renew now to keep your service active.`
    });
  }

  const expired = db.prepare(`
    SELECT sc.id AS code_id,sc.user_id,sc.expires_at,u.name,u.email
    FROM subscription_codes sc
    JOIN users u ON u.id=sc.user_id
    WHERE sc.status='used'
      AND sc.expires_at IS NOT NULL
      AND datetime(sc.expires_at) <= datetime('now')
      AND datetime(sc.expires_at) >= datetime('now','-14 days')
      AND u.email IS NOT NULL AND TRIM(u.email)<>''
      AND NOT EXISTS(
        SELECT 1 FROM subscription_codes active
        WHERE active.user_id=sc.user_id AND active.status='used'
          AND active.expires_at IS NOT NULL AND datetime(active.expires_at) > datetime('now')
      )
      AND NOT EXISTS(
        SELECT 1 FROM subscription_codes newer
        WHERE newer.user_id=sc.user_id AND newer.status='used'
          AND newer.expires_at IS NOT NULL
          AND datetime(newer.expires_at) > datetime(sc.expires_at)
      )
      AND NOT EXISTS(SELECT 1 FROM sales_recovery_opt_outs x WHERE x.user_id=sc.user_id)
  `).all();

  for (const s of expired) {
    candidates.push({
      user_id: s.user_id,
      email: s.email,
      recovery_type: "expired_subscription",
      source_key: `code:${s.code_id}:${s.expires_at}`,
      subject: "Renew your WORLD TV subscription",
      message: `Hi ${s.name || "there"}, your WORLD TV subscription expired on ${formatDate(s.expires_at)}. Renew for $${SUBSCRIPTION_PRICE_USD.toFixed(0)} to restore access.`
    });
  }

  return candidates;
}

function refreshRecoveryStatuses() {
  db.prepare(`
    UPDATE sales_recovery_events
    SET status=COALESCE((SELECT q.status FROM email_queue q WHERE q.id=sales_recovery_events.queue_id),status),
        sent_at=COALESCE((SELECT q.sent_at FROM email_queue q WHERE q.id=sales_recovery_events.queue_id),sent_at)
    WHERE queue_id IS NOT NULL
  `).run();
}

function markConversions() {
  if (!tableExists("orders")) return 0;
  const orders = db.prepare(`
    SELECT o.id,o.user_id,COALESCE(o.paid_at,o.created_at) AS conversion_time
    FROM orders o
    WHERE o.status='paid'
      AND NOT EXISTS(SELECT 1 FROM sales_recovery_events used WHERE used.converted_order_id=o.id)
      AND EXISTS(
        SELECT 1 FROM sales_recovery_events e
        WHERE e.user_id=o.user_id AND e.converted_at IS NULL
          AND datetime(e.created_at) < datetime(COALESCE(o.paid_at,o.created_at))
      )
    ORDER BY datetime(COALESCE(o.paid_at,o.created_at)) ASC,o.id ASC
  `).all();
  let converted = 0;
  const findLatestEvent = db.prepare(`
    SELECT id FROM sales_recovery_events
    WHERE user_id=? AND converted_at IS NULL
      AND datetime(created_at) < datetime(?)
    ORDER BY datetime(created_at) DESC,id DESC
    LIMIT 1
  `);
  const update = db.prepare(`
    UPDATE sales_recovery_events
    SET converted_at=?,converted_order_id=?
    WHERE id=? AND converted_at IS NULL
  `);

  for (const order of orders) {
    const event = findLatestEvent.get(order.user_id, order.conversion_time);
    if (!event) continue;
    const r = update.run(order.conversion_time, order.id, event.id);
    converted += r.changes;
  }
  return converted;
}

async function runRecoveryCycle(trigger = "scheduled") {
  const run = db.prepare("INSERT INTO sales_recovery_runs(notes) VALUES(?)").run(trigger);
  let candidates = 0;
  let queued = 0;
  let errors = 0;
  let converted = 0;

  try {
    const list = collectCandidates();
    candidates = list.length;
    for (const candidate of list) {
      try {
        if (queueRecoveryEmail(candidate)) queued += 1;
      } catch (error) {
        errors += 1;
        console.error("Sales recovery queue error:", error.message);
      }
    }
    refreshRecoveryStatuses();
    converted = markConversions();
  } catch (error) {
    errors += 1;
    console.error("Sales recovery cycle failed:", error.message);
  }

  db.prepare(`
    UPDATE sales_recovery_runs
    SET finished_at=CURRENT_TIMESTAMP,candidates=?,queued=?,converted=?,error_count=?
    WHERE id=?
  `).run(candidates, queued, converted, errors, run.lastInsertRowid);

  return { ok: errors === 0, candidates, queued, converted, errors };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function textToHtml(text) {
  const escaped = escapeHtml(text);
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.55;color:#17130a"><div style="max-width:620px;margin:auto"><h2 style="color:#b57a00">WORLD TV</h2><p>${escaped.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p></div></body></html>`;
}

async function sendWithResend(row) {
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    return { sent: false, configured: false, error: "Email provider not configured" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `worldtv-email-${row.id}`
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [row.recipient_email],
      subject: row.subject,
      text: row.message,
      html: textToHtml(row.message)
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { sent: false, configured: true, error: `Resend ${response.status}: ${body.slice(0, 300)}` };
  }
  return { sent: true, configured: true };
}

let emailWorkerRunning = false;
async function processEmailQueue() {
  if (emailWorkerRunning) return { ok: true, skipped: true };
  if (!RESEND_API_KEY || !EMAIL_FROM) return { ok: false, configured: false, processed: 0 };

  emailWorkerRunning = true;
  let sent = 0;
  let failed = 0;
  try {
    const rows = db.prepare(`
      SELECT * FROM email_queue
      WHERE status='queued' AND attempts < 5
      ORDER BY id ASC
      LIMIT ?
    `).all(MAX_EMAILS_PER_BATCH);

    for (const row of rows) {
      db.prepare("UPDATE email_queue SET attempts=attempts+1 WHERE id=?").run(row.id);
      try {
        const result = await sendWithResend(row);
        if (result.sent) {
          db.prepare("UPDATE email_queue SET status='sent',sent_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
          sent += 1;
        } else if (result.configured) {
          const attempts = Number(row.attempts || 0) + 1;
          if (attempts >= 5) {
            db.prepare("UPDATE email_queue SET status='failed' WHERE id=?").run(row.id);
            failed += 1;
          }
          db.prepare("UPDATE sales_recovery_events SET last_error=? WHERE queue_id=?")
            .run(result.error || "Email delivery failed", row.id);
        }
      } catch (error) {
        const attempts = Number(row.attempts || 0) + 1;
        if (attempts >= 5) {
          db.prepare("UPDATE email_queue SET status='failed' WHERE id=?").run(row.id);
          failed += 1;
        }
        db.prepare("UPDATE sales_recovery_events SET last_error=? WHERE queue_id=?")
          .run(String(error.message || error).slice(0, 500), row.id);
      }
    }
    refreshRecoveryStatuses();
    markConversions();
    return { ok: true, configured: true, processed: rows.length, sent, failed };
  } finally {
    emailWorkerRunning = false;
  }
}

function adminOnly(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!token || !adminEmail || !adminPassword) {
    return res.status(401).json({ error: "Admin authentication required" });
  }
  const expected = crypto.createHmac("sha256", adminPassword).update(adminEmail).digest("hex");
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Admin authentication required" });
  }
  next();
}

function getSummary() {
  refreshRecoveryStatuses();
  markConversions();
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN converted_at IS NOT NULL THEN 1 ELSE 0 END) AS converted
    FROM sales_recovery_events
  `).get();
  const lastRun = db.prepare("SELECT * FROM sales_recovery_runs ORDER BY id DESC LIMIT 1").get() || null;
  const optOuts = db.prepare("SELECT COUNT(*) AS count FROM sales_recovery_opt_outs").get().count;
  const emailQueue = db.prepare(`
    SELECT
      SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
    FROM email_queue
  `).get();
  return {
    totals: {
      total: Number(totals.total || 0),
      queued: Number(totals.queued || 0),
      sent: Number(totals.sent || 0),
      failed: Number(totals.failed || 0),
      converted: Number(totals.converted || 0)
    },
    last_run: lastRun,
    opt_outs: Number(optOuts || 0),
    email_queue: {
      queued: Number(emailQueue.queued || 0),
      sent: Number(emailQueue.sent || 0),
      failed: Number(emailQueue.failed || 0)
    },
    provider: {
      name: "Resend",
      configured: Boolean(RESEND_API_KEY && EMAIL_FROM),
      from: EMAIL_FROM || null
    },
    schedule: {
      recovery_interval_minutes: RECOVERY_INTERVAL_MINUTES,
      email_interval_seconds: EMAIL_INTERVAL_SECONDS
    }
  };
}

function installRoutes(app, expressLib) {
  const router = expressLib.Router();
  router.use(expressLib.json({ limit: "100kb" }));

  router.get("/api/admin/sales-recovery/summary", adminOnly, (req, res) => {
    try { res.json(getSummary()); }
    catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.get("/api/admin/sales-recovery/events", adminOnly, (req, res) => {
    try {
      refreshRecoveryStatuses();
      markConversions();
      const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
      const rows = db.prepare(`
        SELECT e.id,e.user_id,e.recovery_type,e.source_key,e.subject,e.status,e.created_at,e.sent_at,
               e.converted_at,e.converted_order_id,e.last_error,u.name,u.email
        FROM sales_recovery_events e
        LEFT JOIN users u ON u.id=e.user_id
        ORDER BY e.id DESC
        LIMIT ?
      `).all(limit);
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/api/admin/sales-recovery/run", adminOnly, async (req, res) => {
    try {
      const result = await runRecoveryCycle("manual");
      const email = await processEmailQueue();
      res.json({ ...result, email });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/api/admin/sales-recovery/process-email", adminOnly, async (req, res) => {
    try { res.json(await processEmailQueue()); }
    catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.get("/sales-recovery/unsubscribe", (req, res) => {
    const userId = Number(req.query.u);
    const email = String(req.query.e || "").trim().toLowerCase();
    const sig = String(req.query.sig || "");
    if (!userId || !email || !sig) return res.status(400).send("Invalid unsubscribe link.");
    const expected = signUnsubscribe(userId, email);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(400).send("Invalid unsubscribe link.");
    const user = tableExists("users") ? db.prepare("SELECT id,email FROM users WHERE id=?").get(userId) : null;
    if (!user || String(user.email || "").trim().toLowerCase() !== email) return res.status(400).send("Invalid unsubscribe link.");
    db.prepare(`
      INSERT INTO sales_recovery_opt_outs(user_id,email) VALUES(?,?)
      ON CONFLICT(user_id) DO UPDATE SET email=excluded.email
    `).run(userId, email);
    res.type("html").send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>WORLD TV</title></head><body style="font-family:Arial,sans-serif;background:#fff9eb;padding:40px"><div style="max-width:560px;margin:auto;background:white;padding:30px;border-radius:18px"><h2>WORLD TV</h2><p>You have been unsubscribed from sales-recovery reminders.</p><p>You can still use your account and receive essential account or payment messages.</p></div></body></html>`);
  });

  app.use(router);
}

// Preloaded before server.js so these routes are mounted before the main 404 handler.
const expressPath = require.resolve("express");
const originalExpress = require(expressPath);
function wrappedExpress(...args) {
  const app = originalExpress(...args);
  installRoutes(app, originalExpress);
  return app;
}
Object.assign(wrappedExpress, originalExpress);
Object.setPrototypeOf(wrappedExpress, Object.getPrototypeOf(originalExpress));
require.cache[expressPath].exports = wrappedExpress;

setTimeout(() => {
  runRecoveryCycle("startup").catch(error => console.error("Sales recovery startup error:", error.message));
  processEmailQueue().catch(error => console.error("Email queue startup error:", error.message));
}, 10000).unref();

setInterval(() => {
  runRecoveryCycle("scheduled").catch(error => console.error("Sales recovery scheduled error:", error.message));
}, RECOVERY_INTERVAL_MINUTES * 60 * 1000).unref();

setInterval(() => {
  processEmailQueue().catch(error => console.error("Email queue worker error:", error.message));
}, EMAIL_INTERVAL_SECONDS * 1000).unref();

module.exports = { runRecoveryCycle, processEmailQueue, getSummary };
