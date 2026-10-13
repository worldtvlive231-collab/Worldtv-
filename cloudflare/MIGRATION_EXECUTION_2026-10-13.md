# WORLD TV Cloudflare migration execution report — 2026-10-13

**Current decision: NO-GO for production. PR #162 must remain draft.**

This revision completes the disabled-by-default Cloudflare staging implementation
for the requested launch journeys. It does not authorize or perform a production
DNS change, live payment, Railway write/delete, or customer-data import.

## Implemented and tested offline

| Area | Staging implementation | Safety boundary |
| --- | --- | --- |
| Customer identity | Registration, Turnstile, verification, verified login/logout, password recovery, session revocation, shared D1 rate limits | Exact preview host; allowlisted recipients; separate feature flags; peppered password hashes |
| Subscriptions | Account-bound status and one-time activation-code redemption | Hashed codes; active verified account required; transactional D1 guards |
| Paystack | Server-created order, idempotent test checkout initialization, signed test-domain webhook, exact amount/currency/reference matching | Rejects every non-`sk_test_` key and non-Paystack checkout URL; no browser-supplied price or paid flag |
| Activation delivery | Durable D1 outbox, derived code verification, service-bound mailer, retries/dead state, admin inspection/retry | Raw code is not stored in D1; exact staging email allowlist; separate delivery flag |
| Admin | Cloudflare Access JWT signature/issuer/audience/expiry verification plus D1 admin role and explicit email allowlist | Exact preview host; same-origin JSON writes; disabled by default |
| Resellers | Admin creation/suspension/allocation, reseller login/logout/dashboard, quota-backed one-time code generation, redemption accounting | Separate session, password pepper, code HMAC secret and per-feature flags; raw codes shown once |
| Live chat | Account-isolated customer conversations/messages and Access-protected admin queue/reply | Verified customer identity; exact preview host; no anonymous chat |
| APK | R2-backed metadata/download with matching version/SHA-256 object metadata, streaming, no-store and bounded single-range requests | Exact object key/config and preview host; disabled by default |
| Existing customers | Admin stages approved Railway entitlement digests; verified matching customer can claim the original expiry once | Stores keyed digests, not Railway IDs/emails/passwords; no Railway connection or mutation |

D1 migrations `005`–`008` add identity, rate-limit, sandbox-payment,
delivery-outbox, reseller-audit and continuity tables. All migrations are additive
or trigger-replacing and the fresh-schema test replays all eight migrations.

## Automated evidence

On 2026-10-13 the complete local suite passed **80/80** with zero failures,
skips or todos:

```bash
node --test --test-concurrency=1 tests/*.test.mjs
python3 cloudflare/d1/test_schema.py
bash -n cloudflare/d1/setup-remote.sh
node cloudflare/build-preview.mjs
git diff --check
```

The schema check passed with **28 application tables**, zero customer/order/code/
reseller seed rows, foreign-key integrity, case-insensitive email uniqueness,
duplicate-event rejection, migration replay, and compatibility with the manually
created `users` table shape.

These tests use local SQLite and provider/service doubles. They do not count as
real Cloudflare D1, inbox, Paystack, R2, Access or Android-device certification.

## Real staging evidence and blockers

The prior deployed preview homepage rendered successfully in a real browser with
the visible `WORLD TV STAGING` banner and preview-local navigation. All feature
routes correctly returned 404 while their Cloudflare flags were disabled. The
new revision still needs deployment and real-provider tests.

| Launch-critical gate | State | Required next evidence |
| --- | --- | --- |
| Cloudflare configuration | **Blocked**: no authenticated dashboard/Wrangler session in this workspace | Apply migrations 005–008; configure bindings, secrets, Access and only staging flags; record exact deployment SHA |
| Identity email | **Blocked** | Receive verification/reset messages in allowlisted real inboxes; test expiry, replay, resend, reset and logout in browser |
| Paystack sandbox | **Blocked** | Initialize with an encrypted `sk_test_` key; complete success/failure/duplicate/replay/mismatch flows; reconcile D1 rows |
| Activation email | **Blocked** | Prove service-binding delivery, retry and dead-letter visibility without secrets/codes in logs |
| Admin/reseller | **Blocked** | Real Access policy/JWT browser test, admin role isolation, reseller lifecycle and attempted privilege/IDOR failures |
| Chat | **Blocked** | Customer/admin browser exchange, isolation, rate/abuse controls and mobile layout |
| APK | **Blocked** | Upload approved APK to R2, verify configured SHA-256, download/resume, scan and install on supported Android devices |
| Existing customers | **Blocked** | Owner-approved Railway inventory/export, entitlement reconciliation, sampled claims and duplicate/expiry checks; Railway remains read-only and retained |
| Browser/device matrix | **Blocked** | Complete desktop/mobile registration-through-activation journeys and accessibility/localization checks |
| Operations/legal | **Blocked** | Monitoring/alerts, backup/restore rehearsal, refund/chargeback policy and content/distribution-rights review |

## Pocketi hosted checkout — Ghana / manual review

- Ghana checkout uses the existing external Pocketi link; worldwide Paystack remains unchanged.
- The new Cloudflare manual-report queue is **test-only**, protected by
  `WORLDTV_STAGING_POCKETI_MANUAL_ENABLED=true` **and** existing staging account/admin gates.
  It accepts fabricated `WTVTEST-POCKETI-` references, not real receipts.
- The administrator must independently check a real Pocketi merchant record and
  amount before recording verification. Recording that status does **not** create
  a paid order or send an activation code.
- In the current live Railway workflow, a staff member must still look up the
  Pocketi transaction in the merchant dashboard, match the customer's email and
  reference, then issue the annual code using existing authorized admin tools.
  Do not issue codes based on screenshots or an unverified user claim.
- Migration `009_pocketi_manual_review.sql` is additive. Do not apply it remotely
  until the D1 backup, migration tests, and customer continuity checks are ready.
  Never enable the staging feature for real customer payments.

## Pocketi manual-review staging verification — 2026-10-13

- GitHub PR #166 merged at `0f6cb72ad83f5a5d5ee1fbd4703090df05b02533` and all three workflows passed.
- Cloudflare staging deployment `9d7a3282-dc98-4872-b1fe-8a74239e6159` succeeded.
- Cloudflare D1 `worldtv-fresh`: additive migration 009 applied **after** Cloudflare SQL export completed and a pre-migration Time Travel bookmark was recorded. Independently checked **29 application tables**, both manual-review indexes, **zero foreign-key violations**, and **zero users, orders, subscription codes, subscriptions, payment events and review reports**.
- SQL export download links are short-lived; a permanently retained off-platform copy has **not** been verified. Preserve an archival backup before enabling customers.
- `WORLDTV_STAGING_AUTH_ENABLED` remains `false` in both Pages environments. `WORLDTV_STAGING_POCKETI_MANUAL_ENABLED` is unset, and no preview payment-provider variables are configured. The feature is intentionally unavailable pending secure identity and Access setup.
- Production `main` PR #167 is a separate **draft review only** for Ghana hosted-link UI. No Railway deploy, production DNS switch, real payment enrollment, or customer-data transfer.
- Manual Pocketi merchant verification and activation-code assignment are **not** automatic; a browser-visible customer claim is never proof of payment.

## Staging deployment procedure

1. Keep PR #162 draft and verify the reviewed head has green GitHub workflows.
2. Record the current `worldtv-preview` deployment ID, environment variables,
   bindings and `worldtv-fresh` schema. Export D1 to restricted storage and prove
   restoration into an isolated database. Do not commit the export.
3. Run the automated commands above, then authenticate to the correct Cloudflare
   account without sharing secrets in chat.
4. Apply/replay the full additive schema to **`worldtv-fresh` only**:

   ```bash
   bash cloudflare/d1/setup-remote.sh
   ```

   Type `worldtv-fresh` at the safety prompt and confirm the query reports 28
   application tables. This script never touches Railway or DNS.
5. Configure these bindings: `DB` → `worldtv-fresh`,
   `WORLDTV_AUTH_MAILER`, `WORLDTV_ACTIVATION_MAILER`, and
   `WORLDTV_APK_BUCKET`. Each mailer must enforce its own staging recipient policy
   and redact tokens/codes.
6. Store secrets only with Cloudflare secret management:
   `WORLDTV_PASSWORD_PEPPER`, `WORLDTV_AUTH_RATE_SECRET`,
   `WORLDTV_TURNSTILE_SECRET`, `WORLDTV_PAYSTACK_TEST_SECRET` (`sk_test_` only),
   `WORLDTV_STAGING_CODE_HMAC_SECRET`, `WORLDTV_RESELLER_PASSWORD_PEPPER`,
   `WORLDTV_RESELLER_CODE_HMAC_SECRET`, and `WORLDTV_CONTINUITY_HMAC_SECRET`.
   Back up peppers/HMAC keys securely; rotation needs a deliberate recovery plan.
7. Configure nonsecret settings: Turnstile site key, exact staging email allowlist,
   Access team domain/audience/admin emails, and APK object key/version/SHA-256.
   The R2 object custom metadata must contain the same `version` and lowercase
   `sha256` values or the download fails closed.
8. Deploy to `worldtv-preview.pages.dev` and verify the exact commit. Turn on the
   minimum flags for one test area at a time. Never use a live Paystack key or
   production webhook.
9. Execute the real staging matrix above, retain sanitized evidence, then turn
   unused flags off. A mock or HTTP 200 alone is not a passed customer journey.

## Production cutover procedure — not authorized

1. Close every launch-critical blocker and attach evidence to the exact PR head.
2. Reconcile existing Railway customers and in-flight orders. Keep Railway and its
   volume intact and available as rollback.
3. Record current DNS values/TTLs, the previous healthy Railway deployment,
   Cloudflare deployment ID, D1 backup/restore point, flag values, payment mode,
   monitoring owner and change window.
4. Present the precise plan and request the owner's **final explicit confirmation**.
   Earlier migration work is not cutover permission.
5. Only after confirmation, deploy production configuration on an alternate host,
   run health/synthetic checks, then change the specifically approved DNS records.
6. Keep real checkout disabled until production identity and continuity smoke tests
   pass; enable it in a separate observed step. Do not infer payment success from a redirect.

## Rollback procedure

Trigger rollback on authentication outage, entitlement mismatch, duplicate or
unverified fulfillment, code-delivery failure above threshold, data-integrity
error, or unavailable critical monitoring.

1. Disable new checkout and fulfillment first. Preserve a reconciliation list of
   every in-flight reference; do not delete D1 rows.
2. Disable staging/production feature flags and restore the previous known-good
   Pages deployment.
3. Restore DNS to the recorded healthy Railway target and verify login, entitlement
   and support health there. Keep Cloudflare D1 read-only for investigation.
4. Do not blindly restore a D1 snapshot after payments. Reconcile provider events,
   orders, codes and subscriptions first; test any restore in an isolated database.
5. Additive migrations remain in place. Do not roll back by dropping tables or
   deleting Railway/D1 customer data.
6. Document incident scope and obtain separate authorization before any later
   cutover or data-retention cleanup.

Production confirmation has **not** been requested because the real staging gates
are still blocked.
