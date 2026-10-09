import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/staging/payment/paystack-validate.js";

const HOST = "https://worldtv-preview.pages.dev";
const secret = "staging-test-signing-key-not-real-8765";
const event = {
  event: "charge.success",
  data: { id: 18442, status: "success", reference: "WTV-TEST-ORDER-001",
    amount: 2300, currency: "USD" }
};
const expected = { reference: "WTV-TEST-ORDER-001", provider: "paystack",
  amount_minor: 2300, currency: "USD", status: "pending" };

async function signedRequest(payload, signatureOverride) {
  const raw = JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"]
  );
  const signature = Buffer.from(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw))
  ).toString("hex");
  return new Request(HOST + "/api/staging/payment/paystack-validate", {
    method: "POST",
    headers: { "content-type": "application/json",
      "x-paystack-signature": signatureOverride ?? signature },
    body: raw
  });
}
function context(req, storedOrder = expected, enabled = "true") {
  let writes = 0;
  const env = {
    WORLDTV_STAGING_PAYSTACK_VALIDATION_ENABLED: enabled,
    WORLDTV_PAYSTACK_TEST_SECRET: secret,
    DB: {
      prepare(sql) {
        assert.match(sql, /^SELECT reference/);
        return { bind(ref) {
          assert.equal(ref, expected.reference);
          return { first: async () => storedOrder };
        } };
      },
      batch: () => { writes++; throw new Error("No payment writes allowed"); }
    }
  };
  return { context: { request: req, env }, getWrites: () => writes };
}
test("unsigned / mismatched event fails closed", async () => {
  const payload = await signedRequest(event, "0".repeat(128));
  assert.equal((await onRequestPost(context(payload).context)).status, 403);
  const wrongAmount = await signedRequest({ ...event,
    data: { ...event.data, amount: 2200 } });
  assert.equal((await onRequestPost(context(wrongAmount).context)).status, 400);
  const wrongStatus = await signedRequest({ ...event,
    data: { ...event.data, status: "failed" } });
  assert.equal((await onRequestPost(context(wrongStatus).context)).status, 400);
});

test("valid signed event returns validation only and cannot fulfill", async () => {
  const { context: ctx, getWrites } = context(await signedRequest(event));
  const response = await onRequestPost(ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "validated_only", environment: "staging", fulfillment: "disabled"
  });
  assert.equal(getWrites(), 0);
});

test("wrong stored amount, currency, status, or absent order fails", async () => {
  for (const stored of [
    { ...expected, amount_minor: 2200 },
    { ...expected, currency: "GHS" },
    { ...expected, status: "paid" },
    null
  ]) {
    const response = await onRequestPost(
      context(await signedRequest(event), stored).context
    );
    assert.equal(response.status, 400);
  }
});

test("test webhook endpoint defaults to 404, never charges a customer", async () => {
  const req = await signedRequest(event);
  const response = await onRequestPost(context(req, expected, "false").context);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "Not found");
});
