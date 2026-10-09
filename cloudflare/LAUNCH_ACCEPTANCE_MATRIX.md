# WORLD TV: owner acceptance and safe cutover test matrix

Status: **NOT APPROVED FOR PRODUCTION**. Review alongside `GO_LIVE_GATES.md`.

## Non-negotiable constraints

- Fresh D1 `worldtv-fresh`: **no Railway rows imported**. Existing subscriptions must be honored through an explicit continuity/reissue process, not assumed missing.
- Do not change `myworldtvlive.com` DNS, switch payment links, remove Railway storage, or turn on real processing before explicit owner approval.
- Protect all privileged paths with verified Cloudflare Access identity and appropriate server-side role checks; never assume a client-side admin flag is secure.
- Do not put Paystack/Cloudflare tokens, customer passwords or SQLite production data into GitHub, browser bundles, public Pages files or screenshots.

## Required production acceptance evidence

| Area | Required positive and negative scenarios | Blocked until |
| --- | --- | --- |
| Customer identity | Signup; email verify; login/logout; wrong password; reset; expired/revoked cookie; rate-limit and Turnstile abuse | Verified registration and recovery/security controls |
| Existing accounts | Known active customer re-registration / entitlement restoration, expiry correctness, duplicates and customer notices | Owner-approved reissue/continuity process |
| Admin and resellers | Strongly authenticated Access; role boundaries; no IDOR; audit log; code inventory; impersonation attempts denied | Tested dashboard feature parity |
| Subscription codes | One issued per verified paid order; expiry; wrong owner; duplicate / concurrent redemptions; refund/chargeback | Transactional allocation and verified payment provenance |
| Payments | Paystack test-mode success/failure/duplicate/out-of-order; exact currency + amount + reference; webhook HMAC; delivery retry | Sandbox credentials, webhooks, reconciliation, no trust in redirect |
| Live chat | Anonymous/registered policy; cross-account isolation; unread counts; admin reply and handoff; notification privacy | Abuse controls, real browser & mobile tests |
| Download and assets | APK and permitted assets stored in appropriate object storage; download flow; supported Android devices | R2/storage, signed links where needed |
| Email and notifications | Verification, password reset, receipt, activation-code delivery, bounce/retry, no leaked code in logs | Provider configuration and operational monitoring |
| UI and localization | English, French, Spanish, Portuguese, Arabic; mobile/desktop; accessibility; all links and forms | Browser and device regression |
| Legal and operations | Distribution rights, privacy and refunds, monitoring, backups and restore, deployment rollback rehearsal | Owner review and signed-off checklist |

## Final cutover runbook (do not execute yet)

1. Obtain green automated tests **and** witnessed staging browser tests, including isolated test identities and sandbox transactions.
2. Capture deployment artifact SHA, D1 migration state and restore/rollback procedure. Confirm Cloudflare feature flags and Access settings.
3. Establish customer-entitlement continuity and notify affected existing customers.
4. Obtain explicit owner approval for the precise domain, time window and payment mode.
5. Change production configuration only in the approved window, monitor critical workflows, and retain the Railway volume until continuity is confirmed.
6. Roll back on authentication, payment, code issuance, or account-entitlement discrepancies.

## Current evidence (2026-10-09)

- Read-only Pages preview automatically deployed from the migration branch; last owner-confirmed preview commit `92f000e`.
- D1 connection and 20 application tables confirmed in earlier owner-provided CLI screenshots. Chat triggers were also returned by a CLI query.
- GitHub preview safety and schema workflows passed for `92f000e`.
- Owner set `WORLDTV_STAGING_AUTH_ENABLED=false` before the preview re-deployment.
- **No real payment, customer signup, admin dashboard or live chat E2E certification exists yet.**

The read-only landing page must remain visibly marked preview-only until cutover is independently approved.
