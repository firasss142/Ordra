-- Soft-delete column on users.
-- A true SQL DELETE is not feasible: multiple tables (user_audit_log.target_id,
-- warehouse_print_log.printed_by, products.created_by, …) hold NOT NULL FKs to
-- users(id) with no ON DELETE clause. Soft-delete preserves every historical
-- reference while preventing login (the auth.users row is removed by the API).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_deleted_at_idx
  ON users(deleted_at)
  WHERE deleted_at IS NOT NULL;
