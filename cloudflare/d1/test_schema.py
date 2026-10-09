#!/usr/bin/env python3
"""Validate the new, empty WORLD TV D1 SQLite schema without any customer data."""
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parent
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
for filename in ("001_core.sql", "002_operations.sql", "003_user_guards.sql"):
    db.executescript((root / filename).read_text(encoding="utf-8"))

tables = {row[0] for row in db.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
)}
required = {
    "users", "plans", "customer_sessions", "password_reset_tokens",
    "checkout_requests", "orders", "payment_events", "subscription_codes",
    "subscriptions", "resellers", "reseller_sessions", "reseller_code_allocation",
    "reseller_sales", "live_chat_conversations", "live_chat_messages",
    "products", "product_orders", "site_settings", "notifications", "audit_logs"
}
assert required <= tables, f"Missing tables: {required - tables}"
assert db.execute("PRAGMA foreign_key_check").fetchall() == []
assert db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
assert db.execute("SELECT COUNT(*) FROM orders").fetchone()[0] == 0
assert db.execute("SELECT COUNT(*) FROM subscription_codes").fetchone()[0] == 0
assert db.execute("SELECT COUNT(*) FROM resellers").fetchone()[0] == 0
assert db.execute("SELECT slug, price_usd_cents FROM plans").fetchall() == [("annual", 2300)]

db.execute("INSERT INTO users(name,email,password_hash) VALUES('Test','sample@example.invalid','hashed')")
try:
    db.execute("INSERT INTO users(name,email,password_hash) VALUES('Duplicate','SAMPLE@example.invalid','hashed')")
    raise AssertionError("Case-insensitive unique email rule failed")
except sqlite3.IntegrityError:
    pass

db.execute("INSERT INTO payment_events(provider,provider_event_id,verification_status) VALUES('paystack','event-test','verified')")
try:
    db.execute("INSERT INTO payment_events(provider,provider_event_id,verification_status) VALUES('paystack','event-test','verified')")
    raise AssertionError("Duplicate payment event was accepted")
except sqlite3.IntegrityError:
    pass

# Schema can be applied idempotently when intentionally bootstrapping a clean database.
for filename in ("001_core.sql", "002_operations.sql"):
    db.executescript((root / filename).read_text(encoding="utf-8"))

assert db.execute("SELECT COUNT(*) FROM plans").fetchone()[0] == 1
assert db.execute("PRAGMA foreign_key_check").fetchall() == []
print("PASS: 20 application tables, empty customer data, unique constraints and repeat-safe schema.")
