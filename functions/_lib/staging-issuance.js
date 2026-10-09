/**
 * Sandbox-only deterministic code issuance preparation.
 *
 * No public route imports this module, no payment is processed, and it does not
 * write to D1. The future webhook must verify Paystack's raw signed event and
 * match an existing server-created order BEFORE using these helpers.
 */
import { activationCodeHash } from "./staging-entitlements.js";

const encoder = new TextEncoder();

export async function derivedActivationCode(orderReference, issuanceSecret) {
  if (typeof orderReference !== "string" ||
      !/^[A-Za-z0-9_-]{8,120}$/.test(orderReference) ||
      typeof issuanceSecret !== "string" || issuanceSecret.length < 32) {
    throw new Error("Invalid order reference or issuance key");
  }
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(issuanceSecret), { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const bytes = new Uint8Array(await crypto.subtle.sign(
    "HMAC", key, encoder.encode("worldtv-staging-code-v1:" + orderReference)
  ));
  const hex = Array.from(bytes.slice(0, 16),
    byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  const code = "WTV-" + hex;
  return { code, code_hash: await activationCodeHash(code), code_hint: hex.slice(-4) };
}

export const STAGING_FULFILL_SQL = Object.freeze({
  insertEvent:
    "INSERT INTO payment_events(provider,provider_event_id,provider_reference,payload_sha256,verification_status,processed_at) " +
    "VALUES('paystack',?, ?, ?, 'verified', CURRENT_TIMESTAMP) ON CONFLICT(provider,provider_event_id) DO NOTHING",

  payPendingOrder:
    "UPDATE orders SET status='paid', paid_at=CURRENT_TIMESTAMP, provider_reference=? " +
    "WHERE reference=? AND provider='paystack' AND status='pending' " +
    "AND amount_minor=? AND currency=? " +
    "AND EXISTS(SELECT 1 FROM subscription_codes WHERE order_id=orders.id AND code_hash=?) " +
    "AND EXISTS(SELECT 1 FROM payment_events WHERE provider='paystack' " +
    "AND provider_event_id=? AND verification_status='verified')",

  issueCode:
    "INSERT INTO subscription_codes(code_hash,code_hint,plan_id,user_id,order_id,status) " +
    "SELECT ?, ?, o.plan_id, o.user_id, o.id, 'unused' FROM orders o " +
    "JOIN plans p ON p.id=o.plan_id AND p.active=1 " +
    "JOIN users u ON u.id=o.user_id AND u.status='active' AND u.role='customer' " +
    "WHERE o.reference=? AND o.provider='paystack' AND o.status='pending' " +
    "AND o.provider_reference=? AND o.amount_minor=? AND o.currency=? " +
    "AND NOT EXISTS(SELECT 1 FROM subscription_codes c WHERE c.order_id=o.id) " +
    "AND EXISTS(SELECT 1 FROM payment_events e WHERE e.provider='paystack' " +
    "AND e.provider_event_id=? AND e.verification_status='verified') " +
    "ON CONFLICT DO NOTHING"
});

export async function sandboxFulfillInD1Batch(db, {
  eventId, reference, transactionId, amountMinor, currency, payloadSha256,
  issuanceSecret
}) {
  // Not exposed via Pages. Never pass user_id or paid status from a browser.
  if (!/^[A-Za-z0-9_:.-]{8,150}$/.test(eventId || "") ||
      !/^[A-Za-z0-9_-]{8,120}$/.test(reference || "") ||
      !/^[0-9]{1,18}$/.test(String(transactionId)) ||
      !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
      !/^[A-Z]{3}$/.test(currency || "") ||
      !/^[0-9a-f]{64}$/.test(payloadSha256 || "")) {
    throw new Error("Invalid verified payment input");
  }
  const { code_hash, code_hint } = await derivedActivationCode(reference, issuanceSecret);
  // D1.batch executes atomically. A verified event first reserves exactly
  // one code for a pending order, and only then marks that order paid if the
  // SAME code was actually created (or exists for that order). Customers
  // cannot redeem reserved codes for orders that remain pending.
  const results = await db.batch([
    db.prepare(STAGING_FULFILL_SQL.insertEvent).bind(
      eventId, reference, payloadSha256),
    db.prepare(STAGING_FULFILL_SQL.issueCode).bind(
      code_hash, code_hint, reference, String(transactionId), amountMinor, currency, eventId),
    db.prepare(STAGING_FULFILL_SQL.payPendingOrder).bind(
      String(transactionId), reference, amountMinor, currency, code_hash, eventId)
  ]);
  const changes = (results || []).map(row => row?.meta?.changes ?? 0);
  return {
    newly_paid: changes[2] === 1,
    code_issued: changes[1] === 1,
    duplicate: changes[1] !== 1 && changes[2] !== 1,
    code_hint: changes[1] === 1 && changes[2] === 1 ? code_hint : null
  };
}
