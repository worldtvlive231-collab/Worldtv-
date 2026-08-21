'use strict';

const path = require('path');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');

const db = new Database(path.join(process.cwd(), 'data', 'worldtv.sqlite'));
db.pragma('journal_mode=WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS reseller_code_purchases(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reseller_id INTEGER NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  code_count INTEGER NOT NULL,
  unit_price_ghs REAL NOT NULL,
  amount_ghs REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  provider TEXT NOT NULL DEFAULT 'paystack',
  provider_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reseller_code_purchases_reseller
  ON reseller_code_purchases(reseller_id, created_at DESC);
`);

function cleanNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function configuredPrice() {
  const envPrice = cleanNumber(process.env.RESELLER_CODE_PRICE_GHS);
  if (envPrice > 0) return envPrice;
  try {
    const row = db.prepare("SELECT value FROM site_settings WHERE key='reseller_code_price_ghs'").get();
    const dbPrice = cleanNumber(row && row.value);
    return dbPrice > 0 ? dbPrice : 0;
  } catch (e) {
    return 0;
  }
}

function paystackRequest(method, endpoint, payload) {
  return new Promise((resolve, reject) => {
    const secret = String(process.env.PAYSTACK_SECRET_KEY || '').trim();
    if (!secret) return reject(new Error('Paystack is not configured.'));
    const body = payload ? JSON.stringify(payload) : '';
    const req = https.request({
      hostname: 'api.paystack.co',
      path: endpoint,
      method,
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(data || '{}'); } catch (e) {}
        if (res.statusCode < 200 || res.statusCode >= 300 || !json.status) {
          return reject(new Error(json.message || 'Paystack request failed.'));
        }
        resolve(json);
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Paystack request timed out.')));
    if (body) req.write(body);
    req.end();
  });
}

function getStore(req, res) {
  const price = configuredPrice();
  const history = db.prepare(`
    SELECT reference, code_count, unit_price_ghs, amount_ghs, status, created_at, paid_at
    FROM reseller_code_purchases
    WHERE reseller_id=?
    ORDER BY id DESC
    LIMIT 50
  `).all(req.resellerId);
  const quota = db.prepare(`
    SELECT allocated_count, used_count, available_count
    FROM reseller_code_allocation
    WHERE reseller_id=?
  `).get(req.resellerId) || { allocated_count: 0, used_count: 0, available_count: 0 };
  res.json({
    unit_price_ghs: price,
    configured: price > 0,
    payment_configured: Boolean(String(process.env.PAYSTACK_SECRET_KEY || '').trim()),
    quota,
    history
  });
}

async function initializePurchase(req, res) {
  try {
    const count = Math.floor(cleanNumber(req.body && req.body.count));
    if (count < 1 || count > 1000) {
      return res.status(400).json({ error: 'Choose between 1 and 1000 codes.' });
    }
    const unitPrice = configuredPrice();
    if (!(unitPrice > 0)) {
      return res.status(400).json({ error: 'Reseller code price has not been configured yet.' });
    }
    const reseller = db.prepare('SELECT id,name,email FROM resellers WHERE id=? AND status=\'active\'').get(req.resellerId);
    if (!reseller) return res.status(401).json({ error: 'Unauthorized' });

    const amountGhs = Number((unitPrice * count).toFixed(2));
    const reference = `WTV-RC-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    db.prepare(`
      INSERT INTO reseller_code_purchases(reseller_id,reference,code_count,unit_price_ghs,amount_ghs,status)
      VALUES(?,?,?,?,?,'pending')
    `).run(req.resellerId, reference, count, unitPrice, amountGhs);

    const baseUrl = String(process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const callbackUrl = `${baseUrl}/reseller?code_purchase_ref=${encodeURIComponent(reference)}`;
    const initialized = await paystackRequest('POST', '/transaction/initialize', {
      email: reseller.email,
      amount: Math.round(amountGhs * 100),
      currency: 'GHS',
      reference,
      callback_url: callbackUrl,
      metadata: {
        purchase_type: 'reseller_code_credits',
        reseller_id: String(req.resellerId),
        code_count: count
      }
    });

    res.json({
      ok: true,
      reference,
      count,
      unit_price_ghs: unitPrice,
      amount_ghs: amountGhs,
      authorization_url: initialized.data && initialized.data.authorization_url
    });
  } catch (e) {
    console.error('Reseller purchase initialize error:', e);
    res.status(500).json({ error: e.message || 'Could not start payment.' });
  }
}

async function verifyPurchase(req, res) {
  try {
    const reference = String(req.params.reference || '').trim();
    const purchase = db.prepare(`
      SELECT * FROM reseller_code_purchases
      WHERE reference=? AND reseller_id=?
    `).get(reference, req.resellerId);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });

    if (purchase.status === 'paid') {
      const quota = db.prepare('SELECT allocated_count,used_count,available_count FROM reseller_code_allocation WHERE reseller_id=?').get(req.resellerId);
      return res.json({ ok: true, already_credited: true, purchase, quota });
    }

    const verified = await paystackRequest('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    const tx = verified.data || {};
    const expectedPesewas = Math.round(Number(purchase.amount_ghs) * 100);
    if (tx.status !== 'success' || Number(tx.amount) !== expectedPesewas || String(tx.currency || '').toUpperCase() !== 'GHS') {
      return res.status(400).json({ error: 'Payment has not been completed successfully.' });
    }

    const credit = db.transaction(() => {
      const fresh = db.prepare('SELECT status FROM reseller_code_purchases WHERE id=?').get(purchase.id);
      if (fresh && fresh.status === 'paid') return false;

      db.prepare(`
        UPDATE reseller_code_purchases
        SET status='paid', provider_reference=?, paid_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(String(tx.reference || reference), purchase.id);

      const existing = db.prepare('SELECT id FROM reseller_code_allocation WHERE reseller_id=?').get(req.resellerId);
      if (existing) {
        db.prepare(`
          UPDATE reseller_code_allocation
          SET allocated_count=allocated_count+?, available_count=available_count+?, updated_at=CURRENT_TIMESTAMP
          WHERE reseller_id=?
        `).run(purchase.code_count, purchase.code_count, req.resellerId);
      } else {
        db.prepare(`
          INSERT INTO reseller_code_allocation(reseller_id,allocated_count,used_count,available_count)
          VALUES(?,?,0,?)
        `).run(req.resellerId, purchase.code_count, purchase.code_count);
      }
      return true;
    });
    const creditedNow = credit();
    const quota = db.prepare('SELECT allocated_count,used_count,available_count FROM reseller_code_allocation WHERE reseller_id=?').get(req.resellerId);
    res.json({ ok: true, credited: creditedNow ? purchase.code_count : 0, purchase: { ...purchase, status: 'paid' }, quota });
  } catch (e) {
    console.error('Reseller purchase verify error:', e);
    res.status(500).json({ error: e.message || 'Could not verify payment.' });
  }
}

function getAdminPrice(req, res) {
  res.json({ unit_price_ghs: configuredPrice(), source: cleanNumber(process.env.RESELLER_CODE_PRICE_GHS) > 0 ? 'environment' : 'database' });
}

function setAdminPrice(req, res) {
  const price = cleanNumber(req.body && req.body.unit_price_ghs);
  if (!(price > 0)) return res.status(400).json({ error: 'Enter a reseller price greater than 0.' });
  db.prepare(`
    INSERT INTO site_settings(key,value) VALUES('reseller_code_price_ghs',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(String(Number(price.toFixed(2))));
  res.json({ ok: true, unit_price_ghs: configuredPrice() });
}

const originalPost = express.application.post;
const originalGet = express.application.get;

express.application.post = function patchedPost(routePath, ...handlers) {
  const result = originalPost.call(this, routePath, ...handlers);

  if (routePath === '/api/admin/resellers' && !this.__wtvResellerPriceAdminRoutes) {
    const adminOnly = handlers[0];
    if (typeof adminOnly === 'function') {
      originalGet.call(this, '/api/admin/reseller-code-price', adminOnly, getAdminPrice);
      originalPost.call(this, '/api/admin/reseller-code-price', adminOnly, setAdminPrice);
      this.__wtvResellerPriceAdminRoutes = true;
    }
  }

  if (routePath === '/api/reseller/generate-codes' && !this.__wtvResellerCodeStoreRoutes) {
    const resellerOnly = handlers[0];
    if (typeof resellerOnly === 'function') {
      originalGet.call(this, '/api/reseller/code-store', resellerOnly, getStore);
      originalPost.call(this, '/api/reseller/code-purchases/initialize', resellerOnly, initializePurchase);
      originalGet.call(this, '/api/reseller/code-purchases/verify/:reference', resellerOnly, verifyPurchase);
      this.__wtvResellerCodeStoreRoutes = true;
    }
  }
  return result;
};
