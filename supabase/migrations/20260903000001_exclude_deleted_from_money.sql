-- ============================================================
-- Money never counts a manually deleted order.
--
-- Every financial figure is built by joining order_history to orders and
-- filtering on the EVENT (`status_to IN ('delivered','returned','confirmed')`).
-- None of these functions looked at the order's CURRENT status, so an order a
-- manager later deleted still contributed to revenue, COGS, carrier fees and
-- packing cost forever.
--
-- Scope, deliberately: only money. Operational counts — how many orders came
-- in, how many are in each queue, per-agent activity — still include deleted
-- orders, because those events really happened. Only the P&L pretends they
-- did not.
--
-- Measured blast radius on production at the time of writing:
--   * revenue, delivered_count, returned_count: UNCHANGED in both markets.
--     `manual_delete_orders` refuses any status past `scanned`, so no deleted
--     order has ever reached `delivered` or `returned`.
--   * confirmed_count (Libya): 1 711 -> 1 647. 23 deleted orders, 64 confirm
--     events (an order can be confirmed, uploaded, then confirmed again).
--   * packing_cost is charged per confirmed order, so it is the ONE money
--     figure that actually moves.
--
-- The predicate is `o.status <> 'deleted'` rather than a NOT IN list: the other
-- four terminal statuses are legitimate money events and must keep counting.
-- ============================================================

-- ---------- 1. Market P&L, whole period ----------
CREATE OR REPLACE FUNCTION get_profitability_summary(
  p_market_id UUID,
  p_from_date TIMESTAMPTZ,
  p_to_date   TIMESTAMPTZ
)
RETURNS TABLE (
  revenue_cents       BIGINT,
  cogs_cents          BIGINT,
  delivery_cost_cents BIGINT,
  return_cost_cents   BIGINT,
  packing_cost_cents  BIGINT,
  delivered_count     BIGINT,
  returned_count      BIGINT,
  confirmed_count     BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_caller_role   TEXT;
  v_caller_market UUID;
BEGIN
  v_caller_role   := get_user_role();
  v_caller_market := get_user_market_id();

  -- Market isolation: anyone but super_admin must request their own market.
  IF v_caller_role IS DISTINCT FROM 'super_admin'
     AND v_caller_market IS DISTINCT FROM p_market_id THEN
    RETURN;  -- zero rows -> caller treats as all-zeros (see load-summary.ts)
  END IF;

  RETURN QUERY
  WITH oh AS (
    SELECT
      h.status_to,
      o.total_price,
      o.quantity,
      o.product_id,
      o.carrier_id
    FROM order_history h
    JOIN orders o ON o.id = h.order_id
    WHERE o.market_id = p_market_id
      AND o.status <> 'deleted'          -- money ignores manually deleted orders
      AND h.status_to IN ('delivered', 'returned', 'confirmed')
      AND h.created_at >= p_from_date
      AND h.created_at <= p_to_date
  )
  SELECT
    -- revenue: SUM(total_price) over delivered rows only
    COALESCE(SUM(round(oh.total_price * 100))
             FILTER (WHERE oh.status_to = 'delivered'), 0)::bigint,
    -- cogs: unit_cogs * quantity over delivered rows with a resolvable product
    COALESCE(SUM(round(p.unit_cogs * oh.quantity * 100))
             FILTER (WHERE oh.status_to = 'delivered'
                       AND oh.product_id IS NOT NULL
                       AND p.id IS NOT NULL), 0)::bigint,
    -- delivery cost: carrier delivery_fee per delivered row with a resolvable carrier
    COALESCE(SUM(round(c.delivery_fee * 100))
             FILTER (WHERE oh.status_to = 'delivered'
                       AND oh.carrier_id IS NOT NULL
                       AND c.id IS NOT NULL), 0)::bigint,
    -- return cost: carrier return_fee per returned row with a resolvable carrier
    COALESCE(SUM(round(c.return_fee * 100))
             FILTER (WHERE oh.status_to = 'returned'
                       AND oh.carrier_id IS NOT NULL
                       AND c.id IS NOT NULL), 0)::bigint,
    -- packing cost: packing_cost per confirmed row with a resolvable product
    COALESCE(SUM(round(p.packing_cost * 100))
             FILTER (WHERE oh.status_to = 'confirmed'
                       AND p.id IS NOT NULL), 0)::bigint,
    COALESCE(COUNT(*) FILTER (WHERE oh.status_to = 'delivered'), 0)::bigint,
    COALESCE(COUNT(*) FILTER (WHERE oh.status_to = 'returned'), 0)::bigint,
    -- confirmed_count: confirmed rows with a non-null product_id (matches the
    -- legacy JS confirmedOrderProductIds.length, NOT total confirmed rows)
    COALESCE(COUNT(*) FILTER (WHERE oh.status_to = 'confirmed'
                                AND oh.product_id IS NOT NULL), 0)::bigint
  FROM oh
  LEFT JOIN products p ON p.id = oh.product_id
  LEFT JOIN carriers c ON c.id = oh.carrier_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_profitability_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;


-- ---------- 2. Market P&L, per day ----------
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
      AND o.status <> 'deleted'          -- money ignores manually deleted orders
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


-- ---------- 3. True cost per carrier ----------
CREATE OR REPLACE FUNCTION get_carrier_true_cost(
  p_market_id UUID,
  p_days      INTEGER DEFAULT 90
)
RETURNS TABLE (
  carrier_id    UUID,
  delivered     BIGINT,
  returned      BIGINT,
  delivery_cost NUMERIC,
  return_cost   NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH hist_carrier AS (
    SELECT h.status_to, h.order_id, o.carrier_id, c.delivery_fee, c.return_fee
    FROM order_history h
    JOIN orders   o ON o.id = h.order_id
    JOIN carriers c ON c.id = o.carrier_id
    WHERE h.market_id = p_market_id
      AND o.status <> 'deleted'          -- money ignores manually deleted orders
      AND h.status_to IN ('delivered','returned')
      AND h.created_at >= now() - make_interval(days => p_days)
  )
  SELECT
    hc.carrier_id,
    COUNT(*) FILTER (WHERE hc.status_to = 'delivered')                            AS delivered,
    COUNT(*) FILTER (WHERE hc.status_to = 'returned')                             AS returned,
    COALESCE(SUM(hc.delivery_fee) FILTER (WHERE hc.status_to = 'delivered'), 0)   AS delivery_cost,
    COALESCE(SUM(hc.return_fee)   FILTER (WHERE hc.status_to = 'returned'),  0)   AS return_cost
  FROM hist_carrier hc
  GROUP BY hc.carrier_id;
$$;

REVOKE ALL ON FUNCTION get_carrier_true_cost(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_carrier_true_cost(UUID, INTEGER) TO authenticated;
