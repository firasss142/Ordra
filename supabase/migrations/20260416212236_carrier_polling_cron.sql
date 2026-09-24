-- ============================================================
-- 023_carrier_polling_cron.sql
-- Enable pg_cron + pg_net, schedule a 10-min carrier polling job.
-- The job POSTs to /api/cron/poll-carriers with the CRON_SECRET header.
-- APP_URL + CRON_SECRET are expected in Postgres app.* settings (set by ops).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Helper function so the cron body stays terse and secrets are centralized.
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
  v_url    := current_setting('app.url', true);
  v_secret := current_setting('app.cron_secret', true);

  IF v_url IS NULL OR v_secret IS NULL OR v_url = '' OR v_secret = '' THEN
    RAISE EXCEPTION 'app.url and app.cron_secret must be set (ALTER DATABASE ... SET app.url = ...)';
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

-- Schedule: every 10 minutes
SELECT cron.schedule(
  'carrier-polling-10min',
  '*/10 * * * *',
  $$SELECT invoke_carrier_poll()$$
);

-- Deploy checklist (run once, manually, after migration):
--   ALTER DATABASE postgres SET app.url         = 'https://oms.example.com';
--   ALTER DATABASE postgres SET app.cron_secret = '<same as CRON_SECRET env var>';
