import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  derivedActivationCode, sandboxFulfillInD1Batch
} from "../functions/_lib/staging-issuance.js";

const secret = "test-only-issuance-secret-DO-NOT-USE-FOR-REAL-2026";
const reference = "WTV-TEST-PAY-0001";
const base = {
  eventId: "charge.success:443322",
  reference,
  transactionId: 443322,
  amountMinor: 2300,
  currency: "USD",
  payloadSha256: "a".repeat(64),
  issuanceSecret: secret
};

function db() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of [
    "001_core.sql", "002_operations.sql",
    "003_user_guards.sql", "004_chat_message_counters.sql"
  ]) sqlite.exec(readFileSync(resolve("cloudflare/d1", file), "utf8"));
  const api = {
    prepare(sql) {
      return { bind(...args) {
        return { run: async () => {
          const out = sqlite.prepare(sql).run(...args);
          return { meta: { changes: Number(out.changes) } };
        } };
      } };
    },
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
  return { sqlite, api };
}
function seedOrder(sqlite, { status = "pending", userStatus = "active", amount = 2300,
  currency = "USD", ref = reference } = {}) {
  sqlite.prepare(
    "INSERT INTO users(name,email,password_hash,status) VALUES('Buyer','buyer@example.invalid','hash',?)"
  ).run(userStatus);
  const checkout = sqlite.prepare(
    "INSERT INTO checkout_requests(reference,user_id,plan_id,provider,amount_minor,currency,status) " +
    "VALUES(?,1,1,'paystack',?,?,'pending')"
  ).run(ref, amount, currency);
  sqlite.prepare(
    "INSERT INTO orders(reference,user_id,plan_id,checkout_request_id,provider,amount_minor,currency,status) " +
    "VALUES(?,1,1,?,'paystack',?,?,?)"
  ).run(ref, checkout.lastInsertRowid, amount, currency, status);
}
function codeCount(sqlite) {
  return sqlite.prepare("SELECT COUNT(*) AS n FROM subscription_codes").get().n;
}
function orderStatus(sqlite) {
  return sqlite.prepare("SELECT status FROM orders WHERE reference=?").get(reference)?.status;
}

test("stable secret-derived code is not saved in plaintext and changes with key", async () => {
  const a = await derivedActivationCode(reference, secret);
  const b = await derivedActivationCode(reference, secret);
  const c = await derivedActivationCode(reference, secret + "changed");
  assert.deepEqual(a, b);
  assert.notEqual(a.code, c.code);
  assert.match(a.code, /^WTV-[0-9A-F]{32}$/);
  assert.match(a.code_hash, /^[0-9a-f]{64}$/);
  assert.equal(a.code_hint.length, 4);
  await assert.rejects(() => derivedActivationCode(reference, "short"));
});

test("trusted test-order + signed-event input can stage exactly one paid code", async () => {
  const { sqlite, api } = db();
  seedOrder(sqlite);
  const first = await sandboxFulfillInD1Batch(api, base);
  assert.deepEqual(first, { newly_paid: true, code_issued: true,
    duplicate: false, code_hint: (await derivedActivationCode(reference, secret)).code_hint });
  assert.equal(orderStatus(sqlite), "paid");
  assert.equal(sqlite.prepare("SELECT status FROM checkout_requests").get().status, "paid");
  assert.equal(codeCount(sqlite), 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM payment_events").get().n, 1);
  const code = sqlite.prepare("SELECT code_hash,code_hint,user_id,order_id,status FROM subscription_codes").get();
  assert.equal(code.code_hash, (await derivedActivationCode(reference, secret)).code_hash);
  assert.equal(code.user_id, 1);
  assert.equal(code.status, "unused");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM subscriptions").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n >= 20, true);
  assert.deepEqual(await sandboxFulfillInD1Batch(api, base),
    { newly_paid: false, code_issued: false, duplicate: true, code_hint: null });
  assert.equal(codeCount(sqlite), 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM payment_events").get().n, 1);
});

test("different event IDs referencing same paid order never generate a second code", async () => {
  const { sqlite, api } = db();
  seedOrder(sqlite);
  await sandboxFulfillInD1Batch(api, base);
  const replay = await sandboxFulfillInD1Batch(api, {
    ...base, eventId: "charge.success:998877", transactionId: 998877,
    payloadSha256: "b".repeat(64)
  });
  assert.equal(replay.code_issued, false);
  assert.equal(replay.newly_paid, false);
  assert.equal(codeCount(sqlite), 1);
  assert.equal(orderStatus(sqlite), "paid");
});

test("invalid amount, wrong currency or missing order never marks anything paid or issues a code", async () => {
  const { sqlite, api } = db();
  seedOrder(sqlite);
  for (const testChange of [
    { amountMinor: 1200, transactionId: 101, eventId: "charge.success:101" },
    { currency: "GHS", transactionId: 102, eventId: "charge.success:102" },
    { reference: "WTV-UNRECOGNIZED", transactionId: 103, eventId: "charge.success:103" }
  ]) {
    const result = await sandboxFulfillInD1Batch(api, { ...base, ...testChange });
    assert.equal(result.code_issued, false);
    assert.equal(result.newly_paid, false);
  }
  assert.equal(orderStatus(sqlite), "pending");
  assert.equal(codeCount(sqlite), 0);
});

test("disabled buyer cannot receive code or turn an order paid", async () => {
  const { sqlite, api } = db();
  seedOrder(sqlite, { userStatus: "disabled" });
  const result = await sandboxFulfillInD1Batch(api, base);
  assert.equal(result.code_issued, false);
  assert.equal(result.newly_paid, false);
  assert.equal(codeCount(sqlite), 0);
  assert.equal(orderStatus(sqlite), "pending");
});
