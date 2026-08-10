-- ============================================================
-- 20260828000001_profitability_daily_and_cohort_rpc.sql
-- Two additive read-only RPCs for the P&L console.
--
-- 1. get_profitability_daily — the per-day series behind the hero sparklines.
--    Same joins, same filters and the same cents rounding as
--    get_profitability_summary, bucketed by UTC calendar day, so the series
--    sums EXACTLY to the period totals that page already shows. Days with no
--    activity are returned as zero rows rather than omitted: a sparkline that
--    skips empty days draws a line between non-adjacent dates and silently
--    misstates the shape of the trend.
--
-- 2. get_profitability_cohort_funnel — leads → confirmed → delivered for the
--    orders CREATED in the window.
--
--    WHY: the funnel used to divide transitions counted in the window by
--    orders created in the window. Those are different cohorts — the orders
--    delivered today were confirmed weeks ago — so the quotient was not a
--    conversion rate. On the Libya market it published "1300.0% CONFIRMATION"
--    (13 confirmed / 1 lead). Following one cohort forward makes both rates
--    real and bounds them at 100% by construction.
--
-- Both are SECURITY DEFINER for the same reason the summary RPC is: the
-- order_history RLS predicate runs a per-row EXISTS + two SECURITY DEFINER
-- lookups, which crosses statement_timeout on any window wider than ~1 week
-- for a market_manager. Market isolation is enforced once, in-function, by the
-- same guard the summary uses.
--
-- Purely additive. No table, policy or row is modified; order_history stays
-- append-only.
-- ============================================================

CREATE OR REPLACE FUNCTION get_profitability_daily(
  p_market_id UUID,
  p_from_date DATE,
  p_to_date   DATE
)
RETURNS TABLE (
  day                 DATE,
  revenue_cents       BIGINT,
  cogs_cents          BIGINT,
  delivery_cost_cents BIGINT,
  return_cost_cents   BIGINT,
  packing_cost_cents  BIGINT,
  delivered_count     BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
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

  -- Bounds pinned to UTC explicitly rather than cast from the session
  -- timezone, so the buckets line up with the summary RPC (which the API
  -- calls with an ISO ...T23:59:59.999Z upper bound) on any connection.
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
      o.total_price,
      o.quantity,
      o.product_id,
      o.carrier_id
    FROM order_history h
    JOIN orders o ON o.id = h.order_id
    WHERE o.market_id = p_market_id
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
      COALESCE(SUM(round(c.delivery_fee * 100))
               FILTER (WHERE oh.status_to = 'delivered'
                         AND oh.carrier_id IS NOT NULL
                         AND c.id IS NOT NULL), 0)::bigint AS delivery_cost_cents,
      COALESCE(SUM(round(c.return_fee * 100))
               FILTER (WHERE oh.status_to = 'returned'
                         AND oh.carrier_id IS NOT NULL
                         AND c.id IS NOT NULL), 0)::bigint AS return_cost_cents,
      COALESCE(SUM(round(p.packing_cost * 100))
               FILTER (WHERE oh.status_to = 'confirmed'
                         AND p.id IS NOT NULL), 0)::bigint AS packing_cost_cents,
      COALESCE(COUNT(*) FILTER (WHERE oh.status_to = 'delivered'), 0)::bigint AS delivered_count
    FROM oh
    LEFT JOIN products p ON p.id = oh.product_id
    LEFT JOIN carriers c ON c.id = oh.carrier_id
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
$$;

GRANT EXECUTE ON FUNCTION get_profitability_daily(UUID, DATE, DATE) TO authenticated;


CREATE OR REPLACE FUNCTION get_profitability_cohort_funnel(
  p_market_id UUID,
  p_from_date DATE,
  p_to_date   DATE
)
RETURNS TABLE (
  leads_count     BIGINT,
  confirmed_count BIGINT,
  delivered_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
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
  WITH cohort AS (
    SELECT o.id
    FROM orders o
    WHERE o.market_id = p_market_id
      AND o.created_at >= v_from
      AND o.created_at <  v_to
  ),
  -- DISTINCT because an order can be confirmed more than once (a callback that
  -- reopens and re-confirms writes a second row). Counting rows would let the
  -- confirmed total exceed the cohort it came from.
  reached AS (
    SELECT h.order_id, h.status_to
    FROM order_history h
    JOIN cohort ON cohort.id = h.order_id
    WHERE h.status_to IN ('confirmed', 'delivered')
    GROUP BY h.order_id, h.status_to
  )
  SELECT
    (SELECT COUNT(*) FROM cohort)::bigint,
    (SELECT COUNT(*) FROM reached WHERE status_to = 'confirmed')::bigint,
    (SELECT COUNT(*) FROM reached WHERE status_to = 'delivered')::bigint;
END;
$$;

GRANT EXECUTE ON FUNCTION get_profitability_cohort_funnel(UUID, DATE, DATE) TO authenticated;
