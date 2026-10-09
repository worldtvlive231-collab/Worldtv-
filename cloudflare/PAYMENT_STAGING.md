# WORLD TV Cloudflare payment verification preparation

**Status:** Offline helper and unit tests only. No webhook route deployed, no payment processed, no customer charged, no activation code issued.

## Prepared on the migration branch

- `functions/_lib/staging-paystack-verify.js` checks Paystack's `x-paystack-signature` using SHA-512 HMAC on the original raw webhook bytes.
- Rejects wrong signatures, altered payloads, unexpected event types and incorrect transaction status.
- `validatePaidCharge()` requires a trusted D1 order reference and exact provider, amount (minor units) and currency match.
- Derives a deterministic Paystack event identifier for future duplicate prevention.
- Automated unit tests use a fake, test-only key. No real Paystack credentials are used.

## Not yet built / do not enable payments

1. A secure per-customer checkout flow storing order reference, expected amount and currency in D1 before redirect. Verify the existing hosted Paystack link actually supports identifying an individual order.
2. A Cloudflare secret for the real Paystack key; never store the secret in GitHub or browser code.
3. A signed webhook endpoint that verifies the raw signature, loads the pending D1 order and performs idempotent event, payment status and activation-code issuance transactions.
4. A retry-safe subscriber code delivery and recovery process. Never issue a code because a browser displays a payment success redirect.
5. Refunded/chargeback and disputed order handling, admin and reseller security, and end-to-end staging payment tests.
6. Separate renewal/reissue plan for old active Railway customers; the fresh D1 database contains none of the old records.
7. Explicit review and approval before moving the production domain or live payments.

Run tests: `node --test tests/cloudflare-staging-paystack.test.mjs`

**This file does not enable or configure actual payments.**
