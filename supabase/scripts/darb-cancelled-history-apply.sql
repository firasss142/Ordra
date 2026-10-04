-- APPLY — WRITES. Brings back the Darb « cancelled » history. RUN ONLY AFTER THE OWNER
-- HAS READ darb-cancelled-history-dry-run.sql (plans/products-redesign-v6.md Phase 3)
-- and after 20261004100300 is live (otherwise the next sync re-closes nothing, but new
-- Darb cancels would keep landing as terminal).
--
-- What it does, in ONE transaction:
--   · every Darb order still `cancelled` in Ordra whose parcel Darb kept working moves
--     to the status Darb's latest word gives it (same mapping as the dry run):
--       completed → delivered · released/returned → to_be_returned · returning or
--       cancelled after pickup → returning · delayed → delivery_delayed ·
--       processing/booked → at_carrier · on-branch → in_transit · resent → out_for_delivery
--   · one APPEND-ONLY order_history row per order, saying why, DATED WHEN DARB SAYS IT
--     HAPPENED, not today: carrier_parcel_outcome takes a delivery's date from the first
--     `delivered` history row, and the P&L books revenue on that row's date — dated
--     today, 38 deliveries from the summer would land in October. Darb's completion
--     (timeline, else shipment), its hand-back for to_be_returned, its last status change
--     otherwise; never before Ordra's cancel row (chronology) and never in the future;
--   · leaving `cancelled` un-archives the order (orders_stamp_terminal): the handed-back
--     parcels appear in Entrepôt › Retours, where scanning them puts the stock back;
--   · WhatsApp: a status change queues a lifecycle message (delivered, last chance…).
--     Nobody should get one about a months-old parcel, so every message this script
--     queued is deleted before COMMIT — they were never visible to the sender.
-- It never touches an order that is not `cancelled` any more, so running it twice
-- changes nothing the second time. Settled investor statements are immutable and do
-- not move; the deal's next statement carries the restatement.

BEGIN;

CREATE TEMP TABLE darb_history_moves ON COMMIT DROP AS
WITH cand AS (
  SELECT o.id
  FROM orders o
  JOIN carriers c ON c.id = o.carrier_id AND c.code = 'darb_assabil'
  WHERE o.status = 'cancelled'
    AND (EXISTS (SELECT 1 FROM order_history h WHERE h.order_id = o.id AND h.status_to = 'uploaded')
         OR EXISTS (SELECT 1 FROM darb_shipments s WHERE s.order_id = o.id))
),
latest AS (
  SELECT DISTINCT ON (s.order_id) s.order_id, s.status_slug, s.completed_at, s.carrier_updated_at
  FROM darb_shipments s JOIN cand ON cand.id = s.order_id
  ORDER BY s.order_id, s.carrier_updated_at DESC NULLS LAST
),
ev AS (
  SELECT t.order_id,
         min(t.occurred_at) FILTER (WHERE t.type = 'completed')              AS completed_at,
         max(t.occurred_at) FILTER (WHERE t.type IN ('released', 'returned')) AS handed_back_at
  FROM darb_timeline_events t JOIN cand ON cand.id = t.order_id
  GROUP BY t.order_id
),
cancel_row AS (
  SELECT h.order_id, max(h.created_at) AS cancelled_at
  FROM order_history h JOIN cand ON cand.id = h.order_id
  WHERE h.status_to = 'cancelled'
  GROUP BY h.order_id
),
picked AS (
  SELECT e.order_id FROM darb_timeline_events e JOIN cand ON cand.id = e.order_id WHERE e.type = 'assigned'
  UNION
  SELECT h.order_id FROM order_history h JOIN cand ON cand.id = h.order_id
  WHERE h.status_to IN ('at_carrier','in_transit','out_for_delivery','delivery_delayed','returning')
)
SELECT cand.id AS order_id, l.status_slug,
       (CASE
          WHEN l.status_slug = 'completed'                             THEN 'delivered'
          WHEN l.status_slug IN ('released','returned')                THEN 'to_be_returned'
          WHEN l.status_slug = 'returning'                             THEN 'returning'
          WHEN l.status_slug = 'cancelled' AND p.order_id IS NOT NULL  THEN 'returning'
          WHEN l.status_slug = 'delayed'                               THEN 'delivery_delayed'
          WHEN l.status_slug IN ('processing','booked')                THEN 'at_carrier'
          WHEN l.status_slug = 'on-branch'                             THEN 'in_transit'
          WHEN l.status_slug = 'resent'                                THEN 'out_for_delivery'
        END)::order_status AS target,
       LEAST(now(), GREATEST(
         COALESCE(cr.cancelled_at, '-infinity'::timestamptz) + interval '1 second',
         COALESCE(CASE
                    WHEN l.status_slug = 'completed'             THEN COALESCE(ev.completed_at, l.completed_at)
                    WHEN l.status_slug IN ('released','returned') THEN ev.handed_back_at
                  END,
                  l.carrier_updated_at, now())
       )) AS happened_at
FROM cand
LEFT JOIN latest l ON l.order_id = cand.id
LEFT JOIN ev ON ev.order_id = cand.id
LEFT JOIN cancel_row cr ON cr.order_id = cand.id
LEFT JOIN (SELECT DISTINCT order_id FROM picked) p ON p.order_id = cand.id;

DELETE FROM darb_history_moves WHERE target IS NULL;

UPDATE orders o
SET status = m.target,
    carrier_status_slug = COALESCE(m.status_slug, o.carrier_status_slug)
FROM darb_history_moves m
WHERE o.id = m.order_id
  AND o.status = 'cancelled';

INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note, created_at)
SELECT m.order_id, 'cancelled', m.target, NULL, 'system',
       'Darb history backfill (recorded ' || to_char(now() AT TIME ZONE 'Africa/Tripoli', 'YYYY-MM-DD')
         || ', dated at Darb''s own event): Darb kept the parcel after its cancel and says ' || m.status_slug,
       m.happened_at
FROM darb_history_moves m;

-- No customer hears about a months-old parcel: drop what the status trigger queued here.
DELETE FROM whatsapp_outbox w
USING darb_history_moves m
WHERE w.order_id = m.order_id
  AND w.kind = 'lifecycle'
  AND w.created_at >= now();

SELECT target AS new_status, count(*) AS orders,
       min(happened_at)::date AS earliest, max(happened_at)::date AS latest
FROM darb_history_moves GROUP BY target ORDER BY orders DESC;

COMMIT;
