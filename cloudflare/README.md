# WORLD TV → Cloudflare migration (preparation, NOT yet cut over)

> **Status: IN PROGRESS — live site stays on Railway until the backend, data, and payments have passed production-equivalent tests.**
> Do **not** connect `myworldtvlive.com` to the preview or cancel Railway yet.
>
> Update for PR #162: registration/verification/recovery, subscriptions, Paystack
> sandbox initialization/webhook fulfillment, activation delivery, admin/reseller,
> live chat, R2 APK download and customer-continuity staging functions are implemented
> behind exact-host, disabled-by-default flags. Offline tests pass; real provider,
> browser/device and continuity certification is still blocked. See the
> [current execution report](MIGRATION_EXECUTION_2026-10-13.md).

## What the repository actually runs

- Node.js/Express (`server.js`), plus many CommonJS startup patches loaded with `node -r`.
- `better-sqlite3` using a persistent file at `data/worldtv.sqlite` (SQLite WAL).
- Customer and reseller sessions, subscription codes, checkout verification and Paystack/Pocketi/Stripe webhooks, admin tools, live chat and email automation.
- Some in-process intervals and scheduled work.
- Persistent uploads on the Railway volume. The application download may be served from `public/apps` or a separate URL.

**Cloudflare Pages cannot run the current Express server and local SQLite database unchanged.** The Worker runtime is not a persistent Node filesystem/VM. Port database calls to asynchronous Cloudflare D1 bindings, background work to Cron/Queues, uploads to R2, and session handling to durable storage. Port all relevant API routes and startup patches. Preserve hashed passwords, permissions and payment idempotency.

## Part 1: gated staging shell

This branch includes `cloudflare/build-preview.mjs`. It copies the public landing
page, selected legal/information pages, an allowlisted `assets/` directory, and public
icons into `cloudflare/preview-dist/`. It does **not** copy backend source, `.env` or
the SQLite database. It adds a staging banner and no-index headers. Account,
subscription, download and product links remain on the preview host and lead to
gated staging routes.

With a Cloudflare account, create a separate **Cloudflare Pages** project connected to this GitHub branch.

- Git branch: `migration/cloudflare-preview-2026-10`
- Build command: `node cloudflare/build-preview.mjs`
- Build output directory: `cloudflare/preview-dist`
- Project name: `worldtv-preview` (or another available name)
- No secrets, database bindings or custom production domain needed for this preview.
- NEVER connect the customer domain to this preview or use it to accept payments.

Local check: `node --check cloudflare/build-preview.mjs && node cloudflare/build-preview.mjs`

Cloudflare Pages static files have a 25 MiB/file maximum; the current APK should remain on its existing download source until the replacement file distribution is tested. Large downloadable APK files will likely belong in R2 or another suitable host rather than Pages.

## Part 2: staging Pages Functions

The migration branch now contains preview-only implementations for:

1. Registration/login, password reset, hashed passwords, customer sessions, admin authentication and authorization, reseller access.
2. Subscription-code issuance/redemption, expiration, duplicate protection and account/device limits.
3. Hosted checkout intents, **signed webhooks**, payment verification and idempotent code issuance. Validate Paystack and every active provider against real provider callbacks in staging before switching the production webhook URLs.
4. Account-isolated live chat, activation delivery outbox and Access-protected admin operations.
5. R2-backed APK metadata/download and digest-only existing-customer continuity.
6. Automated offline security/failure tests and staging browser shells.

Production parity still requires real staging certification, monitoring, refunds/
chargebacks, mobile/TV/localization checks, distribution-rights review and an
owner-approved Railway continuity inventory.

The Worker free tier has request and CPU limits; D1 has daily read/write limits that can block operations after quota exhaustion. A $0 hosting bill is a **goal, not a guarantee** for this production site. See:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/pages/platform/limits/

## Part 3: back up and reconcile Railway data (DO NOT put exports in Git)

**Required access:** Railway service/volume (production SQLite), Cloudflare account, and control of domain DNS. These credentials/access are not present in this repository.

- Take a consistent online backup of the SQLite file on Railway's persistent volume. Example from a machine with `sqlite3` and safe access:
  `sqlite3 /app/data/worldtv.sqlite ".backup '/path/outside/repo/worldtv-backup.sqlite'"`
- Verify backup integrity, table counts, users, active codes, customer sessions, purchases, reseller accounts, and uploaded files. Safeguard personally identifiable information and hashed credentials.
- Keep the original database and service available. PR #162 does **not** import
  Railway accounts/passwords. Its continuity bridge accepts only an approved list
  of entitlement record IDs, verified emails and expiries, and stores keyed digests.
  Any broader import would be a separate reviewed project and is not authorized.
- D1 supports much of SQLite SQL but **not** the synchronous `better-sqlite3` API. Rework transaction boundaries and query semantics; verify foreign keys and constraints.
- Never expose production DB, API tokens, admin passwords, payment secrets or `.env` in a commit, Cloudflare Pages output, or chat.
- Reconcile active entitlements, expiries, codes, reseller balances and in-flight
  orders immediately before cutover. Test duplicate/expired/wrong-email continuity
  cases and keep Railway as rollback.
- Back up all persistent uploads separately.

Cloudflare import documentation: https://developers.cloudflare.com/d1/best-practices/import-export-data/

## Part 4: production cutover checklist

- [ ] Cloudflare Pages staging frontend passes mobile/desktop checks.
- [ ] Cloudflare Worker implements ALL production API endpoints called by frontend.
- [ ] Owner-approved Railway entitlement inventory reconciles to staged continuity records and sampled claims.
- [ ] R2/assets and APK downloads work from expected countries and devices.
- [ ] Sign-in, account recovery, subscriber codes, reseller dashboard and admin work.
- [ ] Live chat, email and all customer payment flows verified end-to-end.
- [ ] Webhook signature validation, replay protection, refunds and retry behavior tested.
- [ ] DNS and HTTPS configured; only then switch `myworldtvlive.com`.
- [ ] Verify new production traffic, error rate, activation, downloads, payment success and roll-back path.
- [ ] Disable old webhook subscriptions/jobs only AFTER new processor verification.
- [ ] Retain encrypted backups and Railway service/volume through the observation
  period. Deletion/cancellation requires separate authorization after continuity is confirmed.

**Important:** Feature-complete staging code is not production acceptance. This
branch must not be merged or used for cutover until every gate passes and the owner
gives final explicit confirmation.
