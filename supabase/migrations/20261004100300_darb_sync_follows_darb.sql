-- promote_darb_status follows Darb to the end (plans/products-redesign-v6.md Phase 3).
--
-- THE BUG. Darb « cancelled » mapped to Ordra's TERMINAL `cancelled`. Darb keeps
-- working the parcel afterwards — it brings it back through its returns desk
-- (« رواجع جاهزة للتسليم », slug `released`) or delivers it after all
-- (`completed`) — and Ordra never heard of it again. All time, Libya: 445
-- cancelled orders were handed back (a physical return nobody scanned, stock
-- never received) and 37 were delivered (32 already paid out, 7 571 LYD of
-- revenue missing). Measured 2026-10-03.
--
-- THE FIX, for every Darb event read from now on:
--   · `cancelled` AFTER pickup (a courier grabbed it: an `assigned` timeline
--     event, or Ordra already had it at the carrier) → `returning`: the parcel is
--     coming back. Not terminal, so a later `released` or `completed` still lands.
--     `cancelled` BEFORE pickup stays `cancelled`.
--   · `released` that follows a cancellation or a return — Ordra already has it
--     `returning`, or the shipment carries a cancel (cancel_count > 0, or a
--     cancelled / returning / returned timeline event) — means "handed back by
--     the returns desk" → `to_be_returned`, where the bench can scan it. Any
--     other `released` is still "out with a courier". Same rule as the shared
--     view carrier_parcel_outcome (20261004090000), so the pages and the status
--     agree.
--
-- WHAT IT DOES NOT DO. Orders already `cancelled` are not touched (`cancelled`
-- is not a promotable status here). Bringing the history back is a separate,
-- gated script — supabase/scripts/darb-cancelled-history-dry-run.sql first,
-- then …-apply.sql only once the owner has read the dry run.
--
-- Same signature: CREATE OR REPLACE keeps the grants.

CREATE OR REPLACE FUNCTION public.promote_darb_status(p_order_id uuid, p_slug text, p_reference text DEFAULT NULL::text, p_synced_at timestamp with time zone DEFAULT now(), p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_current_status order_status;
  v_carrier_id     UUID;
  v_carrier_code   TEXT;
  v_target_status  order_status;
  v_promoted       BOOLEAN := FALSE;
  v_history_id     UUID;
  v_updated_at     TIMESTAMPTZ;
  v_picked         BOOLEAN;
  v_after_cancel   BOOLEAN;
  v_in_flight CONSTANT order_status[] := ARRAY[
    'uploaded','scanned','at_carrier','dispatched','deposit','unverified',
    'in_transit','out_for_delivery','delivery_delayed','returning'
  ]::order_status[];
BEGIN
  SELECT status, carrier_id INTO v_current_status, v_carrier_id
  FROM orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id
      USING DETAIL = '{"code":"ORDER_NOT_FOUND"}';
  END IF;

  SELECT code INTO v_carrier_code FROM carriers WHERE id = v_carrier_id;

  IF v_carrier_code IS DISTINCT FROM 'darb_assabil' THEN
    RAISE EXCEPTION 'promote_darb_status only applies to Darb Assabil orders (got %)', v_carrier_code
      USING DETAIL = '{"code":"WRONG_CARRIER"}';
  END IF;

  -- Did a courier take it? (Same pickup rule as carrier_parcel_outcome.)
  v_picked := v_current_status IN ('at_carrier','in_transit','out_for_delivery','delivery_delayed','returning')
    OR EXISTS (SELECT 1 FROM darb_timeline_events e WHERE e.order_id = p_order_id AND e.type = 'assigned');

  -- Is there a cancellation or a return behind this shipment?
  v_after_cancel := v_current_status IN ('returning','to_be_returned')
    OR EXISTS (SELECT 1 FROM darb_shipments s WHERE s.order_id = p_order_id AND COALESCE(s.cancel_count, 0) > 0)
    OR EXISTS (SELECT 1 FROM darb_timeline_events e
               WHERE e.order_id = p_order_id AND e.type IN ('cancelled','returning','returned'));

  v_target_status := CASE p_slug
    -- Réservé / en préparation : le colis est physiquement chez eux.
    WHEN 'booked'     THEN 'at_carrier'::order_status
    WHEN 'processing' THEN 'at_carrier'::order_status
    -- Arrivé dans un centre de tri.
    WHEN 'on-branch'  THEN 'in_transit'::order_status
    -- Sorti pour livraison… sauf s'il revient : alors « released » = rendu au
    -- guichet retours, et le banc peut le scanner.
    WHEN 'released'   THEN CASE WHEN v_after_cancel THEN 'to_be_returned'::order_status
                                ELSE 'out_for_delivery'::order_status END
    WHEN 'resent'     THEN 'out_for_delivery'::order_status
    WHEN 'delayed'    THEN 'delivery_delayed'::order_status
    -- En route vers nous : le banc ne peut pas encore le recevoir.
    WHEN 'returning'  THEN 'returning'::order_status
    -- Revenu : le banc peut le scanner.
    WHEN 'returned'   THEN 'to_be_returned'::order_status
    WHEN 'completed'  THEN 'delivered'::order_status
    -- Annulé par Darb : après prise en charge le colis REVIENT (pas terminal) ;
    -- avant, la commande est annulée.
    WHEN 'cancelled'  THEN CASE WHEN v_picked THEN 'returning'::order_status
                                ELSE 'cancelled'::order_status END
    ELSE NULL
  END;

  v_promoted := v_target_status IS NOT NULL
    AND v_current_status <> v_target_status
    AND v_current_status = ANY (v_in_flight)
    AND public.order_status_rank(v_target_status) >= public.order_status_rank(v_current_status);

  IF v_promoted THEN
    UPDATE orders
    SET status = v_target_status,
        carrier_status_slug = p_slug,
        carrier_status_synced_at = p_synced_at,
        tracking_number = COALESCE(p_reference, tracking_number)
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;

    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (p_order_id, v_current_status, v_target_status, p_actor_id, 'system',
            'Darb Assabil carrier status: ' || p_slug)
    RETURNING id INTO v_history_id;
  ELSE
    UPDATE orders
    SET carrier_status_slug = p_slug,
        carrier_status_synced_at = p_synced_at,
        tracking_number = COALESCE(p_reference, tracking_number)
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;
  END IF;

  RETURN json_build_object(
    'order_id', p_order_id,
    'promoted', v_promoted,
    'status', CASE WHEN v_promoted THEN v_target_status ELSE v_current_status END,
    'slug', p_slug,
    'tracking_number', p_reference,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
END;
$function$;
