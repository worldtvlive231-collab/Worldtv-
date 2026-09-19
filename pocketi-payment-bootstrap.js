"use strict";

require("dotenv").config();
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const Database = require("better-sqlite3");

const db = new Database(path.join(process.cwd(), "data", "worldtv.sqlite"));
db.pragma("journal_mode=WAL");
db.pragma("busy_timeout=5000");

const API_BASE = String(process.env.POCKETI_API_BASE || "https://api-shop.pocketi.app").replace(/\/+$/, "");
const SHOP_SLUG = String(process.env.POCKETI_SHOP_SLUG || "worldtv");
const MERCHANT_ID = Number(process.env.POCKETI_MERCHANT_ID || 21407);
const PRODUCT_ID = String(process.env.POCKETI_PRODUCT_ID || "783107ff-addf-4d65-91fa-ad3d1f21b0fb");
const EXPECTED_AMOUNT_GHS = Number(process.env.POCKETI_PRODUCT_PRICE_GHS || 250);
const POLL_MS = Math.max(15000, Number(process.env.POCKETI_PAYMENT_POLL_MS || 30000));

db.exec(`
CREATE TABLE IF NOT EXISTS pocketi_payment_intents(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  plan_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  amount_ghs REAL NOT NULL,
  total_due_ghs REAL,
  provider TEXT NOT NULL,
  phone_last4 TEXT,
  status TEXT NOT NULL DEFAULT 'awaiting_payment',
  code_id INTEGER,
  provider_status TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pocketi_intents_pending
  ON pocketi_payment_intents(status, updated_at);
`);

function tableExists(name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function customerTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function customerFromRequest(req) {
  const token = String(req.headers["x-customer-token"] || "").trim();
  if (!token || !tableExists("customer_sessions")) return null;
  return db.prepare(`
    SELECT s.user_id AS userId,u.name,u.email
    FROM customer_sessions s
    JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now')
  `).get(customerTokenHash(token)) || null;
}

function normalizeGhanaPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("233")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return /^\d{9}$/.test(digits) ? digits : "";
}

async function pocketiRequest(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false || payload.status === false) {
    const error = new Error(payload.error || payload.message || `Pocketi request failed (${response.status})`);
    error.statusCode = response.status;
    throw error;
  }
  return payload.data ?? payload;
}

async function currentProduct() {
  const shop = await pocketiRequest(`/api/shop/${encodeURIComponent(SHOP_SLUG)}`);
  const merchant = shop?.merchant || {};
  const product = (shop?.products || []).find(item => String(item.id) === PRODUCT_ID);
  if (!product || product.isActive === false || product.inStock === false) {
    throw new Error("The WORLD TV Pocketi subscription is not currently available");
  }
  if (Number(merchant.id) !== MERCHANT_ID || Number(product.price) !== EXPECTED_AMOUNT_GHS) {
    throw new Error("Pocketi subscription details do not match the WORLD TV configuration");
  }
  return product;
}

function providerState(order) {
  const subject = order?.data?.order || order?.order || order?.data || order;
  const values = [
    subject?.paymentStatus, subject?.payment_status, subject?.invoiceStatus,
    subject?.invoice_status, subject?.status, subject?.orderStatus, subject?.order_status
  ];
  return values.filter(Boolean).map(value => String(value).trim().toLowerCase().replace(/[\s-]+/g, "_"));
}

function paymentSucceeded(order) {
  const paid = new Set(["paid", "success", "successful", "completed", "complete", "settled", "payment_confirmed"]);
  return providerState(order).some(status => paid.has(status));
}

function nextAdminCode(planId) {
  return db.prepare(`
    SELECT id,code FROM subscription_codes
    WHERE plan_id=? AND status='unused' AND user_id IS NULL AND reseller_id IS NULL
      AND (expires_at IS NULL OR datetime(expires_at)>datetime('now'))
    ORDER BY id ASC LIMIT 1
  `).get(planId);
}

function expiryFor(userId, durationDays) {
  let start = new Date();
  const current = db.prepare(`
    SELECT MAX(sc.expires_at) AS expiry
    FROM orders o JOIN subscription_codes sc ON sc.id=o.code_id
    WHERE o.user_id=? AND o.status='paid'
  `).get(userId);
  if (current?.expiry && new Date(current.expiry) > start) start = new Date(current.expiry);
  const expiry = new Date(start);
  expiry.setUTCDate(expiry.getUTCDate() + Number(durationDays || 365));
  return expiry.toISOString();
}

function fulfillIntent(intent, providerStatus) {
  const reference = `POCKETI-${intent.order_id}`;
  const existing = db.prepare(`
    SELECT o.id,sc.code,sc.expires_at FROM orders o
    LEFT JOIN subscription_codes sc ON sc.id=o.code_id WHERE o.reference=?
  `).get(reference);
  if (existing) return { already: true, code: existing.code, expiresAt: existing.expires_at };

  const plan = db.prepare("SELECT duration_days FROM plans WHERE id=? AND active=1").get(intent.plan_id);
  if (!plan) throw new Error("Pocketi subscription plan is unavailable");
  const code = nextAdminCode(intent.plan_id);
  if (!code) {
    db.prepare(`UPDATE pocketi_payment_intents SET status='payment_confirmed',provider_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(providerStatus || "paid", intent.id);
    return { pendingCode: true };
  }

  const expiresAt = expiryFor(intent.user_id, plan.duration_days);
  const paidAt = new Date().toISOString();
  const transaction = db.transaction(() => {
    const raced = db.prepare("SELECT id FROM orders WHERE reference=?").get(reference);
    if (raced) return { already: true };
    const assigned = db.prepare(`
      UPDATE subscription_codes SET status='used',user_id=?,expires_at=?
      WHERE id=? AND status='unused' AND user_id IS NULL AND reseller_id IS NULL
    `).run(intent.user_id, expiresAt, code.id);
    if (assigned.changes !== 1) throw new Error("Subscription code assignment conflict");
    db.prepare(`
      INSERT INTO orders(reference,user_id,plan_id,amount_pesewas,currency,status,code_id,paid_at)
      VALUES(?,?,?,?,?,'paid',?,?)
    `).run(reference, intent.user_id, intent.plan_id, Math.round(intent.amount_ghs * 100), "GHS", code.id, paidAt);
    db.prepare(`
      UPDATE pocketi_payment_intents
      SET status='fulfilled',code_id=?,provider_status=?,paid_at=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(code.id, providerStatus || "paid", paidAt, intent.id);
    if (tableExists("notifications")) {
      db.prepare("INSERT INTO notifications(user_id,title,message) VALUES(?,?,?)").run(
        intent.user_id, "Subscription Activated",
        `Your Pocketi payment was confirmed automatically. Your WORLD TV code is ${code.code}.`
      );
    }
    if (tableExists("audit_logs")) {
      db.prepare("INSERT INTO audit_logs(action,entity_type,entity_id,details) VALUES(?,?,?,?)").run(
        "pocketi_subscription_payment", "pocketi_order", intent.order_id, `Code ${code.code}`
      );
    }
    return { already: false };
  });
  try {
    const result = transaction();
    return { ...result, code: code.code, expiresAt };
  } catch (error) {
    const raced = db.prepare(`
      SELECT sc.code,sc.expires_at FROM orders o
      LEFT JOIN subscription_codes sc ON sc.id=o.code_id WHERE o.reference=?
    `).get(reference);
    if (raced) return { already: true, code: raced.code, expiresAt: raced.expires_at };
    throw error;
  }
}

async function sendActivationEmail(intent, result) {
  if (!result?.code || !tableExists("activation_email_log")) return;
  const reference = `POCKETI-${intent.order_id}`;
  if (db.prepare("SELECT 1 FROM activation_email_log WHERE reference=?").get(reference)) return;
  const user = db.prepare("SELECT name,email FROM users WHERE id=?").get(intent.user_id);
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!user?.email || !apiKey) return;
  const safe = value => String(value || "").replace(/[<>&]/g, "");
  const expiry = new Date(result.expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `worldtv-pocketi-${intent.order_id}`
    },
    body: JSON.stringify({
      from: String(process.env.EMAIL_FROM || "WORLD TV <support@myworldtvlive.com>"),
      to: [user.email],
      subject: "Your WORLD TV subscription is active",
      html: `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#fffaf0;color:#241b0c"><div style="max-width:620px;margin:auto;padding:28px"><h2>WORLD TV</h2><p>Hi ${safe(user.name || "Customer")}, your Pocketi payment was confirmed and your subscription is active.</p><p>Your subscription code is <strong style="font-size:24px">${safe(result.code)}</strong>.</p><p>Valid until ${safe(expiry)}.</p><p><a href="https://myworldtvlive.com/account.html">Open My Account</a></p></div></body></html>`,
      text: `Hi ${safe(user.name || "Customer")}, your WORLD TV subscription is active. Code: ${safe(result.code)}. Valid until ${expiry}. My Account: https://myworldtvlive.com/account.html`
    })
  });
  if (!response.ok) throw new Error(await response.text().catch(() => "Activation email failed"));
  db.prepare("INSERT OR IGNORE INTO activation_email_log(reference) VALUES(?)").run(reference);
}

let checking = false;
async function checkPocketiPayments(trigger = "scheduled", onlyOrderId = null) {
  if (checking && !onlyOrderId) return;
  if (!onlyOrderId) checking = true;
  try {
    const intents = onlyOrderId
      ? db.prepare("SELECT * FROM pocketi_payment_intents WHERE order_id=?").all(onlyOrderId)
      : db.prepare(`SELECT * FROM pocketi_payment_intents WHERE status IN ('awaiting_payment','payment_confirmed') ORDER BY id ASC LIMIT 100`).all();
    for (const intent of intents) {
      if (intent.status === "payment_confirmed") {
        const recovered = fulfillIntent(intent, intent.provider_status || "paid");
        if (recovered?.code) await sendActivationEmail(intent, recovered).catch(error => console.error("Pocketi activation email error:", error.message));
        continue;
      }
      let order;
      try {
        order = await pocketiRequest(`/api/order/${encodeURIComponent(intent.order_id)}`);
      } catch (error) {
        console.warn("Pocketi order status check failed", { trigger, order_id: intent.order_id, error: error.message });
        continue;
      }
      const state = providerState(order).join(",") || "pending";
      db.prepare("UPDATE pocketi_payment_intents SET provider_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(state, intent.id);
      if (!paymentSucceeded(order)) continue;
      const result = fulfillIntent(intent, state);
      if (result?.code) {
        await sendActivationEmail(intent, result).catch(error => console.error("Pocketi activation email error:", error.message));
        console.log("Pocketi payment fulfilled WORLD TV subscription", { order_id: intent.order_id, user_id: intent.user_id });
      }
    }
  } finally {
    if (!onlyOrderId) checking = false;
  }
}

async function initializePocketi(req, res) {
  try {
    const customer = customerFromRequest(req);
    if (!customer) return res.status(401).json({ error: "Please sign in before paying" });
    const phone = normalizeGhanaPhone(req.body?.phone);
    const provider = String(req.body?.provider || "").toUpperCase();
    if (!phone) return res.status(400).json({ error: "Enter a valid Ghana mobile number" });
    if (!["MTN", "VODAFONE", "AIRTELTIGO"].includes(provider)) return res.status(400).json({ error: "Choose a valid Mobile Money provider" });

    const recent = db.prepare(`
      SELECT order_id,total_due_ghs,status FROM pocketi_payment_intents
      WHERE user_id=? AND status='awaiting_payment' AND datetime(created_at)>datetime('now','-15 minutes')
      ORDER BY id DESC LIMIT 1
    `).get(customer.userId);
    if (recent) return res.json({ ok: true, reused: true, orderId: recent.order_id, total: recent.total_due_ghs, status: recent.status });

    const product = await currentProduct();
    const order = await pocketiRequest("/api/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantId: MERCHANT_ID,
        shopSlug: SHOP_SLUG,
        source: "marketi",
        customerName: String(customer.name || "WORLD TV Customer").trim(),
        customerPhone: phone,
        deliveryNote: "WORLD TV annual subscription",
        paymentMethod: "momo",
        serviceProvider: provider,
        deliveryType: "none",
        deliveryZoneId: null,
        items: [{ productId: PRODUCT_ID, quantity: 1, selectedVariants: {}, unitPrice: Number(product.price) }]
      })
    });
    const orderId = String(order?.orderId || order?.order_id || order?.id || "").trim();
    if (!orderId) throw new Error("Pocketi did not return an order number");
    const plan = db.prepare("SELECT id FROM plans WHERE active=1 AND duration_days>=360 ORDER BY duration_days DESC,id ASC LIMIT 1").get();
    if (!plan) throw new Error("WORLD TV subscription plan is unavailable");
    db.prepare(`
      INSERT INTO pocketi_payment_intents(order_id,user_id,plan_id,product_id,amount_ghs,total_due_ghs,provider,phone_last4)
      VALUES(?,?,?,?,?,?,?,?)
    `).run(orderId, customer.userId, plan.id, PRODUCT_ID, EXPECTED_AMOUNT_GHS, Number(order.total || order.totalDue || EXPECTED_AMOUNT_GHS), provider, phone.slice(-4));
    res.json({ ok: true, orderId, total: Number(order.total || order.totalDue || EXPECTED_AMOUNT_GHS), status: "awaiting_payment", message: "Pocketi sent a secure payment request to your phone." });
  } catch (error) {
    console.error("Pocketi payment initialization failed:", error);
    res.status(error.statusCode && error.statusCode < 500 ? error.statusCode : 502).json({ error: error.message || "Could not start Pocketi payment" });
  }
}

async function pocketiStatus(req, res) {
  try {
    const customer = customerFromRequest(req);
    if (!customer) return res.status(401).json({ error: "Unauthorized" });
    const orderId = String(req.params.orderId || "").trim();
    let intent = db.prepare("SELECT * FROM pocketi_payment_intents WHERE order_id=? AND user_id=?").get(orderId, customer.userId);
    if (!intent) return res.status(404).json({ error: "Pocketi order not found" });
    await checkPocketiPayments("customer_status", orderId);
    intent = db.prepare(`
      SELECT p.*,sc.code,sc.expires_at FROM pocketi_payment_intents p
      LEFT JOIN subscription_codes sc ON sc.id=p.code_id
      WHERE p.order_id=? AND p.user_id=?
    `).get(orderId, customer.userId);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, orderId, status: intent.status, provider_status: intent.provider_status, code: intent.code || null, expires_at: intent.expires_at || null });
  } catch (error) {
    console.error("Pocketi payment status failed:", error);
    res.status(500).json({ error: "Could not check Pocketi payment" });
  }
}

const originalPost = express.application.post;
express.application.post = function worldTvPocketiPost(route, ...handlers) {
  const result = originalPost.call(this, route, ...handlers);
  if (route === "/api/payment/paystack/verify" && !this.locals.__worldTvPocketiInstalled) {
    this.locals.__worldTvPocketiInstalled = true;
    originalPost.call(this, "/api/payment/pocketi/initialize", initializePocketi);
    this.get("/api/payment/pocketi/status/:orderId", pocketiStatus);
    console.log("WORLD TV Pocketi automatic payment routes enabled");
  }
  return result;
};

setTimeout(() => checkPocketiPayments("startup").catch(error => console.error(error)), 7000).unref?.();
const timer = setInterval(() => checkPocketiPayments("scheduled").catch(error => console.error(error)), POLL_MS);
timer.unref?.();

module.exports = { checkPocketiPayments, paymentSucceeded, normalizeGhanaPhone };
