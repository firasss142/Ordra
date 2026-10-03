-- Journaux — retention and personal data (plans/journaux-redesign.md §3.4, decision 1:
-- 30 days for raw payloads, the recommended option).
--
-- ⚠ THIS FILE DELETES DATA. It is separate from the other journal migrations on
-- purpose: everything else works without it. Skip it to keep every raw row.
--
-- WHAT IT DOES
--   1. Folds carrier_event_log's history the way the new trigger folds new rows:
--      one row per (parcel, raw status, outcome, reason, source) with
--      repeat_count and last_seen_at, for refused/ignored events only. Processed
--      status changes are kept row by row. ≈ 900 000 Navex repeats → a few thousand.
--   2. journal_purge(), nightly at 03:30 UTC:
--        raw payloads (webhook bodies, carrier bodies, call excerpts)   30 days → NULL
--        refused sheet rows' raw_row, once resolved                      30 days → NULL
--        app_errors                                                      30 days
--        cron.job_run_details                                            30 days
--        integration_calls, job_runs                                     90 days
--        carrier_event_log                                              180 days
--      audit_events is kept (small, and the point of it).
--   3. webhook_delivery_log.payload becomes nullable: the NOT NULL made some
--      writers' rows fail silently, and the purge needs to clear it.

-- The fold below reads ~925 000 rows in production: give it room.
SET statement_timeout = '15min';

ALTER TABLE public.webhook_delivery_log ALTER COLUMN payload DROP NOT NULL;

-- 1. fold history ─────────────────────────────────────────────────────────────
WITH g AS (
  SELECT id,
         first_value(id) OVER w AS keeper,
         count(*) OVER w AS n,
         max(created_at) OVER w AS last_at
    FROM public.carrier_event_log
   WHERE outcome IN ('ignored', 'error') AND tracking_number IS NOT NULL
  WINDOW w AS (PARTITION BY carrier_code, tracking_number, carrier_status_raw, outcome, outcome_reason, source
               ORDER BY created_at, id
               ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
),
keepers AS (
  UPDATE public.carrier_event_log l
     SET repeat_count = g.n, last_seen_at = CASE WHEN g.n > 1 THEN g.last_at END
    FROM g
   WHERE l.id = g.id AND g.id = g.keeper AND g.n > 1
  RETURNING l.id
)
DELETE FROM public.carrier_event_log l
 USING g
 WHERE l.id = g.id AND g.id <> g.keeper;

-- 2. nightly purge ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.journal_purge()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v JSONB := '{}'::jsonb;
  n INT;
BEGIN
  UPDATE public.webhook_delivery_log SET payload = NULL
   WHERE payload IS NOT NULL AND created_at < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('webhook_payloads', n);

  UPDATE public.carrier_event_log SET raw_body = NULL
   WHERE raw_body IS NOT NULL AND created_at < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('carrier_bodies', n);

  UPDATE public.integration_calls SET request_excerpt = NULL, response_excerpt = NULL
   WHERE (request_excerpt IS NOT NULL OR response_excerpt IS NOT NULL) AND occurred_at < now() - interval '30 days';

  UPDATE public.sheet_sync_failed_rows SET raw_row = '{}'::jsonb
   WHERE resolved_at IS NOT NULL AND resolved_at < now() - interval '30 days' AND raw_row <> '{}'::jsonb;

  DELETE FROM public.app_errors WHERE occurred_at < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('app_errors', n);

  DELETE FROM public.integration_calls WHERE occurred_at < now() - interval '90 days';
  DELETE FROM public.job_runs WHERE started_at < now() - interval '90 days';

  DELETE FROM public.carrier_event_log WHERE COALESCE(last_seen_at, created_at) < now() - interval '180 days';
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('carrier_events', n);

  DELETE FROM cron.job_run_details WHERE start_time < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('cron_runs', n);

  RETURN v;
END $$;

REVOKE EXECUTE ON FUNCTION public.journal_purge() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('journal-purge-nightly', '30 3 * * *', $$ SELECT public.journal_purge(); $$);
