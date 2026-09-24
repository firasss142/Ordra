-- ============================================================
-- 20260906000002_pg_cron_meta_ads_sync.sql
-- Schedule the hourly Meta Ads spend sync.
--
-- WHY pg_cron and not Vercel: the Hobby plan caps crons at once per day, and a
-- sub-daily entry in vercel.json's `crons` key is rejected at config validation
-- — which does not fail the cron, it fails EVERY DEPLOYMENT. That happened once
-- already on the sheets sync (20260520000002) and silently broke auto-deploy
-- from main. Only vercel.json's `functions` key is safe to touch; it carries
-- the maxDuration for this route.
--
-- WHY minute 7: the five existing jobs sit on the minute boundary and on
-- */5, */10 and */15. Landing on :07 keeps this off every one of them, so a
-- slow Meta response never shares a pg_net worker with the carrier poll.
--
-- WHY hourly and not more often: the sync re-reads a rolling 7 days on every
-- run, so a missed tick heals itself. Meta restates spend for ~72h, which no
-- cadence can outrun — re-reading is the only correct answer, and re-reading
-- hourly is already far more current than the manual entry it replaces.
--
-- NON-GOALS: this schedules only. The route authenticates with x-cron-secret
-- and does all the work; the concurrency lock lives in ad_sync_runs.
-- ============================================================

CREATE OR REPLACE FUNCTION invoke_meta_ads_sync()
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
    url     := v_url || '/api/cron/meta-ads-sync',
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

GRANT EXECUTE ON FUNCTION invoke_meta_ads_sync() TO service_role;

-- Idempotent: unschedule any existing entry with the same name first so
-- re-running the migration does not pile up jobs.
DO $$
DECLARE
  v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'meta-ads-sync';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'meta-ads-sync',
  '7 * * * *',
  $sql$ SELECT invoke_meta_ads_sync(); $sql$
);

-- The sync-health strip has to be able to say "not scheduled" and be right.
-- cron.job lives outside the public schema so PostgREST cannot reach it; this
-- is the narrowest possible window onto it — one job name, two non-sensitive
-- columns. Without it the strip either omits the cadence or asserts an hourly
-- schedule it has not checked, and a strip that asserts is worse than none.
CREATE OR REPLACE FUNCTION meta_ads_cron_status()
RETURNS TABLE (schedule TEXT, active BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT j.schedule::TEXT, j.active
  FROM cron.job j
  WHERE j.jobname = 'meta-ads-sync';
$$;

GRANT EXECUTE ON FUNCTION meta_ads_cron_status() TO authenticated, service_role;

-- Verifying this actually ran is a two-step check, because pg_cron reports
-- "succeeded" for any job that merely handed a request to pg_net:
--   SELECT * FROM cron.job_run_details WHERE jobname = 'meta-ads-sync' ORDER BY start_time DESC LIMIT 5;
--   SELECT id, status_code, error_msg FROM net._http_response ORDER BY created DESC LIMIT 5;
--   SELECT * FROM ad_sync_runs ORDER BY started_at DESC LIMIT 5;
-- The third is the one that means the work happened.
