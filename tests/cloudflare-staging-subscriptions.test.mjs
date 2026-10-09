import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CLAIM_SQL, CREATE_SUBSCRIPTION_SQL } from "../functions/api/staging/subscriptions/redeem.js";
import { normalizeActivationCode, activationCodeHash } from "../functions/_lib/staging-entitlements.js";
import { onRequestPost as redeem } from "../functions/api/staging/subscriptions/redeem.js";
import { onRequestGet as list } from "../functions/api/staging/subscriptions.js";

const BASE = "https://worldtv-preview.pages.dev";
const rawCode = "WTV-DEMO-1234-5678-ABCD";
const otherCode = "WTV-DEMO-5555-6666-ABCD";

function memoryDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const file of ["001_core.sql", "002_operations.sql", "003_user_guards.sql"]) {
    db.exec(readFileSync(resolve("cloudflare/d1", file), "utf8"));
  }
  db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)")
    .run("Test A", "a@example.invalid", "test-only-hash");
  db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)")
    .run("Test B", "b@example.invalid", "test-only-hash");
  return db;
}

function insertCode(db, codeHash, options = {}) {
  const status = options.status || "unused";
  const owner = options.owner ?? null;
  const orderId = options.orderId ?? null;
  const expires = options.expires ?? null;
  db.prepare("INSERT INTO subscription_codes(code_hash,plan_id,status,user_id,order_id,expires_at) VALUES(?,1,?,?,?,?)")
    .run(codeHash, status, owner, orderId, expires);
}

function redeemWithinSqliteTransaction(db, hash, userId) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const claim = db.prepare(CLAIM_SQL).run(userId, hash, userId, userId, userId);
    const insert = db.prepare(CREATE_SUBSCRIPTION_SQL).run(userId, hash, userId, userId);
    db.exec("COMMIT");
    return { claimed: Number(claim.changes), inserted: Number(insert.changes) };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

test("normalize codes only to validated uppercase form and hash to fixed SHA256 digest", async () => {
  assert.equal(normalizeActivationCode(" wtv-demo-1234-5678-abcd "), rawCode);
  assert.equal(normalizeActivationCode("short"), null);
  assert.equal(normalizeActivationCode(""), null);
  const hash = await activationCodeHash(rawCode);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, rawCode);
});


test("atomic SQLite claim creates one annual entitlement and blocks duplicate redemption", async () => {
  const db = memoryDb();
  const hash = await activationCodeHash(rawCode);
  insertCode(db, hash);
  const first = redeemWithinSqliteTransaction(db, hash, 1);
  assert.deepEqual(first, { claimed: 1, inserted: 1 });
  const subscription = db.prepare("SELECT user_id, status, ends_at, starts_at FROM subscriptions").get();
  assert.equal(subscription.user_id, 1);
  assert.equal(subscription.status, "active");
  const duration = (Date.parse(subscription.ends_at + "Z") - Date.parse(subscription.starts_at + "Z")) / 86400000;
  assert.equal(duration, 365);
  assert.equal(db.prepare("SELECT status, user_id FROM subscription_codes WHERE code_hash = ?").get(hash).status, "redeemed");
  assert.deepEqual(redeemWithinSqliteTransaction(db, hash, 1), { claimed: 0, inserted: 0 });
  assert.deepEqual(redeemWithinSqliteTransaction(db, hash, 2), { claimed: 0, inserted: 0 });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM subscriptions").get().count, 1);
});

test("invalid ownership, expiry, unverified orders, and active subscriptions cannot claim codes", async () => {
  const db = memoryDb();
  const [a, b, c, d, e] = await Promise.all(
    ["OWNED", "EXPIRED", "UNPAID", "PAID-OTHER", "ACTIVE"].map(
      value => activationCodeHash("WTV-2026-TEST-777-" + value)
    )
  );

  insertCode(db, a, { owner: 2 });
  assert.deepEqual(redeemWithinSqliteTransaction(db, a, 1), { claimed: 0, inserted: 0 });
  insertCode(db, b, { expires: "2000-01-01 00:00:00" });
  assert.deepEqual(redeemWithinSqliteTransaction(db, b, 1), { claimed: 0, inserted: 0 });

  const unpaid = db.prepare(
    "INSERT INTO orders(reference,user_id,plan_id,provider,amount_minor,currency,status) " +
    "VALUES('test-pending-order',1,1,'paystack',2300,'USD','pending')"
  ).run();
  insertCode(db, c, { orderId: unpaid.lastInsertRowid });
  assert.deepEqual(redeemWithinSqliteTransaction(db, c, 1), { claimed: 0, inserted: 0 });

  const someoneElsesOrder = db.prepare(
    "INSERT INTO orders(reference,user_id,plan_id,provider,amount_minor,currency,status) " +
    "VALUES('test-other-user-paid',2,1,'paystack',2300,'USD','paid')"
  ).run();
  insertCode(db, d, { orderId: someoneElsesOrder.lastInsertRowid });
  assert.deepEqual(redeemWithinSqliteTransaction(db, d, 1), { claimed: 0, inserted: 0 });
  assert.deepEqual(redeemWithinSqliteTransaction(db, d, 2), { claimed: 1, inserted: 1 });

  // Account 2 is active now and must not accidentally consume another valid code.
  insertCode(db, e, { owner: 2 });
  assert.deepEqual(redeemWithinSqliteTransaction(db, e, 2), { claimed: 0, inserted: 0 });
  assert.equal(db.prepare("SELECT status FROM subscription_codes WHERE code_hash=?").get(e).status, "unused");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM subscriptions").get().count, 1);
});

function makeRequest(path, method = "GET", cookie = null, payload = undefined, origin = BASE) {
  const headers = method === "POST" ? { origin, "content-type": "application/json" } : {};
  if (cookie) headers.cookie = cookie;
  return new Request(BASE + path, { method, headers,
    body: payload ? JSON.stringify(payload) : undefined });
}

function mockDB() {
  const prepared = [];
  const batchCalls = [];
  const db = {
    prepare(query) {
      return {
        bind(...args) {
          prepared.push({ query, args });
          return {
            first: async () => ({ id: 1, email: "a@example.invalid", name: "Test A" }),
            all: async () => ({ results: [] }),
            query, args
          };
        }
      };
    },
    batch: async statements => {
      batchCalls.push(statements);
      return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }];
    }
  };
  return { db, prepared, batchCalls };
}

test("redemption route is disabled unless both preview flags are enabled", async () => {
  const { db } = mockDB();
  const req = makeRequest("/api/staging/subscriptions/redeem", "POST", null, { code: rawCode });
  const disabledAuth = await redeem({
    request: req, env: { DB: db, WORLDTV_STAGING_AUTH_ENABLED: "false",
      WORLDTV_STAGING_REDEMPTION_ENABLED: "true" }
  });
  assert.equal(disabledAuth.status, 404);
  const disabledRedeem = await redeem({
    request: req, env: { DB: db, WORLDTV_STAGING_AUTH_ENABLED: "true" }
  });
  assert.equal(disabledRedeem.status, 404);
});

test("redemption is account-bound and sends SHA256 hash, not plaintext, to D1", async () => {
  const { db, prepared, batchCalls } = mockDB();
  const session = "x".repeat(43);
  const req = makeRequest("/api/staging/subscriptions/redeem", "POST",
    "__Host-worldtv_staging=" + session, { code: rawCode.toLowerCase() });
  const response = await redeem({
    request: req,
    env: { DB: db, WORLDTV_STAGING_AUTH_ENABLED: "true",
      WORLDTV_STAGING_REDEMPTION_ENABLED: "true" }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "activated", environment: "staging" });
  assert.equal(batchCalls.length, 1);
  assert.equal(batchCalls[0].length, 2);
  assert.ok(prepared.some(item => item.query.startsWith("SELECT u.id")));
  assert.ok(prepared.every(item => !JSON.stringify(item).includes(rawCode)));
  assert.ok(prepared.filter(item => /(?:UPDATE subscription_codes|INSERT INTO subscriptions)/.test(item.query))
    .every(item => item.args.includes(1)));
  assert.ok(prepared.some(item => item.args.includes(await activationCodeHash(rawCode))));
});

test("subscription status is private and only queries active customer's own account", async () => {
  const { db, prepared } = mockDB();
  const unauthorized = await list({
    request: makeRequest("/api/staging/subscriptions"),
    env: { DB: db, WORLDTV_STAGING_AUTH_ENABLED: "true" }
  });
  assert.equal(unauthorized.status, 401);
  const response = await list({
    request: makeRequest("/api/staging/subscriptions", "GET",
      "__Host-worldtv_staging=" + "x".repeat(43)),
    env: { DB: db, WORLDTV_STAGING_AUTH_ENABLED: "true" }
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).subscriptions, []);
  const rowsQuery = prepared.find(item => item.query.startsWith("SELECT s.id"));
  assert.ok(rowsQuery?.query.includes("WHERE s.user_id = ?"));
  assert.deepEqual(rowsQuery?.args, [1]);
});
