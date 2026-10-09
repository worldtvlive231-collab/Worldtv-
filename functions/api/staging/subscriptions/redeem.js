/**
 * POST /api/staging/subscriptions/redeem
 *
 * Experimental activation-code redemption. Both staging auth AND the separate
 * WORLDTV_STAGING_REDEMPTION_ENABLED flag are required; neither flag is set by
 * this migration. No code generation, payment, or public UI is enabled.
 *
 * The D1 batch transaction serializes a guarded one-time code claim and
 * subscription insertion. No raw activation code is stored or logged.
 */
import { gate, readBody, reply } from "../../../_lib/staging-auth.js";
import {
  stagingCustomer, normalizeActivationCode, activationCodeHash
} from "../../../_lib/staging-entitlements.js";

export const CLAIM_SQL = [
  "UPDATE subscription_codes SET status = 'redeemed', user_id = ?, redeemed_at = CURRENT_TIMESTAMP ",
  "WHERE code_hash = ? AND status = 'unused' ",
  "AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) ",
  "AND (user_id IS NULL OR user_id = ?) ",
  "AND EXISTS (SELECT 1 FROM plans p WHERE p.id = subscription_codes.plan_id AND p.active = 1) ",
  "AND (order_id IS NULL OR EXISTS (SELECT 1 FROM orders o WHERE o.id = subscription_codes.order_id ",
  "AND o.status = 'paid' AND o.user_id = ?)) ",
  "AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = ? ",
  "AND s.status = 'active' AND s.ends_at > CURRENT_TIMESTAMP) ",
  "AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.activation_code_id = subscription_codes.id)"
].join("");

export const CREATE_SUBSCRIPTION_SQL = [
  "INSERT INTO subscriptions (user_id, plan_id, activation_code_id, order_id, status, starts_at, ends_at) ",
  "SELECT ?, c.plan_id, c.id, c.order_id, 'active', CURRENT_TIMESTAMP, ",
  "datetime('now', '+' || p.duration_days || ' days') ",
  "FROM subscription_codes c JOIN plans p ON p.id = c.plan_id ",
  "WHERE c.code_hash = ? AND c.user_id = ? AND c.status = 'redeemed' ",
  "AND c.redeemed_at = CURRENT_TIMESTAMP AND p.active = 1 ",
  "AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = ? ",
  "AND s.status = 'active' AND s.ends_at > CURRENT_TIMESTAMP) ",
  "AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.activation_code_id = c.id)"
].join("");

export async function onRequestPost(context) {
  const blocked = gate(context, { write: true });
  if (blocked) return blocked;

  if (context.env.WORLDTV_STAGING_REDEMPTION_ENABLED !== "true") {
    return reply({ error: "Not found" }, 404);
  }

  let body;
  try { body = await readBody(context.request); }
  catch { return reply({ error: "Invalid JSON request" }, 400); }

  const code = normalizeActivationCode(body?.code);
  if (!code) return reply({ error: "Invalid activation request" }, 400);

  try {
    const customer = await stagingCustomer(context);
    if (!customer) return reply({ error: "Not authenticated" }, 401);
    const codeHash = await activationCodeHash(code);

    // Cloudflare D1 .batch runs the statements sequentially as one transaction.
    // Both guard the requested account: no browser-supplied user or plan IDs.
    const statements = [
      context.env.DB.prepare(CLAIM_SQL)
        .bind(customer.id, codeHash, customer.id, customer.id, customer.id),
      context.env.DB.prepare(CREATE_SUBSCRIPTION_SQL)
        .bind(customer.id, codeHash, customer.id, customer.id)
    ];
    const results = await context.env.DB.batch(statements);
    if (results?.[0]?.meta?.changes === 1 && results?.[1]?.meta?.changes === 1) {
      return reply({ status: "activated", environment: "staging" });
    }
    // Do not disclose whether a code exists, is expired, already redeemed,
    // allocated to someone else, or refers to an unpaid order.
    return reply({ error: "Code could not be redeemed" }, 400);
  } catch {
    return reply({ error: "Service unavailable" }, 503);
  }
}
