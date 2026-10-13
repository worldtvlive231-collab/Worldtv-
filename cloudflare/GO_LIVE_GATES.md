# WORLD TV Cloudflare launch gates

**NO-GO. Keep PR #162 draft. Do not merge to main, move
`myworldtvlive.com`, enable live payments, or delete Railway data.**

The staging implementation is complete behind disabled-by-default flags and the
offline suite passes 80/80. Production remains blocked on real Cloudflare,
provider, inbox, browser, device and continuity evidence.

## Staging configuration inventory

| Capability | Required flags/settings |
| --- | --- |
| Customer account | `WORLDTV_STAGING_AUTH_ENABLED`, `WORLDTV_STAGING_IDENTITY_ENABLED`, `WORLDTV_STAGING_REGISTRATION_ENABLED`, `WORLDTV_STAGING_UI_ENABLED`, Turnstile settings, auth mailer, password/rate secrets, email allowlist |
| Subscription/code | `WORLDTV_STAGING_REDEMPTION_ENABLED`, optional `WORLDTV_STAGING_CODE_RETRIEVAL_ENABLED`, code HMAC secret |
| Paystack test | `WORLDTV_STAGING_TEST_CHECKOUT_ENABLED`, `WORLDTV_STAGING_PAYSTACK_INITIALIZE_ENABLED`, `WORLDTV_STAGING_PAYSTACK_VALIDATION_ENABLED`, `WORLDTV_STAGING_FULFILLMENT_ENABLED`, `WORLDTV_PAYSTACK_TEST_SECRET=sk_test_…` |
| Activation email | `WORLDTV_STAGING_DELIVERY_ENABLED`, `WORLDTV_ACTIVATION_MAILER`, staging code HMAC secret, email allowlist |
| Admin | `WORLDTV_STAGING_ADMIN_ENABLED`, `WORLDTV_STAGING_ADMIN_UI_ENABLED`, Access team domain/audience, admin email allowlist, active D1 admin role |
| Reseller | `WORLDTV_STAGING_RESELLER_ENABLED`, `WORLDTV_STAGING_RESELLER_UI_ENABLED`, `WORLDTV_STAGING_RESELLER_CODES_ENABLED`, reseller password pepper/code secret |
| Chat | `WORLDTV_STAGING_CHAT_ENABLED`; admin side also needs the admin gate |
| APK | `WORLDTV_STAGING_DOWNLOAD_ENABLED`, R2 binding, exact object key/version/SHA-256 |
| Continuity | `WORLDTV_STAGING_CONTINUITY_ADMIN_ENABLED`, `WORLDTV_STAGING_CONTINUITY_ENABLED`, continuity HMAC secret |

Every route also requires the exact `worldtv-preview.pages.dev` hostname. Secrets
belong only in Cloudflare secret management. Turn on one capability at a time and
turn it off after its evidence is captured.

## Blocking acceptance gates

- [x] Offline auth, authorization, rate-limit, replay, IDOR, idempotency, payment,
  delivery, reseller, chat, APK and continuity tests pass.
- [x] Fresh schema applies/replays all eight migrations and validates 28 tables.
- [ ] Reviewed PR head deployed to Pages with exact SHA recorded.
- [ ] Migrations 005–008 applied and verified in `worldtv-fresh`; backup/restore rehearsed.
- [ ] Real verification/reset inbox journeys pass, including expiry and retry.
- [ ] Real Paystack test-mode success/failure/duplicate/replay/mismatch and reconciliation pass.
- [ ] Automatic activation delivery and admin retry/dead-letter journeys pass.
- [ ] Real Cloudflare Access admin isolation and full reseller lifecycle pass.
- [ ] Customer/admin live chat passes in browsers with abuse controls.
- [ ] Approved APK passes R2 checksum/download/resume/scan/device-install tests.
- [ ] Owner-approved Railway entitlement inventory is reconciled through continuity
  without copying passwords or deleting/modifying Railway records.
- [ ] Desktop/mobile accessibility and localization matrix passes.
- [ ] Monitoring, alerts, rights/legal review, refund/chargeback handling and rollback rehearsal pass.
- [ ] Owner gives final explicit confirmation for the exact production cutover.

## Reproducible checks

```bash
node --test --test-concurrency=1 tests/*.test.mjs
python3 cloudflare/d1/test_schema.py
bash -n cloudflare/d1/setup-remote.sh
node cloudflare/build-preview.mjs
git diff --check
```

After authenticated staging configuration, run the non-mutating remote check:

```bash
bash cloudflare/check-remote.sh
```

See [MIGRATION_EXECUTION_2026-10-13.md](MIGRATION_EXECUTION_2026-10-13.md)
for the deployment/cutover/rollback procedure and honest blocker list.
