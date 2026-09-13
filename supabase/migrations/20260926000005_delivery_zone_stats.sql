-- ============================================================
-- 20260926000005_delivery_zone_stats.sql
-- Per-destination delivery rate, so "this zone loses parcels" is a fact.
--
-- WHY: one of the three risk inputs for the proactive call is "the destination
-- has a low delivery rate". Computing that per row at query time means scanning
-- 90 days of finished orders for every parcel in the worklist. It is a nightly
-- aggregate instead.
--
-- ZONE KEY, in order of preference: darb:<destination_id>, city:<city_id>,
-- name:<lower(customer_city)>. Measured on production before choosing: of 609
-- finished orders in the last 90 days only 17 carry darb_destination_id and
-- ZERO carry city_id, while the city name covers 59 of 74 distinct zones. The
-- name fallback is therefore not a fallback in practice — it is the key that
-- works — but the id forms stay first so the aggregate sharpens by itself as
-- destination binding spreads.
--
-- HONEST STATE OF THE SIGNAL (2026-09-26): with the shipped defaults
-- (zone_min_sample 20, zone_low_delivery_rate_pct 60) exactly 5 zones have a
-- large enough sample and NONE is under 60 % — the worst, بنغازي, delivers
-- 71.9 % (100/139). So `low_zone` fires on nothing today. That is the correct
-- outcome, not a broken one: the threshold exists so a manager can raise it
-- when a zone really does start losing parcels, and the table is what makes
-- that visible. The other two risk inputs (repeat-risk customer, high value)
-- carry the feature until then.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.delivery_zone_stats (
  market_id        uuid NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  zone_key         text NOT NULL,
  zone_label       text,
  delivered_count  integer NOT NULL DEFAULT 0,
  returned_count   integer NOT NULL DEFAULT 0,
  sample           integer NOT NULL DEFAULT 0,
  delivery_rate    numeric(5,4) NOT NULL DEFAULT 0,
  window_days      integer NOT NULL DEFAULT 90,
  computed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market_id, zone_key)
);

COMMENT ON TABLE public.delivery_zone_stats IS
  'Nightly per-destination delivery rate over a rolling window. Read by evaluate_delivery_risk.';
COMMENT ON COLUMN public.delivery_zone_stats.delivery_rate IS
  'delivered / (delivered + returned), 0..1. Only trustworthy once `sample` >= zone_min_sample.';

ALTER TABLE public.delivery_zone_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delivery_zone_stats_select ON public.delivery_zone_stats;
CREATE POLICY delivery_zone_stats_select ON public.delivery_zone_stats
  FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'super_admin'
    OR market_id = public.get_user_market_id()
  );

-- ── The zone key, in one place ──────────────────────────────────────────────
-- Both the refresh and the risk read must key identically or a parcel would
-- look up a row that was never written for it.

CREATE OR REPLACE FUNCTION public.delivery_zone_key(
  p_darb_destination_id text,
  p_city_id             uuid,
  p_customer_city       text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN NULLIF(btrim(COALESCE(p_darb_destination_id, '')), '') IS NOT NULL
      THEN 'darb:' || btrim(p_darb_destination_id)
    WHEN p_city_id IS NOT NULL
      THEN 'city:' || p_city_id::text
    WHEN NULLIF(btrim(COALESCE(p_customer_city, '')), '') IS NOT NULL
      THEN 'name:' || lower(btrim(p_customer_city))
    ELSE NULL
  END;
$$;

-- ── Refresh ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_delivery_zone_stats(p_window_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows integer;
BEGIN
  WITH finished AS (
    SELECT o.market_id,
           public.delivery_zone_key(
             o.darb_destination_id::text, o.city_id, o.customer_city) AS zone_key,
           NULLIF(btrim(COALESCE(o.customer_city, '')), '')           AS label,
           o.status::text                                             AS st
    FROM public.orders o
    WHERE o.status IN ('delivered', 'returned')
      AND o.terminal_at IS NOT NULL
      AND o.terminal_at >= now() - make_interval(days => p_window_days)
      AND o.market_id IS NOT NULL
  ),
  agg AS (
    SELECT market_id,
           zone_key,
           mode() WITHIN GROUP (ORDER BY label) AS zone_label,
           count(*) FILTER (WHERE st = 'delivered')::integer AS delivered_count,
           count(*) FILTER (WHERE st = 'returned')::integer  AS returned_count,
           count(*)::integer                                 AS sample
    FROM finished
    WHERE zone_key IS NOT NULL
    GROUP BY market_id, zone_key
  )
  INSERT INTO public.delivery_zone_stats AS z (
    market_id, zone_key, zone_label, delivered_count, returned_count,
    sample, delivery_rate, window_days, computed_at)
  SELECT market_id, zone_key, zone_label, delivered_count, returned_count, sample,
         CASE WHEN sample > 0
              THEN round(delivered_count::numeric / sample::numeric, 4)
              ELSE 0 END,
         p_window_days, now()
  FROM agg
  ON CONFLICT (market_id, zone_key) DO UPDATE
    SET zone_label      = EXCLUDED.zone_label,
        delivered_count = EXCLUDED.delivered_count,
        returned_count  = EXCLUDED.returned_count,
        sample          = EXCLUDED.sample,
        delivery_rate   = EXCLUDED.delivery_rate,
        window_days     = EXCLUDED.window_days,
        computed_at     = EXCLUDED.computed_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- A zone that has fallen out of the window entirely must not keep condemning
  -- parcels with a stale rate.
  DELETE FROM public.delivery_zone_stats
  WHERE computed_at < now() - interval '2 days';

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_delivery_zone_stats(integer) FROM PUBLIC;

SELECT public.refresh_delivery_zone_stats(90);

-- Nightly, at 02:17 — off the hour so it never lands with the other crons.
SELECT cron.schedule(
  'delivery-zone-stats-nightly',
  '17 2 * * *',
  $cron$SELECT public.refresh_delivery_zone_stats(90);$cron$
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'delivery-zone-stats-nightly'
);
