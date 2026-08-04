-- Minimal Supabase-compatible bootstrap so the migration set can be replayed
-- against a plain Postgres (no Docker, no Supabase CLI).
--
-- Usage:
--   createdb ordra_check
--   psql -d ordra_check -f supabase/tests/local-supabase-stub.sql
--   for f in supabase/migrations/*.sql; do psql -d ordra_check -v ON_ERROR_STOP=1 -f "$f"; done
--   psql -d ordra_check -f supabase/tests/validate-investor-domain.sql
--
-- Provides only the Supabase surface the migrations actually touch. pg_cron and
-- storage are stubbed rather than installed, so migrations that CREATE EXTENSION
-- pg_cron still fail — that is expected and environmental, not a defect.

CREATE SCHEMA IF NOT EXISTS net;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN; END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS cron;

CREATE TABLE IF NOT EXISTS auth.users (
  id                  UUID PRIMARY KEY,
  instance_id         UUID,
  aud                 TEXT,
  role                TEXT,
  email               TEXT,
  encrypted_password  TEXT,
  email_confirmed_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- Session helpers, backed by GUCs so a test can impersonate a user with
--   SET LOCAL request.jwt.claim.sub = '<uuid>';
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::JSONB, '{}'::JSONB);
$$;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY, name TEXT, public BOOLEAN DEFAULT false,
  file_size_limit BIGINT, allowed_mime_types TEXT[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bucket_id TEXT, name TEXT, owner UUID, metadata JSONB
);

CREATE OR REPLACE FUNCTION cron.schedule(TEXT, TEXT, TEXT) RETURNS BIGINT
LANGUAGE sql AS $$ SELECT 1::BIGINT $$;

CREATE OR REPLACE FUNCTION cron.unschedule(TEXT) RETURNS BOOLEAN
LANGUAGE sql AS $$ SELECT true $$;

CREATE OR REPLACE FUNCTION net.http_post(TEXT, JSONB, JSONB, JSONB, INT) RETURNS BIGINT
LANGUAGE sql AS $$ SELECT 1::BIGINT $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
