#!/usr/bin/env bash
# Non-mutating WORLD TV Cloudflare readiness check.
# Does NOT modify DNS, payment settings, D1 records, Railway or services.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
echo "WORLD TV Cloudflare preview readiness (safe diagnostics)"
echo "Database: worldtv-fresh | Preview: worldtv-preview.pages.dev"
echo "Branch: $(git branch --show-current)"
if [[ "$(git branch --show-current)" != "migration/cloudflare-preview-2026-10" ]]; then
  echo >&2 "STOP: you are not on the approved migration branch."
  exit 1
fi
node --test tests/cloudflare-pages-health.test.mjs
node --test tests/cloudflare-staging-auth.test.mjs
node --test tests/cloudflare-staging-subscriptions.test.mjs
node --test tests/cloudflare-staging-paystack.test.mjs
node --test tests/cloudflare-staging-admin-access.test.mjs
node --test tests/cloudflare-staging-chat.test.mjs
node --test tests/cloudflare-staging-paystack-route.test.mjs
echo "Checking deployment health and default-disabled endpoints (read-only)..."
node cloudflare/check-public-preview.mjs
echo "Checking signed-in Cloudflare Wrangler access to fresh D1..."
npx --yes wrangler@4.119.0 d1 info worldtv-fresh
echo "Checking expected 20 application tables..."
npx --yes wrangler@4.119.0 d1 execute worldtv-fresh --remote --command="SELECT count(*) AS worldtv_tables FROM sqlite_master WHERE type='table' AND name IN ('users','plans','customer_sessions','password_reset_tokens','checkout_requests','orders','payment_events','subscription_codes','subscriptions','resellers','reseller_sessions','reseller_code_allocation','reseller_sales','live_chat_conversations','live_chat_messages','products','product_orders','site_settings','notifications','audit_logs');"
echo "Readiness checks finished. These tests do not certify live customer, payment, or admin operations."
