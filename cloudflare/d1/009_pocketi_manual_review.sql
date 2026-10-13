-- Staging-only Pocketi hosted-link manual review intake.
-- Untrusted customer references NEVER create paid orders or subscription codes.
-- Apply to fresh D1 after backup and review; DO NOT touch Railway.
CREATE TABLE IF NOT EXISTS pocketi_manual_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  provider_reference TEXT NOT NULL COLLATE NOCASE UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  reviewed_by INTEGER REFERENCES users(id),
  review_note TEXT,
  verified_amount_pesewas INTEGER CHECK (verified_amount_pesewas IS NULL OR verified_amount_pesewas > 0),
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  CHECK (
    (status='pending' AND reviewed_at IS NULL AND reviewed_by IS NULL AND verified_amount_pesewas IS NULL)
    OR
    (status='verified' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND verified_amount_pesewas IS NOT NULL)
    OR
    (status='rejected' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND verified_amount_pesewas IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_pocketi_manual_review_pending ON pocketi_manual_reports(status,submitted_at);
CREATE INDEX IF NOT EXISTS idx_pocketi_manual_review_customer ON pocketi_manual_reports(user_id,submitted_at);
