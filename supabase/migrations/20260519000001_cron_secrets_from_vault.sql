-- ============================================================
-- 20260519000001_cron_secrets_from_vault.sql
-- Read pg_cron HTTP-invoker secrets from Supabase Vault.
--
-- Background: invoke_carrier_poll (migration 023) and
-- invoke_dispatch_scheduled (migration 20260421_dispatch_scheduled_cron)
-- read app.url + app.cron_secret via current_setting(). Setting those
-- requires ALTER DATABASE, which on managed Supabase needs SUPERUSER --
-- not granted to project owners. The result: both crons have failed
-- every tick since deploy with "app.url and app.cron_secret must be set".
--
-- Fix: stash the values in vault.secrets (as 'app_url' and 'cron_secret')
-- and rewrite both invoke_* functions to read from vault.decrypted_secrets.
-- Both functions remain SECURITY DEFINER so they retain access to vault.
-- ============================================================

CREATE OR REPLACE FUNCTION invoke_carrier_poll()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
  v_req_id BIGINT;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'app_url';

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'cron_secret';

  IF v_url IS NULL OR v_secret IS NULL OR v_url = '' OR v_secret = '' THEN
    RAISE EXCEPTION 'vault secrets app_url and cron_secret must be set';
  END IF;

  SELECT net.http_post(
    url     := v_url || '/api/cron/poll-carriers',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) INTO v_req_id;

  RETURN v_req_id;
END;
$$;

CREATE OR REPLACE FUNCTION invoke_dispatch_scheduled()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
  v_req_id BIGINT;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'app_url';

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'cron_secret';

  IF v_url IS NULL OR v_secret IS NULL OR v_url = '' OR v_secret = '' THEN
    RAISE EXCEPTION 'vault secrets app_url and cron_secret must be set';
  END IF;

  SELECT net.http_post(
    url     := v_url || '/api/cron/dispatch-scheduled',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) INTO v_req_id;

  RETURN v_req_id;
END;
$$;
