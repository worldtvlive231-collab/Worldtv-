'use strict';

const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');

// Older reseller code generation in server.js inserts only code/status/reseller_id,
// while subscription_codes.plan_id is NOT NULL. Patch that one legacy statement
// at startup so reseller codes automatically use the active subscription plan.
// The replacement keeps the same two .run(code, resellerId) parameters.
const originalPrepare = Database.prototype.prepare;
Database.prototype.prepare = function resellerPlanAwarePrepare(sql, ...args) {
  const normalized = String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalized === "insert into subscription_codes(code, status, reseller_id) values(?, 'active', ?)") {
    sql = `
      INSERT INTO subscription_codes(code, plan_id, status, reseller_id)
      VALUES(
        ?,
        (SELECT id FROM plans WHERE active=1 ORDER BY id ASC LIMIT 1),
        'active',
        ?
      )
    `;
  }
  return originalPrepare.call(this, sql, ...args);
};

const db = new Database(path.join(process.cwd(), 'data', 'worldtv.sqlite'));
db.pragma('journal_mode=WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS reseller_subscribers(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reseller_id INTEGER NOT NULL,
  code TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  service_notifications INTEGER NOT NULL DEFAULT 1,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reseller_subscribers_reseller
  ON reseller_subscribers(reseller_id);
CREATE INDEX IF NOT EXISTS idx_reseller_subscribers_email
  ON reseller_subscribers(email);
`);

function clean(value, max = 300) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function assignSubscriber(req, res) {
  try {
    const code = clean(req.body && req.body.code, 80).toUpperCase();
    const customerName = clean(req.body && req.body.customer_name, 160);
    const phone = clean(req.body && req.body.phone, 80);
    const email = clean(req.body && req.body.email, 200).toLowerCase();
    const country = clean(req.body && req.body.country, 120);
    const notes = clean(req.body && req.body.notes, 800);
    const marketingConsent = req.body && (req.body.marketing_consent === true || req.body.marketing_consent === 1 || req.body.marketing_consent === '1') ? 1 : 0;

    if (!code || !customerName || !phone || !email || !country) {
      return res.status(400).json({ error: 'Code, customer name, phone, email and country are required.' });
    }
    if (!validEmail(email)) {
      return res.status(400).json({ error: 'Enter a valid customer email address.' });
    }

    const ownedCode = db.prepare(`
      SELECT code, status
      FROM subscription_codes
      WHERE code = ? AND reseller_id = ?
    `).get(code, req.resellerId);

    if (!ownedCode) {
      return res.status(404).json({ error: 'This code does not belong to your reseller account.' });
    }

    db.prepare(`
      INSERT INTO reseller_subscribers(
        reseller_id, code, customer_name, phone, email, country, notes,
        service_notifications, marketing_consent
      ) VALUES(?,?,?,?,?,?,?,1,?)
      ON CONFLICT(code) DO UPDATE SET
        customer_name=excluded.customer_name,
        phone=excluded.phone,
        email=excluded.email,
        country=excluded.country,
        notes=excluded.notes,
        service_notifications=1,
        marketing_consent=excluded.marketing_consent,
        updated_at=CURRENT_TIMESTAMP
      WHERE reseller_subscribers.reseller_id=excluded.reseller_id
    `).run(req.resellerId, code, customerName, phone, email, country, notes, marketingConsent);

    const subscriber = db.prepare(`
      SELECT code, customer_name, phone, email, country, notes,
             service_notifications, marketing_consent, created_at, updated_at
      FROM reseller_subscribers
      WHERE reseller_id=? AND code=?
    `).get(req.resellerId, code);

    res.json({ ok: true, subscriber });
  } catch (e) {
    console.error('Reseller subscriber assignment error:', e);
    res.status(500).json({ error: 'Could not save subscriber information.' });
  }
}

function adminSubscribers(req, res) {
  try {
    const q = clean(req.query && req.query.q, 120);
    let sql = `
      SELECT s.id,s.reseller_id,r.name AS reseller_name,r.email AS reseller_email,
             s.code,s.customer_name,s.phone,s.email,s.country,s.notes,
             s.service_notifications,s.marketing_consent,s.created_at,s.updated_at,
             c.status AS code_status,c.expires_at
      FROM reseller_subscribers s
      LEFT JOIN resellers r ON r.id=s.reseller_id
      LEFT JOIN subscription_codes c ON c.code=s.code
    `;
    const params = {};
    if (q) {
      sql += ` WHERE s.customer_name LIKE @q OR s.phone LIKE @q OR s.email LIKE @q OR s.code LIKE @q OR r.name LIKE @q`;
      params.q = `%${q}%`;
    }
    sql += ' ORDER BY s.id DESC LIMIT 5000';
    res.json(db.prepare(sql).all(params));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function enrichDashboardPayload(payload, resellerId) {
  if (!payload || !Array.isArray(payload.codes)) return payload;
  const subscribers = db.prepare(`
    SELECT code,customer_name,phone,email,country,notes,
           service_notifications,marketing_consent,created_at,updated_at
    FROM reseller_subscribers
    WHERE reseller_id=?
    ORDER BY id DESC
    LIMIT 1000
  `).all(resellerId);
  const byCode = new Map(subscribers.map(row => [row.code, row]));
  payload.codes = payload.codes.map(code => ({ ...code, subscriber: byCode.get(code.code) || null }));
  payload.subscriber_count = subscribers.length;
  return payload;
}

const originalPost = express.application.post;
const originalGet = express.application.get;

express.application.post = function patchedPost(routePath, ...handlers) {
  const result = originalPost.call(this, routePath, ...handlers);

  if (routePath === '/api/reseller/generate-codes' && !this.__wtvSubscriberAssignRoute) {
    const resellerOnly = handlers[0];
    if (typeof resellerOnly === 'function') {
      originalPost.call(this, '/api/reseller/assign-subscriber', resellerOnly, assignSubscriber);
      this.__wtvSubscriberAssignRoute = true;
    }
  }
  return result;
};

express.application.get = function patchedGet(routePath, ...handlers) {
  if (routePath === '/api/reseller/dashboard' && handlers.length) {
    const finalHandler = handlers[handlers.length - 1];
    if (typeof finalHandler === 'function') {
      const wrapped = function resellerDashboardWithSubscribers(req, res, next) {
        const originalJson = res.json.bind(res);
        res.json = payload => originalJson(enrichDashboardPayload(payload, req.resellerId));
        return finalHandler(req, res, next);
      };
      return originalGet.call(this, routePath, ...handlers.slice(0, -1), wrapped);
    }
  }

  const result = originalGet.call(this, routePath, ...handlers);
  if (routePath === '/api/admin/resellers' && !this.__wtvAdminSubscriberRoute) {
    const adminOnly = handlers[0];
    if (typeof adminOnly === 'function') {
      originalGet.call(this, '/api/admin/reseller-subscribers', adminOnly, adminSubscribers);
      this.__wtvAdminSubscriberRoute = true;
    }
  }
  return result;
};
