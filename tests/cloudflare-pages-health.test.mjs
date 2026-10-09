import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const code = await readFile(new URL("../functions/api/cloudflare-health.js", import.meta.url), "utf8");
const { onRequestGet } = await import("data:text/javascript;charset=utf-8," + encodeURIComponent(code));

test("healthy D1 binding has a sanitized success response", async () => {
  let query;
  const response = await onRequestGet({
    env: {
      DB: {
        prepare(statement) {
          query = statement;
          return { first: async () => ({ name: "subscriptions" }) };
        }
      }
    }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", database: "connected" });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(query, /sqlite_master/i);
  assert.doesNotMatch(query, /from\s+users\b|from\s+orders\b|from\s+subscription_codes\b/i);
});

test("missing D1 binding produces no data leaks", async () => {
  const response = await onRequestGet({ env: {} });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "unavailable" });
});

test("missing schema produces 503", async () => {
  const response = await onRequestGet({
    env: { DB: { prepare: () => ({ first: async () => null }) } }
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "unavailable" });
});

test("D1 errors are never shown publicly", async () => {
  const response = await onRequestGet({
    env: { DB: { prepare: () => ({ first: async () => { throw new Error("secret diagnostic"); } }) } }
  });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /secret diagnostic/);
});
