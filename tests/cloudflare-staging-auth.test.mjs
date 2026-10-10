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
const pepper = "test-only-password-pepper-32-bytes-minimum";

import { TestD1 as FakeD1 } from './helpers/d1.mjs';

function request(path, { method = "GET", payload, cookie, origin = BASE } = {}) {
  const headers = { "cf-connecting-ip": "192.0.2.10" };
  if (method === "POST") {
    headers.origin = origin;
    headers["content-type"] = "application/json";
  }
  if (cookie) headers.cookie = cookie;
  return new Request(BASE + path, { method, headers, body: payload ? JSON.stringify(payload) : undefined });
}
function context(db, req, enabled = "true") {
  return { request: req, env: { DB: db, WORLDTV_STAGING_AUTH_ENABLED: enabled, WORLDTV_STAGING_REGISTRATION_ENABLED: "true", WORLDTV_STAGING_IDENTITY_ENABLED: "true", WORLDTV_AUTH_RATE_SECRET: "x".repeat(32), WORLDTV_PASSWORD_PEPPER: pepper, WORLDTV_STAGING_EMAIL_ALLOWLIST: email, WORLDTV_AUTH_MAILER: { fetch: async () => new Response("", {status:202}) }, WORLDTV_TURNSTILE_SECRET: "test-secret-not-real" }, data: { turnstileTestVerify: async () => ({ ok: true, json: async () => ({ success: true, hostname: "worldtv-preview.pages.dev", action: "register" }) }) } };
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
  const a = await hashPassword(password, pepper);
  const b = await hashPassword(password, pepper);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(password, a, pepper), true);
  assert.equal(await verifyPassword("different-password", a, pepper), false);
  assert.equal(await verifyPassword(password, "malformed", pepper), false);
  assert.equal(await verifyPassword(password, a, "wrong-pepper-but-long-enough-to-use"), false);
  assert.equal(await verifyPassword(password, a), false);
});

test("registration, verified login, cookie-backed session and logout work with local SQLite", async () => {
  const db = new FakeD1();
  const created = await register(context(db, request("/api/staging/auth/register", {
    method: "POST", payload: { name: "Sample User", email: email.toUpperCase(), password, turnstileToken: "staging-fake-token" }
  })));
  assert.equal(created.status, 201);
  assert.equal(db.users.length, 1);
  assert.equal(db.users[0].email, email);
  assert.ok(!db.users[0].password_hash.includes(password));

  const duplicated = await register(context(db, request("/api/staging/auth/register", {
    method: "POST", payload: { name: "Sample User", email, password, turnstileToken: "staging-fake-token" }
  })));
  assert.equal(duplicated.status, 409);
  assert.equal(db.users.length, 1);

  const wrong = await login(context(db, request("/api/staging/auth/login", {
    method: "POST", payload: { email, password: "Different-Password-777" }
  })));
  assert.equal(wrong.status, 401);

  const unverified = await login(context(db, request("/api/staging/auth/login", {
    method: "POST", payload: { email, password }
  })));
  assert.equal(unverified.status, 401);
  db.sqlite.exec("UPDATE users SET email_verified_at=CURRENT_TIMESTAMP");
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

test("staging registration stays disabled unless separately approved", async () => {
  const db = new FakeD1();
  const req = request("/api/staging/auth/register", {
    method: "POST", payload: { name: "Sample User", email, password, turnstileToken: "staging-fake-token" }
  });
  const disabled = context(db, req);
  disabled.env.WORLDTV_STAGING_REGISTRATION_ENABLED = "false";
  const response = await register(disabled);
  assert.equal(response.status, 404);
  assert.equal(db.users.length, 0);
});

test("registration denies invalid Turnstile even when staging signup is enabled", async () => {
  const db = new FakeD1();
  const ctx = context(db, request("/api/staging/auth/register", {
    method: "POST", payload: { name: "Sample User", email, password,
      turnstileToken: "staging-fake-token" }
  }));
  ctx.data.turnstileTestVerify = async () => ({ ok: true, json: async () => ({ success: false }) });
  const response = await register(ctx);
  assert.equal(response.status, 403);
  assert.equal(db.users.length, 0);
  ctx.env.WORLDTV_TURNSTILE_SECRET = undefined;
  assert.equal((await register(context(db, request("/api/staging/auth/register", {
    method: "POST", payload: { name: "Sample User", email, password,
      turnstileToken: "short" }
  })))).status, 403);
});
