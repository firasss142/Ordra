-- Darb at its real price, app-wide (plans/products-redesign-v6.md Phase 2).
--
-- Owner, 2026-10-03: "The flat delivery cost should be ignored, skipped, and
-- deleted… just use the invoices", for EVERY Darb figure; a failed Darb parcel
-- costs nothing; settled investor statements are not touched; Tunisia keeps its
-- flat fees until its carriers send invoices.
--
-- 1. order_carrier_cost — the view get_dashboard_health and get_carrier_true_cost
--    read — is rebuilt on order_delivery_cost (20261004100000), same columns:
--      · ONE row per order. It LEFT JOINed every Darb shipment, so a re-sent
--        parcel counted twice in every SUM over it.
--      · Darb delivery = the completed shipment's invoice → the upload quote →
--        the market's 30-day average invoice. Never the flat 10 LYD again.
--      · Darb return = 0. The 5 LYD carriers.return_fee is no longer read.
--      · security_invoker: authenticated readers see their own market only
--        (the old view ran as its owner and was granted to every user).
--    Both RPCs pick this up without being rewritten.
-- 2. get_profitability_summary / get_profitability_daily (P&L global) priced every
--    delivery at carriers.delivery_fee and every return at carriers.return_fee.
--    They now read order_carrier_cost. Same signatures: grants are kept.
--
-- The P&L stays event-dated (a delivery counts on the day it happened); only the
-- price of a delivery changes. Investor accrual already used Darb's invoice — see
-- lib/investors/facts/order-facts.ts — and its Darb return cost becomes 0 in the
-- same change, in TypeScript.

-- ── 1. order_carrier_cost ────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.order_carrier_cost
WITH (security_invoker = true) AS
WITH darb_avg AS (
  SELECT m.id AS market_id, public.market_avg_delivery_cost(m.id) AS avg_cost
  FROM public.markets m
)
SELECT
  o.id                                                              AS order_id,
  o.carrier_id,
  o.market_id,
  CASE
    WHEN dc.invoiced THEN COALESCE(dc.delivery_cost, da.avg_cost)
    ELSE dc.delivery_cost
  END::numeric                                                      AS effective_delivery_fee,
  dc.return_cost::numeric(10,3)                                     AS effective_return_fee,
  c.delivery_fee                                                    AS flat_delivery_fee,
  (CASE WHEN dc.delivery_cost_source = 'invoice' THEN dc.delivery_cost END)::numeric
                                                                    AS billed_delivery_fee,
  CASE
    WHEN dc.delivery_cost_source = 'invoice' THEN 'billed'
    WHEN dc.delivery_cost_source = 'quote'   THEN 'quote'
    WHEN dc.invoiced                          THEN 'average'
    ELSE 'flat'
  END                                                               AS cost_source
FROM public.orders o
JOIN public.carriers c                ON c.id = o.carrier_id
JOIN public.order_delivery_cost dc    ON dc.order_id = o.id
LEFT JOIN darb_avg da                 ON da.market_id = o.market_id;

COMMENT ON VIEW public.order_carrier_cost IS
  'Per-order effective carrier cost, ONE row per order. Darb: invoice of the completed shipment, else the upload quote, else the market''s 30-day average invoice (cost_source billed/quote/average); a failed Darb parcel costs 0. Other carriers: flat fees (cost_source flat). Built on order_delivery_cost. Read by get_dashboard_health, get_carrier_true_cost, get_profitability_summary/_daily.';

GRANT SELECT ON public.order_carrier_cost TO authenticated, service_role;

-- ── 2. P&L global ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_profitability_summary(p_market_id uuid, p_from_date timestamp with time zone, p_to_date timestamp with time zone)
 RETURNS TABLE(revenue_cents bigint, cogs_cents bigint, delivery_cost_cents bigint, return_cost_cents bigint, packing_cost_cents bigint, delivered_count bigint, returned_count bigint, confirmed_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role   TEXT;
  v_caller_market UUID;
BEGIN
  v_caller_role   := get_user_role();
  v_caller_market := get_user_market_id();

  IF v_caller_role IS DISTINCT FROM 'super_admin'
     AND v_caller_market IS DISTINCT FROM p_market_id THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH oh AS (
    SELECT
      h.status_to,
      o.id AS order_id,
      o.total_price,
      o.quantity,
      o.product_id,
      o.carrier_id
    FROM order_history h
    JOIN orders o ON o.id = h.order_id
    WHERE o.market_id = p_market_id
      AND o.status <> 'deleted'
      AND h.status_to IN ('delivered', 'returned', 'confirmed')
      AND h.created_at >= p_from_date
      AND h.created_at <= p_to_date
  )
  SELECT
    COALESCE(SUM(round(oh.total_price * 100))
             FILTER (WHERE oh.status_to = 'delivered'), 0)::bigint,
    COALESCE(SUM(round(p.unit_cogs * oh.quantity * 100))
             FILTER (WHERE oh.status_to = 'delivered'
                       AND oh.product_id IS NOT NULL
                       AND p.id IS NOT NULL), 0)::bigint,
    -- Darb's invoice (else quote, else the 30-day average), not carriers.delivery_fee.
    COALESCE(SUM(round(occ.effective_delivery_fee * 100))
             FILTER (WHERE oh.status_to = 'delivered'
                       AND oh.carrier_id IS NOT NULL
                       AND occ.order_id IS NOT NULL), 0)::bigint,
    -- A failed Darb parcel costs nothing; other carriers keep their flat return fee.
    COALESCE(SUM(round(occ.effective_return_fee * 100))
             FILTER (WHERE oh.status_to = 'returned'
                       AND oh.carrier_id IS NOT NULL
                       AND occ.order_id IS NOT NULL), 0)::bigint,
    COALESCE(SUM(round(p.packing_cost * 100))
             FILTER (WHERE oh.status_to = 'confirmed'
                       AND p.id IS NOT NULL), 0)::bigint,
    COALESCE(COUNT(*) FILTER (WHERE oh.status_to = 'delivered'), 0)::bigint,
    COALESCE(COUNT(*) FILTER (WHERE oh.status_to = 'returned'), 0)::bigint,
    COALESCE(COUNT(*) FILTER (WHERE oh.status_to = 'confirmed'
                                AND oh.product_id IS NOT NULL), 0)::bigint
  FROM oh
  LEFT JOIN products p ON p.id = oh.product_id
  LEFT JOIN order_carrier_cost occ ON occ.order_id = oh.order_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_profitability_daily(p_market_id uuid, p_from_date date, p_to_date date)
 RETURNS TABLE(day date, revenue_cents bigint, cogs_cents bigint, delivery_cost_cents bigint, return_cost_cents bigint, packing_cost_cents bigint, delivered_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role   TEXT;
  v_caller_market UUID;
  v_from          TIMESTAMPTZ;
  v_to            TIMESTAMPTZ;
BEGIN
  v_caller_role   := get_user_role();
  v_caller_market := get_user_market_id();

  IF v_caller_role IS DISTINCT FROM 'super_admin'
     AND v_caller_market IS DISTINCT FROM p_market_id THEN
    RETURN;
  END IF;

  v_from := (p_from_date::text || ' 00:00:00+00')::timestamptz;
  v_to   := ((p_to_date + 1)::text || ' 00:00:00+00')::timestamptz;

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(p_from_date, p_to_date, INTERVAL '1 day')::date AS day
  ),
  oh AS (
    SELECT
      (h.created_at AT TIME ZONE 'UTC')::date AS day,
      h.status_to,
      o.id AS order_id,
      o.total_price,
      o.quantity,
      o.product_id,
      o.carrier_id
    FROM order_history h
    JOIN orders o ON o.id = h.order_id
    WHERE o.market_id = p_market_id
      AND o.status <> 'deleted'
      AND h.status_to IN ('delivered', 'returned', 'confirmed')
      AND h.created_at >= v_from
      AND h.created_at <  v_to
  ),
  agg AS (
    SELECT
      oh.day,
      COALESCE(SUM(round(oh.total_price * 100))
               FILTER (WHERE oh.status_to = 'delivered'), 0)::bigint AS revenue_cents,
      COALESCE(SUM(round(p.unit_cogs * oh.quantity * 100))
               FILTER (WHERE oh.status_to = 'delivered'
                         AND oh.product_id IS NOT NULL
                         AND p.id IS NOT NULL), 0)::bigint AS cogs_cents,
      COALESCE(SUM(round(occ.effective_delivery_fee * 100))
               FILTER (WHERE oh.status_to = 'delivered'
                         AND oh.carrier_id IS NOT NULL
                         AND occ.order_id IS NOT NULL), 0)::bigint AS delivery_cost_cents,
      COALESCE(SUM(round(occ.effective_return_fee * 100))
               FILTER (WHERE oh.status_to = 'returned'
                         AND oh.carrier_id IS NOT NULL
                         AND occ.order_id IS NOT NULL), 0)::bigint AS return_cost_cents,
      COALESCE(SUM(round(p.packing_cost * 100))
               FILTER (WHERE oh.status_to = 'confirmed'
                         AND p.id IS NOT NULL), 0)::bigint AS packing_cost_cents,
      COALESCE(COUNT(*) FILTER (WHERE oh.status_to = 'delivered'), 0)::bigint AS delivered_count
    FROM oh
    LEFT JOIN products p ON p.id = oh.product_id
    LEFT JOIN order_carrier_cost occ ON occ.order_id = oh.order_id
    GROUP BY oh.day
  )
  SELECT
    d.day,
    COALESCE(a.revenue_cents, 0)::bigint,
    COALESCE(a.cogs_cents, 0)::bigint,
    COALESCE(a.delivery_cost_cents, 0)::bigint,
    COALESCE(a.return_cost_cents, 0)::bigint,
    COALESCE(a.packing_cost_cents, 0)::bigint,
    COALESCE(a.delivered_count, 0)::bigint
  FROM days d
  LEFT JOIN agg a ON a.day = d.day
  ORDER BY d.day;
END;
$function$;
