# WORLD TV: signed Paystack sandbox checkout and code issuance

**Status: code & offline tests passed; all new endpoints are DISABLED in Cloudflare.**

This workflow is for synthetic sandbox tests only, not collecting money. There is no live checkout URL, active customer registration, email delivery, or real activation-code distribution.

## Routes prepared in preview only

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/staging/payment/checkout-draft` | Authenticated test account creates a random reference and a 1-year USD 23 pending checkout and pending order; **payment_url=null** |
| POST | `/api/staging/payment/paystack-sandbox-webhook` | Verifies signed **test-domain** charge success payload, exact checkout/order/reference/amount/currency and transaction ID, then performs one atomic D1 batch |
| GET | `/api/staging/subscriptions/test-code?reference=...` | Signed-in customer retrieves their OWN unused sandbox code, matched against stored hash. No email or live activation. |

All endpoints stay 404 unless their per-feature flags are set and the host is exactly `worldtv-preview.pages.dev`.

### Required staging flags (DO NOT ENABLE YET)
- `WORLDTV_STAGING_AUTH_ENABLED=true`: staging customer sessions.
- `WORLDTV_STAGING_TEST_CHECKOUT_ENABLED=true`: no-money pending test orders.
- `WORLDTV_STAGING_PAYSTACK_VALIDATION_ENABLED=true`: signature tests.
- `WORLDTV_STAGING_FULFILLMENT_ENABLED=true`: signed test-event-only D1 issuance.
- `WORLDTV_STAGING_CODE_RETRIEVAL_ENABLED=true`: customer-bound code retrieval; OFF by default.

Encrypted Cloudflare secrets (NOT GitHub files or chat messages):
- `WORLDTV_PAYSTACK_TEST_SECRET`: Paystack **sandbox/test** signing secret ONLY.
- `WORLDTV_STAGING_CODE_HMAC_SECRET`: randomly generated test-only code derivation secret of at least 32 characters. Once codes have been generated, changing this secret will prevent reconstructing those test codes.

**Never reuse a production Paystack secret, enable a live webhook URL, or point actual payments at these endpoints.**

## Security controls already tested offline

- Raw webhook bytes verified using SHA-512 HMAC before any database query.
- Only Paystack `charge.success` events with `data.domain=test` pass the staging flow.
- Checkout reference must be server-generated, and the stored checkout/order must match user, plan, provider, amount and currency.
- Every event ID must correspond to its provider transaction ID, and the event is bound to exact reference and payload digest.
- D1 batch inserts a verified event, reserves a hashed activation code, marks the order paid, then marks the checkout paid.
- The code is derived from a **separate HMAC secret**, linked to an order, stored only as a SHA-256 hash and a 4-character hint. **The raw code is not returned from the payment webhook, sent or stored. A **separately gated**, authenticated customer-only test route can reconstruct it from the protected HMAC secret.**
- Unique `subscription_codes.order_id` prevents reissuing on Paystack webhook retries.
- Duplicate notifications and wrong amount/currency/order/invalid signatures are rejected or safely acknowledged without another code.
- Disabled accounts cannot issue subscription codes.
- No customer activation or subscription begins automatically; later, the code must be redeemed through the separately gated staging redemption route.

## Mandatory before enabling anything publicly

1. Configure and test email verification, rate limiting, abuse/WAF protections and Turnstile.
2. Add a polished customer-facing code-activation UI, optional verified email delivery and resend workflow, with a safe HMAC key rotation and recovery policy. The existing customer-only retrieval API is a staging prototype, not a production fulfillment method.
3. Add trusted checkout initialization and callback metadata using Paystack's actual supported payment API, **not** an externally hosted anonymous payment link whose recipient cannot be reliably matched.
4. Handle refunds, chargebacks, out-of-order events, expired sessions, transaction-verification API checks and safe failed-email retries.
5. Obtain the owner's explicit approval to enable sandbox flags and test with a genuine Paystack test key using Cloudflare Work/Browser; the GitHub connector alone cannot configure encrypted Cloudflare secrets.
6. Test any required country/currency conversion and payment provider approval.
7. Preserve all old Railway customer entitlements via a separate documented transition plan even though old data will not be imported.
8. Confirm content distribution rights before production launch.

### Offline tests

Run:

```bash
node --test tests/cloudflare-staging-issuance.test.mjs
node --test tests/cloudflare-staging-sandbox-e2e.test.mjs
```

No real payment, email or product delivery is invoked by these tests.
