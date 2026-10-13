# WORLD TV owner acceptance matrix

**Status: NOT APPROVED FOR PRODUCTION.** Automated staging tests are green; every
row below still needs real staging evidence against the reviewed deployment SHA.
PR #162's external merge into `main` does not change this status.

| Area | Positive evidence | Required negative/failure evidence | Status |
| --- | --- | --- | --- |
| Registration/auth | Register, receive email, verify, login/logout, reset password | Invalid Turnstile, wrong password, expired/replayed token, revoked session, rate limit | Blocked: provider/browser |
| Existing customers | Approved active entitlement restored with original expiry | Wrong email, duplicate claim, expired/revoked record, active-subscription collision | Blocked: Railway inventory/approval |
| Admin | Access login, overview, audits, chat/delivery/continuity operations | Bad JWT/audience, unlisted email, non-admin role, CSRF/IDOR attempts | Blocked: Access configuration |
| Reseller | Create, allocate, login, generate, redeem, usage accounting, suspend/logout | Over-quota, cross-reseller access, suspended login/session, duplicate redemption | Blocked: browser staging |
| Subscription | Status, one-time redemption, ownership and expiry | Invalid/wrong-owner/paid-state/concurrent duplicate claims | Offline pass; real D1 blocked |
| Paystack | Test initialization, success and exact reconciliation | Live key, decline/cancel, bad HMAC/domain/amount/currency/reference, duplicate/out-of-order | Blocked: test credentials/webhook |
| Activation email | One allowlisted delivery and visible status | Mailer outage, retry, max-attempt dead state, mismatched code/recipient, log leakage | Blocked: mailer/inbox |
| Chat | Customer/admin exchange, unread count, mobile layout | Anonymous/cross-account access, invalid payload, abuse/rate limit | Blocked: browser/operations |
| APK | R2 metadata, checksum, full/range download, install | Wrong key/hash/version, missing object, unsupported range/device | Blocked: approved APK/R2/device |
| UI/accessibility | Desktop/mobile journeys; English/French/Spanish/Portuguese/Arabic | Broken links, keyboard/screen-reader/layout and RTL regressions | Blocked: browser/device matrix |
| Operations | Alerts, D1 backup/restore, deployment and DNS rollback rehearsal | Simulated outage/data mismatch/payment duplication | Blocked: Cloudflare access/change window |
| Legal/commercial | Rights, privacy, refund/chargeback, retention and notices approved | Unlicensed content or unresolved customer terms | Blocked: owner/legal review |

## Evidence record for each test

Record the timestamp, exact git SHA and Pages deployment ID, tester, environment,
sanitized account/reference, expected result, actual result, screenshot/log link and
cleanup performed. Never capture secrets, raw activation codes, passwords or customer data.

## Cutover rule

All rows must pass, Railway must remain available as rollback, and the owner must
approve the precise DNS/payment/change-window plan after reviewing the evidence.
Earlier approval to build or stage is not production authorization.

Deployment and rollback steps are in
[MIGRATION_EXECUTION_2026-10-13.md](MIGRATION_EXECUTION_2026-10-13.md).
