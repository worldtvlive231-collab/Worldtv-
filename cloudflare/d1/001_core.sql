-- WORLD TV: fresh Cloudflare D1 schema, part 1 / 2.
-- New, empty database ONLY. Does not import or delete Railway records.
-- Runtime code (Node/Express + better-sqlite3) is NOT compatible with D1 unchanged.
-- Store hash of activation code or bearer token, never the raw value.
-- Timestamps are UTC textual timestamps. No payment fulfillment routes exist yet.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  email_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_usd_cents INTEGER NOT NULL CHECK (price_usd_cents >= 0),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Informational plan only: this does NOT enable billing or code issuance.
INSERT INTO plans(slug,name,price_usd_cents,duration_days,active)
VALUES ('annual','WORLD TV Annual',2300,365,1)
ON CONFLICT(slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS customer_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_expires ON customer_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_user ON customer_sessions(user_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_password_reset_expires ON password_reset_tokens(expires_at);

CREATE TABLE IF NOT EXISTS checkout_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  provider TEXT NOT NULL CHECK (provider IN ('paystack','pocketi','stripe')),
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','pending','paid','failed','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_checkout_user ON checkout_requests(user_id,created_at);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  checkout_request_id INTEGER UNIQUE REFERENCES checkout_requests(id),
  provider TEXT NOT NULL CHECK (provider IN ('paystack','pocketi','stripe')),
  provider_reference TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded')),
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_provider_ref ON orders(provider,provider_reference);
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id,created_at);

-- Each webhook event must be verified before processing. Avoid duplicate fulfillment.
CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL CHECK (provider IN ('paystack','pocketi','stripe')),
  provider_event_id TEXT NOT NULL,
  provider_reference TEXT,
  payload_sha256 TEXT,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('verified','rejected')),
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider,provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_events_reference ON payment_events(provider,provider_reference);

CREATE TABLE IF NOT EXISTS subscription_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL UNIQUE,
  code_hint TEXT,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  user_id INTEGER REFERENCES users(id),
  order_id INTEGER UNIQUE REFERENCES orders(id),
  status TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused','reserved','redeemed','revoked','expired')),
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  redeemed_at TEXT,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_codes_owner_status ON subscription_codes(user_id,status);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  activation_code_id INTEGER UNIQUE REFERENCES subscription_codes(id),
  order_id INTEGER UNIQUE REFERENCES orders(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id,status,ends_at);
