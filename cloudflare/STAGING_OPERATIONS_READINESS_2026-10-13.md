# WORLD TV — staging operations acceptance (2026-10-13)

**Status: code and offline tests prepared; NOT live or production-certified.**

Draft PR #164 includes:
- Access-protected admin web controls to list chat conversations, read messages,
  reply and close threads via the existing server-side staging APIs.
- Reseller interface quota display, password-field clearing after submit, and
  clearing of one-time code display on logout. Reseller grants stay quota- and
  owner-scoped in the existing D1 APIs.
- R2 download object revalidation for size, version, declared SHA-256 metadata,
  and matching ETag (when provided), protecting HEAD/GET replacement races.
- Offline UI and APK regression tests. The GitHub full staging tests and preview
  safety workflows passed for commit `6a01395`.

## External blockers verified directly in Cloudflare on 2026-10-13

1. **Zero Trust Access is not enabled.** The Cloudflare Access list API reports
   `access.api.error.not_enabled`. A Cloudflare administrator must enable
   Access, create and scope the staging admin application, set its JWT audience,
   and independently provision only approved admin identities in D1.
   Do not substitute an unverified header, disable signature checks, or create a
   universal admin account.
2. **R2 is not enabled.** Cloudflare reports error `10042` when listing buckets.
   An account administrator must enable R2 in Cloudflare before creating a
   staging-only bucket and binding it as `WORLDTV_APK_BUCKET`. No APK was
   uploaded or certified. Upload only an owner-approved and malware-scanned APK,
   record its independently calculated SHA-256, version and object metadata.
   Validate download, byte-range resume, digest, and Android installation.
3. The Pages project `worldtv-preview` deploys branch
   `migration/cloudflare-preview-2026-10`, not this draft PR branch.
   Staging auth is still disabled. Do not claim the new admin/reseller UI or APK
   changes are deployed until the exact reviewed commit reaches an isolated
   preview deployment and browser tests pass.
4. Namecheap domain email renewal/setup has been deferred by the owner, so
   production-ready verification and password-reset mail remain blocked.
5. Customer entitlement continuity and complete staging browser/device tests
   remain required before any production cutover.

## Staging acceptance checklist

- [ ] Owner enables Cloudflare Zero Trust Access; restrict an application to
      the staging admin host; verify JWT issuer, audience, and selected identity.
- [ ] Configure `WORLDTV_STAGING_ADMIN_ENABLED`,
      `WORLDTV_STAGING_ADMIN_UI_ENABLED`, approved email allowlist,
      Access team/audience, and active D1 admin role on protected staging only.
- [ ] Verify admin login cannot be bypassed; read/reply/close one synthetic chat;
      cross-account and cross-origin attempts must fail.
- [ ] Verify reseller create, suspend, allocation, sign-in, quota, code generation,
      replay rejection, sign-out and isolation on test identities.
- [ ] Owner enables R2, binds test bucket, uploads SHA-256-verified APK and
      validates R2 metadata, HTTP range, checksum, scan and installation.
- [ ] Keep all staging flags off when tests are not running.
- [ ] Run monitored browser tests on mobile and desktop and retain sanitized
      evidence, recording exact deployment commit and rollback point.

**Never switch `myworldtvlive.com` DNS or enable real Paystack processing in
this phase. Preserve Railway data.**
