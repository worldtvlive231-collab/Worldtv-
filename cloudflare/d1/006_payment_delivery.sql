-- Staging payment initialization and activation-delivery outbox.
-- Additive only: no Railway rows are imported, changed or deleted.

CREATE TABLE IF NOT EXISTS payment_initializations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkout_request_id INTEGER NOT NULL UNIQUE REFERENCES checkout_requests(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'paystack'),
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('initializing','initialized','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  authorization_url TEXT,
  provider_access_code TEXT,
  last_error_code TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  initialized_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_initializations_retry
  ON payment_initializations(status,next_attempt_at);

CREATE TABLE IF NOT EXISTS activation_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','delivering','retry','delivered','dead')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claim_token TEXT,
  claimed_at TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_activation_deliveries_retry
  ON activation_deliveries(status,next_attempt_at);
