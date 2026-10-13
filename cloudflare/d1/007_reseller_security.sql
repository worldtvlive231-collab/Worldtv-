-- Secure staging reseller sessions, quota-backed code generation and auditability.
-- Ownership stays in reseller_code_grants, so this migration is additive and
-- replay-safe. No Railway data is imported, altered or deleted.

CREATE TABLE IF NOT EXISTS reseller_generation_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_reference TEXT NOT NULL UNIQUE,
  reseller_id INTEGER NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
  requested_count INTEGER NOT NULL CHECK (requested_count BETWEEN 1 AND 50),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reseller_batches_owner
  ON reseller_generation_batches(reseller_id,created_at);

CREATE TABLE IF NOT EXISTS reseller_code_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_reference TEXT NOT NULL UNIQUE,
  batch_id INTEGER NOT NULL REFERENCES reseller_generation_batches(id) ON DELETE CASCADE,
  reseller_id INTEGER NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
  subscription_code_id INTEGER NOT NULL UNIQUE REFERENCES subscription_codes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','redeemed','revoked')),
  customer_user_id INTEGER REFERENCES users(id),
  count_token TEXT,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reseller_grants_owner
  ON reseller_code_grants(reseller_id,status,issued_at);
