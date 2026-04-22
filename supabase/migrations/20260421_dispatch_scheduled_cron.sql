-- ============================================================
-- 20260421_dispatch_scheduled_cron.sql
-- Schedule the 5-min cron that promotes auto-dispatch orders whose
-- scheduled_dispatch_at has arrived. POSTs to /api/cron/dispatch-scheduled
-- with the x-cron-secret header — reuses the same app.url + app.cron_secret
-- Postgres settings as migration 023.
-- ============================================================

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
  v_url    := current_setting('app.url', true);
  v_secret := current_setting('app.cron_secret', true);

  IF v_url IS NULL OR v_secret IS NULL OR v_url = '' OR v_secret = '' THEN
    RAISE EXCEPTION 'app.url and app.cron_secret must be set (ALTER DATABASE ... SET app.url = ...)';
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

SELECT cron.schedule(
  'dispatch-scheduled-5min',
  '*/5 * * * *',
  $$SELECT invoke_dispatch_scheduled()$$
);
