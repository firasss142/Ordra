-- ============================================================
-- 20260421_scheduled_dispatch.sql
-- Scheduled-dispatch feature: a confirmed order can be held for
-- automatic or manual dispatch at a future time chosen by the agent.
--
-- Example client reason: "Confirm the order, but ship it end of the
-- month when I get paid."
--
-- Changes:
--   * New order_status enum value: 'dispatch_scheduled'
--   * New columns on orders:
--       scheduled_dispatch_at         TIMESTAMPTZ
--       scheduled_dispatch_auto       BOOLEAN   NOT NULL DEFAULT false
--       scheduled_dispatch_carrier_id UUID      REFERENCES carriers(id)
--   * Partial indexes for the queue filter + the auto-dispatch cron
--   * Extended transition_order_status RPC accepting the scheduled-dispatch
--     params (and still accepting p_callback_at so the callback route keeps
--     working). A transition OUT of 'dispatch_scheduled' clears the three
--     scheduled_dispatch_* columns back to null/false.
--   * New RPC dispatch_scheduled_ready() — used by the cron endpoint to
--     atomically fetch the next batch of auto-dispatch rows whose time has
--     arrived.
-- ============================================================

-- 1. Enum value (must be committed before referencing in subsequent queries)
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'dispatch_scheduled' AFTER 'confirmed';

COMMIT;
BEGIN;

-- 2. Columns
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS scheduled_dispatch_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_dispatch_auto BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scheduled_dispatch_carrier_id UUID REFERENCES carriers(id);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_orders_dispatch_scheduled_due
  ON orders (scheduled_dispatch_at)
  WHERE status = 'dispatch_scheduled';

CREATE INDEX IF NOT EXISTS idx_orders_dispatch_scheduled_auto_due
  ON orders (scheduled_dispatch_at)
  WHERE status = 'dispatch_scheduled' AND scheduled_dispatch_auto = true;

-- 4. transition_order_status — extended signature
--    Adds p_callback_at (restored — had been dropped by the warehouse migration)
--    and p_scheduled_at / p_scheduled_auto / p_scheduled_carrier_id.
--    Transition graph now allows: confirmed → dispatch_scheduled,
--    dispatch_scheduled → {confirmed, scanned, cancelled}.
CREATE OR REPLACE FUNCTION transition_order_status(
  p_order_id UUID,
  p_new_status order_status,
  p_actor_id UUID DEFAULT NULL,
  p_actor_type TEXT DEFAULT 'system',
  p_note TEXT DEFAULT NULL,
  p_rejection_reason rejection_reason DEFAULT NULL,
  p_rejection_note TEXT DEFAULT NULL,
  p_callback_at TIMESTAMPTZ DEFAULT NULL,
  p_scheduled_at TIMESTAMPTZ DEFAULT NULL,
  p_scheduled_auto BOOLEAN DEFAULT NULL,
  p_scheduled_carrier_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status order_status;
  v_order_id UUID;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
  v_valid BOOLEAN := false;
BEGIN
  SELECT id, status INTO v_order_id, v_current_status
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  v_valid := CASE v_current_status
    WHEN 'new' THEN p_new_status IN ('assigned')
    WHEN 'assigned' THEN p_new_status IN ('attempt_1', 'callback_scheduled', 'confirmed', 'rejected', 'cancelled')
    WHEN 'attempt_1' THEN p_new_status IN ('attempt_2', 'callback_scheduled', 'confirmed', 'rejected', 'cancelled')
    WHEN 'attempt_2' THEN p_new_status IN ('attempt_3', 'callback_scheduled', 'confirmed', 'rejected', 'cancelled')
    WHEN 'attempt_3' THEN p_new_status IN ('callback_scheduled', 'confirmed', 'rejected', 'cancelled')
    WHEN 'callback_scheduled' THEN p_new_status IN ('attempt_1', 'attempt_2', 'attempt_3', 'confirmed', 'rejected', 'cancelled')
    WHEN 'confirmed' THEN p_new_status IN ('scanned', 'cancelled', 'dispatch_scheduled')
    WHEN 'dispatch_scheduled' THEN p_new_status IN ('confirmed', 'scanned', 'cancelled')
    WHEN 'scanned' THEN p_new_status IN ('dispatched', 'cancelled')
    WHEN 'dispatched' THEN p_new_status IN ('deposit', 'cancelled')
    WHEN 'deposit' THEN p_new_status IN ('in_transit')
    WHEN 'in_transit' THEN p_new_status IN ('delivered', 'to_be_returned')
    WHEN 'to_be_returned' THEN p_new_status IN ('returned')
    ELSE false
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'invalid transition from % to %', v_current_status, p_new_status;
  END IF;

  UPDATE orders
  SET
    status = p_new_status,
    rejection_reason = CASE WHEN p_new_status = 'rejected' THEN p_rejection_reason ELSE rejection_reason END,
    rejection_note   = CASE WHEN p_new_status = 'rejected' THEN p_rejection_note   ELSE rejection_note END,
    callback_scheduled_at = CASE
      WHEN p_new_status = 'callback_scheduled' THEN p_callback_at
      WHEN v_current_status = 'callback_scheduled' THEN NULL
      ELSE callback_scheduled_at
    END,
    scheduled_dispatch_at = CASE
      WHEN p_new_status = 'dispatch_scheduled' THEN p_scheduled_at
      WHEN v_current_status = 'dispatch_scheduled' THEN NULL
      ELSE scheduled_dispatch_at
    END,
    scheduled_dispatch_auto = CASE
      WHEN p_new_status = 'dispatch_scheduled' THEN COALESCE(p_scheduled_auto, false)
      WHEN v_current_status = 'dispatch_scheduled' THEN false
      ELSE scheduled_dispatch_auto
    END,
    scheduled_dispatch_carrier_id = CASE
      WHEN p_new_status = 'dispatch_scheduled' THEN p_scheduled_carrier_id
      WHEN v_current_status = 'dispatch_scheduled' THEN NULL
      ELSE scheduled_dispatch_carrier_id
    END
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_current_status, p_new_status, p_actor_id, p_actor_type, p_note)
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', p_new_status,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
END;
$$;

-- 5. dispatch_scheduled_ready — locking batch fetch for the cron job
--    Returns rows that are ready to auto-dispatch and LOCKs them so a
--    concurrent cron run can't grab the same rows. Caller still performs
--    the dispatch via the normal dispatch_order RPC.
CREATE OR REPLACE FUNCTION dispatch_scheduled_ready(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  order_id UUID,
  carrier_id UUID,
  scheduled_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT id, scheduled_dispatch_carrier_id, scheduled_dispatch_at
  FROM orders
  WHERE status = 'dispatch_scheduled'
    AND scheduled_dispatch_auto = true
    AND scheduled_dispatch_carrier_id IS NOT NULL
    AND scheduled_dispatch_at IS NOT NULL
    AND scheduled_dispatch_at <= now()
  ORDER BY scheduled_dispatch_at ASC
  LIMIT p_limit
  FOR UPDATE SKIP LOCKED;
$$;

COMMIT;
