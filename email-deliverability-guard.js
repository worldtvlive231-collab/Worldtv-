"use strict";

require("dotenv").config();

// Keep the legacy queue worker as a safety net, but never let it drain a burst.
// Transactional mail is handled by the fast worker below; recovery mail is
// released to the legacy worker one message at a time.
process.env.EMAIL_QUEUE_BATCH_SIZE = "1";
if (!process.env.EMAIL_QUEUE_INTERVAL_SECONDS || Number(process.env.EMAIL_QUEUE_INTERVAL_SECONDS) < 60) {
  process.env.EMAIL_QUEUE_INTERVAL_SECONDS = "60";
}

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "data", "worldtv.sqlite");
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const EMAIL_FROM = String(process.env.EMAIL_FROM || "").trim();
const RECOVERY_SEND_INTERVAL_MINUTES = Math.max(5, Number(process.env.SALES_RECOVERY_SEND_INTERVAL_MINUTES || 5));
const CUSTOMER_COOLDOWN_HOURS = Math.max(1, Number(process.env.SALES_RECOVERY_CUSTOMER_COOLDOWN_HOURS || 24));
const TRANSACTIONAL_INTERVAL_SECONDS = Math.max(15, Number(process.env.TRANSACTIONAL_EMAIL_INTERVAL_SECONDS || 15));
const TRANSACTIONAL_RECIPIENT_COOLDOWN_SECONDS = Math.max(30, Number(process.env.TRANSACTIONAL_RECIPIENT_COOLDOWN_SECONDS || 60));

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("busy_timeout=5000");

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function initializeGuardTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_delivery_guard(
      queue_id INTEGER PRIMARY KEY,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      last_sent_at TEXT,
      last_error TEXT
    );
  `);
}
initializeGuardTable();

let releasedRecoveryId = null;
let transactionalWorkerRunning = false;

function holdQueues() {
  if (!tableExists("email_queue") || !tableExists("sales_recovery_events")) return;

  if (releasedRecoveryId) {
    const row = db.prepare("SELECT status,attempts FROM email_queue WHERE id=?").get(releasedRecoveryId);
    if (!row || row.status !== "queued" || Number(row.attempts || 0) >= 5) {
      releasedRecoveryId = null;
    }
  }

  // attempts=99 is a durable hold marker for recovery messages. The existing
  // worker only processes attempts < 5, so status can remain 'queued' for the UI.
  db.prepare(`
    UPDATE email_queue
    SET attempts=99
    WHERE status='queued' AND attempts < 98
      AND EXISTS(SELECT 1 FROM sales_recovery_events e WHERE e.queue_id=email_queue.id)
      AND id<>?
  `).run(releasedRecoveryId || -1);

  // attempts=98 hands transactional messages to the fast guarded worker below.
  db.prepare(`
    UPDATE email_queue
    SET attempts=98
    WHERE status='queued' AND attempts < 98
      AND NOT EXISTS(SELECT 1 FROM sales_recovery_events e WHERE e.queue_id=email_queue.id)
  `).run();
}

function recoveryMaySendNow() {
  if (!tableExists("sales_recovery_events")) return false;
  const recent = db.prepare(`
    SELECT 1
    FROM sales_recovery_events
    WHERE sent_at IS NOT NULL
      AND datetime(sent_at) > datetime('now', ?)
    LIMIT 1
  `).get(`-${RECOVERY_SEND_INTERVAL_MINUTES} minutes`);
  return !recent;
}

function releaseOneRecovery() {
  if (!tableExists("email_queue") || !tableExists("sales_recovery_events")) return;
  holdQueues();
  if (releasedRecoveryId || !recoveryMaySendNow()) return;

  const row = db.prepare(`
    SELECT q.id,e.user_id
    FROM email_queue q
    JOIN sales_recovery_events e ON e.queue_id=q.id
    WHERE q.status='queued' AND q.attempts=99
      AND NOT EXISTS(
        SELECT 1 FROM sales_recovery_events recent
        WHERE recent.user_id=e.user_id
          AND recent.sent_at IS NOT NULL
          AND datetime(recent.sent_at) > datetime('now', ?)
      )
    ORDER BY q.id ASC
    LIMIT 1
  `).get(`-${CUSTOMER_COOLDOWN_HOURS} hours`);

  if (!row) return;
  const changed = db.prepare("UPDATE email_queue SET attempts=0 WHERE id=? AND status='queued' AND attempts=99").run(row.id);
  if (changed.changes) releasedRecoveryId = Number(row.id);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function textToHtml(text) {
  const escaped = escapeHtml(text);
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.55;color:#17130a"><div style="max-width:620px;margin:auto"><h2 style="color:#b57a00">WORLD TV</h2><p>${escaped.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p></div></body></html>`;
}

async function sendWithResend(row) {
  if (!RESEND_API_KEY || !EMAIL_FROM) return { sent:false, error:"Email provider not configured" };
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
    return { sent:false, error:`Resend ${response.status}: ${body.slice(0,300)}` };
  }
  return { sent:true };
}

async function processOneTransactional() {
  if (transactionalWorkerRunning || !RESEND_API_KEY || !EMAIL_FROM) return;
  if (!tableExists("email_queue") || !tableExists("sales_recovery_events")) return;

  transactionalWorkerRunning = true;
  try {
    holdQueues();
    const row = db.prepare(`
      SELECT q.*
      FROM email_queue q
      WHERE q.status='queued' AND q.attempts=98
        AND NOT EXISTS(SELECT 1 FROM sales_recovery_events e WHERE e.queue_id=q.id)
        AND NOT EXISTS(
          SELECT 1 FROM email_queue recent
          WHERE lower(recent.recipient_email)=lower(q.recipient_email)
            AND recent.status='sent' AND recent.sent_at IS NOT NULL
            AND datetime(recent.sent_at) > datetime('now', ?)
        )
      ORDER BY q.id ASC
      LIMIT 1
    `).get(`-${TRANSACTIONAL_RECIPIENT_COOLDOWN_SECONDS} seconds`);

    if (!row) return;
    const claim = db.prepare("UPDATE email_queue SET status='sending' WHERE id=? AND status='queued' AND attempts=98").run(row.id);
    if (!claim.changes) return;

    const guard = db.prepare("SELECT failure_count FROM email_delivery_guard WHERE queue_id=?").get(row.id);
    const priorFailures = Number(guard?.failure_count || 0);

    try {
      const result = await sendWithResend(row);
      if (result.sent) {
        db.prepare("UPDATE email_queue SET status='sent',sent_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
        db.prepare(`
          INSERT INTO email_delivery_guard(queue_id,failure_count,last_attempt_at,last_sent_at,last_error)
          VALUES(?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,NULL)
          ON CONFLICT(queue_id) DO UPDATE SET failure_count=0,last_attempt_at=CURRENT_TIMESTAMP,last_sent_at=CURRENT_TIMESTAMP,last_error=NULL
        `).run(row.id);
      } else {
        const failures = priorFailures + 1;
        db.prepare(`
          INSERT INTO email_delivery_guard(queue_id,failure_count,last_attempt_at,last_error)
          VALUES(?,?,CURRENT_TIMESTAMP,?)
          ON CONFLICT(queue_id) DO UPDATE SET failure_count=excluded.failure_count,last_attempt_at=CURRENT_TIMESTAMP,last_error=excluded.last_error
        `).run(row.id, failures, result.error || "Email delivery failed");
        db.prepare("UPDATE email_queue SET status=?,attempts=98 WHERE id=?")
          .run(failures >= 5 ? "failed" : "queued", row.id);
      }
    } catch (error) {
      const failures = priorFailures + 1;
      const message = String(error?.message || error).slice(0,500);
      db.prepare(`
        INSERT INTO email_delivery_guard(queue_id,failure_count,last_attempt_at,last_error)
        VALUES(?,?,CURRENT_TIMESTAMP,?)
        ON CONFLICT(queue_id) DO UPDATE SET failure_count=excluded.failure_count,last_attempt_at=CURRENT_TIMESTAMP,last_error=excluded.last_error
      `).run(row.id, failures, message);
      db.prepare("UPDATE email_queue SET status=?,attempts=98 WHERE id=?")
        .run(failures >= 5 ? "failed" : "queued", row.id);
    }
  } finally {
    transactionalWorkerRunning = false;
  }
}

// Recover a transactional claim after a process restart.
if (tableExists("email_queue") && tableExists("sales_recovery_events")) {
  db.prepare(`
    UPDATE email_queue SET status='queued',attempts=98
    WHERE status='sending'
      AND NOT EXISTS(SELECT 1 FROM sales_recovery_events e WHERE e.queue_id=email_queue.id)
  `).run();
}

// Hold any backlog before sales-recovery-bootstrap's startup worker runs at 10s.
holdQueues();
setInterval(holdQueues, 1000).unref();
setTimeout(releaseOneRecovery, 30000).unref();
setInterval(releaseOneRecovery, 30000).unref();
setTimeout(() => processOneTransactional().catch(err => console.error("Transactional email worker:", err.message)), 12000).unref();
setInterval(() => processOneTransactional().catch(err => console.error("Transactional email worker:", err.message)), TRANSACTIONAL_INTERVAL_SECONDS * 1000).unref();

module.exports = { holdQueues, releaseOneRecovery, processOneTransactional };
