import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.mjs';
import { hashSessionToken } from '../functions/_lib/staging-auth.js';
import { initializePaystackSandbox } from '../functions/_lib/staging-paystack-client.js';
import { onRequestPost as createDraft } from '../functions/api/staging/payment/checkout-draft.js';
import { onRequestPost as initialize } from '../functions/api/staging/payment/paystack-sandbox-initialize.js';

const HOST = 'https://worldtv-preview.pages.dev';
const secret = 'sk_test_only_for_worldtv_tests_1234567890';
const token = 'i'.repeat(43);

async function setup() {
  const db = new TestD1();
  db.sqlite.prepare("INSERT INTO users(name,email,password_hash,email_verified_at) VALUES('Buyer','buyer@example.invalid','hash',CURRENT_TIMESTAMP)").run();
  db.sqlite.prepare("INSERT INTO customer_sessions(token_hash,user_id,expires_at) VALUES(?,1,datetime('now','+1 day'))")
    .run(await hashSessionToken(token));
  const baseEnv = { DB: db, WORLDTV_STAGING_AUTH_ENABLED: 'true',
    WORLDTV_STAGING_TEST_CHECKOUT_ENABLED: 'true',
    WORLDTV_STAGING_PAYSTACK_INITIALIZE_ENABLED: 'true',
    WORLDTV_PAYSTACK_TEST_SECRET: secret };
  const draftRequest = new Request(HOST + '/api/staging/payment/checkout-draft', {
    method: 'POST', headers: { origin: HOST, 'content-type': 'application/json',
      cookie: '__Host-worldtv_staging=' + token }, body: JSON.stringify({ plan_slug: 'annual' })
  });
  const draft = await createDraft({ request: draftRequest, env: baseEnv });
  const { reference } = await draft.json();
  return { db, baseEnv, reference };
}

function request(reference) {
  return new Request(HOST + '/api/staging/payment/paystack-sandbox-initialize', {
    method: 'POST', headers: { origin: HOST, 'content-type': 'application/json',
      cookie: '__Host-worldtv_staging=' + token }, body: JSON.stringify({ reference })
  });
}

function provider(reference, calls) {
  return async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ status: true, data: {
      authorization_url: 'https://checkout.paystack.com/test-access-123',
      access_code: 'test-access-123', reference
    } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

test('Paystack client accepts only test keys, exact preview callback and approved checkout host', async () => {
  const input = { secret, email: 'buyer@example.invalid', reference: 'WTVTEST-abcdefghijklmnop',
    amountMinor: 2300, currency: 'USD',
    callbackUrl: HOST + '/staging-lab?payment=return' };
  const calls = [];
  assert.equal((await initializePaystackSandbox({ ...input,
    fetchImpl: provider(input.reference, calls) })).payment_url,
    'https://checkout.paystack.com/test-access-123');
  assert.equal(calls[0].url, 'https://api.paystack.co/transaction/initialize');
  assert.equal(JSON.parse(calls[0].options.body).amount, '2300');
  await assert.rejects(initializePaystackSandbox({ ...input, secret: 'sk_live_do_not_accept_1234567890',
    fetchImpl: provider(input.reference, []) }));
  await assert.rejects(initializePaystackSandbox({ ...input,
    callbackUrl: 'https://attacker.invalid/callback', fetchImpl: provider(input.reference, []) }));
  await assert.rejects(initializePaystackSandbox({ ...input,
    fetchImpl: async () => new Response(JSON.stringify({ status: true, data: {
      authorization_url: 'https://attacker.invalid/pay', access_code: 'test-access-123',
      reference: input.reference } }), { status: 200 }) }));
});

test('authenticated customer initializes one idempotent sandbox checkout', async () => {
  const { db, baseEnv, reference } = await setup();
  const calls = [];
  const context = { request: request(reference), env: baseEnv,
    data: { paystackFetch: provider(reference, calls) } };
  const response = await initialize(context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { environment: 'staging', reference,
    payment_url: 'https://checkout.paystack.com/test-access-123', status: 'sandbox_initialized' });
  assert.equal(calls.length, 1);
  const repeat = await initialize({ ...context, request: request(reference) });
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).duplicate, true);
  assert.equal(calls.length, 1);
  assert.equal(db.sqlite.prepare('SELECT status FROM payment_initializations').get().status, 'initialized');
});

test('sandbox initialization fails closed without flags, session or a test key', async () => {
  const { baseEnv, reference } = await setup();
  const off = await initialize({ request: request(reference), env: {
    ...baseEnv, WORLDTV_STAGING_PAYSTACK_INITIALIZE_ENABLED: 'false' } });
  assert.equal(off.status, 404);
  const liveKey = await initialize({ request: request(reference), env: {
    ...baseEnv, WORLDTV_PAYSTACK_TEST_SECRET: 'sk_live_never_accepted_1234567890' } });
  assert.equal(liveKey.status, 503);
  const anonymousRequest = request(reference);
  anonymousRequest.headers.delete('cookie');
  assert.equal((await initialize({ request: anonymousRequest, env: baseEnv })).status, 401);
});

test('provider failure is persisted without leaking its response and retry is delayed', async () => {
  const { db, baseEnv, reference } = await setup();
  const response = await initialize({ request: request(reference), env: baseEnv,
    data: { paystackFetch: async () => new Response(JSON.stringify({
      status: false, message: 'sensitive provider detail' }), { status: 400 }) } });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'Could not start sandbox payment');
  const row = db.sqlite.prepare('SELECT status,last_error_code,authorization_url FROM payment_initializations').get();
  assert.equal(row.status, 'failed');
  assert.equal(row.last_error_code, 'provider_rejected');
  assert.equal(row.authorization_url, null);
  const early = await initialize({ request: request(reference), env: baseEnv,
    data: { paystackFetch: () => { throw new Error('must not call provider'); } } });
  assert.equal(early.status, 409);
});
