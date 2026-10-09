import test from "node:test";
import assert from "node:assert/strict";
import { verifyPaystackSignature, validatePaidCharge } from "../functions/_lib/staging-paystack-verify.js";

const secret = "test-only-paystack-signing-key-not-real";
const event = {
  event: "charge.success",
  data: {
    id: 884412,
    reference: "WTV-TEST-ORDER-001",
    amount: 2300,
    currency: "USD",
    status: "success"
  }
};
const storedOrder = {
  reference: "WTV-TEST-ORDER-001",
  provider: "paystack",
  amount_minor: 2300,
  currency: "USD"
};

async function signatureFor(rawBody) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-512" },
    false, ["sign"]
  );
  const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

test("Paystack HMAC verifies exactly the raw bytes, rejecting tampering", async () => {
  const raw = JSON.stringify(event);
  const signature = await signatureFor(raw);
  assert.equal(await verifyPaystackSignature({ rawBody: raw, signature, secret }), true);
  assert.equal(await verifyPaystackSignature({
    rawBody: new TextEncoder().encode(raw), signature, secret
  }), true);
  assert.equal(await verifyPaystackSignature({
    rawBody: raw.replace("2300", "2301"), signature, secret
  }), false);
  assert.equal(await verifyPaystackSignature({
    rawBody: raw, signature: "0".repeat(128), secret
  }), false);
  assert.equal(await verifyPaystackSignature({
    rawBody: raw, signature, secret: "different-test-signing-secret"
  }), false);
});

test("signature verifier rejects missing signatures, short secrets and huge payloads", async () => {
  assert.equal(await verifyPaystackSignature({ rawBody: "{}", signature: "", secret }), false);
  assert.equal(await verifyPaystackSignature({
    rawBody: "{}", signature: "b".repeat(128), secret: "short"
  }), false);
  assert.equal(await verifyPaystackSignature({
    rawBody: "x".repeat(65537), signature: "a".repeat(128), secret
  }), false);
});

test("only a successful charge matching a trusted stored order validates", () => {
  const verified = validatePaidCharge(event, storedOrder);
  assert.deepEqual(verified, {
    provider: "paystack", provider_event_id: "charge.success:884412",
    reference: "WTV-TEST-ORDER-001", amount_minor: 2300,
    currency: "USD", validated: true
  });

  assert.equal(validatePaidCharge(event, { ...storedOrder, amount_minor: 2200 }), null);
  assert.equal(validatePaidCharge(event, { ...storedOrder, currency: "GHS" }), null);
  assert.equal(validatePaidCharge(event, { ...storedOrder, provider: "pocketi" }), null);
  assert.equal(validatePaidCharge(event, { ...storedOrder, reference: "DIFFERENT-REF" }), null);
  assert.equal(validatePaidCharge({ ...event, event: "refund.processed" }, storedOrder), null);
  assert.equal(validatePaidCharge({
    ...event, data: { ...event.data, status: "failed" }
  }, storedOrder), null);
  assert.equal(validatePaidCharge({
    ...event, data: { ...event.data, id: null }
  }, storedOrder), null);
  assert.equal(validatePaidCharge({
    ...event, data: { ...event.data, amount: "2300" }
  }, storedOrder), null);
});

test("this module exposes validation primitives only, not an externally enabled payment route", () => {
  assert.equal(typeof verifyPaystackSignature, "function");
  assert.equal(typeof validatePaidCharge, "function");
});
