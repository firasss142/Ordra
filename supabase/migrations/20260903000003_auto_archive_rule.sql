-- ============================================================
-- The auto-archive rule: finished orders leave the working list after N days.
--
-- N lives in `settings` per market (key `auto_archive_after_days`), so it is
-- changeable without a deploy, and 0 or NULL turns the rule off for that market
-- while leaving manual archiving available.
--
-- The rule counts from `terminal_at` — when the order FINISHED — not from
-- `created_at`. An order rejected today is worth seeing for a month regardless
-- of how long ago the customer placed it.
--
-- This only ever sets `archived_at`. It never touches `status`, never writes
-- order_history, and no money or product calculation reads the column it writes
-- (verified: of 110 database functions, only the stamping trigger references
-- archived_at). Archiving is visibility and nothing else.
-- ============================================================

-- Default for both markets. Managers can change it per market from Settings.
INSERT INTO public.settings (market_id, key, value)
SELECT m.id, 'auto_archive_after_days', '30'::jsonb
FROM public.markets m
ON CONFLICT (market_id, key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.archive_finished_orders()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INT := 0;
  v_rows  INT;
  v_market RECORD;
  v_days  INT;
BEGIN
  FOR v_market IN SELECT id, name FROM public.markets LOOP
    SELECT NULLIF(value #>> '{}', '')::int
      INTO v_days
      FROM public.settings
     WHERE market_id = v_market.id AND key = 'auto_archive_after_days';

    -- Unset or 0 => the rule is off for this market. Manual archiving still works.
    CONTINUE WHEN v_days IS NULL OR v_days <= 0;

    UPDATE public.orders
       SET archived_at = now()
     WHERE market_id = v_market.id
       AND archived_at IS NULL
       AND terminal_at IS NOT NULL
       AND terminal_at < now() - make_interval(days => v_days);

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_total := v_total + v_rows;
  END LOOP;

  RETURN json_build_object('archived', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.archive_finished_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_finished_orders() TO service_role;

COMMENT ON FUNCTION public.archive_finished_orders() IS
  'Puts finished orders away once they are older than settings.auto_archive_after_days. Sets archived_at only — never status. Idempotent: re-running archives nothing new.';

-- Daily at 03:00 UTC — outside Libyan business hours. Idempotent (re)schedule,
-- following the pattern in 20260624000003_pg_cron_notifications.sql.
DO $cron$
DECLARE v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'auto-archive-finished-orders';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
  PERFORM cron.schedule(
    'auto-archive-finished-orders',
    '0 3 * * *',
    $sql$ SELECT public.archive_finished_orders(); $sql$
  );
END
$cron$;
