/**
 * SANDBOX ONLY: signed test Paystack webhook -> staged D1 checkout issuance.
 *
 * The endpoint is hidden by default; require all THREE:
 *  - worldtv-preview.pages.dev hostname
 *  - WORLDTV_STAGING_PAYSTACK_VALIDATION_ENABLED=true
 *  - WORLDTV_STAGING_FULFILLMENT_ENABLED=true
 * It also requires Cloudflare secrets for TEST Paystack and test-only HMAC.
 * NEVER configure production keys or a live webhook URL to this route.
 *
 * Does not email, return raw activation codes or enable a live checkout.
 */
import { reply } from "../../../_lib/staging-auth.js";
import { verifyPaystackSignature, validatePaidCharge } from "../../../_lib/staging-paystack-verify.js";
import { sandboxFulfillInD1Batch } from "../../../_lib/staging-issuance.js";

const encoder = new TextEncoder();

export async function onRequestPost(context) {
  const url = new URL(context.request.url);
  if (url.hostname !== "worldtv-preview.pages.dev" ||
      context.env?.WORLDTV_STAGING_PAYSTACK_VALIDATION_ENABLED !== "true" ||
      context.env?.WORLDTV_STAGING_FULFILLMENT_ENABLED !== "true") {
    return reply({ error: "Not found" }, 404);
  }
  const signingSecret = context.env.WORLDTV_PAYSTACK_TEST_SECRET;
  const issuanceSecret = context.env.WORLDTV_STAGING_CODE_HMAC_SECRET;
  if (typeof signingSecret !== "string" || signingSecret.length < 16 ||
      typeof issuanceSecret !== "string" || issuanceSecret.length < 32 ||
      typeof context.env.DB?.batch !== "function" ||
      typeof context.env.DB?.prepare !== "function") {
    return reply({ error: "Service unavailable" }, 503);
  }

  const length = Number(context.request.headers.get("content-length"));
  if (Number.isFinite(length) && length > 65536) return reply({ error: "Too large" }, 413);
  let raw;
  try { raw = new Uint8Array(await context.request.arrayBuffer()); }
  catch { return reply({ error: "Invalid request" }, 400); }
  if (raw.length > 65536) return reply({ error: "Too large" }, 413);

  const verified = await verifyPaystackSignature({
    rawBody: raw,
    signature: context.request.headers.get("x-paystack-signature"),
    secret: signingSecret
  });
  if (!verified) return reply({ error: "Forbidden" }, 403);

  let event;
  try { event = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
  catch { return reply({ error: "Invalid JSON" }, 400); }
  // Never accept live-domain Paystack events, even if the test key is misused.
  if (event?.data?.domain !== "test") {
    return reply({ error: "Test transactions only" }, 403);
  }
  const reference = event?.data?.reference;
  if (typeof reference !== "string" ||
      !/^WTVTEST-[A-Za-z0-9_-]{16,32}$/.test(reference)) {
    return reply({ error: "Unmatched test order" }, 400);
  }

  try {
    // Order MUST originate from a server-created, matching checkout request.
    const order = await context.env.DB.prepare(
      "SELECT o.reference,o.provider,o.amount_minor,o.currency,o.status,o.provider_reference " +
      "FROM orders o JOIN checkout_requests co ON co.id=o.checkout_request_id " +
      "AND co.reference=o.reference AND co.user_id=o.user_id " +
      "AND co.plan_id=o.plan_id AND co.provider=o.provider " +
      "AND co.amount_minor=o.amount_minor AND co.currency=o.currency " +
      "WHERE o.reference=? AND o.provider='paystack' LIMIT 1"
    ).bind(reference).first();

    const charge = validatePaidCharge(event, order);
    if (!charge) return reply({ error: "Unmatched test order" }, 400);
    // Replays are harmless and do not re-issue. A different transaction must
    // not silently fulfill a paid order.
    if (order.status === "paid") {
      return order.provider_reference === String(event.data.id) ?
        reply({ status: "accepted", environment: "staging", duplicate: true }) :
        reply({ error: "Already fulfilled" }, 409);
    }
    if (order.status !== "pending") return reply({ error: "Unmatched test order" }, 400);

    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
    const payloadSha256 = Array.from(bytes,
      byte => byte.toString(16).padStart(2, "0")).join("");
    const result = await sandboxFulfillInD1Batch(context.env.DB, {
      eventId: charge.provider_event_id,
      reference,
      transactionId: event.data.id,
      amountMinor: charge.amount_minor,
      currency: charge.currency,
      payloadSha256,
      issuanceSecret
    });
    if (!result.newly_paid || !result.code_issued) {
      return reply({ error: "Test fulfillment pending review" }, 409);
    }
    return reply({
      status: "accepted",
      environment: "staging",
      fulfillment: "code_reserved_no_delivery"
    });
  } catch {
    return reply({ error: "Service unavailable" }, 503);
  }
}
