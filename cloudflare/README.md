# WORLD TV → Cloudflare migration (preparation, NOT yet cut over)

> **Status: IN PROGRESS — live site stays on Railway until the backend, data, and payments have passed production-equivalent tests.**
> Do **not** connect `myworldtvlive.com` to the preview or cancel Railway yet.

## What the repository actually runs

- Node.js/Express (`server.js`), plus many CommonJS startup patches loaded with `node -r`.
- `better-sqlite3` using a persistent file at `data/worldtv.sqlite` (SQLite WAL).
- Customer and reseller sessions, subscription codes, checkout verification and Paystack/Pocketi/Stripe webhooks, admin tools, live chat and email automation.
- Some in-process intervals and scheduled work.
- Persistent uploads on the Railway volume. The application download may be served from `public/apps` or a separate URL.

**Cloudflare Pages cannot run the current Express server and local SQLite database unchanged.** The Worker runtime is not a persistent Node filesystem/VM. Port database calls to asynchronous Cloudflare D1 bindings, background work to Cron/Queues, uploads to R2, and session handling to durable storage. Port all relevant API routes and startup patches. Preserve hashed passwords, permissions and payment idempotency.

## Part 1: read-only preview — safe to try now

This branch includes `cloudflare/build-preview.mjs`. It copies only the public landing page, a carefully allowlisted `assets/` directory, and a few optional public icons/manifest files into `cloudflare/preview-dist/`. It does **not** copy backend source, `.env` or the SQLite database. It adds an unmistakable preview-only banner, no-index headers, and routes internal landing-page links to the live website.

With a Cloudflare account, create a separate **Cloudflare Pages** project connected to this GitHub branch.

- Git branch: `migration/cloudflare-preview-2026-10`
- Build command: `node cloudflare/build-preview.mjs`
- Build output directory: `cloudflare/preview-dist`
- Project name: `worldtv-preview` (or another available name)
- No secrets, database bindings or custom production domain needed for this preview.
- NEVER connect the customer domain to this preview or use it to accept payments.

Local check: `node --check cloudflare/build-preview.mjs && node cloudflare/build-preview.mjs`

Cloudflare Pages static files have a 25 MiB/file maximum; the current APK should remain on its existing download source until the replacement file distribution is tested. Large downloadable APK files will likely belong in R2 or another suitable host rather than Pages.

## Part 2: port backend features to Workers

Migrate feature-by-feature behind a separate staging URL, including:

1. Registration/login, password reset, hashed passwords, customer sessions, admin authentication and authorization, reseller access.
2. Subscription-code issuance/redemption, expiration, duplicate protection and account/device limits.
3. Hosted checkout intents, **signed webhooks**, payment verification and idempotent code issuance. Validate Paystack and every active provider against real provider callbacks in staging before switching the production webhook URLs.
4. Live chat + AI response routes, email queues, sales reporting, referrals, and scheduled recovery tasks.
5. Product files, uploads and download routes. Store durable objects outside the Worker filesystem, e.g. Cloudflare R2; avoid putting the APK in Pages if >25 MiB.
6. Frontend page-by-page tests and an API contract regression suite against the old host.

The Worker free tier has request and CPU limits; D1 has daily read/write limits that can block operations after quota exhaustion. A $0 hosting bill is a **goal, not a guarantee** for this production site. See:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/pages/platform/limits/

## Part 3: back up and migrate production data (DO NOT put exports in Git)

**Required access:** Railway service/volume (production SQLite), Cloudflare account, and control of domain DNS. These credentials/access are not present in this repository.

- Take a consistent online backup of the SQLite file on Railway's persistent volume. Example from a machine with `sqlite3` and safe access:
  `sqlite3 /app/data/worldtv.sqlite ".backup '/path/outside/repo/worldtv-backup.sqlite'"`
- Verify backup integrity, table counts, users, active codes, customer sessions, purchases, reseller accounts, and uploaded files. Safeguard personally identifiable information and hashed credentials.
- Keep the original database read-only or on the existing server while converting a COPY to D1-compatible SQL. Cloudflare documents `sqlite3 copied-backup.sqlite .dump > export.sql`, removal of `BEGIN TRANSACTION`/`COMMIT` and incompatible statements, followed by `npx wrangler d1 execute DATABASE --remote --file=export.sql` after review.
- D1 supports much of SQLite SQL but **not** the synchronous `better-sqlite3` API. Rework transaction boundaries and query semantics; verify foreign keys and constraints.
- Never expose production DB, API tokens, admin passwords, payment secrets or `.env` in a commit, Cloudflare Pages output, or chat.
- Stage repeated restores and consistency checks. Because Railway remains live during development, **final data cutover needs a coordinated write freeze or replay of changes after the last snapshot**, otherwise late customer purchases/codes can be lost.
- Back up all persistent uploads separately.

Cloudflare import documentation: https://developers.cloudflare.com/d1/best-practices/import-export-data/

## Part 4: production cutover checklist

- [ ] Cloudflare Pages staging frontend passes mobile/desktop checks.
- [ ] Cloudflare Worker implements ALL production API endpoints called by frontend.
- [ ] D1 production data matches source rows, constraints, new purchases and activation states.
- [ ] R2/assets and APK downloads work from expected countries and devices.
- [ ] Sign-in, account recovery, subscriber codes, reseller dashboard and admin work.
- [ ] Live chat, email and all customer payment flows verified end-to-end.
- [ ] Webhook signature validation, replay protection, refunds and retry behavior tested.
- [ ] DNS and HTTPS configured; only then switch `myworldtvlive.com`.
- [ ] Verify new production traffic, error rate, activation, downloads, payment success and roll-back path.
- [ ] Disable old webhook subscriptions/jobs only AFTER new processor verification.
- [ ] Retain encrypted backups; then terminate Railway services/volume and cancel the Railway plan when safe.

**Important:** The preview build in this branch is deliberately incomplete. Its purpose is to validate static presentation and set up Cloudflare Git integration safely. This branch must NOT be merged into production as proof of a complete migration.
