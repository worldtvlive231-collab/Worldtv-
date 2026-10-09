/**
 * Staging-only account-bound D1 subscription helpers.
 *
 * D1 must never trust a user_id, plan_id, paid flag, or order amount
 * supplied by the browser. Authenticate by the hashed session cookie.
 */
import { getSessionToken, hashSessionToken } from "./staging-auth.js";

const textEncoder = new TextEncoder();

export async function stagingCustomer(context) {
  const token = getSessionToken(context.request);
  if (!token) return null;

  const user = await context.env.DB.prepare(
    "SELECT u.id, u.name, u.email FROM customer_sessions AS s " +
    "JOIN users AS u ON u.id = s.user_id " +
    "WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP " +
    "AND u.status = 'active' AND u.role = 'customer' LIMIT 1"
  ).bind(await hashSessionToken(token)).first();

  return user || null;
}

export function normalizeActivationCode(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  // Raw code never appears in logs/URLs and is not saved in D1.
  return /^[A-Z0-9-]{16,64}$/.test(code) ? code : null;
}

export async function activationCodeHash(code) {
  const buffer = await crypto.subtle.digest("SHA-256", textEncoder.encode(code));
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}
