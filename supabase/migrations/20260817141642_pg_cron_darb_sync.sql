-- ============================================================
-- 20260909000005_pg_cron_darb_sync.sql
-- Schedule the Darb Assabil status sweep.
--
-- WHY this job needs to exist at all: Darb status had NO schedule. The only
-- trigger was a QueuePage mount in the browser (throttled to once per 10 min
-- per market), so overnight, weekends and holidays were dead zones for the
-- entire Libya market — the carrier moved parcels and the OMS never noticed.
-- Worse, the browser-triggered route made one HTTP call PER ORDER at
-- concurrency 3 with no maxDuration, so it was killed mid-sweep and different
-- orders were refreshed on different days. 68 orders were never caught up with
-- at all.
--
-- The new route pages the carrier's LIST endpoint at 500 records per request,
-- so a full mirror of BOTH accounts is ~3 HTTP calls. It fits in one tick with
-- room to spare, which is what makes a fixed schedule safe here.
--
-- WHY pg_cron and not Vercel: the Hobby plan rejects a sub-daily entry in
-- vercel.json's `crons` key at config validation — that does not fail the cron,
-- it fails EVERY DEPLOYMENT. Only the `functions` key is safe to touch; it
-- carries maxDuration for this route.
--
-- WHY minute 3, */10: the existing jobs sit on the minute boundary and on
-- */5, */10, */15 and :07. Offsetting to :03 keeps the Darb sweep off all of
-- them, so a slow vendor response never shares a pg_net worker with the
-- carrier poll or the sheets sync.
--
-- WHY a full sweep rather than delta: a missed tick heals itself completely,
-- and at ~3 requests there is nothing to save. Delta mode exists on the route
-- (?since=) for manual use.
--
-- NON-GOALS: this schedules only. The route authenticates with x-cron-secret;
-- per-run accounting lives in darb_sync_runs.
-- ============================================================

CREATE OR REPLACE FUNCTION invoke_darb_sync()
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
    url     := v_url || '/api/cron/darb-sync',
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

GRANT EXECUTE ON FUNCTION invoke_darb_sync() TO service_role;

-- Idempotent: drop any existing entry with the same name so re-running the
-- migration cannot pile up duplicate jobs.
DO $$
DECLARE
  v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'darb-sync-10min';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'darb-sync-10min',
  -- :03, :13, :23, :33, :43, :53 — every 10 min, offset off the other jobs.
  '3-59/10 * * * *',
  $sql$ SELECT invoke_darb_sync(); $sql$
);

-- Narrow, read-only window onto cron.job so the UI can honestly say
-- "not scheduled" instead of asserting a cadence it has not checked.
-- cron.job lives outside the public schema, so PostgREST cannot reach it.
CREATE OR REPLACE FUNCTION darb_cron_status()
RETURNS TABLE (schedule TEXT, active BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT j.schedule::TEXT, j.active
  FROM cron.job j
  WHERE j.jobname = 'darb-sync-10min';
$$;

GRANT EXECUTE ON FUNCTION darb_cron_status() TO authenticated, service_role;

-- Verifying this actually ran is a THREE-step check, because pg_cron reports
-- "succeeded" for any job that merely handed a request to pg_net — that false
-- green is exactly how the carrier poll stayed broken (HTTP 500 every 10 min)
-- without anyone noticing:
--   SELECT * FROM cron.job_run_details WHERE jobname = 'darb-sync-10min' ORDER BY start_time DESC LIMIT 5;
--   SELECT id, status_code, error_msg FROM net._http_response ORDER BY created DESC LIMIT 5;
--   SELECT * FROM darb_sync_runs ORDER BY started_at DESC LIMIT 5;
-- The third is the one that means the work happened.
