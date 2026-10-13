# WORLD TV sandbox checkout and activation delivery

**Preview only; disabled by default. No live key or real payment is permitted.**

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/staging/payment/checkout-draft` | Creates an account-bound, server-priced pending order |
| POST | `/api/staging/payment/paystack-sandbox-initialize` | Idempotently initializes that order with a Paystack `sk_test_` key |
| POST | `/api/staging/payment/paystack-sandbox-webhook` | Verifies a signed test event and atomically fulfills once |
| GET | `/api/staging/subscriptions/test-code?reference=…` | Separately gated customer-only diagnostic retrieval |
| POST | `/api/staging/subscriptions/redeem` | Redeems a valid account-bound code once |
| GET | `/api/staging/admin/activation-deliveries` | Access-protected delivery queue visibility |
| POST | `/api/staging/admin/activation-delivery-retry` | Access-protected retry of one order's delivery |

The staging lab provides explicit controls to create a draft and initialize its
reference. It only renders a continuation link when the API returns a validated
`https://checkout.paystack.com/…` URL.

Security properties:

- Price, currency, customer and paid state come from D1, never from the browser.
- Live keys fail validation before any provider request.
- Raw webhook bytes are HMAC verified and only `domain=test` events qualify.
- Unique provider event/reference/order constraints make retries idempotent.
- Activation codes are HMAC-derived and stored only as SHA-256 hashes plus hints.
- Delivery uses a durable outbox, exact recipient allowlist and service binding.
- Every capability is exact-host and independently feature-flag gated.

See [PAYMENT_STAGING.md](PAYMENT_STAGING.md) for configuration and the real test
matrix. See [MIGRATION_EXECUTION_2026-10-13.md](MIGRATION_EXECUTION_2026-10-13.md)
for deployment, blockers and rollback.
