-- ============================================================
-- 20260909000006_order_carrier_cost_view.sql
-- Per-order EFFECTIVE carrier cost: what the carrier actually billed when it
-- told us, the flat contract fee when it didn't.
--
-- WHY: carriers.delivery_fee is a single flat number per account (10 LYD for
-- both Darb rows). Darb actually bills 5-50 LYD depending on destination —
-- averaging 28.80 (Tripoli) and 25.34 (Benghazi) across 828 live shipments.
-- Over the 90-day reporting window that understated delivered-order delivery
-- cost by 6,995 LYD (3,780 reported vs 10,775 real).
--
-- Every consumer of per-order carrier cost MUST read this view rather than
-- joining carriers directly, so get_dashboard_health and get_carrier_true_cost
-- can never disagree about what a delivery cost.
--
-- billed_shipping_amount IS NULL means "not reported", NOT "free" — hence the
-- COALESCE to the flat fee rather than to 0.
-- ============================================================

CREATE OR REPLACE VIEW order_carrier_cost AS
SELECT
  o.id                                                    AS order_id,
  o.carrier_id,
  o.market_id,
  COALESCE(ds.billed_shipping_amount, c.delivery_fee)     AS effective_delivery_fee,
  c.return_fee                                            AS effective_return_fee,
  c.delivery_fee                                          AS flat_delivery_fee,
  ds.billed_shipping_amount                               AS billed_delivery_fee,
  CASE WHEN ds.billed_shipping_amount IS NOT NULL
       THEN 'billed' ELSE 'flat' END                      AS cost_source
FROM orders o
JOIN carriers c             ON c.id = o.carrier_id
LEFT JOIN darb_shipments ds ON ds.order_id = o.id;

COMMENT ON VIEW order_carrier_cost IS
  'Per-order effective carrier delivery cost: the carrier''s actually-billed amount when known, else the flat carriers.delivery_fee. The single source of truth for per-order carrier cost — read this, never join carriers.delivery_fee directly. See docs/darb-assabil-sync.md.';

GRANT SELECT ON order_carrier_cost TO authenticated, service_role;
