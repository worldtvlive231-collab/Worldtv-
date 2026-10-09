# WORLD TV — Fresh Cloudflare D1 database

**Status:** schema prepared and validated separately. A database has **not** been created in the customer's Cloudflare account from ChatGPT. No customer data was migrated. This is not a completed hosting move.

## First, create a NEW database in your Cloudflare account

1. Open https://dash.cloudflare.com/.
2. Go to **Storage & Databases → D1 SQL Database** (menu labels can vary; use dashboard search for `D1`).
3. Select **Create database**.
4. Name it `worldtv-fresh`. Select automatic region placement unless there is a specific data residency need.
5. Keep a note of the generated database ID and avoid sharing API tokens or passwords.

This database starts empty. The schema seeds only one non-sensitive *plan definition*: WORLD TV Annual (USD $23, 365 days). No customer, admin, reseller, session, order, or activation-code data is inserted.

## Apply schema (only AFTER confirming database name)

There are two reviewed SQL files:

- `cloudflare/d1/001_core.sql`: users, plans, hashed sessions and password reset tokens, checkout, orders, payment events, hashed activation codes, subscriptions.
- `cloudflare/d1/002_operations.sql`: resellers, live chat, product orders, site settings, notifications and audit logs.

Either use Cloudflare D1's **Console** tab to run the SQL contents **in order** (copy from your GitHub branch), or use Wrangler from a local checkout:

```bash
npx wrangler login
npx wrangler d1 execute worldtv-fresh --remote --file=cloudflare/d1/001_core.sql
npx wrangler d1 execute worldtv-fresh --remote --file=cloudflare/d1/002_operations.sql
npx wrangler d1 execute worldtv-fresh --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
```

Run those commands from the repository root on branch `migration/cloudflare-preview-2026-10`, not directly from your home directory.

**Never run these scripts against an existing database with important data without reviewing the changes.** The scripts use `IF NOT EXISTS` and preserve rows on rerun, but future code changes may require a more carefully versioned migration strategy.

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

**Binding is not the same as implementing the application.** The existing Pages site remains a READ-ONLY preview and does not run the Node/Express application. Its backend must be redesigned as Pages Functions/Workers with D1 queries before registering customers or accepting payments.

Do not point `myworldtvlive.com` to Pages yet.

## Important functionality / safety gaps

- The old `better-sqlite3` queries and transaction helpers do not run directly in the Cloudflare runtime. Full API migration remains needed.
- This fresh schema is **not 1:1 compatible** with the old Railway schema. It intentionally stores subscription-code **hashes**, and uses integer minor-currency units to reduce rounding issues.
- No default admin or reseller accounts; provision those only after secure authentication/authorization is implemented.
- Do not enable payments until signed Paystack/Pocketi webhook handlers, idempotent fulfillment, activation flows and audit logging are tested end-to-end.
- Do not add customer phone numbers, private keys, live passwords, database exports or bearer codes to GitHub.
- Set up separate Cloudflare R2 storage for uploaded product media and APK if needed (D1 stores metadata, not files).
- Since no Railway records are migrated, **old customer logins and activation codes WILL NOT be present in D1**. Communicate a deliberate account migration/reissue process to existing customers before launching this fresh system.
- Keep the old Railway volume untouched for now; it may be needed to honor active subscriptions or recover records later.
- Free-tier limits are not unlimited; monitor daily D1 read/write usage and Worker requests. See https://developers.cloudflare.com/d1/platform/pricing/.

## Checklist before actual domain migration

- [ ] New D1 database created in Cloudflare
- [ ] Both SQL files applied successfully
- [ ] Binding `DB` points to the right database
- [ ] Backend rewritten for Workers/Pages Functions and D1
- [ ] Auth, login, password reset, admin and resellers secured
- [ ] Paystack payment test and verified webhook duplicate prevention pass
- [ ] Subscriptions and activation-code issuance and redemption pass
- [ ] Chat and uploads integrated (durable R2 storage)
- [ ] All pages and APIs tested against staging
- [ ] Existing customers notified/reissued their entitlements if old data remains unavailable
- [ ] Custom domain and DNS moved only after acceptance tests
