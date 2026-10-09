#!/usr/bin/env bash
# Installs the NEW WORLD TV schema to the user's named Cloudflare D1 database.
# Run only after authenticating Wrangler on a supported computer/Codespace.
# It does not import Railway data, create customer accounts or deploy the website.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
DB="worldtv-fresh"
WRANGLER_VERSION="4.86.0"

if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo >&2 "Node.js and npm are required. Use GitHub Codespaces (Node 22+) if your Mac is unsupported."
  exit 1
fi

if ! command -v python3 >/dev/null; then
  echo >&2 "Python 3 is required for the schema smoke test."
  exit 1
fi

echo "== WORLD TV / fresh D1 setup =="
echo "Target database: $DB"
echo "No existing Railway customer data will be imported."
echo "This does not install a backend, enable logins or switch myworldtvlive.com."
echo

python3 cloudflare/d1/test_schema.py
echo
echo "Checking Wrangler access to the Cloudflare database..."
if ! npx --yes "wrangler@$WRANGLER_VERSION" d1 info "$DB"; then
  echo "Cloudflare authorization may be required. Starting secure browser sign-in..."
  npx --yes "wrangler@$WRANGLER_VERSION" login || {
    echo >&2 "Unable to complete Cloudflare sign-in. Try opening this project in ChatGPT Work's Cloud Browser or Codespaces browser."
    exit 1
  }
  npx --yes "wrangler@$WRANGLER_VERSION" d1 info "$DB" || {
    echo >&2 "Database '$DB' not found in this authenticated Cloudflare account, or access denied."
    exit 1
  }
fi

echo
echo "To protect against applying schema to the wrong account, confirm database name."
read -r -p 'Type worldtv-fresh to create missing schema tables: ' approval
if [[ "$approval" != "$DB" ]]; then
  echo "Stopped. No SQL files were applied."
  exit 1
fi

echo "Installing core user, plan, payment and subscription tables..."
npx --yes "wrangler@$WRANGLER_VERSION" d1 execute "$DB" --remote --yes --file=cloudflare/d1/001_core.sql

echo "Installing reseller, live-chat, product and audit tables..."
npx --yes "wrangler@$WRANGLER_VERSION" d1 execute "$DB" --remote --yes --file=cloudflare/d1/002_operations.sql

echo "Installing compatibility rules for the existing manually created users table..."
npx --yes "wrangler@$WRANGLER_VERSION" d1 execute "$DB" --remote --yes --file=cloudflare/d1/003_user_guards.sql

echo
echo "Verifying application tables (should be 20, plus Cloudflare's internal table)..."
npx --yes "wrangler@$WRANGLER_VERSION" d1 execute "$DB" --remote --command="SELECT COUNT(*) AS worldtv_tables FROM sqlite_master WHERE type='table' AND name IN ('users','plans','customer_sessions','password_reset_tokens','checkout_requests','orders','payment_events','subscription_codes','subscriptions','resellers','reseller_sessions','reseller_code_allocation','reseller_sales','live_chat_conversations','live_chat_messages','products','product_orders','site_settings','notifications','audit_logs');"
echo
echo "Checking that all customer accounts and payment tables remain empty..."
npx --yes "wrangler@$WRANGLER_VERSION" d1 execute "$DB" --remote --command="SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM subscription_codes) AS subscription_codes, (SELECT COUNT(*) FROM resellers) AS resellers;"
echo
echo "Finished sending D1 schema commands. Review count above; expected WORLD TV tables: 20."
echo "Cloudflare Pages is still a preview. Do not switch DNS or enable payments yet."
