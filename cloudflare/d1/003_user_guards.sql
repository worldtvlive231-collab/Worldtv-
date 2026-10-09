-- WORLD TV 003: enforce account role/status rules after a users table
-- was manually created in Cloudflare D1 without the original CHECK clauses.
-- Safe to run on an EMPTY users table; no rows are deleted or altered.
-- Triggers also work on databases whose table already has CHECK clauses.

CREATE TRIGGER IF NOT EXISTS trg_worldtv_users_validate_insert
BEFORE INSERT ON users
FOR EACH ROW
WHEN NEW.role IS NULL OR NEW.role NOT IN ('customer','admin')
  OR NEW.status IS NULL OR NEW.status NOT IN ('active','disabled')
BEGIN
  SELECT RAISE(ABORT, 'Invalid account role or status');
END;

CREATE TRIGGER IF NOT EXISTS trg_worldtv_users_validate_update
BEFORE UPDATE OF role, status ON users
FOR EACH ROW
WHEN NEW.role IS NULL OR NEW.role NOT IN ('customer','admin')
  OR NEW.status IS NULL OR NEW.status NOT IN ('active','disabled')
BEGIN
  SELECT RAISE(ABORT, 'Invalid account role or status');
END;
