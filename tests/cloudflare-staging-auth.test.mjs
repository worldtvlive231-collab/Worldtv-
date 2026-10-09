import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, gate, getSessionToken } from "../functions/_lib/staging-auth.js";
import { onRequestPost as register } from "../functions/api/staging/auth/register.js";
import { onRequestPost as login } from "../functions/api/staging/auth/login.js";
import { onRequestGet as me } from "../functions/api/staging/auth/me.js";
import { onRequestPost as logout } from "../functions/api/staging/auth/logout.js";

const BASE = "https://worldtv-preview.pages.dev";
const email = "sample@example.invalid";
const password = "Strong-Staging-Test-Password-42";

class FakeD1 {
  constructor() {
    this.users = [];
    this.sessions = [];
    this.statements = [];
  }
  prepare(sql) {
    this.statements.push(sql);
    return {
      bind: (...args) => ({
        run: async () => {
          if (sql.startsWith("INSERT INTO users")) {
            const [name, emailValue, stored] = args;
            if (this.users.some(user => user.email === emailValue)) {
              throw new Error("UNIQUE constraint failed: users.email");
            }
            this.users.push({ id: this.users.length + 1, name, email: emailValue,
              role: "customer", status: "active", password_hash: stored });
            return { success: true };
          }
          if (sql.startsWith("INSERT INTO customer_sessions")) {
            const [token_hash, user_id, expires_at] = args;
            this.sessions.push({ token_hash, user_id, expires_at });
            return { success: true };
          }
          if (sql.startsWith("DELETE FROM customer_sessions")) {
            this.sessions = this.sessions.filter(session => session.token_hash !== args[0]);
            return { success: true };
          }
          throw new Error("Unexpected SQL write");
        },
        first: async () => {
          if (sql.startsWith("SELECT id, name, email")) {
            return this.users.find(user => user.email === args[0]) || null;
          }
          if (sql.startsWith("SELECT u.id")) {
            const session = this.sessions.find(row => row.token_hash === args[0] &&
              new Date(row.expires_at.replace(" ", "T") + "Z") > new Date());
            const user = this.users.find(row => row.id === session?.user_id);
            return user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null;
          }
          throw new Error("Unexpected SQL read");
        }
      })
    };
  }
}

function request(path, { method = "GET", payload, cookie, origin = BASE } = {}) {
  const headers = {};
  if (method === "POST") {
    headers.origin = origin;
    headers["content-type"] = "application/json";
  }
  if (cookie) headers.cookie = cookie;
  return new Request(BASE + path, { method, headers, body: payload ? JSON.stringify(payload) : undefined });
}
function context(db, req, enabled = "true") {
  return { request: req, env: { DB: db, WORLDTV_STAGING_AUTH_ENABLED: enabled } };
}

test("staging auth is disabled by default and on non-preview hosts", async () => {
  const db = new FakeD1();
  const req = request("/api/staging/auth/register", {
    method: "POST", payload: { name: "Sample", email, password }
  });
  const response = await register(context(db, req, "false"));
  assert.equal(response.status, 404);
  assert.equal(db.users.length, 0);

  const wrongHost = new Request("https://myworldtvlive.com/api/staging/auth/me");
  const blocked = gate(context(db, wrongHost));
  assert.equal(blocked.status, 404);
});

test("password hashing is salted and rejects wrong passwords", async () => {
  const a = await hashPassword(password);
  const b = await hashPassword(password);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword("different-password", a), false);
  assert.equal(await verifyPassword(password, "malformed"), false);
});

test("registration, login, cookie-backed session and logout work in staging mocks", async () => {
  const db = new FakeD1();
  const created = await register(context(db, request("/api/staging/auth/register", {
    method: "POST", payload: { name: "Sample User", email: email.toUpperCase(), password }
  })));
  assert.equal(created.status, 201);
  assert.equal(db.users.length, 1);
  assert.equal(db.users[0].email, email);
  assert.ok(!db.users[0].password_hash.includes(password));

  const duplicated = await register(context(db, request("/api/staging/auth/register", {
    method: "POST", payload: { name: "Sample User", email, password }
  })));
  assert.equal(duplicated.status, 409);
  assert.equal(db.users.length, 1);

  const wrong = await login(context(db, request("/api/staging/auth/login", {
    method: "POST", payload: { email, password: "Different-Password-777" }
  })));
  assert.equal(wrong.status, 401);

  const valid = await login(context(db, request("/api/staging/auth/login", {
    method: "POST", payload: { email, password }
  })));
  assert.equal(valid.status, 200);
  const cookieHeader = valid.headers.get("set-cookie");
  assert.match(cookieHeader, /Secure; HttpOnly; SameSite=Strict/);
  const cookie = cookieHeader.split(";")[0];
  assert.equal(getSessionToken(new Request(BASE, { headers: { cookie } }))?.length, 43);

  const authenticated = await me(context(db, request("/api/staging/auth/me", { cookie })));
  assert.equal(authenticated.status, 200);
  const json = await authenticated.json();
  assert.deepEqual(json.account, { id: 1, name: "Sample User", email });

  const signedOut = await logout(context(db, request("/api/staging/auth/logout", {
    method: "POST", cookie
  })));
  assert.equal(signedOut.status, 200);
  assert.match(signedOut.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(db.sessions.length, 0);
  const postLogout = await me(context(db, request("/api/staging/auth/me", { cookie })));
  assert.equal(postLogout.status, 401);
});

test("write requests must be JSON and same-origin", async () => {
  const db = new FakeD1();
  const x = await register(context(db, request("/api/staging/auth/register", {
    method: "POST", origin: "https://attacker.example", payload: { name: "Sample", email, password }
  })));
  assert.equal(x.status, 403);
  const noOrigin = await login(context(db, new Request(BASE + "/api/staging/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  })));
  assert.equal(noOrigin.status, 403);
  assert.equal(db.users.length, 0);
});

test("staging auth responses carry browser security and no-cache headers", async () => {
  const db = new FakeD1();
  const response = await me(context(db, request("/api/staging/auth/me"), "false"));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
});
