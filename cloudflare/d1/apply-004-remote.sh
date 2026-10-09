#!/usr/bin/env bash
# Safe incremental migration for the staging D1 database, without importing
# Railway records, deleting rows, changing production DNS, or live payments.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="worldtv-fresh"
WRANGLER="wrangler@4.119.0"
printf 'Incremental D1 chat-trigger migration on %s (existing rows preserved).\n' "$DB"
printf 'This is a staging migration; customer/admin chat flags must stay OFF.\n'
read -r -p 'Type worldtv-fresh to continue: ' confirm
if [[ "$confirm" != "$DB" ]]; then echo "Cancelled."; exit 1; fi
npx --yes "$WRANGLER" d1 info "$DB"
npx --yes "$WRANGLER" d1 execute "$DB" --remote --yes --file=cloudflare/d1/004_chat_message_counters.sql
npx --yes "$WRANGLER" d1 execute "$DB" --remote --command="SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('trg_worldtv_chat_customer_message','trg_worldtv_chat_staff_message') ORDER BY name;"
printf 'Confirm exactly TWO chat triggers above before proceeding to chat testing.\n'
