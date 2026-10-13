# WORLD TV Paystack staging

**Status:** implementation and offline tests complete; real sandbox certification
is still blocked. Live payments are not enabled or authorized.

## Staging flow

1. A verified signed-in customer creates a server-priced annual checkout with
   `POST /api/staging/payment/checkout-draft`.
2. The customer initializes that reference with
   `POST /api/staging/payment/paystack-sandbox-initialize`.
3. The server accepts only a Cloudflare secret matching `sk_test_…`, sends the
   stored email/amount/currency/reference to Paystack, and accepts only an HTTPS
   URL on `checkout.paystack.com`.
4. `POST /api/staging/payment/paystack-sandbox-webhook` verifies the SHA-512 HMAC
   over the original bytes, requires `data.domain=test`, and matches the exact
   pending order amount, currency and reference.
5. One D1 batch records the unique event, derives and stores one hashed code,
   marks the order/checkout paid and queues activation delivery.
6. The service-bound mailer derives the same code, verifies its stored hash and
   sends only to an allowlisted staging recipient. Retry/dead status is durable.

All routes require the exact `worldtv-preview.pages.dev` hostname and remain 404
unless their separate flags are enabled. Browser redirects never mark an order paid.

## Required staging configuration

- `WORLDTV_STAGING_AUTH_ENABLED=true`
- `WORLDTV_STAGING_TEST_CHECKOUT_ENABLED=true`
- `WORLDTV_STAGING_PAYSTACK_INITIALIZE_ENABLED=true`
- `WORLDTV_STAGING_PAYSTACK_VALIDATION_ENABLED=true`
- `WORLDTV_STAGING_FULFILLMENT_ENABLED=true`
- `WORLDTV_STAGING_DELIVERY_ENABLED=true`
- Secret `WORLDTV_PAYSTACK_TEST_SECRET` beginning with `sk_test_`
- Secret `WORLDTV_STAGING_CODE_HMAC_SECRET` (at least 32 characters)
- Service binding `WORLDTV_ACTIVATION_MAILER`
- Exact `WORLDTV_STAGING_EMAIL_ALLOWLIST`

Do not configure a live key, production webhook, public secret, or real customer
email for staging.

## Required real sandbox tests

- Success, declined/cancelled, retry and abandoned checkout.
- Duplicate and out-of-order webhooks; tampered HMAC, amount, currency, domain and reference.
- Initialization retry after provider outage and duplicate initialization.
- Exactly one order, event, code and delivery for one paid reference.
- Email accepted, retry and dead-letter/admin-retry behavior without code leakage in logs.
- Reconciliation against Paystack test dashboard/API before declaring payment certification.
- Refund, chargeback and cancellation design before any production enablement.

## Automated tests

```bash
node --test --test-concurrency=1 \
  tests/cloudflare-staging-paystack.test.mjs \
  tests/cloudflare-staging-paystack-route.test.mjs \
  tests/cloudflare-staging-paystack-initialize.test.mjs \
  tests/cloudflare-staging-issuance.test.mjs \
  tests/cloudflare-staging-sandbox-e2e.test.mjs \
  tests/cloudflare-staging-delivery.test.mjs
```

These tests use doubles and never call Paystack or send email.
