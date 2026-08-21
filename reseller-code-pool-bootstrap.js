'use strict';

const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');

const db = new Database(path.join(process.cwd(), 'data', 'worldtv.sqlite'));
db.pragma('journal_mode=WAL');

try { db.prepare('ALTER TABLE subscription_codes ADD COLUMN reseller_id INTEGER').run(); } catch (e) {}
try { db.prepare('CREATE INDEX IF NOT EXISTS idx_subscription_codes_reseller ON subscription_codes(reseller_id)').run(); } catch (e) {}

function allocateUploadedCodes(req, res) {
  const genCount = Number(req.body && req.body.count);
  if (!Number.isInteger(genCount) || genCount < 1 || genCount > 1000) {
    return res.status(400).json({ error: 'Valid count required (1-1000)' });
  }

  try {
    const reseller = db.prepare("SELECT id FROM resellers WHERE id=? AND status='active'").get(req.resellerId);
    if (!reseller) return res.status(401).json({ error: 'Unauthorized' });

    const quota = db.prepare(`
      SELECT available_count
      FROM reseller_code_allocation
      WHERE reseller_id=?
    `).get(req.resellerId);

    const availableCredit = Number(quota && quota.available_count || 0);
    if (availableCredit < genCount) {
      return res.status(400).json({
        error: `Not enough paid code credits. You have ${availableCredit} available.`
      });
    }

    const pool = db.prepare(`
      SELECT id, code
      FROM subscription_codes
      WHERE status='unused'
        AND user_id IS NULL
        AND reseller_id IS NULL
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
      ORDER BY id ASC
      LIMIT ?
    `).all(genCount);

    if (pool.length < genCount) {
      return res.status(409).json({
        error: `Not enough Admin uploaded subscription codes. ${pool.length} code(s) are currently available in the Admin pool. Upload more subscription codes first.`,
        admin_pool_available: pool.length
      });
    }

    const claim = db.prepare(`
      UPDATE subscription_codes
      SET reseller_id=?
      WHERE id=?
        AND status='unused'
        AND user_id IS NULL
        AND reseller_id IS NULL
    `);
    const deductCredit = db.prepare(`
      UPDATE reseller_code_allocation
      SET available_count=available_count-?,
          used_count=used_count+?,
          updated_at=CURRENT_TIMESTAMP
      WHERE reseller_id=? AND available_count>=?
    `);

    const generated = db.transaction(() => {
      const codes = [];
      for (const row of pool) {
        const changed = claim.run(req.resellerId, row.id);
        if (changed.changes !== 1) throw new Error('Subscription code allocation conflict. Please try again.');
        codes.push(row.code);
      }
      const q = deductCredit.run(genCount, genCount, req.resellerId, genCount);
      if (q.changes !== 1) throw new Error('Paid code credit allocation conflict. Please try again.');
      return codes;
    })();

    const remainingPool = db.prepare(`
      SELECT COUNT(*) AS count
      FROM subscription_codes
      WHERE status='unused' AND user_id IS NULL AND reseller_id IS NULL
    `).get().count;

    return res.json({
      ok: true,
      generated,
      count: generated.length,
      source: 'admin_uploaded_subscription_codes',
      admin_pool_remaining: remainingPool
    });
  } catch (e) {
    console.error('Reseller admin-code allocation error:', e);
    return res.status(500).json({ error: e.message || 'Could not allocate subscription codes.' });
  }
}

const previousPost = express.application.post;
express.application.post = function resellerAdminPoolPost(routePath, ...handlers) {
  if (routePath === '/api/reseller/generate-codes' && handlers.length >= 2) {
    const resellerOnly = handlers[0];
    return previousPost.call(this, routePath, resellerOnly, allocateUploadedCodes);
  }
  return previousPost.call(this, routePath, ...handlers);
};

const previousGet = express.application.get;
express.application.get = function resellerAdminPoolGet(routePath, ...handlers) {
  if (routePath === '/api/admin/stats' && handlers.length) {
    const finalHandler = handlers[handlers.length - 1];
    if (typeof finalHandler === 'function') {
      const wrapped = function adminStatsWithUnassignedPool(req, res, next) {
        const originalJson = res.json.bind(res);
        res.json = payload => {
          if (payload && typeof payload === 'object') {
            const available = db.prepare(`
              SELECT COUNT(*) AS count
              FROM subscription_codes
              WHERE status='unused' AND user_id IS NULL AND reseller_id IS NULL
            `).get().count;
            payload.unused = available;
            payload.reseller_allocated_unused = db.prepare(`
              SELECT COUNT(*) AS count
              FROM subscription_codes
              WHERE status='unused' AND reseller_id IS NOT NULL
            `).get().count;
          }
          return originalJson(payload);
        };
        return finalHandler(req, res, next);
      };
      return previousGet.call(this, routePath, ...handlers.slice(0, -1), wrapped);
    }
  }
  return previousGet.call(this, routePath, ...handlers);
};
