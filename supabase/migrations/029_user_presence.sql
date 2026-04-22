-- Add presence tracking to users table
-- online: last_seen_at within 90s, idle: within 5min, offline: older

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON users (last_seen_at)
  WHERE last_seen_at IS NOT NULL;
