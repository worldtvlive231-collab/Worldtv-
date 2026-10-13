# WORLD TV — Fresh Cloudflare D1 database

**Status:** the separate `worldtv-fresh` D1 database and Pages binding were previously
confirmed, but migrations 005–008 are not yet remotely verified. No Railway
customer data was migrated. This is not a completed hosting move.

## Simple setup for an older Mac: one command inside GitHub Codespaces

The user's Mac runs macOS 11.7 and cannot run current Wrangler officially, so a safe **GitHub Codespace** is prepared on this branch with Node 22 and Python.

1. Go to [the WORLD TV GitHub repo](https://github.com/worldtvlive231-collab/Worldtv-).
2. Set branch to `migration/cloudflare-preview-2026-10`.
3. Click **Code → Codespaces → Create codespace on migration/cloudflare-preview-2026-10**.
4. After the cloud terminal is ready, run exactly:

```bash
bash cloudflare/d1/setup-remote.sh
```

The setup script checks all eight migrations locally, checks Cloudflare D1 access,
and uses Wrangler's browserless OAuth **device login** if required. If asked,
visit https://dash.cloudflare.com/oauth2/device in your own browser and enter the
short code. It then requires an exact `worldtv-fresh` confirmation, replays the
additive schema safely and checks for 28 application tables. **Do not paste
Cloudflare API tokens, passwords, secrets or private records into ChatGPT or GitHub.**

**Safety:** If Codespaces is not enabled or device authorization cannot finish, run this task in **ChatGPT Work mode**, which has a Cloud Browser that can navigate the Cloudflare dashboard, or follow the manual Wrangler instructions below. A GitHub connection in the normal chat does not grant Cloudflare API access. Codespaces may incur costs beyond your included GitHub allowance; check GitHub usage before proceeding.

The schema setup does not enable login, chat, payments, downloads or continuity;
all staging functions remain exact-host and feature-flag gated.

---

## First, create a NEW database in your Cloudflare account

1. Open https://dash.cloudflare.com/.
2. Go to **Storage & Databases → D1 SQL Database** (menu labels can vary; use dashboard search for `D1`).
3. Select **Create database**.
4. Name it `worldtv-fresh`. Select automatic region placement unless there is a specific data residency need.
5. Keep a note of the generated database ID and avoid sharing API tokens or passwords.

This database starts empty. The schema seeds only one non-sensitive *plan definition*: WORLD TV Annual (USD $23, 365 days). No customer, admin, reseller, session, order, or activation-code data is inserted.

## Apply schema (only AFTER confirming database name)

There are eight ordered migrations:

- `cloudflare/d1/001_core.sql`: users, plans, hashed sessions and password reset tokens, checkout, orders, payment events, hashed activation codes, subscriptions.
- `cloudflare/d1/002_operations.sql`: resellers, live chat, product orders, site settings, notifications and audit logs.
- `cloudflare/d1/003_user_guards.sql`: guard manually created `users` tables against invalid roles/status values.
- `cloudflare/d1/004_chat_message_counters.sql`: atomic unread-count triggers.
- `cloudflare/d1/005_account_security.sql`: verification/reset tokens and shared auth rate limits.
- `cloudflare/d1/006_payment_delivery.sql`: sandbox initialization and activation-delivery outbox.
- `cloudflare/d1/007_reseller_security.sql`: reseller generation batches and code grants.
- `cloudflare/d1/008_customer_continuity.sql`: digest-only continuity import batches and entitlements.

Use the guarded setup script from a reviewed checkout:

```bash
bash cloudflare/d1/setup-remote.sh
```

Run those commands from the repository root on branch `migration/cloudflare-preview-2026-10`, not directly from your home directory.

**Never point this script at Railway or another database.** It hard-codes
`worldtv-fresh`, requires an exact confirmation and does not delete/import rows.

To run a schema smoke test locally (does not touch Cloudflare or Railway):

```bash
python3 cloudflare/d1/test_schema.py
```

## Bind to Cloudflare Pages when ready

Cloudflare Docs: https://developers.cloudflare.com/pages/functions/bindings/

1. Open Cloudflare → Workers & Pages → `worldtv-preview`.
2. Settings → Bindings → Add → D1 database binding.
3. Variable name: `DB`; select `worldtv-fresh` as database.
4. Redeploy the project.

**Binding is not launch approval.** The Pages Functions backend is implemented for
staging but remains disabled until its individual flags, bindings and secrets are
configured and real staging acceptance tests pass.

Do not point `myworldtvlive.com` to Pages yet.

## Important functionality / safety gaps

- The old Node/Express process is not deployed to Pages; only reviewed Pages Functions routes are available.
- This fresh schema is **not 1:1 compatible** with the old Railway schema. It intentionally stores subscription-code **hashes**, and uses integer minor-currency units to reduce rounding issues.
- No default admin or reseller accounts; provision only through the Access-protected staging workflow.
- Do not enable payments until real Paystack sandbox, delivery and reconciliation tests pass.
- Do not add customer phone numbers, private keys, live passwords, database exports or bearer codes to GitHub.
- Set up separate Cloudflare R2 storage for uploaded product media and APK if needed (D1 stores metadata, not files).
- Railway passwords are never copied. The digest-only continuity bridge must be
  populated from an owner-approved entitlement inventory and tested before launch.
- Keep the old Railway volume untouched for now; it may be needed to honor active subscriptions or recover records later.
- Free-tier limits are not unlimited; monitor daily D1 read/write usage and Worker requests. See https://developers.cloudflare.com/d1/platform/pricing/.

## Checklist before actual domain migration

- [ ] New D1 database created in Cloudflare
- [ ] All eight migrations applied/replayed successfully (28 application tables)
- [ ] Binding `DB` points to the right database
- [ ] Backend rewritten for Workers/Pages Functions and D1
- [ ] Auth, login, password reset, admin and resellers secured
- [ ] Paystack payment test and verified webhook duplicate prevention pass
- [ ] Subscriptions and activation-code issuance and redemption pass
- [ ] Chat and uploads integrated (durable R2 storage)
- [ ] All pages and APIs tested against staging
- [ ] Existing customers notified/reissued their entitlements if old data remains unavailable
- [ ] Custom domain and DNS moved only after acceptance tests
