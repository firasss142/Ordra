-- Darb Assabil returns must land on the warehouse bench, not close the order.
--
-- WHY
--   promote_darb_status mapped the carrier slug `returned` straight to the
--   TERMINAL status `returned`, from `uploaded`, with no stock movement. So a
--   parcel physically coming back to the Libyan warehouse was already "done"
--   in the OMS: the returns console (which lists `to_be_returned`) never saw
--   it, a scan at the returns bench answered "wrong status: returned", and
--   the units never re-entered stock — 103 Libyan orders to date, all with
--   zero inventory_log rows. `returning` (on its way back) was not mapped at
--   all.
--
--   The warehouse already has the right instrument: the three-decision
--   returns scan (restock / damaged / redeliver) that sets `returned` or
--   `received` AND moves stock. The sync's job is only to put the parcel in
--   that inbox.
--
-- WHAT CHANGES
--   · `returning` and `returned` → `to_be_returned` (non-terminal). The
--     bench finalises with scan_return_in / scan_received_in.
--   · Promotion no longer requires `uploaded`: since the bench scans out
--     through the OMS, Darb parcels are `scanned` when the carrier reports
--     on them, and a `scanned → delivered` promotion is exactly right. Every
--     in-flight status promotes; terminal statuses and the two bench-owned
--     statuses (`to_be_returned`, `received`) only get their slug refreshed.
--   · Historical orders already closed as `returned` are NOT rewritten here
--     (terminal rows feed investor facts). They are listed for a manual stock
--     decision by `scripts/wh-test-fixture.ts report-returns`.
--
-- Same signature, same JSON shape, still append-only on order_history.

CREATE OR REPLACE FUNCTION public.promote_darb_status(
  p_order_id uuid,
  p_slug text,
  p_reference text DEFAULT NULL,
  p_synced_at timestamptz DEFAULT now(),
  p_actor_id uuid DEFAULT NULL
)
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
  -- Statuses the carrier's word may move. Everything else is either terminal
  -- or owned by the bench.
  v_in_flight CONSTANT order_status[] :=
    ARRAY['uploaded','scanned','dispatched','deposit','in_transit']::order_status[];
BEGIN
  SELECT status, carrier_id
    INTO v_current_status, v_carrier_id
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  SELECT code INTO v_carrier_code FROM carriers WHERE id = v_carrier_id;

  IF v_carrier_code IS DISTINCT FROM 'darb_assabil' THEN
    RAISE EXCEPTION 'promote_darb_status only applies to Darb Assabil orders (got %)', v_carrier_code;
  END IF;

  v_target_status := CASE p_slug
    WHEN 'completed' THEN 'delivered'::order_status
    WHEN 'returning' THEN 'to_be_returned'::order_status
    WHEN 'returned'  THEN 'to_be_returned'::order_status
    WHEN 'cancelled' THEN 'cancelled'::order_status
    ELSE NULL
  END;

  v_promoted := v_target_status IS NOT NULL
    AND v_current_status <> v_target_status
    AND v_current_status = ANY (v_in_flight);

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
