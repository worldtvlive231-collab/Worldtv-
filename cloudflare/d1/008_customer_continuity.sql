-- Approved existing-customer entitlement bridge. Passwords are never imported.
-- Email and Railway record identifiers are stored only as keyed HMAC digests.

CREATE TABLE IF NOT EXISTS continuity_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_reference TEXT NOT NULL UNIQUE,
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  entry_count INTEGER NOT NULL CHECK (entry_count BETWEEN 1 AND 50),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS continuity_entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES continuity_import_batches(id),
  source_system TEXT NOT NULL DEFAULT 'railway' CHECK (source_system = 'railway'),
  source_record_digest TEXT NOT NULL UNIQUE,
  email_hash TEXT NOT NULL,
  plan_slug TEXT NOT NULL REFERENCES plans(slug),
  source_ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'eligible'
    CHECK (status IN ('eligible','claimed','revoked')),
  claimed_user_id INTEGER REFERENCES users(id),
  claim_token TEXT UNIQUE,
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_continuity_email_status
  ON continuity_entitlements(email_hash,status,source_ends_at);
