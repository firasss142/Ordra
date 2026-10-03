-- Journaux, phase 1 — outside calls, Ordra's own errors, run bookkeeping
-- (plans/journaux-redesign.md §3.2).
--
-- 1. integration_calls   every carrier upload, success or not. Until now a
--                        refused upload was written NOWHERE: the agent saw the
--                        error once and it was gone. Written by
--                        src/lib/journal/record-call.ts from performDispatch.
-- 2. app_errors          every API response ≥ 500 and every thrown handler,
--                        written by withRouteErrors(). Deactivating a user
--                        answered 500 for nine days (2026-09-24 → PR #59) and
--                        only Vercel's logs knew.
-- 3. job_runs            poll-carriers and dispatch-scheduled had no run table:
--                        pg_cron says « succeeded » as soon as the HTTP call is
--                        queued, whatever the route then did.
-- 4. carrier_event_log   repeats fold into one row (repeat_count, last_seen_at)
--                        instead of the same 139 Navex parcels rewritten every
--                        10 minutes (921 017 rows, 540 MB). carrier_id and
--                        market_id are filled from the order. source 'manual'
--                        is accepted (it was silently refused).
-- 5. journal_reap_runs() closes runs stuck in 'running' for more than 30 min
--                        (21 Darb runs since 2026-09-25) as failed · abandoned.
--
-- All three new tables: RLS on, read by super_admin only, written only by the
-- service role (which bypasses RLS). Purged by journal_purge() (retention
-- migration), never read by a browser directly — the Journaux routes call the
-- SECURITY DEFINER read functions.

-- ── 1. integration_calls ────────────────────────────────────────────────────
CREATE TABLE public.integration_calls (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  system            TEXT NOT NULL,
  connection_id     UUID,
  operation         TEXT NOT NULL CHECK (operation IN ('upload', 'void', 'bind', 'verify', 'quote', 'stock_read', 'send', 'test')),
  status            TEXT NOT NULL CHECK (status IN ('ok', 'error', 'timeout', 'refused')),
  http_status       INT,
  error_code        TEXT,
  message           TEXT,
  duration_ms       INT,
  attempt           INT NOT NULL DEFAULT 1,
  order_id          UUID,
  market_id         UUID REFERENCES public.markets(id),
  actor_id          UUID,
  fingerprint       TEXT,
  request_excerpt   JSONB,
  response_excerpt  JSONB
);
CREATE INDEX integration_calls_occurred_idx ON public.integration_calls (occurred_at DESC, id DESC);
CREATE INDEX integration_calls_order_idx    ON public.integration_calls (order_id, occurred_at) WHERE order_id IS NOT NULL;
CREATE INDEX integration_calls_failed_idx   ON public.integration_calls (status, occurred_at DESC) WHERE status <> 'ok';

-- ── 2. app_errors ───────────────────────────────────────────────────────────
CREATE TABLE public.app_errors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  route        TEXT NOT NULL,
  method       TEXT NOT NULL,
  status       INT NOT NULL,
  error_code   TEXT,
  message      TEXT,
  actor_id     UUID,
  market_id    UUID,
  request_id   TEXT,
  fingerprint  TEXT NOT NULL
);
CREATE INDEX app_errors_occurred_idx    ON public.app_errors (occurred_at DESC, id DESC);
CREATE INDEX app_errors_fingerprint_idx ON public.app_errors (fingerprint, occurred_at DESC);

-- ── 3. job_runs ─────────────────────────────────────────────────────────────
CREATE TABLE public.job_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job          TEXT NOT NULL CHECK (job IN ('poll-carriers', 'dispatch-scheduled')),
  status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'skipped')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  counters     JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed      INT NOT NULL DEFAULT 0,
  error        TEXT
);
CREATE INDEX job_runs_job_started_idx ON public.job_runs (job, started_at DESC);

DO $rls$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['integration_calls', 'app_errors', 'job_runs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.get_user_role()) = ''super_admin'')',
      t || '_select_super_admin', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated', t);
  END LOOP;
END $rls$;

-- ── 4. carrier_event_log: one row per change, not per poll ─────────────────
ALTER TABLE public.carrier_event_log
  ADD COLUMN IF NOT EXISTS carrier_id   UUID,
  ADD COLUMN IF NOT EXISTS market_id    UUID,
  ADD COLUMN IF NOT EXISTS repeat_count INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

ALTER TABLE public.carrier_event_log DROP CONSTRAINT IF EXISTS carrier_event_log_source_check;
ALTER TABLE public.carrier_event_log ADD CONSTRAINT carrier_event_log_source_check
  CHECK (source = ANY (ARRAY['poll', 'webhook', 'barcode_deletion', 'tracking_view', 'cron', 'reconcile', 'manual']));

CREATE INDEX IF NOT EXISTS idx_carrier_log_parcel_latest
  ON public.carrier_event_log (carrier_code, tracking_number, created_at DESC)
  WHERE tracking_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_carrier_log_order
  ON public.carrier_event_log (order_id, created_at) WHERE order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.carrier_event_log_fold_repeat()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prev RECORD;
BEGIN
  IF NEW.order_id IS NOT NULL AND (NEW.carrier_id IS NULL OR NEW.market_id IS NULL) THEN
    SELECT COALESCE(NEW.carrier_id, o.carrier_id), COALESCE(NEW.market_id, o.market_id)
      INTO NEW.carrier_id, NEW.market_id
      FROM public.orders o WHERE o.id = NEW.order_id;
  END IF;

  IF NEW.tracking_number IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, carrier_status_raw, outcome, outcome_reason, source
    INTO v_prev
    FROM public.carrier_event_log
   WHERE carrier_code = NEW.carrier_code
     AND tracking_number = NEW.tracking_number
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND
     AND v_prev.carrier_status_raw IS NOT DISTINCT FROM NEW.carrier_status_raw
     AND v_prev.outcome            IS NOT DISTINCT FROM NEW.outcome
     AND v_prev.outcome_reason     IS NOT DISTINCT FROM NEW.outcome_reason
     AND v_prev.source             IS NOT DISTINCT FROM NEW.source THEN
    UPDATE public.carrier_event_log
       SET repeat_count = repeat_count + 1,
           last_seen_at = now()
     WHERE id = v_prev.id;
    RETURN NULL;
  END IF;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.carrier_event_log_fold_repeat() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_carrier_event_log_fold_repeat
  BEFORE INSERT ON public.carrier_event_log
  FOR EACH ROW EXECUTE FUNCTION public.carrier_event_log_fold_repeat();

-- ── 5. stuck runs ───────────────────────────────────────────────────────────
-- 'running' for more than 30 minutes is not running: the function died, the
-- deploy rolled over it, or the timeout killed it before it could write.
CREATE OR REPLACE FUNCTION public.journal_reap_runs()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_n INT := 0;
  v_rows INT;
  v_msg CONSTANT TEXT := 'abandonné : resté « en cours » plus de 30 min';
BEGIN
  UPDATE public.darb_sync_runs SET status = 'failed', finished_at = now(),
         error_message = COALESCE(error_message, v_msg)
   WHERE status = 'running' AND started_at < now() - interval '30 minutes';
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_n := v_n + v_rows;

  UPDATE public.darb_rate_harvest_runs SET status = 'failed', finished_at = now(),
         notes = COALESCE(notes, v_msg)
   WHERE status = 'running' AND started_at < now() - interval '30 minutes';
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_n := v_n + v_rows;

  UPDATE public.sheet_sync_runs SET status = 'failed', finished_at = now(), error = COALESCE(error, v_msg)
   WHERE status = 'running' AND started_at < now() - interval '30 minutes';
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_n := v_n + v_rows;

  UPDATE public.ad_sync_runs SET status = 'failed', finished_at = now(), error = COALESCE(error, v_msg)
   WHERE status = 'running' AND started_at < now() - interval '30 minutes';
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_n := v_n + v_rows;

  UPDATE public.investor_rollup_runs SET status = 'failed', finished_at = now(), error = COALESCE(error, v_msg)
   WHERE status = 'running' AND started_at < now() - interval '30 minutes';
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_n := v_n + v_rows;

  UPDATE public.whatsapp_outbox_runs SET status = 'failed', finished_at = now(), error = COALESCE(error, v_msg)
   WHERE status = 'running' AND started_at < now() - interval '30 minutes';
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_n := v_n + v_rows;

  UPDATE public.job_runs SET status = 'failed', finished_at = now(), error = COALESCE(error, v_msg)
   WHERE status = 'running' AND started_at < now() - interval '30 minutes';
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_n := v_n + v_rows;

  RETURN v_n;
END $$;

REVOKE EXECUTE ON FUNCTION public.journal_reap_runs() FROM PUBLIC, anon, authenticated;
