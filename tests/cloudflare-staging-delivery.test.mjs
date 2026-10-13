import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.mjs';
import { sandboxFulfillInD1Batch, derivedActivationCode } from '../functions/_lib/staging-issuance.js';
import { attemptActivationDelivery } from '../functions/_lib/staging-delivery.js';

const secret = 'test-only-delivery-code-secret-1234567890';
const email = 'delivery@example.invalid';
const reference = 'WTVTEST-deliveryreference1';

async function setup() {
  const db = new TestD1();
  db.sqlite.prepare("INSERT INTO users(name,email,password_hash,email_verified_at) VALUES('Buyer',?,'hash',CURRENT_TIMESTAMP)").run(email);
  const checkout = db.sqlite.prepare("INSERT INTO checkout_requests(reference,user_id,plan_id,provider,currency,amount_minor,status) VALUES(?,1,1,'paystack','USD',2300,'pending')").run(reference);
  db.sqlite.prepare("INSERT INTO orders(reference,user_id,plan_id,checkout_request_id,provider,amount_minor,currency,status) VALUES(?,1,1,?,'paystack',2300,'USD','pending')").run(reference, checkout.lastInsertRowid);
  await sandboxFulfillInD1Batch(db, { eventId: 'charge.success:123456', reference,
    transactionId: 123456, amountMinor: 2300, currency: 'USD',
    payloadSha256: 'd'.repeat(64), issuanceSecret: secret });
  return db;
}

function context(db, deliveries, responseStatus = 202) {
  return { env: { DB: db, WORLDTV_STAGING_DELIVERY_ENABLED: 'true',
    WORLDTV_STAGING_CODE_HMAC_SECRET: secret,
    WORLDTV_STAGING_EMAIL_ALLOWLIST: email,
    WORLDTV_ACTIVATION_MAILER: { fetch: async request => {
      deliveries.push(await request.json()); return new Response('', { status: responseStatus });
    } } } };
}

test('outbox delivers the derived code once and stores no plaintext code', async () => {
  const db = await setup();
  const deliveries = [];
  assert.deepEqual(await attemptActivationDelivery(context(db, deliveries), 1), { status: 'delivered' });
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].template, 'activation-code');
  assert.equal(deliveries[0].to, email);
  assert.equal(deliveries[0].activation_code, (await derivedActivationCode(reference, secret)).code);
  assert.equal(db.sqlite.prepare('SELECT status FROM activation_deliveries').get().status, 'delivered');
  assert.equal(JSON.stringify(db.sqlite.prepare('SELECT * FROM activation_deliveries').all())
    .includes(deliveries[0].activation_code), false);
  assert.deepEqual(await attemptActivationDelivery(context(db, deliveries), 1), { status: 'not_due' });
  assert.equal(deliveries.length, 1);
});

test('mailer failure is retryable and recipient/code mismatch dies without transmission', async () => {
  const failedDb = await setup();
  assert.deepEqual(await attemptActivationDelivery(context(failedDb, [], 503), 1), { status: 'retry' });
  assert.equal(failedDb.sqlite.prepare('SELECT status,last_error_code FROM activation_deliveries').get().status, 'retry');

  const wrongRecipientDb = await setup();
  const sent = [];
  const ctx = context(wrongRecipientDb, sent);
  ctx.env.WORLDTV_STAGING_EMAIL_ALLOWLIST = 'somebody-else@example.invalid';
  assert.deepEqual(await attemptActivationDelivery(ctx, 1), { status: 'dead' });
  assert.equal(sent.length, 0);

  const wrongCodeDb = await setup();
  wrongCodeDb.sqlite.exec("UPDATE subscription_codes SET code_hash='" + '0'.repeat(64) + "'");
  const codeSent = [];
  assert.deepEqual(await attemptActivationDelivery(context(wrongCodeDb, codeSent), 1), { status: 'dead' });
  assert.equal(codeSent.length, 0);
});

test('delivery remains disabled without every staging switch and binding', async () => {
  const db = await setup();
  assert.deepEqual(await attemptActivationDelivery({ env: { DB: db } }, 1), { status: 'disabled' });
  assert.equal(db.sqlite.prepare('SELECT status FROM activation_deliveries').get().status, 'pending');
});
