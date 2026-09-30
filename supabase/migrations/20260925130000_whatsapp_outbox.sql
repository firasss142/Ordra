-- ============================================================
-- 20260925130000_whatsapp_outbox.sql
-- WhatsApp — automatic lifecycle notifications (plan Phase 4).
--
-- WHY: an order changing status is the moment the customer wants to hear from
-- us ("your parcel is on its way", "we could not reach you"), and today nobody
-- writes those messages. Sending from inside the status trigger is out of the
-- question — a Graph call inside an order UPDATE would make every carrier
-- sync as slow as Meta and every Meta outage an order-write outage. So the
-- trigger only ENQUEUES, cheaply and idempotently, and a pg_cron job drains
-- the queue through the Vercel route that owns the Graph client.
--
-- WHAT:
--   whatsapp_outbox            one row per (order, event); paced by not_before
--   whatsapp_outbox_runs       the drain's audit + "one in flight" lock
--   whatsapp_outbox_claim()    FOR UPDATE SKIP LOCKED batch claim, service_role only
--   whatsapp_setting_bool/text the settings reads the trigger and the slot need
--   whatsapp_next_send_slot()  defers a send outside the market's send window
--   whatsapp_enqueue_lifecycle trigger AFTER UPDATE OF status ON orders
--   invoke_whatsapp_outbox()   pg_net → /api/cron/whatsapp-outbox, every minute
--                              but only when something is due
--   whatsapp_outbox_cron_status() the Connexions card's honest "scheduled?"
--
-- Every settings key involved defaults OFF: nothing is sent until a manager
-- turns the master switch AND one event on, per market.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. whatsapp_outbox
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id       uuid NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('lifecycle', 'campaign')),
  -- lifecycle:<order_id>:<event_key> | campaign:<campaign_id>:<lead_id>
  dedupe_key      text NOT NULL UNIQUE,
  phone_e164      text NOT NULL,
  customer_id     uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  order_id        uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  lead_id         uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  campaign_id     uuid REFERENCES public.prospect_campaigns(id) ON DELETE SET NULL,
  event_key       text,
  language        text NOT NULL CHECK (language IN ('ar', 'fr')),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 6,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  -- Send window / campaign pacing. NULL = as soon as possible.
  not_before      timestamptz,
  locked_at       timestamptz,
  run_id          uuid,
  last_error_code integer,
  last_error      text,
  skip_reason     text,
  message_id      uuid REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_outbox_drain_idx
  ON public.whatsapp_outbox (next_attempt_at, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS whatsapp_outbox_stale_idx
  ON public.whatsapp_outbox (locked_at) WHERE status = 'sending';
CREATE INDEX IF NOT EXISTS whatsapp_outbox_phone_idx
  ON public.whatsapp_outbox (phone_e164, status);
CREATE INDEX IF NOT EXISTS whatsapp_outbox_campaign_idx
  ON public.whatsapp_outbox (campaign_id, status) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_outbox_order_idx
  ON public.whatsapp_outbox (order_id) WHERE order_id IS NOT NULL;

ALTER TABLE public.whatsapp_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_outbox_select ON public.whatsapp_outbox;
CREATE POLICY whatsapp_outbox_select ON public.whatsapp_outbox
  FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR ((SELECT public.get_user_role()) = 'market_manager'
        AND market_id = (SELECT public.get_user_market_id()))
  );

REVOKE ALL ON public.whatsapp_outbox FROM anon;
REVOKE ALL ON public.whatsapp_outbox FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.whatsapp_outbox FROM authenticated;
GRANT SELECT ON public.whatsapp_outbox TO authenticated;

DROP TRIGGER IF EXISTS trg_whatsapp_outbox_updated_at ON public.whatsapp_outbox;
CREATE TRIGGER trg_whatsapp_outbox_updated_at
  BEFORE UPDATE ON public.whatsapp_outbox
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- The log row now points back at the queue row that produced it.
ALTER TABLE public.whatsapp_messages
  DROP CONSTRAINT IF EXISTS whatsapp_messages_outbox_id_fkey;
ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_outbox_id_fkey
  FOREIGN KEY (outbox_id) REFERENCES public.whatsapp_outbox(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. whatsapp_outbox_runs — audit + lock
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_outbox_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger     text NOT NULL CHECK (trigger IN ('cron', 'manual')),
  status      text NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'skipped_locked')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  claimed     integer NOT NULL DEFAULT 0,
  sent        integer NOT NULL DEFAULT 0,
  failed      integer NOT NULL DEFAULT 0,
  skipped     integer NOT NULL DEFAULT 0,
  deferred    integer NOT NULL DEFAULT 0,
  released    integer NOT NULL DEFAULT 0,
  error       text
);

-- One drain at a time. A plain INSERT whose 23505 the route catches.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_outbox_runs_one_in_flight
  ON public.whatsapp_outbox_runs (status) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS whatsapp_outbox_runs_started_idx
  ON public.whatsapp_outbox_runs (started_at DESC);

ALTER TABLE public.whatsapp_outbox_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_outbox_runs_select ON public.whatsapp_outbox_runs;
CREATE POLICY whatsapp_outbox_runs_select ON public.whatsapp_outbox_runs
  FOR SELECT TO authenticated
  USING ((SELECT public.get_user_role()) IN ('super_admin', 'market_manager'));
REVOKE ALL ON public.whatsapp_outbox_runs FROM anon;
REVOKE ALL ON public.whatsapp_outbox_runs FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.whatsapp_outbox_runs FROM authenticated;
GRANT SELECT ON public.whatsapp_outbox_runs TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. whatsapp_outbox_claim — the batch claim
-- ─────────────────────────────────────────────────────────────
-- FOR UPDATE SKIP LOCKED so two drains that overlap (a slow tick, a manual
-- run) never send the same row; `attempts` counts at claim time so a crash
-- between claim and send still burns an attempt.
CREATE OR REPLACE FUNCTION public.whatsapp_outbox_claim(p_run_id uuid, p_limit integer DEFAULT 120)
RETURNS SETOF public.whatsapp_outbox
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH picked AS (
    SELECT o.id
      FROM public.whatsapp_outbox o
     WHERE o.status = 'queued'
       AND o.next_attempt_at <= now()
       AND (o.not_before IS NULL OR o.not_before <= now())
     ORDER BY o.next_attempt_at, o.created_at
     LIMIT GREATEST(1, LEAST(p_limit, 500))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.whatsapp_outbox o
     SET status = 'sending',
         locked_at = now(),
         run_id = p_run_id,
         attempts = o.attempts + 1,
         updated_at = now()
    FROM picked
   WHERE o.id = picked.id
  RETURNING o.*;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_outbox_claim(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_outbox_claim(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_outbox_claim(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_outbox_claim(uuid, integer) TO service_role;

-- ─────────────────────────────────────────────────────────────
-- 4. settings reads
-- ─────────────────────────────────────────────────────────────
-- settings.value is {"value": <json>} for scalars (the settings route wraps them).
CREATE OR REPLACE FUNCTION public.whatsapp_setting_bool(p_market uuid, p_key text, p_default boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT CASE
              WHEN jsonb_typeof(s.value) = 'boolean' THEN (s.value)::text::boolean
              WHEN jsonb_typeof(s.value -> 'value') = 'boolean' THEN (s.value -> 'value')::text::boolean
              WHEN (s.value ->> 'value') IN ('true', 'false') THEN (s.value ->> 'value')::boolean
              ELSE NULL
            END
       FROM public.settings s
      WHERE s.market_id = p_market AND s.key = p_key
      LIMIT 1),
    p_default);
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_setting_text(p_market uuid, p_key text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT NULLIF(
    (SELECT CASE
              WHEN jsonb_typeof(s.value) = 'string' THEN s.value #>> '{}'
              ELSE s.value ->> 'value'
            END
       FROM public.settings s
      WHERE s.market_id = p_market AND s.key = p_key
      LIMIT 1),
    '');
$$;

REVOKE ALL ON FUNCTION public.whatsapp_setting_bool(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.whatsapp_setting_text(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_setting_bool(uuid, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_setting_text(uuid, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 5. whatsapp_next_send_slot — the market's send window
-- ─────────────────────────────────────────────────────────────
-- `whatsapp_send_window` is "HH-HH" in the market's local time ("10-20"),
-- the same shape as a campaign's wa_window. Outside it a send waits for the
-- window to open — Darb syncs at night and nobody should be woken at 03:00.
CREATE OR REPLACE FUNCTION public.whatsapp_next_send_slot(p_market uuid, p_at timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_window text;
  v_start  integer;
  v_end    integer;
  v_tz     text;
  v_local  timestamp;
  v_hour   numeric;
  v_day    timestamp;
BEGIN
  v_window := public.whatsapp_setting_text(p_market, 'whatsapp_send_window');
  IF v_window IS NULL OR v_window !~ '^\d{1,2}-\d{1,2}$' THEN
    RETURN p_at;
  END IF;
  v_start := split_part(v_window, '-', 1)::integer;
  v_end   := split_part(v_window, '-', 2)::integer;
  IF v_start < 0 OR v_start > 23 OR v_end < 1 OR v_end > 24 OR v_start >= v_end THEN
    RETURN p_at;
  END IF;

  SELECT CASE m.code WHEN 'ly' THEN 'Africa/Tripoli' ELSE 'Africa/Tunis' END
    INTO v_tz FROM public.markets m WHERE m.id = p_market;
  v_tz := COALESCE(v_tz, 'Africa/Tunis');

  v_local := p_at AT TIME ZONE v_tz;
  v_hour  := extract(hour FROM v_local) + extract(minute FROM v_local) / 60.0;
  v_day   := date_trunc('day', v_local);

  IF v_hour >= v_start AND v_hour < v_end THEN
    RETURN p_at;
  ELSIF v_hour < v_start THEN
    RETURN (v_day + make_interval(hours => v_start)) AT TIME ZONE v_tz;
  ELSE
    RETURN (v_day + interval '1 day' + make_interval(hours => v_start)) AT TIME ZONE v_tz;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_next_send_slot(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_next_send_slot(uuid, timestamptz) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 6. the trigger — enqueue, never send
-- ─────────────────────────────────────────────────────────────
-- Same shape as orders_broadcast_change(): SECURITY DEFINER, empty
-- search_path, the whole body inside BEGIN…EXCEPTION so it can never fail an
-- order write. AFTER UPDATE OF status keeps it free on the Darb sweep, which
-- rewrites carrier columns on every order every ten minutes.
CREATE OR REPLACE FUNCTION public.whatsapp_enqueue_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code     text;
  v_event    text;
  v_status   text := NEW.status::text;
  v_cust     RECORD;
  v_phone    text;
  v_lang     text;
  v_slot     timestamptz;
BEGIN
  BEGIN
    -- Cheapest guard first: a market without a live number has nothing to do.
    IF NOT EXISTS (SELECT 1 FROM public.whatsapp_configs c WHERE c.market_id = NEW.market_id AND c.status = 'active') THEN
      RETURN NULL;
    END IF;
    IF NOT public.whatsapp_setting_bool(NEW.market_id, 'whatsapp_lifecycle_enabled', false) THEN
      RETURN NULL;
    END IF;

    SELECT m.code INTO v_code FROM public.markets m WHERE m.id = NEW.market_id;

    v_event := CASE
      WHEN v_status IN ('attempt_1', 'attempt_2', 'attempt_3') THEN 'could_not_reach'
      WHEN v_code = 'tn' AND v_status = 'dispatched' THEN 'shipped'
      WHEN v_code = 'ly' AND v_status IN ('scanned', 'at_carrier') THEN 'shipped'
      WHEN v_status = 'out_for_delivery' THEN 'out_for_delivery'
      WHEN v_code = 'tn' AND v_status = 'returning' THEN 'last_chance'
      WHEN v_code = 'ly' AND v_status IN ('delivery_delayed', 'returning') THEN 'last_chance'
      WHEN v_status = 'delivered' THEN 'delivered'
      ELSE NULL
    END;
    IF v_event IS NULL THEN
      RETURN NULL;
    END IF;
    IF NOT public.whatsapp_setting_bool(NEW.market_id, 'whatsapp_event_' || v_event, false) THEN
      RETURN NULL;
    END IF;

    -- The customer's memory: language, and the two brakes.
    SELECT c.id, c.whatsapp_language, c.whatsapp_opted_out_at, c.whatsapp_undeliverable_at
      INTO v_cust
      FROM public.customers c
     WHERE c.id = NEW.customer_id
        OR (NEW.customer_id IS NULL AND c.market_id = NEW.market_id
            AND c.phone_normalized = public.normalize_phone(NEW.customer_phone))
     LIMIT 1;
    IF v_cust.id IS NOT NULL AND (v_cust.whatsapp_opted_out_at IS NOT NULL OR v_cust.whatsapp_undeliverable_at IS NOT NULL) THEN
      RETURN NULL;
    END IF;

    v_phone := COALESCE(public.whatsapp_e164(NEW.customer_phone, v_code), public.whatsapp_e164(NEW.customer_phone_2, v_code));
    IF v_phone IS NULL THEN
      RETURN NULL;
    END IF;

    v_lang := COALESCE(
      v_cust.whatsapp_language,
      public.whatsapp_setting_text(NEW.market_id, 'whatsapp_default_language'),
      (SELECT m.language FROM public.markets m WHERE m.id = NEW.market_id),
      'fr');
    IF v_lang NOT IN ('ar', 'fr') THEN v_lang := 'fr'; END IF;

    v_slot := public.whatsapp_next_send_slot(NEW.market_id, now());

    -- Once per (order, event): the second attempt, the second Darb status that
    -- means "shipped", the replayed webhook — all land on the same key.
    INSERT INTO public.whatsapp_outbox
      (market_id, kind, dedupe_key, phone_e164, customer_id, order_id, event_key, language, payload, not_before, next_attempt_at)
    VALUES
      (NEW.market_id, 'lifecycle', 'lifecycle:' || NEW.id::text || ':' || v_event, v_phone, v_cust.id, NEW.id, v_event, v_lang,
       jsonb_build_object('status', v_status, 'previous_status', OLD.status::text),
       v_slot, v_slot)
    ON CONFLICT (dedupe_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'whatsapp_enqueue_lifecycle: % (order %)', SQLERRM, NEW.id;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_enqueue_lifecycle() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_orders_whatsapp_enqueue ON public.orders;
CREATE TRIGGER trg_orders_whatsapp_enqueue
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.whatsapp_enqueue_lifecycle();

-- ─────────────────────────────────────────────────────────────
-- 7. the drain's cron: every minute, but only when something is due
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invoke_whatsapp_outbox()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
  v_req_id BIGINT;
BEGIN
  -- Nothing due and nothing stuck: no HTTP call at all. Most minutes end here.
  IF NOT EXISTS (
       SELECT 1 FROM public.whatsapp_outbox o
        WHERE (o.status = 'queued' AND o.next_attempt_at <= now() AND (o.not_before IS NULL OR o.not_before <= now()))
           OR (o.status = 'sending' AND o.locked_at < now() - interval '5 minutes')
        LIMIT 1) THEN
    RETURN 0;
  END IF;

  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'app_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF v_url IS NULL OR v_secret IS NULL OR v_url = '' OR v_secret = '' THEN
    RAISE EXCEPTION 'vault secrets app_url and cron_secret must be set';
  END IF;

  SELECT net.http_post(
    url     := v_url || '/api/cron/whatsapp-outbox',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) INTO v_req_id;
  RETURN v_req_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_whatsapp_outbox() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_whatsapp_outbox() TO service_role;

DO $$
DECLARE v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'whatsapp-outbox-1min';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
END $$;

SELECT cron.schedule('whatsapp-outbox-1min', '* * * * *', $sql$ SELECT public.invoke_whatsapp_outbox(); $sql$);

CREATE OR REPLACE FUNCTION public.whatsapp_outbox_cron_status()
RETURNS TABLE (schedule TEXT, active BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT j.schedule::TEXT, j.active FROM cron.job j WHERE j.jobname = 'whatsapp-outbox-1min';
$$;
-- Read only by the Connexions config route through the service role.
REVOKE ALL ON FUNCTION public.whatsapp_outbox_cron_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_outbox_cron_status() TO service_role;

COMMENT ON TABLE public.whatsapp_outbox IS
  'Queued WhatsApp sends (lifecycle + campaign). Filled by whatsapp_enqueue_lifecycle / whatsapp_enqueue_campaign, drained by /api/cron/whatsapp-outbox.';
