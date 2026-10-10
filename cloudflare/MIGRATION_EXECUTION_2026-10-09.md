# WORLD TV migration execution report — 2026-10-09

**NO-GO. PR #162 remains draft. Production cutover is not authorized.**

Base reviewed: `891e3221df958f3664fce5a9d0ef28ccbccd4e3f` on
`migration/cloudflare-staging-phase5-2026-10`. No main merge, DNS change,
live payment activation, or Railway data deletion was performed.

## Implemented in this revision

- Registration remains host/feature gated and creates an unverified customer.
- Turnstile must attest the exact request hostname and `register` action.
- Login, session reads and subscription/chat customer authorization require verified email.
- D1 shared rate counters enforce 20 requests per IP and 5 per email per action
  in each ten-minute window; identifiers are HMAC hashed with a deployment secret.
  Missing IP/secret/schema or unavailable counters fail closed. Counters are not
  a substitute for edge WAF protections against distributed floods.
- Verification and password recovery tokens use 256-bit randomness; only SHA-256
  hashes are stored. Verification expires in 24 hours; reset expires in 30 minutes.
  A D1 transactional claim prevents replay; password reset revokes all customer sessions.
- Recovery responses do not disclose account existence. Email links keep tokens
  in fragments; the staging page clears the fragment before sending a same-origin POST.
- Email sending uses a trusted `WORLDTV_AUTH_MAILER` service binding and an exact
  staging recipient allowlist. It is not configured remotely. A failed initial
  send leaves an unverified account; resend is the recovery path. This is not a
  durable automatic delivery queue. Mailer failures/retries/bounces still need monitoring.
- `/staging-account` provides a gated registration/login/verification/recovery UI,
  CSP nonces, a Turnstile widget and no browser token persistence.
- Request-body reading cancels the stream above 4096 bytes.
- Additive D1 migration 005 supplies identity tokens and rate counters. It has not
  been applied remotely. Existing customer data is not modified by the migration.

## Test evidence

The baseline had 44 passing offline tests. The final revised suite passed **55/55**
with `--test-concurrency=1` (0 failures, 0 skipped). The preview build and Python
legacy-schema check also passed; `git diff --check` was clean. The revised suite includes identity
lifecycle, expired/superseded/disabled tokens, reset session revocation, single-use
claims, concurrent claim simulation, recovery privacy, rate limits, email outage,
Turnstile binding, body-size bounds and account-page gates. Run the commands below
to reproduce the exact revision's final count. Local SQLite serialization is not a real D1
multi-region race test; email and Turnstile use isolated test doubles.

The Python schema test checks legacy migrations 001–004; new identity integration
fixtures apply all migrations including 005. Passing it alone does not certify 005.

### Real staging browser observations

| Journey | Observed result | Assessment |
| --- | --- | --- |
| Preview homepage | Rendered with preview-only banner | Smoke pass only |
| Click Create account on homepage | Redirected to `https://myworldtvlive.com/register.html`; Railway Not Found page | Failed customer journey |
| `/staging-lab` | Browser `net::ERR_BLOCKED_BY_CLIENT`, including a second attempt after homepage access | Blocked; no lab E2E pass |
| Health GET via terminal | `{ "status": "ok", "database": "connected" }` | Binding health only |

The account UI added in this revision has not been deployed or tested in a real
staging browser. The preview builder intentionally redirects customer links to
Railway. The observed registration failure does not prove Railway data is gone.

## Remaining launch-critical blockers

| Area | Current state / required evidence |
| --- | --- |
| Cloudflare runtime | Password derivation now pre-hashes with a required server-held pepper and performs one 100,000-round PBKDF2 call within the hosted runtime limit. Test compatibility and CPU on the actual deployment; Node tests are insufficient. Keep the pepper backed up securely because changing it invalidates staging passwords. |
| Configuration/access | No authenticated Cloudflare deployment capability or credentials were supplied. Need authorized Pages/D1 configuration access; do not paste secrets into chat. |
| Identity/email | Apply 005, configure mailer service, sandbox sender/domain, allowlisted test recipients, Turnstile widget/sitekey/secret, rate secret, monitoring and flags. Prove inbox receipt, expiry, resend, reset and abuse controls in staging. |
| Admin | Existing Access JWT gate and overview/chat APIs have offline tests. Full dashboard, audit/inventory parity and actual Access policy/role/browser validation are unfinished. |
| Resellers | D1 schema exists; complete Cloudflare reseller management and authenticated reseller workflows are not implemented or validated. |
| Subscriptions | Redemption/ownership/isolation have local tests. Renewal, concurrent D1 claims, cancellation/refund/chargeback and migrated entitlement behavior need coverage. |
| Paystack | Existing checkout is a synthetic reference draft with no payment URL; signed test-domain webhooks are simulated. Need `sk_test_` credentials configured securely, real sandbox initialize/verify transactions, webhook delivery/replay and reconciliation. No actual Paystack sandbox transaction was run. |
| Code delivery | Existing webhook reserves one hashed code and supports authenticated test retrieval. Automatic email delivery, durable queue/retries and delivery-failure recovery are unfinished. |
| Chat | Local account-isolation/chat-counter tests pass; abuse limits, actual admin/customer browsers, notification/handoff and mobile flows are not certified. |
| APK | R2/download API, authorized APK artifact, checksum/versioning, access policy and Android download/install tests are unfinished. |
| Existing customers | No current Railway entitlement inventory or approved continuity policy was supplied. Retain Railway and existing entitlements; do not force customers to repurchase. Securely reconcile identity, expiry, reseller balances and code ownership, and rehearse restoration before cutover. |
| Browser/device | Critical registration journey failed; lab blocked. No complete mobile/TV/localization/live-provider E2E evidence. |

## Staging deployment procedure — do not enable until runtime/configuration gates pass

1. Check out the reviewed PR SHA. Confirm the target is `worldtv-preview` and D1
   `worldtv-fresh`, never the production domain or a Railway database.
2. Run:

   ```bash
   node --test --test-concurrency=1 tests/*.test.mjs
   python cloudflare/d1/test_schema.py
   node cloudflare/build-preview.mjs
   git diff --check
   ```

3. Record the current Pages deployment ID/SHA, feature-flag values and D1 schema
   versions. Create a D1 export in restricted storage and rehearse restore to an
   isolated database. Never commit exports or customer data.
4. With authorized Cloudflare access, apply the additive migration:

   ```bash
   npx wrangler d1 execute worldtv-fresh --remote --file cloudflare/d1/005_account_security.sql
   ```

   Confirm identity_tokens and auth_rate_limits exist. This document does not
   authorize applying the migration to production.
5. Configure the trusted email service binding `WORLDTV_AUTH_MAILER`. Its contract
   is POST `/send` with JSON `{to,template,link,environment:"staging"}` returning a
   2xx only after accepting delivery. It must redact links/tokens from logs, enforce
   its own sender/recipient sandbox policy, and expose delivery/failure metrics.
6. Provision secrets through Cloudflare secret management, never GitHub/source:
   `WORLDTV_AUTH_RATE_SECRET` (random >=32 characters), `WORLDTV_PASSWORD_PEPPER`
   (random >=32 bytes), and `WORLDTV_TURNSTILE_SECRET`.
   Set nonsecret `WORLDTV_TURNSTILE_SITEKEY` and exact comma-separated
   `WORLDTV_STAGING_EMAIL_ALLOWLIST`. Restrict widget hostnames and use action `register`.
7. Deploy the PR revision to an isolated preview; verify the deployed SHA, D1
   binding and password derivation on that actual Cloudflare runtime while
   registration remains disabled. If KDF fails, stop and fix architecture.
8. Only after the above checks, enable staging identity/UI/auth/registration flags
   for allowlisted test identities. Run real inbox/browser journeys, then disable
   test features after testing. Payment flags remain disabled until sandbox wiring
   and anti-live-key guards are independently verified.
9. Run edge cases and concurrent D1 tests, Access roles/IDOR, sandbox payment failure
   and replay, automatic delivery/retry, APK download/install and customer continuity.
   Store sanitized evidence against the exact deployment SHA. No mock counts as a
   real provider, inbox, browser or Cloudflare test.
10. Housekeeping in staging: expire/revoke sessions and tokens, remove rate counter
    rows with windows older than a day, and verify monitoring. Use a scheduled
    privileged maintenance process; never expose deletion publicly.

## Production deployment and rollback procedure

Do not execute production cutover while any acceptance-matrix item is blocked.

1. Prepare a reviewed production artifact/configuration plan, domain record change,
   payment mode, change window, customer-continuity reconciliation, backup/restore
   evidence and rollback owner. Keep Railway running and retain its volumes/data.
2. Require green tests plus witnessed staging evidence for every critical journey.
3. Ask the owner for **final explicit confirmation** of the precise cutover plan.
   Prior migration authorization does not authorize DNS or live-payment cutover.
4. After confirmation only, deploy compatible production config, verify bindings
   and health on an alternate hostname, then change the approved DNS records.
   Preserve the exact old DNS records and previous healthy application deployment.
5. Monitor authentication, entitlement mismatches, payment verification/duplicates,
   issuance/email errors, chat and download errors. Stop immediately on critical
   failure; disable new checkout first and pause fulfillment workers to prevent
   duplicated grants. Keep a reconciliation ledger of in-flight order references.
6. Roll back DNS to the recorded Railway target and restore its last verified
   healthy deployment. **The currently observed Railway registration URL is not
   verified healthy**, so repair and rehearse it before relying on this fallback.
7. For a staging-only rollback, disable staging flags and restore the previous
   Pages deployment. Keep additive tables; do not drop them or roll back by deleting
   customer data. Review changed verified/session state before restoring old code:
   old auth code does not enforce the new email-verification gate.
8. Do not blindly restore a database snapshot after new orders exist. Reconcile
   payments and entitlements first; test any point-in-time restore in an isolated
   database. Retain both platforms and snapshots until continuity is independently
   confirmed. Railway deletion requires a separate authorized cleanup decision.
