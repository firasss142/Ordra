-- ============================================================
-- 20260909000007_carrier_true_cost_use_billed.sql
-- Point the carrier-recommendation cost at the ACTUALLY BILLED amount.
--
-- Previously summed carriers.delivery_fee — a flat 10 LYD for both Darb rows,
-- while Darb bills 5-50 depending on destination. Over the 90-day window that
-- understated delivered-order cost by 6,995 LYD (3,780 reported vs 10,775 real),
-- and it materially changed the answer this function exists to give: real cost
-- per delivered order went from ~11.65 / ~10.73 to 30.67 (Tripoli) / 24.64
-- (Benghazi).
--
-- Now reads order_carrier_cost, the shared per-order view, so this and
-- get_dashboard_health cannot disagree about what a delivery cost — the
-- invariant 20260825000003 was written to protect.
--
-- COST MODEL unchanged: a returned order is charged return_fee ONLY, never
-- delivery_fee + return_fee. Return fees remain flat — the carrier reports no
-- per-shipment return charge.
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
    SELECT h.status_to,
           h.order_id,
           o.carrier_id,
           occ.effective_delivery_fee AS delivery_fee,
           occ.effective_return_fee   AS return_fee
    FROM order_history h
    JOIN orders o               ON o.id = h.order_id
    JOIN order_carrier_cost occ ON occ.order_id = o.id
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
