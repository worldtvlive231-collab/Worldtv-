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
