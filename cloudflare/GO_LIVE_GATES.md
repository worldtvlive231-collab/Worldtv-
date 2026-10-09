# WORLD TV – Cloudflare launch readiness and remaining gates

**Migration branch:** `migration/cloudflare-preview-2026-10`

**Do not merge to main, move DNS, remove Railway, or activate live payments until every blocking test has passed and the owner approves cutover.**

## Verified in Cloudflare / GitHub

- [x] A new Cloudflare D1 database named `worldtv-fresh` exists, separate from Railway.
- [x] The owner ran the D1 install command; Wrangler reported **20 application tables**, with 0 users/orders/subscription codes/resellers at installation.
- [x] `worldtv-preview` Pages D1 binding `DB` maps to `worldtv-fresh`.
- [x] The owner verified `/api/cloudflare-health` returns `{"status":"ok","database":"connected"}`.
- [x] A Cloudflare read-only static preview exists at `worldtv-preview.pages.dev`.
- [x] GitHub unit/integration tests exercise D1 schema, staging auth, subscription code validation, signed Paystack dry-run validation, Access-admin JWT signature checking, and account-isolated chat.
- [x] Staging-only functions are disabled unless specific per-feature flags are explicitly configured.
- [x] Offline integration tests cover atomic unread chat counters and duplicate-text handling using D1 migration 004.
- [x] Offline sandbox-only issuance helper derives a code hash using HMAC, ties an authenticated event to an existing paid order, and tests duplicate event/amount/currency protection. **There is no public issuance route or email code delivery.**
- [x] Offline signed Paystack **test-domain** webhook simulation now covers a synthetic pending checkout -> pending order -> verified event -> one reserved activation code -> paid order/checkout. New endpoints remain disabled by default and no real Paystack calls occur.
- [x] Mock end-to-end tests now also verify authenticated retrieval of the reserved test code only by its own customer.
- [x] A customer-facing Cloudflare staging lab UI is prepared, but responds 404 by default and is not wired to live accounts, admin tools or payments.

## Not done: required engineering

- [ ] Build and security-review complete customer signup, email verification, password resets, rate limiting, MFA where needed, fraud defenses, consent/retention and account session management. Cloudflare free-tier CPU impact of password hashing is not yet measured.
- [ ] Build actual frontend integration for account registration, login, subscription management and help chat on Android/mobile/TV. Test all languages and layouts.
- [ ] Review full Node/Express route inventory and port remaining features to Cloudflare Workers/Pages Functions, including complete admin dashboard, reseller store, inventory, downloadable APK/R2 storage, channel management, and support flows.
- [ ] Configure Cloudflare Zero Trust Access application for admin routes. Set signed JWT audience and team domain; provision permitted D1 admin identities separately. **Do not trust unsigned headers or create default admins.**
- [ ] Add Cloudflare Turnstile, WAF/rate limiting, logging, auditing, and privacy protections.
- [ ] Build and configure the complete live-chat UI and notifications; staged chat APIs currently accept **signed-in test customers only**, not anonymous website visitors. Add AI auto-replies only after retrieval, guardrails, human handoff and budget checks are validated.
- [ ] Implement reliable, signed payment-provider webhooks, secret management, persistent order references and durable idempotent activation-code issuance. The current Paystack handler is **validation-only** and cannot charge or fulfill.
- [ ] Decide how to replace any external hosted Paystack link with a transaction flow that supplies a verified per-customer order reference. Do not infer a customer from payment amount or a redirect.
- [ ] Build authenticated code retrieval plus encrypted queued code/email delivery, payment retries, refund/chargeback/cancellation handling, admin audits, and recovery for failed email.
- [ ] Obtain payment provider sandbox access and complete successful/failed/duplicate/out-of-order/mismatch test transactions for customer, reseller and Ghana/wider-world flows.
- [ ] Reconcile current subscriptions, customer accounts and codes on Railway with the decision **not to import Railway records**. Prepare a truthful re-registration, re-issue and uninterrupted-entitlement policy for existing customers.
- [ ] Verify legitimate rights to any channels, films, or live sports being distributed.
- [ ] Audit production dependencies and security vulnerabilities. Several old Node/Express bootstrap modules are not supported by Cloudflare's JavaScript runtime.
- [ ] Conduct real preview E2E checks: registration, login/logout, concurrency, duplicate webhook prevention, activation, admin isolation, chat, all pages, mobile layouts, localization, email, fees, tax/currency, and rollback.
- [ ] Set up domain/DNS migration and rollback plan; execute **only after explicit approval**. Keep the Railway volume until old customer entitlements are resolved.

## One remaining staged database migration

The original 20 application tables are installed, but the new **chat trigger migration 004 is NOT verified remotely**. It only adds two triggers and does not delete or copy customer data. Use the already authorized GitHub Codespaces terminal:

```bash
git pull --ff-only
bash cloudflare/d1/apply-004-remote.sh
```

Type `worldtv-fresh` when prompted, then confirm two trigger names are returned. Do not enable live chat until this succeeds and production-grade rate limiting and the admin Access policy are ready. Even after installation this will NOT enable the chat APIs automatically.

## Environment feature flags in staging (currently NOT set by this PR)

All functions require the correct preview domain plus their flags:

- `WORLDTV_STAGING_AUTH_ENABLED=true`: experimental register/login/subscription endpoints.
- `WORLDTV_STAGING_REDEMPTION_ENABLED=true`: in addition to auth flag, experimental code redemption.
- `WORLDTV_STAGING_CHAT_ENABLED=true`: in addition to auth flag, experimental account-bound live chat; admin routes also require admin flag.
- `WORLDTV_STAGING_ADMIN_ENABLED=true`: admin route also checks Cloudflare Access signed JWT, email allowlist and D1 `role='admin'`.
- `WORLDTV_ACCESS_TEAM_DOMAIN`: e.g. `https://yourteam.cloudflareaccess.com`, must be the actual organization.
- `WORLDTV_ACCESS_AUD`: Access application's real audience ID.
- `WORLDTV_STAGING_ADMIN_EMAILS`: explicit list of approved admin emails.
- `WORLDTV_STAGING_PAYSTACK_VALIDATION_ENABLED=true`: non-fulfilling, signed **test** Paystack validation endpoint only.
- `WORLDTV_PAYSTACK_TEST_SECRET`: Cloudflare secret, **sandbox only**, never committed.
- `WORLDTV_STAGING_TEST_CHECKOUT_ENABLED=true`: double-gated, test-only checkout reference creator that NEVER charges or returns a payment link.
- `WORLDTV_STAGING_FULFILLMENT_ENABLED=true`: triple-gated signed Paystack test-domain webhook that reserves one hashed code but never delivers it.
- `WORLDTV_STAGING_CODE_HMAC_SECRET`: Cloudflare test-only encrypted secret (at least 32 characters) required for deterministic code derivation. Never commit or share it.
- `WORLDTV_STAGING_CODE_RETRIEVAL_ENABLED=true`: enables authenticated test-code retrieval **only** on preview.
- `WORLDTV_STAGING_UI_ENABLED=true`: with staging auth, exposes the gated `/staging-lab` browser test page; never use for production.

See `cloudflare/SANDBOX_CHECKOUT.md` for the mock end-to-end transaction, limitations and verification requirements. **Do not enable any of these features yet.** Current auth and chat prototypes still need rate limiting and operational protections; signed payment validation does NOT mean payment integration is ready.

## Owner-facing safe verification

In GitHub Codespaces, after updating the migration branch:

```bash
git pull --ff-only
node --test tests/cloudflare-pages-health.test.mjs
node --test tests/cloudflare-staging-auth.test.mjs
node --test tests/cloudflare-staging-subscriptions.test.mjs
node --test tests/cloudflare-staging-paystack.test.mjs
node --test tests/cloudflare-staging-admin-access.test.mjs
node --test tests/cloudflare-staging-chat.test.mjs
node --test tests/cloudflare-staging-paystack-route.test.mjs
node cloudflare/check-public-preview.mjs
```

The last script sends only safe probes to the public Pages preview. **Do not use live payments for testing.**

## Deployment constraints

This ordinary GitHub connector can commit and run GitHub Actions tests, but cannot use the customer's already-authorized Codespaces terminal session or Cloudflare dashboard directly. Final Cloudflare configuration requires an authorized browser workflow, such as **ChatGPT Work mode** with Cloud Browser, or user-run Codespaces commands. Never paste Paystack private keys or Cloudflare API tokens into this chat.
