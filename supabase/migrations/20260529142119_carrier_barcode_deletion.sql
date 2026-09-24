-- ============================================================
-- 20260620000001_carrier_barcode_deletion.sql
-- Support manual deletion of a carrier barcode from the OMS:
--   1. Persist that an order was previously uploaded and then voided,
--      so the UI can flag it after tracking_number is wiped.
--   2. Allow carrier_event_log.source = 'barcode_deletion'.
--   3. RPC: atomic status rollback uploaded → confirmed + history row.
-- ============================================================

-- 1. Order-level deletion markers
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS carrier_barcode_deleted_at TIMESTAMPTZ;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS carrier_barcode_deleted_carrier_code TEXT;

-- 2. Allow carrier_event_log.source to record manual barcode deletions
ALTER TABLE carrier_event_log
  DROP CONSTRAINT IF EXISTS carrier_event_log_source_check;
ALTER TABLE carrier_event_log
  ADD CONSTRAINT carrier_event_log_source_check
    CHECK (source IN ('poll', 'webhook', 'barcode_deletion'));

-- 3. RPC: delete_carrier_barcode
CREATE OR REPLACE FUNCTION delete_carrier_barcode(
  p_order_id     UUID,
  p_actor_id     UUID,
  p_void_outcome TEXT  -- 'carrier_voided' | 'local_only'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status        order_status;
  v_tracking      TEXT;
  v_carrier_code  TEXT;
  v_history_note  TEXT;
BEGIN
  SELECT o.status, o.tracking_number, c.code
    INTO v_status, v_tracking, v_carrier_code
    FROM orders o
    LEFT JOIN carriers c ON c.id = o.carrier_id
   WHERE o.id = p_order_id
     FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  IF v_status <> 'uploaded' THEN
    RAISE EXCEPTION 'Cannot delete barcode: order in status %', v_status;
  END IF;

  IF v_tracking IS NULL THEN
    RAISE EXCEPTION 'Order has no tracking number to delete';
  END IF;

  v_history_note := CASE p_void_outcome
    WHEN 'carrier_voided' THEN 'Code-barres supprimé chez transporteur'
    WHEN 'local_only'     THEN 'Code-barres supprimé localement — coordination manuelle requise chez transporteur'
    ELSE                       'Code-barres supprimé'
  END;

  UPDATE orders
     SET status                                = 'confirmed',
         tracking_number                       = NULL,
         carrier_id                            = NULL,
         carrier_extra                         = NULL,
         carrier_barcode_deleted_at            = NOW(),
         carrier_barcode_deleted_carrier_code  = v_carrier_code,
         updated_at                            = NOW()
   WHERE id = p_order_id;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, 'uploaded'::order_status, 'confirmed'::order_status,
          p_actor_id, 'agent', v_history_note);

  RETURN json_build_object(
    'order_id', p_order_id,
    'previous_tracking', v_tracking,
    'void_outcome', p_void_outcome
  );
END;
$$;

-- 4. Recreate dispatch_order so a successful re-upload clears the deletion
--    markers. Same body as 20260506000000 with the two extra columns nulled
--    out — keeps the badge logic single-sourced (the column value is the
--    truth; if it's NULL, the order is currently uploaded or never uploaded).
CREATE OR REPLACE FUNCTION dispatch_order(
  p_order_id UUID,
  p_carrier_id UUID,
  p_tracking_number TEXT,
  p_carrier_extra JSONB DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status     order_status;
  v_order_id           UUID;
  v_order_market_id    UUID;
  v_carrier_market_id  UUID;
  v_carrier_active     BOOLEAN;
  v_history_id         UUID;
  v_updated_at         TIMESTAMPTZ;
BEGIN
  SELECT id, status, market_id
    INTO v_order_id, v_current_status, v_order_market_id
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  SELECT market_id, is_active
    INTO v_carrier_market_id, v_carrier_active
  FROM carriers
  WHERE id = p_carrier_id;

  IF v_carrier_market_id IS NULL THEN
    RAISE EXCEPTION 'Carrier not found: %', p_carrier_id;
  END IF;

  IF v_carrier_market_id <> v_order_market_id THEN
    RAISE EXCEPTION 'Carrier does not belong to the order''s market';
  END IF;

  IF NOT v_carrier_active THEN
    RAISE EXCEPTION 'Carrier is not active';
  END IF;

  IF v_current_status NOT IN ('confirmed', 'dispatch_scheduled') THEN
    RAISE EXCEPTION 'Order must be confirmed or dispatch_scheduled to upload, current status: %', v_current_status;
  END IF;

  UPDATE orders
  SET
    status                                = 'uploaded',
    carrier_id                            = p_carrier_id,
    tracking_number                       = p_tracking_number,
    carrier_extra                         = p_carrier_extra,
    scheduled_dispatch_at                 = NULL,
    scheduled_dispatch_auto               = false,
    scheduled_dispatch_carrier_id         = NULL,
    carrier_barcode_deleted_at            = NULL,
    carrier_barcode_deleted_carrier_code  = NULL
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_current_status, 'uploaded', p_actor_id, 'system',
    'Téléchargé chez transporteur, suivi : ' || p_tracking_number)
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', 'uploaded',
    'tracking_number', p_tracking_number,
    'carrier_id', p_carrier_id,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
END;
$$;
