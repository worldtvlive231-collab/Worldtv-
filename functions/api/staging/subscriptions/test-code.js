/**
 * Preview-only customer retrieval of one issued SANDBOX activation code.
 * Requires an authenticated customer session and separate opt-in flag.
 * Does not email/activate the code or connect to live payments.
 */
import { gate, reply } from "../../../_lib/staging-auth.js";
import { stagingCustomer } from "../../../_lib/staging-entitlements.js";
import { derivedActivationCode } from "../../../_lib/staging-issuance.js";

export async function onRequestGet(context) {
  const blocked = gate(context);
  if (blocked) return blocked;
  if (context.env?.WORLDTV_STAGING_CODE_RETRIEVAL_ENABLED !== "true") {
    return reply({ error: "Not found" }, 404);
  }
  const reference = new URL(context.request.url).searchParams.get("reference");
  if (!/^WTVTEST-[A-Za-z0-9_-]{16,32}$/.test(reference || "")) {
    return reply({ error: "Invalid reference" }, 400);
  }
  const secret = context.env?.WORLDTV_STAGING_CODE_HMAC_SECRET;
  if (typeof secret !== "string" || secret.length < 32) {
    return reply({ error: "Service unavailable" }, 503);
  }

  try {
    const customer = await stagingCustomer(context);
    if (!customer) return reply({ error: "Not authenticated" }, 401);
    const row = await context.env.DB.prepare(
      "SELECT sc.code_hash,sc.status FROM subscription_codes sc " +
      "JOIN orders o ON o.id=sc.order_id AND o.user_id=sc.user_id " +
      "JOIN checkout_requests co ON co.id=o.checkout_request_id " +
      "AND co.reference=o.reference AND co.user_id=o.user_id " +
      "WHERE o.reference=? AND o.user_id=? " +
      "AND o.provider='paystack' AND o.status='paid' " +
      "AND co.status='paid' AND sc.status='unused' " +
      "AND (sc.expires_at IS NULL OR sc.expires_at > CURRENT_TIMESTAMP) LIMIT 1"
    ).bind(reference, customer.id).first();
    if (!row) return reply({ error: "Code unavailable" }, 404);
    const derived = await derivedActivationCode(reference, secret);
    // Detect changed/stale HMAC secret; never emit a mismatched code.
    if (derived.code_hash !== row.code_hash) {
      return reply({ error: "Code unavailable" }, 503);
    }
    return reply({
      environment: "staging",
      activation_code: derived.code,
      status: "unused",
      warning: "TEST CODE ONLY — live activation is disabled"
    });
  } catch {
    return reply({ error: "Service unavailable" }, 503);
  }
}
