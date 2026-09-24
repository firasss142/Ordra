-- ============================================================
-- 20260818000001_profitability_summary_rpc.sql
-- Server-side aggregation RPC for market P&L summary.
--
-- WHY: /api/profitability loaded delivered/returned/confirmed order_history
-- rows via three RLS-enforced joins and aggregated them in Node. Under the
-- market_manager role, the order_history_select RLS policy runs a per-row
-- EXISTS(SELECT 1 FROM orders ...) plus SECURITY DEFINER get_user_role()/
-- get_user_market_id() calls for every candidate row, which scales linearly
-- with the date window and crosses the DB statement_timeout (~8s) somewhere
-- between a 7- and 14-day range — so any P&L view wider than ~1 week returned
-- 500 for market managers.
--
-- This function aggregates the same rows in ONE round-trip. Being
-- SECURITY DEFINER, the expensive per-row order_history RLS predicate never
-- fires; market isolation is instead enforced once, in-function, by the same
-- guard used by get_duplicate_orders_batch. Output is byte-identical to the
-- previous JS path (verified against both markets for the failing window).
--
-- order_history is untouched (append-only preserved); this is purely additive.
-- ============================================================

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
