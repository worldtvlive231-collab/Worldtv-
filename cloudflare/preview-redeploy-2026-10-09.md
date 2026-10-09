# Preview-only redeployment checkpoint

This no-op documentation change requests Cloudflare Pages automatic deployment from `migration/cloudflare-preview-2026-10`.

Safety requirements:
- `WORLDTV_STAGING_AUTH_ENABLED=false` (owner reports saved in Cloudflare settings).
- Keep all other privileged staging flags disabled.
- No production DNS cutover, live payments, or Railway data migration.
- Cloudflare Pages build must continue to produce the read-only preview with the explicit preview banner.

This file makes no changes to application behavior or database schema.
