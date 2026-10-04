-- DRY RUN — READ ONLY. What bringing back the Darb « cancelled » history would change.
-- plans/products-redesign-v6.md Phase 3. Owner, 2026-10-03: "fix it and dry-run the
-- history before writing anything". This is ONE SELECT: it writes nothing. The writes
-- are in darb-cancelled-history-apply.sql, to run only once this has been read.
--
-- Scope: Darb orders that Ordra closed as `cancelled` after they were uploaded, read
-- against Darb's latest word on the parcel (latest shipment by carrier_updated_at).
-- The planned status is what 20261004100300 would have written had it been live:
--   completed                          → delivered       (revenue Ordra never counted)
--   released / returned                → to_be_returned  (handed back: the bench can scan it)
--   returning, or cancelled + pickup   → returning       (on its way back)
--   delayed / processing / booked …    → the in-flight status Darb still reports
--   anything else (cancelled before pickup, pending) → stays cancelled
--
-- Sections: A per market and planned status · B by month received · C by product ·
-- D investor statements already SETTLED over these orders (they do not move — owner:
-- settled statements stay as they are; the deal's next statement shows the change).

WITH cand AS (
  SELECT o.id, o.market_id, o.created_at, o.total_price, o.quantity, o.product_id,
         (SELECT min(h.created_at) FROM order_history h
           WHERE h.order_id = o.id AND h.status_to = 'cancelled') AS cancelled_at
  FROM orders o
  JOIN carriers c ON c.id = o.carrier_id AND c.code = 'darb_assabil'
  WHERE o.status = 'cancelled'
    AND (EXISTS (SELECT 1 FROM order_history h WHERE h.order_id = o.id AND h.status_to = 'uploaded')
         OR EXISTS (SELECT 1 FROM darb_shipments s WHERE s.order_id = o.id))
),
latest AS (
  SELECT DISTINCT ON (s.order_id) s.order_id, s.status_slug, s.delivery_withdrawal_at
  FROM darb_shipments s JOIN cand ON cand.id = s.order_id
  ORDER BY s.order_id, s.carrier_updated_at DESC NULLS LAST
),
picked AS (
  SELECT e.order_id FROM darb_timeline_events e JOIN cand ON cand.id = e.order_id WHERE e.type = 'assigned'
  UNION
  SELECT h.order_id FROM order_history h JOIN cand ON cand.id = h.order_id
  WHERE h.status_to IN ('at_carrier','in_transit','out_for_delivery','delivery_delayed','returning')
),
plan AS (
  SELECT cand.*, l.status_slug, l.delivery_withdrawal_at,
         CASE
           WHEN l.status_slug = 'completed'                             THEN 'delivered'
           WHEN l.status_slug IN ('released','returned')                THEN 'to_be_returned'
           WHEN l.status_slug = 'returning'                             THEN 'returning'
           WHEN l.status_slug = 'cancelled' AND p.order_id IS NOT NULL  THEN 'returning'
           WHEN l.status_slug = 'delayed'                               THEN 'delivery_delayed'
           WHEN l.status_slug IN ('processing','booked')                THEN 'at_carrier'
           WHEN l.status_slug = 'on-branch'                             THEN 'in_transit'
           WHEN l.status_slug = 'resent'                                THEN 'out_for_delivery'
           ELSE 'cancelled'
         END AS planned_status,
         COALESCE((SELECT sum(oi.quantity) FROM order_items oi WHERE oi.order_id = cand.id), cand.quantity) AS units
  FROM cand
  LEFT JOIN latest l ON l.order_id = cand.id
  LEFT JOIN (SELECT DISTINCT order_id FROM picked) p ON p.order_id = cand.id
)
SELECT 'A market' AS section, m.code AS label, planned_status AS status,
       count(*) AS orders, round(sum(total_price), 3) AS order_value, sum(units) AS units,
       'paid out by Darb: ' || count(*) FILTER (WHERE delivery_withdrawal_at IS NOT NULL)
         || ' · cancelled ' || min(cancelled_at)::date || ' → ' || max(cancelled_at)::date AS detail
FROM plan JOIN markets m ON m.id = plan.market_id
GROUP BY m.code, planned_status
UNION ALL
SELECT 'B month', to_char(created_at AT TIME ZONE 'Africa/Tripoli', 'YYYY-MM'), planned_status,
       count(*), round(sum(total_price), 3), sum(units), NULL
FROM plan WHERE planned_status <> 'cancelled'
GROUP BY 2, 3
UNION ALL
SELECT 'C product', COALESCE(p.sku, p.name), planned_status,
       count(*), round(sum(d.total_price), 3), sum(d.units), NULL
FROM plan d JOIN products p ON p.id = d.product_id
WHERE planned_status <> 'cancelled'
GROUP BY 2, 3
UNION ALL
SELECT 'D settled statement', s.period_start || ' → ' || s.period_end, 'settled ' || s.settled_at::date,
       count(d.id), round(sum(d.total_price) FILTER (WHERE d.planned_status = 'delivered'), 3), NULL,
       'statement ' || s.id
FROM investor_deal_statements s
JOIN plan d
  ON d.product_id = s.product_id
 AND (d.created_at AT TIME ZONE 'Africa/Tripoli')::date BETWEEN s.period_start AND s.period_end
WHERE s.settled_at IS NOT NULL AND d.planned_status <> 'cancelled'
GROUP BY s.id, s.period_start, s.period_end, s.settled_at
ORDER BY 1, 2, 3;
