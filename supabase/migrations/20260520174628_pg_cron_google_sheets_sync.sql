-- Replaces the Vercel-cron-based Google Sheets sync with a pg_cron schedule.
-- The feat/excel-sheets-synchronization merge added a `crons` entry to
-- vercel.json ("*/15 * * * *"), but the Vercel Hobby plan caps crons at once
-- per day, so every deployment after the merge was REJECTED at config
-- validation (never built) — silently breaking auto-deploy from main.
--
-- Fix: drop the vercel.json cron and trigger the endpoint from pg_cron via
-- net.http_post, exactly like invoke_carrier_poll / invoke_dispatch_scheduled
-- (see 20260519000001_cron_secrets_from_vault.sql). Secrets come from Vault.
--
-- The HTTP route at /api/cron/google-sheets-sync still exists and is unchanged;
-- it authenticates with the x-cron-secret header.

CREATE OR REPLACE FUNCTION invoke_google_sheets_sync()
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
    url     := v_url || '/api/cron/google-sheets-sync',
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

GRANT EXECUTE ON FUNCTION invoke_google_sheets_sync() TO service_role;

-- Schedule every 15 minutes. Idempotent: unschedule any existing entry with
-- the same name first so re-running the migration doesn't pile up jobs.
DO $$
DECLARE
  v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'google-sheets-sync';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'google-sheets-sync',
  '*/15 * * * *',
  $sql$ SELECT invoke_google_sheets_sync(); $sql$
);
