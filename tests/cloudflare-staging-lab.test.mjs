import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/staging-lab.js";

const path = "https://worldtv-preview.pages.dev/staging-lab";
test("staging lab remains unreachable by default and on the live domain", async () => {
  const disabled = await onRequestGet({
    request: new Request(path), env: { WORLDTV_STAGING_AUTH_ENABLED: "true" }
  });
  assert.equal(disabled.status, 404);
  const wrongDomain = await onRequestGet({
    request: new Request("https://myworldtvlive.com/staging-lab"),
    env: { WORLDTV_STAGING_AUTH_ENABLED: "true", WORLDTV_STAGING_UI_ENABLED: "true" }
  });
  assert.equal(wrongDomain.status, 404);
});
test("authorized preview lab has restrictive response headers and no payment form", async () => {
  const enabled = await onRequestGet({
    request: new Request(path),
    env: { WORLDTV_STAGING_AUTH_ENABLED: "true", WORLDTV_STAGING_UI_ENABLED: "true" }
  });
  assert.equal(enabled.status, 200);
  const csp = enabled.headers.get("content-security-policy");
  assert.match(csp, /script-src 'nonce-[0-9a-f]{48}'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(enabled.headers.get("cache-control"), "no-store");
  const html = await enabled.text();
  assert.match(html, /TEST ACCOUNTS ONLY/);
  assert.match(html, /Create test checkout/);
  assert.match(html, //api/staging/subscriptions/test-code/);
  assert.equal(html.includes("paystack.shop/pay/"), false);
  assert.equal(html.includes("api/transaction/initialize"), false);
  assert.doesNotMatch(html, /<script nonce="__NONCE__"/);
  assert.match(html, /<script nonce="[0-9a-f]{48}"/);
});
