# WORLD TV Cloudflare staged customer authentication

**Status: code added to migration branch; DISABLED BY DEFAULT; not production-ready.**

The D1 health probe successfully returned `{"status":"ok","database":"connected"}` from `https://worldtv-preview.pages.dev/api/cloudflare-health` in the customer screenshot.

A first isolated customer authentication API has now been implemented as a *development prototype* using the existing fresh D1 tables:

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/staging/auth/register` | Creates a **new staging-only** customer record after validation |
| POST | `/api/staging/auth/login` | Verifies a salted password hash, creates hashed session record |
| GET | `/api/staging/auth/me` | Reads own account using a secure HttpOnly session cookie |
| POST | `/api/staging/auth/logout` | Revokes the session, clears cookie |

**Every endpoint responds 404 unless BOTH conditions hold:**
- Host is `worldtv-preview.pages.dev` or its Cloudflare preview subdomain.
- Cloudflare Pages runtime environment has `WORLDTV_STAGING_AUTH_ENABLED` precisely set to `true`. The flag has NOT been set by this migration.

**Do not enable the flag yet.** Before real-world testing, add robust IP/user rate limiting, account email verification, password reset, monitoring, cookie-rotation rules and confirm password-derivation CPU costs under Cloudflare Workers free tier. The test suite currently uses fake D1 bindings, not live database reads/writes for these endpoints. Registration is not yet part of the frontend UI.

Security measures in the prototype:
- Parameterized D1 queries; duplicate-email protection via unique DB index.
- Password hashing with PBKDF2-SHA256 and per-user random salt; plain passwords are never written to D1.
- Session tokens generated with cryptographic randomness and stored only as SHA-256 hashes, with a 7-day expiration.
- HttpOnly Secure SameSite=Strict host-only session cookie.
- POST requests must have a matching Origin and application/json content type.
- No admin login, live payment handling, production domain, or Railway data.

**Important limitations:**
- The backend is not yet production-complete: not all Node/Express routes and old app clients have been ported.
- No admin account, billing, coupon validation, reseller API or subscription-code redemption is enabled.
- Existing Railway customer accounts and codes are not present in the fresh D1 database. A customer notification and replacement/continuity plan is required before launch.
- D1 schema is not identical to the old SQLite schema. Do not route production traffic to it yet.

The code lives in `functions/_lib/staging-auth.js` and `functions/api/staging/auth/*.js`. Test with:

```bash
node --test tests/cloudflare-staging-auth.test.mjs
```

The GitHub Actions Cloudflare preview workflow runs this unit test on changes.
