/**
 * WORLD TV Cloudflare Paystack webhook verification primitives.
 *
 * NO public webhook route is registered by this module.
 * NO order status updates, code issuance, billing or transfers are performed.
 * Only use with a Paystack secret stored in Cloudflare encrypted secrets,
 * and a previously created D1 checkout/order with known amount/currency.
 */
const encoder = new TextEncoder();

export async function verifyPaystackSignature({ rawBody, signature, secret }) {
  if (typeof secret !== "string" || secret.length < 16 ||
      typeof signature !== "string" || !/^[0-9a-f]{128}$/i.test(signature)) return false;

  const bytes = typeof rawBody === "string" ? encoder.encode(rawBody) : rawBody;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2 ||
      bytes.byteLength > 65536) return false;

  const signatureBytes = Uint8Array.from(
    signature.toLowerCase().match(/.{2}/g),
    octet => Number.parseInt(octet, 16)
  );
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-512" },
    false, ["verify"]
  );
  return crypto.subtle.verify("HMAC", key, signatureBytes, bytes);
}

export function validatePaidCharge(event, expected) {
  // Expected order must be fetched from trusted D1 storage, not client input.
  const charge = event?.data;
  const reference = typeof charge?.reference === "string" ? charge.reference.trim() : "";
  const currency = typeof charge?.currency === "string" ? charge.currency.toUpperCase() : "";
  if (event?.event !== "charge.success" || charge?.status !== "success" ||
      !/^[A-Za-z0-9_-]{8,120}$/.test(reference) ||
      !expected || reference !== expected.reference ||
      expected.provider !== "paystack" ||
      !Number.isSafeInteger(expected.amount_minor) || expected.amount_minor <= 0 ||
      !/^[A-Z]{3}$/.test(expected.currency || "") ||
      !Number.isSafeInteger(charge.amount) || charge.amount !== expected.amount_minor ||
      currency !== expected.currency) {
    return null;
  }

  const providerTransactionId = charge.id;
  if (!Number.isSafeInteger(providerTransactionId) || providerTransactionId <= 0) return null;

  return {
    provider: "paystack",
    provider_event_id: "charge.success:" + providerTransactionId,
    reference,
    amount_minor: charge.amount,
    currency,
    // Staging-only validation output; NOT evidence of fulfillment.
    validated: true
  };
}
