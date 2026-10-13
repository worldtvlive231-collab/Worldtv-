import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.mjs';
import { hashSessionToken } from '../functions/_lib/staging-auth.js';
import { continuityEmailHash, continuityRecordDigest, continuityEnd } from '../functions/_lib/staging-continuity.js';
import { onRequestGet as status } from '../functions/api/staging/continuity/status.js';
import { onRequestPost as claim } from '../functions/api/staging/continuity/claim.js';

const HOST = 'https://worldtv-preview.pages.dev';
const secret = 'test-continuity-secret-123456789012345';
const email = 'legacy@example.invalid';
const token = 'l'.repeat(43);

async function setup() {
  const db = new TestD1();
  db.sqlite.prepare("INSERT INTO users(name,email,password_hash,email_verified_at) VALUES('Legacy',?,'hash',CURRENT_TIMESTAMP)").run(email);
  db.sqlite.prepare("INSERT INTO customer_sessions(token_hash,user_id,expires_at) VALUES(?,1,datetime('now','+1 day'))")
    .run(await hashSessionToken(token));
  db.sqlite.prepare("INSERT INTO users(name,email,password_hash,role,email_verified_at) VALUES('Admin','admin@example.invalid','hash','admin',CURRENT_TIMESTAMP)").run();
  db.sqlite.prepare("INSERT INTO continuity_import_batches(batch_reference,actor_user_id,entry_count) VALUES('test-batch',2,1)").run();
  db.sqlite.prepare("INSERT INTO continuity_entitlements(batch_id,source_record_digest,email_hash,plan_slug,source_ends_at,status) VALUES(1,?,?, 'annual',datetime('now','+100 days'),'eligible')")
    .run(await continuityRecordDigest('railway-subscription-77', secret),
      await continuityEmailHash(email, secret));
  const env = { DB: db, WORLDTV_STAGING_AUTH_ENABLED: 'true',
    WORLDTV_STAGING_CONTINUITY_ENABLED: 'true', WORLDTV_CONTINUITY_HMAC_SECRET: secret };
  return { db, env };
}

function customerRequest(path, method = 'GET', body) {
  return new Request(HOST + path, { method, headers: { cookie: '__Host-worldtv_staging=' + token,
    ...(method === 'POST' ? { origin: HOST, 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
}

test('continuity digests are fixed length and expiry validation is bounded', async () => {
  const emailHash = await continuityEmailHash(email, secret);
  const recordHash = await continuityRecordDigest('railway-record-77', secret);
  assert.match(emailHash, /^[0-9a-f]{64}$/);
  assert.notEqual(emailHash, recordHash);
  assert.equal(continuityEnd('2020-01-01T00:00:00Z'), null);
  assert.equal(continuityEnd('not-a-date'), null);
});

test('verified customer can view and claim one approved unexpired entitlement', async () => {
  const { db, env } = await setup();
  const visible = await status({ request: customerRequest('/api/staging/continuity/status'), env });
  assert.equal(visible.status, 200);
  assert.equal((await visible.json()).continuity.status, 'eligible');
  const restored = await claim({ request: customerRequest('/api/staging/continuity/claim', 'POST', {}), env });
  assert.equal(restored.status, 200);
  assert.equal(db.sqlite.prepare('SELECT status FROM continuity_entitlements').get().status, 'claimed');
  const subscription = db.sqlite.prepare('SELECT user_id,status,ends_at FROM subscriptions').get();
  assert.equal(subscription.user_id, 1);
  assert.equal(subscription.status, 'active');
  assert.equal((await claim({ request: customerRequest('/api/staging/continuity/claim', 'POST', {}), env })).status, 409);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n, 1);
});

test('continuity is disabled by default and never matches another verified email', async () => {
  const { db, env } = await setup();
  const hidden = await status({ request: customerRequest('/api/staging/continuity/status'),
    env: { ...env, WORLDTV_STAGING_CONTINUITY_ENABLED: 'false' } });
  assert.equal(hidden.status, 404);
  db.sqlite.exec("UPDATE users SET email='different@example.invalid' WHERE id=1");
  const result = await status({ request: customerRequest('/api/staging/continuity/status'), env });
  assert.equal((await result.json()).continuity, null);
  assert.equal((await claim({ request: customerRequest('/api/staging/continuity/claim', 'POST', {}), env })).status, 409);
});
