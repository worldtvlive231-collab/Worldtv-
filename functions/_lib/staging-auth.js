/**
 * Staging-only WORLD TV customer auth helpers for Cloudflare Pages + D1.
 * Deliberately disabled until WORLDTV_STAGING_AUTH_ENABLED='true' is set
 * AND the request is made on the worldtv-preview.pages.dev hostname.
 *
 * Not production ready: add distributed rate limiting, email verification,
 * forgot-password delivery, abuse defenses, device policy and monitoring.
 * No Railway records or live payment integrations are used here.
 */

const STAGING_HOST = "worldtv-preview.pages.dev";
const SESSION_COOKIE = "__Host-worldtv_staging";
const COOKIE_SECONDS = 60 * 60 * 24 * 7;
const PBKDF2_ITERATIONS = 310000;
const encoder = new TextEncoder();

export function reply(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      ...extraHeaders
    }
  });
}

export function gate(context, { write = false } = {}) {
  const url = new URL(context.request.url);
  const host = url.hostname.toLowerCase();
  const permittedHost = host === STAGING_HOST || host.endsWith("." + STAGING_HOST);
  if (!permittedHost || context.env?.WORLDTV_STAGING_AUTH_ENABLED !== "true") {
    return reply({ error: "Not found" }, 404);
  }
  if (!context.env?.DB || typeof context.env.DB.prepare !== "function") {
    return reply({ error: "Service unavailable" }, 503);
  }
  if (write) {
    if (context.request.headers.get("origin") !== url.origin) {
      return reply({ error: "Origin not allowed" }, 403);
    }
    const contentType = context.request.headers.get("content-type") || "";
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return reply({ error: "Expected JSON" }, 415);
    }
  }
  return null;
}

export async function readBody(request) {
  const raw = await request.text();
  if (encoder.encode(raw).length > 4096) {
    throw new Error("request too large");
  }
  return JSON.parse(raw);
}

export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 5 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

export function validPassword(value) {
  return typeof value === "string" && value.length >= 12 && value.length <= 128 &&
    encoder.encode(value).length <= 256;
}

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("bad hash");
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

async function derivePassword(password, salt, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key, 256
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  if (!validPassword(password)) throw new Error("invalid password");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt);
  return "pbkdf2_sha256$" + PBKDF2_ITERATIONS + "$" +
    encodeBase64Url(salt) + "$" + encodeBase64Url(hash);
}

export async function verifyPassword(password, stored) {
  if (!validPassword(password) || typeof stored !== "string") return false;
  const fields = stored.split("$");
  if (fields.length !== 4 || fields[0] !== "pbkdf2_sha256") return false;
  const iterations = Number(fields[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 100000 || iterations > 1000000) {
    return false;
  }
  try {
    const salt = decodeBase64Url(fields[2]);
    const expected = decodeBase64Url(fields[3]);
    if (salt.length !== 16 || expected.length !== 32) return false;
    const actual = await derivePassword(password, salt, iterations);
    let difference = 0;
    for (let i = 0; i < expected.length; i++) difference |= actual[i] ^ expected[i];
    return difference === 0;
  } catch {
    return false;
  }
}

export function makeSessionToken() {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashSessionToken(token) {
  const bytes = encoder.encode(token);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

export function expiryDate() {
  return new Date(Date.now() + COOKIE_SECONDS * 1000)
    .toISOString().slice(0, 19).replace("T", " ");
}

export function sessionCookie(value) {
  return SESSION_COOKIE + "=" + value + "; Path=/; Max-Age=" + COOKIE_SECONDS +
    "; Secure; HttpOnly; SameSite=Strict";
}

export function clearSessionCookie() {
  return SESSION_COOKIE + "=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict";
}

export function getSessionToken(request) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const value = part.trim();
    if (!value.startsWith(SESSION_COOKIE + "=")) continue;
    const token = value.slice(SESSION_COOKIE.length + 1);
    if (/^[A-Za-z0-9_-]{43}$/.test(token)) return token;
  }
  return null;
}
