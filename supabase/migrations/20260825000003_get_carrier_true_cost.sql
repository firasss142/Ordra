-- ============================================================
-- 20260825000003_get_carrier_true_cost.sql
-- Per-carrier resolved counts + fee sums, for the carrier recommendation.
--
-- WHY. When two Darb Assabil accounts quote the same price for a destination
-- (سبها: 35 LYD from both), the tie-break is what a SUCCESSFUL delivery actually
-- costs once failures are paid for — which is return-rate driven and differs
-- measurably between the accounts (Tripoli 11.65 vs Benghazi 10.73 over 90 days).
--
-- The dashboard already computes this, but only inside get_dashboard_health,
-- which is a large multi-CTE rollup and far too heavy to call per order. This
-- function extracts JUST the carrier slice, reusing get_dashboard_health's
-- hist_carrier + carriers_agg CTEs VERBATIM so the two can never disagree about
-- which carrier is cheaper. That divergence is the worst possible failure mode
-- for a feature whose whole job is answering that question.
--
-- Returns RAW counts and sums. The ratio is derived in TypeScript
-- (lib/calculations/carrier-true-cost.ts), matching the dashboard module's rule
-- that every rate is computed once, beside the denominator it came from.
--
-- COST MODEL: a returned order is charged return_fee ONLY, never
-- delivery_fee + return_fee. Same rule as docs/business-logic.md and 20260823000005.
-- ============================================================

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
