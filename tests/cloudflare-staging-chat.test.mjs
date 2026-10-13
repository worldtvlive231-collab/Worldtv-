import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hashSessionToken } from "../functions/_lib/staging-auth.js";
import { onRequestPost as startChat } from "../functions/api/staging/chat/start.js";
import { onRequestGet as getMessages } from "../functions/api/staging/chat/messages.js";
import { onRequestPost as sendMessage } from "../functions/api/staging/chat/send.js";
import { onRequestGet as adminChats } from "../functions/api/staging/admin/chats.js";

const HOST = "https://worldtv-preview.pages.dev";
const accountToken = "m".repeat(43);
const alternateToken = "n".repeat(43);
const flags = {
  WORLDTV_STAGING_AUTH_ENABLED: "true",
  WORLDTV_STAGING_CHAT_ENABLED: "true"
};

function testDB() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of ["001_core.sql", "002_operations.sql", "003_user_guards.sql", "004_chat_message_counters.sql"]) {
    sqlite.exec(readFileSync(resolve("cloudflare/d1", file), "utf8"));
  }
  const api = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            run: async () => {
              const result = sqlite.prepare(sql).run(...args);
              return { success: true, meta: { changes: Number(result.changes) } };
            },
            first: async () => sqlite.prepare(sql).get(...args) || null,
            all: async () => ({ results: sqlite.prepare(sql).all(...args) })
          };
        },
        all: async () => ({ results: sqlite.prepare(sql).all() })
      };
    },
    async batch(items) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const res = [];
        for (const item of items) res.push(await item.run());
        sqlite.exec("COMMIT");
        return res;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    }
  };
  return { sqlite, api };
}

async function createCustomers(sqlite) {
  sqlite.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)")
    .run("Customer A", "a@example.invalid", "only-test-hash");
  sqlite.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)")
    .run("Customer B", "b@example.invalid", "only-test-hash");
  sqlite.exec("UPDATE users SET email_verified_at=CURRENT_TIMESTAMP");
  sqlite.prepare("INSERT INTO customer_sessions(token_hash,user_id,expires_at) VALUES(?,1,datetime('now','+1 day'))")
    .run(await hashSessionToken(accountToken));
  sqlite.exec("UPDATE users SET email_verified_at=CURRENT_TIMESTAMP");
  sqlite.prepare("INSERT INTO customer_sessions(token_hash,user_id,expires_at) VALUES(?,2,datetime('now','+1 day'))")
    .run(await hashSessionToken(alternateToken));
}
function request(path, { method = "GET", cookie = "", body, origin = HOST } = {}) {
  const headers = { ...(cookie ? { cookie } : {}) };
  if (method === "POST") {
    headers.origin = origin;
    headers["content-type"] = "application/json";
  }
  return new Request(HOST + path, { method, headers,
    body: body === undefined ? undefined : JSON.stringify(body) });
}
const authCookie = "__Host-worldtv_staging=" + accountToken;
const otherAuthCookie = "__Host-worldtv_staging=" + alternateToken;
const context = (db, req, overrides = {}) => ({
  request: req, env: { DB: db, ...flags, ...overrides }
});

test("staging chat stays 404 unless chat flag is enabled", async () => {
  const { api } = testDB();
  const res = await startChat(context(api, request("/api/staging/chat/start", {
    method: "POST", cookie: authCookie, body: { page_path: "/" }
  }), { WORLDTV_STAGING_CHAT_ENABLED: "false" }));
  assert.equal(res.status, 404);
  assert.equal((await adminChats(context(api,
    request("/api/staging/admin/chats"), { WORLDTV_STAGING_CHAT_ENABLED: "false" }))).status, 404);
});

test("customers can start chat and exchange own messages, not see another account", async () => {
  const { sqlite, api } = testDB();
  await createCustomers(sqlite);
  const created = await startChat(context(api, request("/api/staging/chat/start", {
    method: "POST", cookie: authCookie, body: { page_path: "/subscribe" }
  })));
  assert.equal(created.status, 201);
  const chatCookie = created.headers.get("set-cookie").split(";")[0];
  assert.match(chatCookie, /^__Host-worldtv_staging_chat=/);
  assert.match(created.headers.get("set-cookie"), /Secure; HttpOnly; SameSite=Strict/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM live_chat_conversations").get().n, 1);

  const ownCookie = authCookie + "; " + chatCookie;
  const msg = await sendMessage(context(api, request("/api/staging/chat/send", {
    method: "POST", cookie: ownCookie, body: { message: "Hello admin, subscription question" }
  })));
  assert.equal(msg.status, 200);
  const listed = await getMessages(context(api, request("/api/staging/chat/messages", {
    cookie: ownCookie
  })));
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).messages.map(x => x.body),
    ["Hello admin, subscription question"]);
  assert.equal(sqlite.prepare("SELECT unread_admin FROM live_chat_conversations").get().unread_admin, 1);
  // Identical content must still create two distinct messages, not rely on
  // a recent-text lookup which could corrupt unread counts.
  const repeat = await sendMessage(context(api, request("/api/staging/chat/send", {
    method: "POST", cookie: ownCookie, body: { message: "Hello admin, subscription question" }
  })));
  assert.equal(repeat.status, 200);
  assert.equal(sqlite.prepare("SELECT unread_admin FROM live_chat_conversations").get().unread_admin, 2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM live_chat_messages").get().n, 2);
  // Simulate an authenticated admin reply at D1 level to verify the trigger.
  const conversationId = sqlite.prepare("SELECT id FROM live_chat_conversations").get().id;
  sqlite.prepare("INSERT INTO live_chat_messages(conversation_id,sender,source,body) VALUES(?,'admin','human',?)")
    .run(conversationId, "Admin response");
  assert.equal(sqlite.prepare("SELECT unread_customer FROM live_chat_conversations").get().unread_customer, 1);
  const counters = sqlite.prepare("SELECT unread_admin,unread_customer FROM live_chat_conversations").get();
  assert.equal(counters.unread_admin, 2);
  assert.equal(counters.unread_customer, 1);


  const foreignCookie = otherAuthCookie + "; " + chatCookie;
  const foreignRead = await getMessages(context(api, request("/api/staging/chat/messages", {
    cookie: foreignCookie
  })));
  assert.equal(foreignRead.status, 200);
  assert.deepEqual((await foreignRead.json()).messages, []);
  const foreignSend = await sendMessage(context(api, request("/api/staging/chat/send", {
    method: "POST", cookie: foreignCookie, body: { message: "Trying to hijack" }
  })));
  assert.equal(foreignSend.status, 404);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM live_chat_messages").get().n, 3);
});

test("chat rejects anonymous users, bad paths, invalid messages and cross-origin writes", async () => {
  const { sqlite, api } = testDB();
  await createCustomers(sqlite);
  const anon = await startChat(context(api, request("/api/staging/chat/start", {
    method: "POST", body: { page_path: "/" }
  })));
  assert.equal(anon.status, 401);
  const invalid = await startChat(context(api, request("/api/staging/chat/start", {
    method: "POST", cookie: authCookie, body: { page_path: "https://attacker.example" }
  })));
  assert.equal(invalid.status, 400);
  const cors = await startChat(context(api, request("/api/staging/chat/start", {
    method: "POST", cookie: authCookie, body: { page_path: "/" },
    origin: "https://attacker.example"
  })));
  assert.equal(cors.status, 403);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM live_chat_conversations").get().n, 0);
});
