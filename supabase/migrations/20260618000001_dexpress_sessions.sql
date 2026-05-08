-- ============================================================
-- 20260618000001_dexpress_sessions.sql
-- Cache for the Dexpress merchant portal session cookie.
--
-- Dexpress has no API. We drive their Laravel portal by simulating
-- a browser session: login once, reuse the laravel_session cookie
-- across order submissions until it expires (2h).
--
-- One row per Dexpress carrier. PK = carrier_id. Service-role only:
-- the adapter uses createAdminClient() to read/write this table.
-- ============================================================

CREATE TABLE IF NOT EXISTS dexpress_sessions (
  carrier_id      UUID PRIMARY KEY REFERENCES carriers(id) ON DELETE CASCADE,
  laravel_session TEXT NOT NULL,
  xsrf_token      TEXT,
  csrf_token      TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dexpress_sessions ENABLE ROW LEVEL SECURITY;

-- No policies → only service_role bypasses RLS. End-users (authenticated, anon)
-- have no access by design. The cookie is a credential; treat it like one.
REVOKE ALL ON dexpress_sessions FROM authenticated;
REVOKE ALL ON dexpress_sessions FROM anon;

CREATE OR REPLACE FUNCTION dexpress_sessions_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dexpress_sessions_updated_at ON dexpress_sessions;
CREATE TRIGGER dexpress_sessions_updated_at
  BEFORE UPDATE ON dexpress_sessions
  FOR EACH ROW EXECUTE FUNCTION dexpress_sessions_set_updated_at();
