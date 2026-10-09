import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hashSessionToken } from "../functions/_lib/staging-auth.js";
import { onRequestPost as checkout } from "../functions/api/staging/payment/checkout-draft.js";
import { onRequestPost as webhook } from "../functions/api/staging/payment/paystack-sandbox-webhook.js";

const HOST = "https://worldtv-preview.pages.dev";
const token = "u".repeat(43);
const signSecret = "fake-staging-paystack-key-DO-NOT-USE";
const codeSecret = "fake-staging-code-hmac-master-key-DO-NOT-USE-2026";

function memoryDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of ["001_core.sql", "002_operations.sql",
    "003_user_guards.sql", "004_chat_message_counters.sql"]) {
    sqlite.exec(readFileSync(resolve("cloudflare/d1", file), "utf8"));
  }
  const api = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            run: async () => {
              const row = sqlite.prepare(sql).run(...args);
              return { meta: { changes: Number(row.changes) } };
            },
            first: async () => sqlite.prepare(sql).get(...args) || null
          };
        },
        first: async () => sqlite.prepare(sql).get() || null
      };
    },
    async batch(stmts) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = [];
        for (const stmt of stmts) result.push(await stmt.run());
        sqlite.exec("COMMIT");
        return result;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    }
  };
  return { sqlite, api };
}

async function setupAccount(sqlite) {
  sqlite.prepare(
    "INSERT INTO users(name,email,password_hash) VALUES('Buyer','buyer@example.invalid','only-test-hash')"
  ).run();
  sqlite.prepare(
    "INSERT INTO customer_sessions(token_hash,user_id,expires_at) VALUES(?,1,datetime('now','+1 day'))"
  ).run(await hashSessionToken(token));
}

function ctx(req, api, extraFlags = {}) {
  return { request: req, env: {
    DB: api, WORLDTV_STAGING_AUTH_ENABLED: "true",
    WORLDTV_STAGING_TEST_CHECKOUT_ENABLED: "true",
    WORLDTV_STAGING_PAYSTACK_VALIDATION_ENABLED: "true",
    WORLDTV_STAGING_FULFILLMENT_ENABLED: "true",
    WORLDTV_PAYSTACK_TEST_SECRET: signSecret,
    WORLDTV_STAGING_CODE_HMAC_SECRET: codeSecret,
    ...extraFlags
  } };
}
function checkoutRequest(body = { plan_slug: "annual" }) {
  return new Request(HOST + "/api/staging/payment/checkout-draft", {
    method: "POST", headers: {
      origin: HOST,
      "content-type": "application/json",
      cookie: "__Host-worldtv_staging=" + token
    }, body: JSON.stringify(body)
  });
}

async function signedWebhook(ref, attrs = {}) {
  const event = {
    event: "charge.success",
    data: { id: 990011, reference: ref, status: "success",
      domain: "test", amount: 2300, currency: "USD", ...attrs }
  };
  const raw = JSON.stringify(event);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(signSecret),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"]
  );
  const signature = Buffer.from(await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(raw)
  )).toString("hex");
  return new Request(HOST + "/api/staging/payment/paystack-sandbox-webhook", {
    method: "POST", headers: { "x-paystack-signature": signature }, body: raw
  });
}

test("checkout is double-gated and never returns a live payment URL", async () => {
  const { sqlite, api } = memoryDb();
  await setupAccount(sqlite);
  const disabled = await checkout(ctx(checkoutRequest(), api, {
    WORLDTV_STAGING_TEST_CHECKOUT_ENABLED: "false"
  }));
  assert.equal(disabled.status, 404);
  const invalid = await checkout(ctx(checkoutRequest({
    plan_slug: "annual", amount_minor: 1
  }), api));
  assert.equal(invalid.status, 400);
  const created = await checkout(ctx(checkoutRequest(), api));
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.payment_url, null);
  assert.equal(body.amount_minor, 2300);
  assert.equal(body.currency, "USD");
  assert.match(body.reference, /^WTVTEST-[A-Za-z0-9_-]{22}$/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM orders").get().n, 1);
});

test("signed sandbox test webhook fulfills only a linked pending order once", async () => {
  const { sqlite, api } = memoryDb();
  await setupAccount(sqlite);
  const created = await checkout(ctx(checkoutRequest(), api));
  const { reference } = await created.json();
  const request = await signedWebhook(reference);
  const result = await webhook(ctx(request, api));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    status: "accepted", environment: "staging",
    fulfillment: "code_reserved_no_delivery"
  });
  assert.equal(sqlite.prepare("SELECT status FROM orders").get().status, "paid");
  assert.equal(sqlite.prepare("SELECT status FROM checkout_requests").get().status, "paid");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM subscription_codes").get().n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM subscriptions").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM payment_events").get().n, 1);

  const replay = await webhook(ctx(await signedWebhook(reference), api));
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).duplicate, true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM subscription_codes").get().n, 1);
});

test("forged, mismatched and live-domain events do not issue a code", async () => {
  const { sqlite, api } = memoryDb();
  await setupAccount(sqlite);
  const created = await checkout(ctx(checkoutRequest(), api));
  const { reference } = await created.json();
  const off = await webhook(ctx(await signedWebhook(reference), api, {
    WORLDTV_STAGING_FULFILLMENT_ENABLED: "false"
  }));
  assert.equal(off.status, 404);

  const fake = await signedWebhook(reference);
  fake.headers.set("x-paystack-signature", "0".repeat(128));
  assert.equal((await webhook(ctx(fake, api))).status, 403);
  assert.equal((await webhook(ctx(await signedWebhook(reference, { amount: 1 }), api))).status, 400);
  assert.equal((await webhook(ctx(await signedWebhook(reference, { domain: "live" }), api))).status, 403);
  assert.equal(sqlite.prepare("SELECT status FROM orders").get().status, "pending");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM subscription_codes").get().n, 0);
});
