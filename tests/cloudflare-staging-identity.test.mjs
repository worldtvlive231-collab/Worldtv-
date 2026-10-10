import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.mjs';
import { onRequestPost as register } from '../functions/api/staging/auth/register.js';
import { onRequestPost as login } from '../functions/api/staging/auth/login.js';
import { onRequestPost as requestEmail } from '../functions/api/staging/auth/request-email.js';
import { onRequestPost as completeEmail } from '../functions/api/staging/auth/complete-email.js';
import { hashPassword, hashSessionToken, readBody, verifyPassword } from '../functions/_lib/staging-auth.js';
import { verifyTurnstile } from '../functions/_lib/staging-turnstile.js';
import { onRequestGet as accountPage } from '../functions/staging-account.js';

const origin = 'https://worldtv-preview.pages.dev';
const email = 'security@example.invalid';
const password = 'Secure-Test-Password-777';
const pepper = 'test-only-password-pepper-32-bytes-minimum';
function setup() {
  const db = new TestD1();
  const deliveries = [];
  const env = { DB: db, WORLDTV_STAGING_AUTH_ENABLED: 'true', WORLDTV_STAGING_REGISTRATION_ENABLED: 'true',
    WORLDTV_STAGING_IDENTITY_ENABLED: 'true', WORLDTV_AUTH_RATE_SECRET: 'test-rate-secret'.repeat(4),
    WORLDTV_TURNSTILE_SECRET: 'test-turnstile-secret', WORLDTV_PASSWORD_PEPPER: pepper,
    WORLDTV_STAGING_EMAIL_ALLOWLIST: email,
    WORLDTV_AUTH_MAILER: { fetch: async request => { deliveries.push(await request.json()); return new Response('', {status:202}); } } };
  const context = (payload, overrides = {}) => ({ env, ...overrides, request: new Request(origin + '/api/staging/auth/test', {
    method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.9' }, body: JSON.stringify(payload)
  }), data: { turnstileTestVerify: async () => ({ ok: true, json: async () => ({ success: true, hostname: 'worldtv-preview.pages.dev', action: 'register' }) }) } });
  return { db, env, deliveries, context };
}
function deliveredToken(deliveries) { return deliveries.at(-1).link.split('=')[1]; }

test('registration requires verification; token is hashed, purpose bound and single use', async () => {
  const { db, deliveries, context } = setup();
  assert.equal((await register(context({ name: 'Test', email, password, turnstileToken: 'test-token-long-enough' }))).status, 201);
  assert.equal(db.users[0].email_verified_at, null);
  assert.equal((await login(context({ email, password }))).status, 401);
  const token = deliveredToken(deliveries);
  assert.equal(db.sqlite.prepare('SELECT token_hash FROM identity_tokens').get().token_hash, await hashSessionToken(token));
  assert.ok(!JSON.stringify(db.sqlite.prepare('SELECT * FROM identity_tokens').all()).includes(token));
  assert.equal((await completeEmail(context({ token, purpose: 'reset', password }))).status, 400);
  assert.equal((await completeEmail(context({ token, purpose: 'verify' }))).status, 200);
  assert.equal((await completeEmail(context({ token, purpose: 'verify' }))).status, 400);
  assert.equal((await login(context({ email, password }))).status, 200);
});

test('recovery changes verified account password and revokes all sessions; replay fails', async () => {
  const { db, deliveries, context } = setup();
  db.sqlite.prepare('INSERT INTO users(name,email,password_hash,email_verified_at) VALUES(?,?,?,CURRENT_TIMESTAMP)')
    .run('Test', email, await hashPassword(password, pepper));
  assert.equal((await login(context({ email, password }))).status, 200);
  assert.equal((await login(context({ email, password }))).status, 200);
  assert.equal(db.sessions.length, 2);
  assert.equal((await requestEmail(context({ email, purpose: 'reset' }))).status, 202);
  const token = deliveredToken(deliveries);
  const changed = 'Changed-Secure-Password-888';
  const result = await completeEmail(context({ purpose: 'reset', token, password: changed }));
  assert.equal(result.status, 200);
  assert.match(result.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(db.sessions.length, 0);
  assert.equal(await verifyPassword(changed, db.users[0].password_hash, pepper), true);
  assert.equal(await verifyPassword(password, db.users[0].password_hash, pepper), false);
  assert.equal((await completeEmail(context({ purpose: 'reset', token, password }))).status, 400);
});

test('unknown and ineligible accounts have identical recovery response', async () => {
  const { db, deliveries, context } = setup();
  db.sqlite.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run('Test', email, await hashPassword(password, pepper));
  const existing = await requestEmail(context({ email, purpose: 'reset' }));
  const absent = await requestEmail(context({ email: 'absent@example.invalid', purpose: 'reset' }));
  assert.equal(existing.status, absent.status);
  assert.equal(await existing.text(), await absent.text());
  assert.equal(deliveries.length, 0);
});

test('expired, disabled and superseded tokens cannot verify accounts', async () => {
  const { db, deliveries, context } = setup();
  db.sqlite.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run('Test', email, await hashPassword(password, pepper));
  await requestEmail(context({ email, purpose: 'verify' }));
  const old = deliveredToken(deliveries);
  await requestEmail(context({ email, purpose: 'verify' }));
  assert.equal((await completeEmail(context({ token: old, purpose: 'verify' }))).status, 400);
  const current = deliveredToken(deliveries);
  db.sqlite.exec("UPDATE identity_tokens SET expires_at=datetime('now','-1 minute')");
  assert.equal((await completeEmail(context({ token: current, purpose: 'verify' }))).status, 400);
  await requestEmail(context({ email, purpose: 'verify' }));
  db.sqlite.exec("UPDATE users SET status='disabled'");
  assert.equal((await completeEmail(context({ token: deliveredToken(deliveries), purpose: 'verify' }))).status, 400);
});

test('distributed account rate limit prevents sixth login and fails closed without secrets or D1', async () => {
  const { env, context } = setup();
  for (let i=0;i<5;i++) assert.equal((await login(context({ email, password }))).status, 401);
  const denied = await login(context({ email, password }));
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get('retry-after'), '600');
  delete env.WORLDTV_AUTH_RATE_SECRET;
  assert.equal((await login(context({ email, password }))).status, 503);
});

test('email routes reject cross-origin writes and are disabled on live hostname', async () => {
  const { env, context } = setup();
  for (const handler of [requestEmail, completeEmail]) {
    const ctx = context({ email, purpose: 'verify' });
    ctx.request.headers.set('origin', 'https://attacker.invalid');
    assert.equal((await handler(ctx)).status, 403);
    ctx.request = new Request('https://myworldtvlive.com/api/staging/auth/test', {method:'POST'});
    assert.equal((await handler(ctx)).status, 404);
  }
  env.WORLDTV_STAGING_IDENTITY_ENABLED = 'false';
  assert.equal((await requestEmail(context({ email, purpose: 'verify' }))).status, 404);
});

test('mailer outage never authenticates a new account and resend can recover it', async () => {
  const { env, context, db } = setup();
  env.WORLDTV_AUTH_MAILER.fetch = async () => new Response('', {status:503});
  assert.equal((await register(context({ name:'Test', email, password, turnstileToken:'long-test-token' }))).status, 503);
  assert.equal(db.users.length, 1);
  assert.equal(db.users[0].email_verified_at, null);
  assert.equal((await login(context({ email, password }))).status, 401);
  assert.equal((await requestEmail(context({ email, purpose:'verify' }))).status, 202);
});

test('Turnstile verifies exact deployment hostname and register action', async () => {
  const options = { secret:'test-secret-long', hostname:'worldtv-preview.pages.dev', action:'register' };
  for (const result of [{success:true,hostname:'attacker.invalid',action:'register'},
    {success:true,hostname:options.hostname,action:'login'}, {success:true}]) {
    assert.equal(await verifyTurnstile('long-test-token', {...options,verify:async()=>({ok:true,json:async()=>result})}), false);
  }
});

test('body reader bounds a streaming request before collecting oversized payload', async () => {
  const request = new Request(origin, {method:'POST',body:'a'.repeat(4097)});
  await assert.rejects(readBody(request), /too large/);
});

test('concurrent verification consumes exactly one token in serialized transactional batches', async () => {
  const { db, deliveries, context } = setup();
  db.sqlite.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run('Test', email, await hashPassword(password, pepper));
  await requestEmail(context({ email, purpose:'verify' }));
  const token = deliveredToken(deliveries);
  const responses = await Promise.all([completeEmail(context({token,purpose:'verify'})), completeEmail(context({token,purpose:'verify'}))]);
  assert.deepEqual(responses.map(x=>x.status).sort(), [200,400]);
});

test('account page is gated, rejects sitekey injection and uses nonce CSP with fragment cleanup', async () => {
  const { env, context } = setup();
  assert.equal((await accountPage(context({}))).status, 404);
  env.WORLDTV_STAGING_UI_ENABLED = 'true';
  env.WORLDTV_TURNSTILE_SITEKEY = 'invalid"><script>';
  assert.equal((await accountPage(context({}))).status, 503);
  env.WORLDTV_TURNSTILE_SITEKEY = 'test-sitekey-1234';
  const response = await accountPage(context({}));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy'), /script-src 'nonce-/);
  const html = await response.text();
  assert.match(html, /data-action="register"/);
  assert.match(html, /history.replaceState/);
  assert.ok(!html.includes('localStorage'));
});
