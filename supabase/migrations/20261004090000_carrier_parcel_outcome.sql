-- carrier_parcel_outcome — what became of every parcel that left for a carrier.
--
-- ONE definition, shared by Transporteurs (plans/transporteurs.md §3) and
-- Produits v6 (plans/products-redesign-v6.md §4). Both branches carry this file
-- byte for byte; whichever merges first wins. Never edit it after it ships:
-- change it with a NEW migration (CREATE OR REPLACE VIEW, columns appended).
--
-- WHY A VIEW. Until now every screen counted delivered ÷ (delivered + returned)
-- on order_history. In Libya a failed Darb parcel almost never ends `returned`
-- (that status means "scanned back in the warehouse"): Darb cancels it, and
-- promote_darb_status maps that to Ordra `cancelled`. So the failures fell out of
-- the denominator and Darb read 92–100 % where the truth was 50–55 %
-- (2026-10-03). And Darb keeps working a parcel after cancelling it — it is
-- later handed back (`released`) or even delivered (`completed`) — which
-- Ordra never hears. This view reads Darb's own latest status to correct that.
--
-- RULES, in order. « Latest Darb shipment » = darb_shipments by
-- carrier_updated_at DESC NULLS LAST (a re-sent parcel has two rows).
--   uploaded    an order_history row → uploaded, a post-upload status (now or
--               in history), or a Darb shipment. Anything else is not a row.
--   delivered   status delivered, or latest Darb slug completed.
--   failed      status returning / to_be_returned / returned / received ;
--               slug returning / returned ;
--               slug released AFTER a Darb cancellation (Ordra cancelled, or
--               Darb's cancel_count > 0, or a cancelled/returning/returned
--               event) — the returns desk handed it back ;
--               cancelled + slug cancelled + picked up.
--               A `released` with no cancellation behind it is NOT a failure.
--               Careful: promote_darb_status maps every `released` to
--               out_for_delivery, so 19 Tripoli parcels read « en livraison »
--               in Ordra (idle up to 105 days on 2026-10-03) although Darb
--               cancelled them and handed them back. Darb's history decides.
--   in_flight   an in-flight status ; cancelled + an active Darb slug ;
--               re-queued after upload (received → confirmed re-send, …).
--   cancelled_before_pickup   everything else.
--   picked up   the earliest of Darb's `assigned` event and the first
--               "with the carrier" status in order_history. The history half
--               covers Tunisia AND Darb parcels older than the timeline mirror
--               (2026-08-17), which have no `assigned` event at all.
--
-- security_invoker: a reader sees only the orders their RLS lets them see
-- (market_manager → own market). SECURITY DEFINER RPCs that read it must
-- check the market themselves.

CREATE OR REPLACE VIEW public.carrier_parcel_outcome
WITH (security_invoker = true) AS
SELECT
  o.id                                   AS order_id,
  o.market_id,
  o.carrier_id,
  o.status                               AS order_status,
  o.tracking_number,
  up.uploaded_at,
  pk.picked_at,
  oc.outcome,
  CASE oc.outcome
    WHEN 'delivered' THEN COALESCE(h.delivered_at, ds.completed_at, ev.completed_at)
    WHEN 'failed'    THEN LEAST(ev.failed_at, h.failed_at)
  END                                    AS outcome_at,
  ds.cancellation_cause                  AS failure_cause,
  ds.remark_class,
  ds.status_slug                         AS darb_status,
  CASE WHEN ds.order_id IS NOT NULL THEN NULLIF(btrim(ds.to_city), '')
       ELSE NULLIF(btrim(o.customer_city), '') END AS city,
  COALESCE(ds.latest_event_at, ds.carrier_updated_at, h.last_at) AS last_move_at,
  COALESCE(ev.n_postponed, 0)::INT       AS n_postponed,
  CASE WHEN oc.outcome = 'failed' THEN COALESCE(ev.handed_back_at, h.handed_back_at) END AS handed_back_at,
  EXISTS (
    SELECT 1 FROM public.inventory_log l
     WHERE l.order_id = o.id AND l.reason IN ('returned', 'received_back', 'damaged_writeoff')
  )                                      AS scanned_back,
  (oc.outcome = 'in_flight'
   AND o.status IN ('uploaded', 'dispatching', 'scanned', 'at_carrier', 'dispatched', 'deposit',
                    'unverified', 'in_transit', 'out_for_delivery', 'delivery_delayed')
   AND (c.code IS DISTINCT FROM 'darb_assabil' OR ds.order_id IS NOT NULL)
  )                                      AS open_at_carrier
FROM public.orders o
LEFT JOIN public.carriers c ON c.id = o.carrier_id
LEFT JOIN LATERAL (
  SELECT s.order_id, s.status_slug, s.cancellation_cause, s.remark_class, s.to_city,
         s.completed_at, s.latest_event_at, s.carrier_updated_at, s.cancel_count
    FROM public.darb_shipments s
   WHERE s.order_id = o.id
   ORDER BY s.carrier_updated_at DESC NULLS LAST
   LIMIT 1
) ds ON TRUE
LEFT JOIN LATERAL (
  SELECT
    min(hh.created_at) FILTER (WHERE hh.status_to = 'uploaded') AS uploaded_at,
    min(hh.created_at) FILTER (WHERE hh.status_to IN (
      'uploaded', 'dispatching', 'scanned', 'at_carrier', 'dispatched', 'deposit', 'unverified', 'in_transit',
      'out_for_delivery', 'delivery_delayed', 'delivered', 'returning', 'to_be_returned', 'returned', 'received'))
                                                                       AS post_upload_at,
    min(hh.created_at) FILTER (WHERE hh.status_to IN (
      'at_carrier', 'dispatched', 'deposit', 'in_transit', 'out_for_delivery', 'delivery_delayed',
      'returning', 'to_be_returned', 'returned'))                      AS pick_at,
    min(hh.created_at) FILTER (WHERE hh.status_to = 'delivered')      AS delivered_at,
    min(hh.created_at) FILTER (WHERE hh.status_to IN ('returning', 'to_be_returned', 'returned', 'received', 'cancelled'))
                                                                       AS failed_at,
    min(hh.created_at) FILTER (WHERE hh.status_to IN ('to_be_returned', 'returned', 'received'))
                                                                       AS handed_back_at,
    max(hh.created_at)                                                 AS last_at
    FROM public.order_history hh
   WHERE hh.order_id = o.id
) h ON TRUE
LEFT JOIN LATERAL (
  SELECT
    min(t.occurred_at) FILTER (WHERE t.type = 'assigned')                                     AS assigned_at,
    min(t.occurred_at) FILTER (WHERE t.type = 'completed')                                    AS completed_at,
    min(t.occurred_at) FILTER (WHERE t.type IN ('cancelled', 'returning', 'returned'))        AS failed_at,
    max(t.occurred_at) FILTER (WHERE t.type IN ('released', 'returned'))                      AS handed_back_at,
    count(*)           FILTER (WHERE t.type = 'delayed')                                      AS n_postponed
    FROM public.darb_timeline_events t
   WHERE t.order_id = o.id
) ev ON TRUE
CROSS JOIN LATERAL (
  SELECT LEAST(h.uploaded_at, h.post_upload_at,
               (SELECT min(s2.carrier_created_at) FROM public.darb_shipments s2 WHERE s2.order_id = o.id)) AS uploaded_at
) up
CROSS JOIN LATERAL (SELECT LEAST(ev.assigned_at, h.pick_at) AS picked_at) pk
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN o.status = 'delivered' OR ds.status_slug = 'completed' THEN 'delivered'
    WHEN o.status IN ('returning', 'to_be_returned', 'returned', 'received')
      OR ds.status_slug IN ('returning', 'returned')
      OR (ds.status_slug = 'released'
          AND (o.status = 'cancelled' OR COALESCE(ds.cancel_count, 0) > 0 OR ev.failed_at IS NOT NULL))
      OR (o.status = 'cancelled' AND ds.status_slug = 'cancelled' AND pk.picked_at IS NOT NULL) THEN 'failed'
    WHEN o.status IN ('uploaded', 'dispatching', 'scanned', 'at_carrier', 'dispatched', 'deposit', 'unverified',
                      'in_transit', 'out_for_delivery', 'delivery_delayed')
      OR (o.status = 'cancelled' AND ds.status_slug IN ('pending', 'booked', 'processing', 'on-branch', 'delayed', 'resent'))
      OR o.status IN ('new', 'assigned', 'pending', 'attempt_1', 'attempt_2', 'attempt_3', 'callback_scheduled',
                      'confirmed', 'dispatch_scheduled') THEN 'in_flight'
    ELSE 'cancelled_before_pickup'
  END AS outcome
) oc
WHERE h.uploaded_at IS NOT NULL
   OR h.post_upload_at IS NOT NULL
   OR ds.order_id IS NOT NULL
   OR o.status IN ('uploaded', 'dispatching', 'scanned', 'at_carrier', 'dispatched', 'deposit', 'unverified',
                   'in_transit', 'out_for_delivery', 'delivery_delayed', 'delivered', 'returning',
                   'to_be_returned', 'returned', 'received');

COMMENT ON VIEW public.carrier_parcel_outcome IS
  'One row per parcel that left for a carrier: delivered | failed | in_flight | cancelled_before_pickup. '
  'The ONE failed-parcel definition (Transporteurs + Produits v6). security_invoker.';

REVOKE ALL ON public.carrier_parcel_outcome FROM PUBLIC, anon;
GRANT SELECT ON public.carrier_parcel_outcome TO authenticated, service_role;
