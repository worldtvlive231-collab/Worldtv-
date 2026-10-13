import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.mjs';
import { hashPassword, hashSessionToken } from '../functions/_lib/staging-auth.js';
import { onRequestPost as login } from '../functions/api/staging/reseller/login.js';
import { onRequestPost as logout } from '../functions/api/staging/reseller/logout.js';
import { onRequestGet as dashboard } from '../functions/api/staging/reseller/dashboard.js';
import { onRequestPost as generateCodes } from '../functions/api/staging/reseller/generate-codes.js';
import { onRequestPost as redeem } from '../functions/api/staging/subscriptions/redeem.js';
import { onRequestGet as listResellers, onRequestPost as createReseller } from '../functions/api/staging/admin/resellers.js';
import { onRequestPost as allocate } from '../functions/api/staging/admin/reseller-allocate.js';
import { onRequestPost as setStatus } from '../functions/api/staging/admin/reseller-status.js';
import { onRequestPost as importContinuity } from '../functions/api/staging/admin/continuity-entitlements.js';

const HOST = 'https://worldtv-preview.pages.dev';
const resellerEmail = 'reseller@example.invalid';
const resellerPassword = 'Secure-Reseller-Password-123';
const resellerPepper = 'test-reseller-password-pepper-123456789';
const codeSecret = 'test-reseller-code-secret-1234567890123';
const rateSecret = 'test-rate-secret-12345678901234567890';

function post(path, body, cookie, extraHeaders = {}) {
  return new Request(HOST + path, { method: 'POST', headers: { origin: HOST,
    'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.44',
    ...(cookie ? { cookie } : {}), ...extraHeaders }, body: JSON.stringify(body) });
}

async function resellerSetup(quota = 2) {
  const db = new TestD1();
  const hash = await hashPassword(resellerPassword, resellerPepper);
  db.sqlite.prepare("INSERT INTO resellers(name,email,password_hash,commission_percent,status) VALUES('Test Reseller',?,?,10,'active')")
    .run(resellerEmail, hash);
  db.sqlite.prepare('INSERT INTO reseller_code_allocation(reseller_id,allocated_count,used_count,available_count) VALUES(1,?,0,?)')
    .run(quota, quota);
  const env = { DB: db, WORLDTV_STAGING_RESELLER_ENABLED: 'true',
    WORLDTV_STAGING_RESELLER_CODES_ENABLED: 'true', WORLDTV_AUTH_RATE_SECRET: rateSecret,
    WORLDTV_RESELLER_PASSWORD_PEPPER: resellerPepper,
    WORLDTV_RESELLER_CODE_HMAC_SECRET: codeSecret };
  return { db, env };
}

test('reseller API is hidden by default and rejects invalid passwords', async () => {
  const { db, env } = await resellerSetup();
  const hidden = await login({ request: post('/api/staging/reseller/login', {
    email: resellerEmail, password: resellerPassword }), env: { DB: db } });
  assert.equal(hidden.status, 404);
  const denied = await login({ request: post('/api/staging/reseller/login', {
    email: resellerEmail, password: 'Wrong-Password-But-Long-123' }), env });
  assert.equal(denied.status, 401);
});

test('reseller login, quota-backed generation, dashboard isolation and logout work', async () => {
  const { db, env } = await resellerSetup();
  const signedIn = await login({ request: post('/api/staging/reseller/login', {
    email: resellerEmail, password: resellerPassword }), env });
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^__Host-worldtv_reseller=/);

  const generated = await generateCodes({ request: post('/api/staging/reseller/generate-codes',
    { count: 2 }, cookie), env });
  assert.equal(generated.status, 201);
  const generatedBody = await generated.json();
  assert.equal(generatedBody.codes.length, 2);
  assert.match(generatedBody.codes[0].code, /^WTV-R-[0-9A-F]{24}$/);
  assert.equal(db.sqlite.prepare('SELECT available_count FROM reseller_code_allocation').get().available_count, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM subscription_codes').get().n, 2);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM reseller_code_grants').get().n, 2);

  const noQuota = await generateCodes({ request: post('/api/staging/reseller/generate-codes',
    { count: 1 }, cookie), env });
  assert.equal(noQuota.status, 409);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM subscription_codes').get().n, 2);

  const panel = await dashboard({ request: new Request(HOST + '/api/staging/reseller/dashboard', {
    headers: { cookie } }), env });
  assert.equal(panel.status, 200);
  const panelBody = await panel.json();
  assert.equal(panelBody.codes.length, 2);
  assert.equal(panelBody.quota.available_count, 0);
  assert.equal(JSON.stringify(panelBody).includes(generatedBody.codes[0].code), false);

  const out = await logout({ request: post('/api/staging/reseller/logout', {}, cookie), env });
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM reseller_sessions').get().n, 0);
});

test('redeeming a reseller code increments usage exactly once', async () => {
  const { db, env } = await resellerSetup(1);
  const signedIn = await login({ request: post('/api/staging/reseller/login', {
    email: resellerEmail, password: resellerPassword }), env });
  const resellerCookie = signedIn.headers.get('set-cookie').split(';')[0];
  const generated = await generateCodes({ request: post('/api/staging/reseller/generate-codes',
    { count: 1 }, resellerCookie), env });
  const code = (await generated.json()).codes[0].code;

  db.sqlite.prepare("INSERT INTO users(name,email,password_hash,email_verified_at) VALUES('Customer','customer@example.invalid','hash',CURRENT_TIMESTAMP)").run();
  const customerToken = 'c'.repeat(43);
  db.sqlite.prepare("INSERT INTO customer_sessions(token_hash,user_id,expires_at) VALUES(?,1,datetime('now','+1 day'))")
    .run(await hashSessionToken(customerToken));
  const customerEnv = { ...env, WORLDTV_STAGING_AUTH_ENABLED: 'true',
    WORLDTV_STAGING_REDEMPTION_ENABLED: 'true' };
  const request = () => post('/api/staging/subscriptions/redeem', { code },
    '__Host-worldtv_staging=' + customerToken);
  assert.equal((await redeem({ request: request(), env: customerEnv })).status, 200);
  assert.equal(db.sqlite.prepare('SELECT used_count FROM reseller_code_allocation').get().used_count, 1);
  assert.equal(db.sqlite.prepare('SELECT status FROM reseller_code_grants').get().status, 'redeemed');
  assert.equal((await redeem({ request: request(), env: customerEnv })).status, 400);
  assert.equal(db.sqlite.prepare('SELECT used_count FROM reseller_code_allocation').get().used_count, 1);
});

function base64url(value) { return Buffer.from(value).toString('base64url'); }
async function adminIdentity() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true,
  ['sign','verify']);
  const jwk = await crypto.subtle.exportKey('jwk', publicKey);
  jwk.kid = 'reseller-test-key';
  const team = 'https://worldtvresellertest.cloudflareaccess.com';
  const audience = 'worldtvresellertestaudience123';
  const email = 'admin@example.invalid';
  const now = Math.floor(Date.now() / 1000);
  const head = base64url(JSON.stringify({ alg: 'RS256', kid: jwk.kid }));
  const body = base64url(JSON.stringify({ iss: team, aud: audience, email,
    sub: 'admin-reseller-tests', iat: now, exp: now + 600 }));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey,
    new TextEncoder().encode(head + '.' + body));
  return { jwt: head + '.' + body + '.' + base64url(signature), team, audience, email,
    fetchJwks: async () => new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200, headers: { 'content-type': 'application/json' } }) };
}

test('Access-authorized admin can create, allocate, list and suspend a reseller with audit logs', async () => {
  const db = new TestD1();
  const identity = await adminIdentity();
  db.sqlite.prepare("INSERT INTO users(name,email,password_hash,role,email_verified_at) VALUES('Admin',?,'hash','admin',CURRENT_TIMESTAMP)")
    .run(identity.email);
  const env = { DB: db, WORLDTV_STAGING_ADMIN_ENABLED: 'true',
    WORLDTV_ACCESS_TEAM_DOMAIN: identity.team, WORLDTV_ACCESS_AUD: identity.audience,
    WORLDTV_STAGING_ADMIN_EMAILS: identity.email,
    WORLDTV_RESELLER_PASSWORD_PEPPER: resellerPepper,
    WORLDTV_STAGING_CONTINUITY_ADMIN_ENABLED: 'true',
    WORLDTV_CONTINUITY_HMAC_SECRET: 'test-continuity-admin-secret-1234567890' };
  const context = (path, body) => ({ request: post(path, body, null,
    { 'cf-access-jwt-assertion': identity.jwt }), env,
    data: { accessJwksFetch: identity.fetchJwks } });
  const created = await createReseller(context('/api/staging/admin/resellers', {
    name: 'Managed Reseller', email: 'managed@example.invalid', phone: '+233 20 000 0000',
    commission_percent: 12.5, password: resellerPassword }));
  assert.equal(created.status, 201);
  const allocated = await allocate(context('/api/staging/admin/reseller-allocate', {
    reseller_id: 1, count: 3 }));
  assert.equal(allocated.status, 200);
  const listed = await listResellers({ request: new Request(HOST + '/api/staging/admin/resellers', {
    headers: { 'cf-access-jwt-assertion': identity.jwt } }), env,
    data: { accessJwksFetch: identity.fetchJwks } });
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).resellers[0].available_count, 3);
  db.sqlite.prepare("INSERT INTO reseller_sessions(token_hash,reseller_id,expires_at) VALUES('session',1,datetime('now','+1 day'))").run();
  const suspended = await setStatus(context('/api/staging/admin/reseller-status', {
    reseller_id: 1, status: 'suspended' }));
  assert.equal(suspended.status, 200);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM reseller_sessions').get().n, 0);
  const endsAt = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 19) + 'Z';
  const continuityBody = { entries: [{ source_record_id: 'railway-entitlement-100',
    email: 'existing@example.invalid', plan_slug: 'annual', ends_at: endsAt }] };
  assert.equal((await importContinuity(context('/api/staging/admin/continuity-entitlements',
    continuityBody))).status, 201);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM continuity_entitlements').get().n, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM continuity_entitlements WHERE email_hash LIKE '%existing%' OR source_record_digest LIKE '%railway%'").get().n, 0);
  assert.equal((await importContinuity(context('/api/staging/admin/continuity-entitlements',
    continuityBody))).status, 409);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM continuity_import_batches').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n, 4);
});
