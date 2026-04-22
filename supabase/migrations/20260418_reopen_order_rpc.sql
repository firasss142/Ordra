-- ============================================================
-- 20260418_reopen_order_rpc.sql
-- Add reopen_order RPC: agent reopens rejected/confirmed/dispatched
-- orders within a 7-day window. Clears carrier data and rejection
-- fields, transitions back to 'assigned', appends one history row.
-- ============================================================

CREATE OR REPLACE FUNCTION reopen_order(
  p_order_id    UUID,
  p_actor_id    UUID,
  p_void_outcome TEXT DEFAULT 'no_barcode'  -- 'carrier_voided' | 'local_only' | 'no_barcode'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id    UUID;
  v_status      order_status;
  v_assigned_to UUID;
  v_updated_at  TIMESTAMPTZ;
  v_history_note TEXT;
BEGIN
  -- Lock the row
  SELECT id, status, assigned_to, updated_at
    INTO v_order_id, v_status, v_assigned_to, v_updated_at
    FROM orders
   WHERE id = p_order_id
     FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- Must be assigned to the calling agent
  IF v_assigned_to IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Order not assigned to actor';
  END IF;

  -- Only reopenable statuses
  IF v_status NOT IN ('rejected', 'confirmed', 'dispatched') THEN
    RAISE EXCEPTION 'Cannot reopen order in status %', v_status;
  END IF;

  -- 7-day window
  IF v_updated_at < NOW() - INTERVAL '7 days' THEN
    RAISE EXCEPTION 'Reopen window expired (updated_at = %)', v_updated_at;
  END IF;

  -- Build history note from void outcome
  v_history_note := CASE p_void_outcome
    WHEN 'carrier_voided' THEN 'Réouvert — code-barres annulé chez transporteur'
    WHEN 'local_only'     THEN 'Réouvert — annulation transporteur échouée, coordination manuelle requise'
    ELSE                       'Réouvert par agent'
  END;

  -- Transition to assigned, clear carrier + rejection fields
  UPDATE orders
     SET status            = 'assigned',
         tracking_number   = NULL,
         carrier_id        = NULL,
         carrier_extra     = NULL,
         rejection_reason  = NULL,
         rejection_note    = NULL,
         updated_at        = NOW()
   WHERE id = p_order_id;

  -- Append single history row
  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_status, 'assigned'::order_status, p_actor_id, 'agent', v_history_note);

  RETURN json_build_object(
    'order_id',     p_order_id,
    'from_status',  v_status,
    'void_outcome', p_void_outcome
  );
END;
$$;
