-- Every delivery rate in Ordra is the same number — « PR 2 » of docs/carrier-scorecard.md.
--
-- Until now three readers still counted delivered ÷ (delivered + returned) on
-- order_history. In Libya a failed Darb parcel almost never ends `returned` (that
-- status means « scanned back at the warehouse »): Darb cancels it. So the failures
-- fell out of the denominator and Darb read 92–100 % where Transporteurs, which reads
-- carrier_parcel_outcome, shows ~52 %. They now read the same view:
--
--   1. get_carrier_true_cost        — the « meilleur choix » tie-break between the two
--                                      Darb accounts. Same signature, same columns
--                                      (`returned` now holds the FAILED count).
--   2. get_carrier_delivery_performance (new) — what /api/carriers/performance returns:
--                                      the rate shown in the agent's carrier picker and
--                                      in Réglages › Livraison. SECURITY DEFINER because an
--                                      agent's RLS would only show her own parcels.
--   3. refresh_delivery_zone_stats  — the /delivery « Zone difficile » rate.
--
-- COST. A failure is charged order_carrier_cost.effective_return_fee, which is 0 for
-- Darb since 20261004100200 (owner, 2026-10-06: « in Libya, failures cost nothing »)
-- and the carrier's flat return fee elsewhere. Nothing new is decided here.
--
-- WINDOW. A parcel counts in the window its outcome happened in: outcome_at, or its
-- last movement when the view has no outcome time.
--
-- get_dashboard_health is NOT repointed: nothing in the app calls it since the
-- Accueil rebuild (PR #75). It should be dropped, not fixed.
--
-- CREATE OR REPLACE with unchanged signatures keeps the grants (DROP would reopen
-- them to anon — see the drop-function-resets-grants note).

-- ── 1 · true cost per delivered parcel ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_carrier_true_cost(p_market_id uuid, p_days integer DEFAULT 90)
 RETURNS TABLE(carrier_id uuid, delivered bigint, returned bigint, delivery_cost numeric, return_cost numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH finished AS (
    SELECT cpo.carrier_id,
           cpo.outcome,
           occ.effective_delivery_fee AS delivery_fee,
           occ.effective_return_fee   AS return_fee
    FROM carrier_parcel_outcome cpo
    JOIN order_carrier_cost occ ON occ.order_id = cpo.order_id
    WHERE cpo.market_id = p_market_id
      AND cpo.outcome IN ('delivered', 'failed')
      AND cpo.carrier_id IS NOT NULL
      AND COALESCE(cpo.outcome_at, cpo.last_move_at) >= now() - make_interval(days => p_days)
      -- the server (service role) or someone of this market
      AND (auth.uid() IS NULL OR get_user_role() = 'super_admin' OR get_user_market_id() = p_market_id)
  )
  SELECT
    f.carrier_id,
    COUNT(*) FILTER (WHERE f.outcome = 'delivered')                              AS delivered,
    COUNT(*) FILTER (WHERE f.outcome = 'failed')                                 AS returned,
    COALESCE(SUM(f.delivery_fee) FILTER (WHERE f.outcome = 'delivered'), 0)      AS delivery_cost,
    COALESCE(SUM(f.return_fee)   FILTER (WHERE f.outcome = 'failed'),    0)      AS return_cost
  FROM finished f
  GROUP BY f.carrier_id;
$function$;

-- ── 2 · delivery rate + transit per carrier (/api/carriers/performance) ─────────
CREATE OR REPLACE FUNCTION public.get_carrier_delivery_performance(p_market_id uuid, p_days integer DEFAULT 30)
 RETURNS TABLE(carrier_id uuid, delivered bigint, failed bigint, median_transit_hours numeric, sample_size bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    cpo.carrier_id,
    COUNT(*) FILTER (WHERE cpo.outcome = 'delivered')                            AS delivered,
    COUNT(*) FILTER (WHERE cpo.outcome = 'failed')                               AS failed,
    round((percentile_cont(0.5) WITHIN GROUP (
      ORDER BY extract(epoch FROM cpo.outcome_at - COALESCE(cpo.picked_at, cpo.uploaded_at)) / 3600
    ) FILTER (WHERE cpo.outcome = 'delivered'
                AND cpo.outcome_at >= COALESCE(cpo.picked_at, cpo.uploaded_at)))::numeric, 1)
                                                                                 AS median_transit_hours,
    COUNT(*)                                                                     AS sample_size
  FROM public.carrier_parcel_outcome cpo
  WHERE cpo.market_id = p_market_id
    AND cpo.outcome IN ('delivered', 'failed')
    AND cpo.carrier_id IS NOT NULL
    AND COALESCE(cpo.outcome_at, cpo.last_move_at) >= now() - make_interval(days => p_days)
    AND (auth.uid() IS NULL OR public.get_user_role() = 'super_admin' OR public.get_user_market_id() = p_market_id)
  GROUP BY cpo.carrier_id;
$function$;

COMMENT ON FUNCTION public.get_carrier_delivery_performance(uuid, integer) IS
  'Per carrier: delivered / failed (carrier_parcel_outcome), median pickup→delivered hours. '
  'Caller''s own market only (super_admin: any). Read by /api/carriers/performance.';

REVOKE ALL ON FUNCTION public.get_carrier_delivery_performance(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_carrier_delivery_performance(uuid, integer) TO authenticated, service_role;

-- ── 3 · per-zone delivery rate (« Zone difficile ») ─────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_delivery_zone_stats(p_window_days integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_rows integer;
BEGIN
  WITH finished AS (
    SELECT o.market_id,
           public.delivery_zone_key(
             o.darb_destination_id::text, o.city_id, o.customer_city) AS zone_key,
           NULLIF(btrim(COALESCE(o.customer_city, '')), '')           AS label,
           cpo.outcome                                                AS st
    FROM public.carrier_parcel_outcome cpo
    JOIN public.orders o ON o.id = cpo.order_id
    WHERE cpo.outcome IN ('delivered', 'failed')
      AND COALESCE(cpo.outcome_at, cpo.last_move_at) >= now() - make_interval(days => p_window_days)
      AND o.market_id IS NOT NULL
  ),
  agg AS (
    SELECT market_id,
           zone_key,
           mode() WITHIN GROUP (ORDER BY label) AS zone_label,
           count(*) FILTER (WHERE st = 'delivered')::integer AS delivered_count,
           count(*) FILTER (WHERE st = 'failed')::integer    AS returned_count,
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
$function$;
