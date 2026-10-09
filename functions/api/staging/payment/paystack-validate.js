/**
 * NON-FULFILLING preview-only Paystack webhook validation.
 *
 * This endpoint NEVER marks an order paid or issues a code. It stays
 * disabled unless WORLDTV_STAGING_PAYSTACK_VALIDATION_ENABLED='true'.
 * Only a separate Paystack TEST secret should be configured for staging.
 */
import { reply } from "../../../_lib/staging-auth.js";
import {
  verifyPaystackSignature, validatePaidCharge
} from "../../../_lib/staging-paystack-verify.js";

export async function onRequestPost(context) {
  const url = new URL(context.request.url);
  if (url.hostname !== "worldtv-preview.pages.dev" ||
      context.env?.WORLDTV_STAGING_PAYSTACK_VALIDATION_ENABLED !== "true") {
    return reply({ error: "Not found" }, 404);
  }

  const secret = context.env?.WORLDTV_PAYSTACK_TEST_SECRET;
  if (typeof secret !== "string" || secret.length < 16 ||
      typeof context.env?.DB?.prepare !== "function") {
    return reply({ error: "Unavailable" }, 503);
  }
  const size = Number(context.request.headers.get("content-length"));
  if (Number.isFinite(size) && size > 65536) return reply({ error: "Too large" }, 413);

  let raw;
  try {
    raw = new Uint8Array(await context.request.arrayBuffer());
  } catch {
    return reply({ error: "Invalid payload" }, 400);
  }
  if (raw.length > 65536) return reply({ error: "Too large" }, 413);
  const signed = await verifyPaystackSignature({
    rawBody: raw,
    signature: context.request.headers.get("x-paystack-signature"),
    secret
  });
  if (!signed) return reply({ error: "Forbidden" }, 403);

  let event;
  try { event = JSON.parse(new TextDecoder().decode(raw)); }
  catch { return reply({ error: "Invalid payload" }, 400); }
  const reference = event?.data?.reference;
  if (typeof reference !== "string" || !/^[A-Za-z0-9_-]{8,120}$/.test(reference)) {
    return reply({ error: "Unmatched event" }, 400);
  }

  try {
    const order = await context.env.DB.prepare(
      "SELECT reference,provider,amount_minor,currency,status " +
      "FROM orders WHERE reference=? AND provider='paystack' LIMIT 1"
    ).bind(reference).first();
    if (!order || order.status !== "pending") return reply({ error: "Unmatched event" }, 400);
    const matched = validatePaidCharge(event, order);
    if (!matched) return reply({ error: "Unmatched event" }, 400);

    // No D1 writes, no user-specific information, no payment fulfillment.
    return reply({
      status: "validated_only", environment: "staging",
      fulfillment: "disabled"
    });
  } catch {
    return reply({ error: "Unavailable" }, 503);
  }
}
