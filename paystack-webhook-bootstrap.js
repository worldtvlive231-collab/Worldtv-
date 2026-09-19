"use strict";

const crypto = require("crypto");
const path = require("path");
const Database = require("better-sqlite3");
const express = require("express");

// Capture the exact JSON bytes so Paystack webhook signatures can be verified.
const originalJson = express.json;
express.json = function worldTvJson(options = {}) {
  const originalVerify = options.verify;
  return originalJson({
    ...options,
    verify(req, res, buf, encoding) {
      req.rawBody = Buffer.from(buf);
      if (typeof originalVerify === "function") {
        originalVerify(req, res, buf, encoding);
      }
    }
  });
};

const db = new Database(path.join(__dirname, "data", "worldtv.sqlite"));
db.pragma("journal_mode=WAL");
db.pragma("busy_timeout=5000");

const HOSTED_PAGE_URL = String(process.env.PAYSTACK_HOSTED_PAGE_URL || "https://paystack.shop/pay/x4sqejilmz");
const HOSTED_PAGE_AMOUNT_GHS = Number(process.env.PAYSTACK_HOSTED_PAGE_AMOUNT_GHS || 270);

db.exec(`
CREATE TABLE IF NOT EXISTS paystack_hosted_intents(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  plan_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  expected_amount_pesewas INTEGER NOT NULL,
  provider_reference TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'awaiting_payment',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_paystack_hosted_intents_pending
  ON paystack_hosted_intents(email,status,created_at);
`);

function customerTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function customerFromRequest(req) {
  const token = String(req.headers["x-customer-token"] || "").trim();
  if (!token) return null;
  return db.prepare(`
    SELECT s.user_id AS userId,u.name,u.email
    FROM customer_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now')
  `).get(customerTokenHash(token)) || null;
}

function initializeHostedPaystack(req, res) {
  try {
    const customer = customerFromRequest(req);
    if (!customer) return res.status(401).json({ error: "Please sign in before paying" });
    const plan = db.prepare("SELECT id FROM plans WHERE active=1 AND duration_days>=360 ORDER BY duration_days DESC,id ASC LIMIT 1").get();
    if (!plan) return res.status(503).json({ error: "The annual subscription plan is unavailable" });
    const expectedAmount = Math.round(HOSTED_PAGE_AMOUNT_GHS * 100);
    let intent = db.prepare(`
      SELECT id FROM paystack_hosted_intents
      WHERE user_id=? AND status='awaiting_payment' AND datetime(created_at)>datetime('now','-24 hours')
      ORDER BY id DESC LIMIT 1
    `).get(customer.userId);
    if (!intent) {
      const inserted = db.prepare(`
        INSERT INTO paystack_hosted_intents(user_id,plan_id,email,expected_amount_pesewas)
        VALUES(?,?,?,?)
      `).run(customer.userId, plan.id, String(customer.email).trim().toLowerCase(), expectedAmount);
      intent = { id: inserted.lastInsertRowid };
    }
    const url = new URL(HOSTED_PAGE_URL);
    url.searchParams.set("email", customer.email);
    res.json({ ok: true, intentId: intent.id, authorization_url: url.toString() });
  } catch (error) {
    console.error("Paystack hosted intent initialization failed:", error);
    res.status(500).json({ error: "Could not prepare the Paystack payment" });
  }
}

function safeEqualHex(a, b) {
  try {
    const left = Buffer.from(String(a || ""), "hex");
    const right = Buffer.from(String(b || ""), "hex");
    return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch (_) {
    return false;
  }
}

function verifyPaystackSignature(req) {
  const secret = String(process.env.PAYSTACK_SECRET_KEY || "");
  const signature = String(req.headers["x-paystack-signature"] || "");
  if (!secret || !signature || !req.rawBody) return false;
  const expected = crypto.createHmac("sha512", secret).update(req.rawBody).digest("hex");
  return safeEqualHex(signature, expected);
}

async function fetchVerifiedPaystackPayment(reference) {
  const secret = String(process.env.PAYSTACK_SECRET_KEY || "");
  if (!secret) throw new Error("PAYSTACK_SECRET_KEY is not configured");

  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json"
      }
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.status || !payload.data) {
    throw new Error(payload.message || "Paystack verification failed");
  }
  return payload.data;
}

async function sendActivationEmail(email, customerName, code, expiresAt) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.EMAIL_FROM || "WORLD TV <support@myworldtvlive.com>").trim();
  if (!apiKey || !email) return;

  const safeName = String(customerName || "Customer").replace(/[<>&]/g, "");
  const safeCode = String(code || "").replace(/[<>&]/g, "");
  const expiry = expiresAt ? new Date(expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Your WORLD TV subscription is active",
        html: `<!doctype html><html><body style="margin:0;background:#fffaf0;font-family:Arial,sans-serif;color:#241b0c"><div style="max-width:620px;margin:0 auto;padding:28px"><div style="background:#fff;border:1px solid #ead9aa;border-radius:18px;padding:28px;text-align:center"><img src="https://myworldtvlive.com/world-tv-logo.png" alt="WORLD TV" style="max-width:150px;height:auto"><h1 style="font-size:25px;margin:18px 0 8px">Payment successful ✅</h1><p>Hi ${safeName}, your WORLD TV subscription has been activated automatically.</p><div style="margin:22px auto;padding:18px;background:#fff5cf;border:1px solid #e7c766;border-radius:12px"><div style="font-size:13px;color:#73633a">YOUR SUBSCRIPTION CODE</div><div style="font-size:28px;font-weight:800;letter-spacing:2px;margin-top:7px">${safeCode}</div>${expiry ? `<div style="margin-top:8px;color:#73633a">Valid until ${expiry}</div>` : ""}</div><p style="margin:22px 0"><a href="https://myworldtvlive.com/account.html" style="display:inline-block;background:#e3a400;color:#17120a;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:700">Open My Account</a></p><p style="font-size:13px;color:#756b58">Thank you for choosing WORLD TV.</p></div></div></body></html>`,
        text: `Hi ${safeName}, your WORLD TV subscription is active. Subscription code: ${safeCode}${expiry ? `. Valid until ${expiry}` : ""}. My Account: https://myworldtvlive.com/account.html`
      })
    });
    if (!response.ok) {
      console.error("Paystack webhook activation email failed:", await response.text().catch(() => ""));
    }
  } catch (error) {
    console.error("Paystack webhook activation email error:", error);
  }
}

async function fulfillSubscription(reference, payment) {
  let checkout = db.prepare(`
    SELECT c.*, p.duration_days, p.name AS plan_name, u.email, u.name AS customer_name
    FROM checkout_requests c
    JOIN plans p ON p.id=c.plan_id
    JOIN users u ON u.id=c.user_id
    WHERE c.reference=?
  `).get(reference);

  if (!checkout) {
    const email = String(payment.customer?.email || payment.email || "").trim().toLowerCase();
    const amount = Number(payment.amount);
    const currency = String(payment.currency || "").toUpperCase();
    const intent = email ? db.prepare(`
      SELECT i.*,u.name AS customer_name
      FROM paystack_hosted_intents i JOIN users u ON u.id=i.user_id
      WHERE lower(i.email)=? AND i.status='awaiting_payment'
        AND datetime(i.created_at)>datetime('now','-7 days')
      ORDER BY i.id DESC LIMIT 1
    `).get(email) : null;
    if (!intent || payment.status !== "success" || amount !== Number(intent.expected_amount_pesewas) || currency !== "GHS") {
      return { ok: true, ignored: true, reason: "checkout_not_found" };
    }
    db.transaction(() => {
      db.prepare(`
        INSERT OR IGNORE INTO checkout_requests(
          reference,user_id,plan_id,original_amount_usd,discount_usd,final_amount_usd,
          original_amount_ghs,discount_ghs,final_amount_ghs,status,notes
        ) VALUES(?,?,?,23,0,23,?,0,?,'awaiting_payment',?)
      `).run(reference, intent.user_id, intent.plan_id, amount / 100, amount / 100, "Paystack hosted page x4sqejilmz");
      db.prepare(`
        UPDATE paystack_hosted_intents
        SET provider_reference=?,status='payment_confirmed',updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status='awaiting_payment'
      `).run(reference, intent.id);
    })();
    checkout = db.prepare(`
      SELECT c.*, p.duration_days, p.name AS plan_name, u.email, u.name AS customer_name
      FROM checkout_requests c JOIN plans p ON p.id=c.plan_id JOIN users u ON u.id=c.user_id
      WHERE c.reference=?
    `).get(reference);
    if (!checkout) return { ok: true, ignored: true, reason: "hosted_checkout_not_created" };
  }

  const existing = db.prepare(`
    SELECT o.id, o.status, sc.code, sc.expires_at
    FROM orders o
    LEFT JOIN subscription_codes sc ON sc.id=o.code_id
    WHERE o.reference=?
  `).get(reference);

  if (existing) {
    return {
      ok: true,
      already_processed: true,
      code: existing.code || null,
      expires_at: existing.expires_at || null
    };
  }

  const expectedAmount = Math.round(Number(checkout.final_amount_ghs) * 100);
  if (
    payment.status !== "success" ||
    String(payment.reference || "") !== reference ||
    Number(payment.amount) !== expectedAmount ||
    String(payment.currency || "").toUpperCase() !== "GHS"
  ) {
    throw new Error("Paystack payment details do not match checkout");
  }

  const code = db.prepare(`
    SELECT id, code
    FROM subscription_codes
    WHERE plan_id=? AND status='unused' AND user_id IS NULL AND reseller_id IS NULL
      AND (expires_at IS NULL OR datetime(expires_at)>datetime('now'))
    ORDER BY id ASC
    LIMIT 1
  `).get(checkout.plan_id);

  if (!code) {
    db.prepare(`
      UPDATE checkout_requests
      SET status='payment_confirmed', updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status!='fulfilled'
    `).run(checkout.id);

    try {
      db.prepare(`INSERT INTO notifications(user_id,title,message) VALUES(?,?,?)`).run(
        checkout.user_id,
        "Payment Received",
        "Your payment was received successfully. Subscription activation is pending because no unused code is currently available."
      );
    } catch (_) {}

    return { ok: true, paid: true, fulfilled: false, reason: "no_unused_codes" };
  }

  let start = new Date();
  const current = db.prepare(`
    SELECT MAX(sc.expires_at) AS expiry
    FROM orders o
    JOIN subscription_codes sc ON sc.id=o.code_id
    WHERE o.user_id=? AND o.status='paid'
  `).get(checkout.user_id);

  if (current?.expiry && new Date(current.expiry) > start) start = new Date(current.expiry);
  const expiry = new Date(start);
  expiry.setUTCDate(expiry.getUTCDate() + Number(checkout.duration_days));
  const expiresAt = expiry.toISOString();
  const paidAt = payment.paid_at || new Date().toISOString();

  const transaction = db.transaction(() => {
    const already = db.prepare("SELECT id FROM orders WHERE reference=?").get(reference);
    if (already) return { already: true };

    const assigned = db.prepare(`
      UPDATE subscription_codes
      SET status='used', user_id=?, expires_at=?
      WHERE id=? AND status='unused' AND user_id IS NULL AND reseller_id IS NULL
    `).run(checkout.user_id, expiresAt, code.id);
    if (assigned.changes !== 1) throw new Error("Subscription code assignment conflict");

    db.prepare(`
      INSERT INTO orders(reference,user_id,plan_id,amount_pesewas,currency,status,code_id,paid_at)
      VALUES(?,?,?,?,?,'paid',?,?)
    `).run(reference, checkout.user_id, checkout.plan_id, expectedAmount, "GHS", code.id, paidAt);

    db.prepare(`
      UPDATE checkout_requests
      SET status='fulfilled', updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(checkout.id);

    if (checkout.coupon_code) {
      db.prepare("UPDATE coupons SET used_count=used_count+1 WHERE code=?").run(checkout.coupon_code);
    }

    try {
      db.prepare(`INSERT INTO notifications(user_id,title,message) VALUES(?,?,?)`).run(
        checkout.user_id,
        "Subscription Activated",
        `Your WORLD TV subscription has been activated automatically. Your code is ${code.code}.`
      );
    } catch (_) {}

    return { already: false };
  });

  let txResult;
  try {
    txResult = transaction();
  } catch (error) {
    const raced = db.prepare(`
      SELECT o.id, sc.code, sc.expires_at
      FROM orders o
      LEFT JOIN subscription_codes sc ON sc.id=o.code_id
      WHERE o.reference=?
    `).get(reference);
    if (raced) {
      return { ok: true, already_processed: true, code: raced.code || null, expires_at: raced.expires_at || null };
    }
    throw error;
  }

  if (txResult?.already) {
    const row = db.prepare(`
      SELECT sc.code, sc.expires_at
      FROM orders o LEFT JOIN subscription_codes sc ON sc.id=o.code_id
      WHERE o.reference=?
    `).get(reference);
    return { ok: true, already_processed: true, code: row?.code || null, expires_at: row?.expires_at || null };
  }

  await sendActivationEmail(checkout.email, checkout.customer_name, code.code, expiresAt);
  db.prepare(`
    UPDATE paystack_hosted_intents SET status='fulfilled',updated_at=CURRENT_TIMESTAMP
    WHERE provider_reference=?
  `).run(reference);
  console.log("Paystack webhook fulfilled WORLD TV subscription", { reference, user_id: checkout.user_id, code_id: code.id });

  return { ok: true, paid: true, fulfilled: true, code: code.code, expires_at: expiresAt };
}

async function paystackWebhookHandler(req, res) {
  // Always validate the signature before trusting event data.
  if (!verifyPaystackSignature(req)) {
    console.warn("Rejected Paystack webhook with invalid signature");
    return res.status(401).send("Invalid signature");
  }

  const event = req.body || {};
  if (event.event !== "charge.success") {
    return res.sendStatus(200);
  }

  const reference = String(event.data?.reference || "").trim();
  if (!reference) return res.sendStatus(200);

  try {
    // Re-query Paystack so fulfillment never relies only on the webhook payload.
    const verifiedPayment = await fetchVerifiedPaystackPayment(reference);
    const result = await fulfillSubscription(reference, verifiedPayment);
    console.log("Paystack webhook processed", { reference, result });
    return res.sendStatus(200);
  } catch (error) {
    // Non-2xx tells Paystack delivery was not processed successfully so it can retry.
    console.error("Paystack webhook processing failed:", error);
    return res.status(500).send("Webhook processing failed");
  }
}

// Add the webhook immediately after the existing Paystack verification route,
// which keeps it before the application's final 404 middleware.
const originalPost = express.application.post;
express.application.post = function worldTvPost(route, ...handlers) {
  const result = originalPost.call(this, route, ...handlers);
  if (route === "/api/payment/paystack/verify" && !this.locals.__worldTvPaystackWebhookInstalled) {
    this.locals.__worldTvPaystackWebhookInstalled = true;
    originalPost.call(this, "/api/payment/paystack/webhook", paystackWebhookHandler);
    originalPost.call(this, "/api/payment/paystack/hosted-intent", initializeHostedPaystack);
    console.log("WORLD TV Paystack webhook route enabled: /api/payment/paystack/webhook");
  }
  return result;
};
