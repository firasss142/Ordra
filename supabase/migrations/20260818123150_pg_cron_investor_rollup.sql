-- ============================================================
-- 20260920000003_pg_cron_investor_rollup.sql
-- Schedule the investor v2 rollup.
--
-- The v1 rollup route existed but was NEVER scheduled (no cron.schedule entry,
-- no vercel.json crons) — which is why production's daily table was empty and
-- the walkthrough ran it 62 times by hand. This fixes that at the root.
--
-- Two jobs:
--   investor-rollup-15min   '4-59/15 * * * *'  → incremental (changed orders,
--                           late Darb billing, last-7-day ad restatement, deal
--                           snapshots). :04 is free of the existing :00/:03/:05/
--                           :07/:08/:10/:15 offsets, so it never shares a pg_net
--                           worker with the carrier poll or the Meta sync.
--   investor-rollup-nightly '41 2 * * *'       → full recompute, one bounded
--                           HTTP call per product that has a non-closed deal.
--
-- Same mechanics as 20260906000002 (vault app_url + cron_secret, pg_net,
-- x-cron-secret). The route holds the concurrency claim (investor_rollup_runs).
-- ============================================================

CREATE OR REPLACE FUNCTION invoke_investor_rollup(
  p_mode TEXT DEFAULT 'incremental',
  p_product_id UUID DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
  v_req_id BIGINT;
  v_qs     TEXT;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'app_url';

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'cron_secret';

  IF v_url IS NULL OR v_secret IS NULL OR v_url = '' OR v_secret = '' THEN
    RAISE EXCEPTION 'vault secrets app_url and cron_secret must be set';
  END IF;

  v_qs := '?mode=' || COALESCE(p_mode, 'incremental');
  IF p_product_id IS NOT NULL THEN
    v_qs := v_qs || '&product_id=' || p_product_id::text;
  END IF;

  SELECT net.http_post(
    url     := v_url || '/api/cron/investor-rollup' || v_qs,
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

GRANT EXECUTE ON FUNCTION invoke_investor_rollup(TEXT, UUID) TO service_role;

DO $$
DECLARE
  v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'investor-rollup-15min';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'investor-rollup-nightly';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
END $$;

SELECT cron.schedule(
  'investor-rollup-15min',
  '4-59/15 * * * *',
  $sql$ SELECT invoke_investor_rollup('incremental', NULL); $sql$
);

SELECT cron.schedule(
  'investor-rollup-nightly',
  '41 2 * * *',
  $sql$
    SELECT invoke_investor_rollup('full', p.product_id)
    FROM (SELECT DISTINCT product_id FROM investor_deals WHERE status <> 'closed') p;
  $sql$
);

-- Health strip needs to say "scheduled / not scheduled" and be right.
CREATE OR REPLACE FUNCTION investor_rollup_cron_status()
RETURNS TABLE (jobname TEXT, schedule TEXT, active BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT j.jobname::TEXT, j.schedule::TEXT, j.active
  FROM cron.job j
  WHERE j.jobname IN ('investor-rollup-15min', 'investor-rollup-nightly')
  ORDER BY j.jobname;
$$;

GRANT EXECUTE ON FUNCTION investor_rollup_cron_status() TO authenticated, service_role;

-- Verify (three steps — pg_cron "succeeded" only means the request was handed
-- to pg_net):
--   SELECT * FROM cron.job_run_details WHERE jobname LIKE 'investor-rollup%' ORDER BY start_time DESC LIMIT 5;
--   SELECT id, status_code, error_msg FROM net._http_response ORDER BY created DESC LIMIT 5;
--   SELECT * FROM investor_rollup_runs ORDER BY started_at DESC LIMIT 5;
