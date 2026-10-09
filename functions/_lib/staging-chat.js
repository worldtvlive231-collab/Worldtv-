/**
 * Private staging-only chat utilities.
 * No public visitor chat is enabled: customers must have a test account,
 * and WORLDTV_STAGING_CHAT_ENABLED must explicitly be set to true.
 */
import {
  reply, getSessionToken, hashSessionToken, normalizeEmail
} from "./staging-auth.js";

const CHAT_COOKIE = "__Host-worldtv_staging_chat";
const TTL_SECONDS = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();

export function chatGate(context) {
  const url = new URL(context.request.url);
  if (url.hostname !== "worldtv-preview.pages.dev" ||
      context.env?.WORLDTV_STAGING_AUTH_ENABLED !== "true" ||
      context.env?.WORLDTV_STAGING_CHAT_ENABLED !== "true") {
    return reply({ error: "Not found" }, 404);
  }
  if (!context.env.DB || typeof context.env.DB.prepare !== "function") {
    return reply({ error: "Service unavailable" }, 503);
  }
  return null;
}

export async function verifiedChatCustomer(context) {
  const sessionToken = getSessionToken(context.request);
  if (!sessionToken) return null;
  const account = await context.env.DB.prepare(
    "SELECT u.id, u.name, u.email FROM customer_sessions s " +
    "JOIN users u ON u.id=s.user_id " +
    "WHERE s.token_hash=? AND s.expires_at > CURRENT_TIMESTAMP " +
    "AND u.status='active' AND u.role='customer' LIMIT 1"
  ).bind(await hashSessionToken(sessionToken)).first();
  return account && normalizeEmail(account.email) ? account : null;
}

export function validateMessage(message) {
  if (typeof message !== "string") return null;
  const value = message.trim();
  if (!value || value.length > 2000 ||
      encoder.encode(value).byteLength > 6000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
    return null;
  }
  return value;
}

export function chatCookie(value) {
  return CHAT_COOKIE + "=" + value + "; Path=/; Max-Age=" +
    TTL_SECONDS + "; Secure; HttpOnly; SameSite=Strict";
}

export function createChatToken() {
  const random = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...random))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function chatToken(request) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const value = part.trim();
    if (value.startsWith(CHAT_COOKIE + "=")) {
      const token = value.slice(CHAT_COOKIE.length + 1);
      if (/^[A-Za-z0-9_-]{43}$/.test(token)) return token;
    }
  }
  return null;
}

export async function chatTokenHash(value) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(bytes), ch => ch.toString(16).padStart(2, "0")).join("");
}
