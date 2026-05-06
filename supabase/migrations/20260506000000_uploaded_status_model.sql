-- ============================================================
-- 20260506000000_uploaded_status_model.sql
-- Decouple confirmation from carrier upload.
--
-- The confirm action becomes atomic and independent of the carrier
-- API: a confirmed order has no tracking yet. A separate "upload"
-- action pushes the order to a carrier and lands it on a new
-- 'uploaded' status. On any upload failure, the order stays
-- 'confirmed' (or 'dispatch_scheduled' for cron-driven uploads) so
-- a retry is just a retry, never a recovery.
--
-- Changes:
--   * New enum value 'uploaded' (after 'dispatch_scheduled').
--   * 'dispatching' is no longer used by application code (it was
--     dead — nothing wrote it). Postgres cannot DROP an enum value
--     without recreating the type, so we leave the value in place
--     and stop referencing it. A defensive UPDATE normalizes any
--     stray rows to 'confirmed'.
--   * transition_order_status: new graph
--       confirmed           → uploaded | dispatch_scheduled | deleted
--       dispatch_scheduled  → uploaded | deleted
--       uploaded            → scanned  | deleted
--       (all 'dispatching' branches removed; 'dispatch_scheduled →
--       confirmed' removed — scheduled orders auto-upload, never
--       revert to plain confirmed)
--   * dispatch_order RPC: now lands on 'uploaded' (not 'dispatched');
--     accepts source statuses 'confirmed' or 'dispatch_scheduled';
--     clears scheduled_dispatch_* on success.
--   * scan_order_out: requires 'uploaded' (not 'confirmed') — only
--     orders with a carrier label can be scanned out.
--   * reopen_order: allowed source statuses become
--       rejected | uploaded | dispatched
--     (was rejected | confirmed | dispatched). Plain 'confirmed'
--     has no carrier work to undo, so reopen does not apply.
--   * create_order_follow_up: post-confirmation gate now includes
--     'uploaded' instead of 'dispatching'.
--   * orders_update RLS: agent allow-list includes 'uploaded'.
-- ============================================================

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'uploaded' AFTER 'dispatch_scheduled';

COMMIT;
BEGIN;

-- Defensive normalization: nothing in the codebase writes 'dispatching'
-- today, but if a row is somehow stuck there, treat it as a failed upload
-- and roll it back to confirmed.
UPDATE orders SET status = 'confirmed' WHERE status = 'dispatching';

-- ------------------------------------------------------------
-- transition_order_status — new graph
-- ------------------------------------------------------------
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
    WHEN 'new' THEN p_new_status IN ('pending', 'attempt_1', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'pending' THEN p_new_status IN ('attempt_1', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'assigned' THEN p_new_status IN ('attempt_1', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'attempt_1' THEN p_new_status IN ('attempt_2', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'attempt_2' THEN p_new_status IN ('attempt_3', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'attempt_3' THEN p_new_status IN ('callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'callback_scheduled' THEN p_new_status IN ('attempt_1', 'attempt_2', 'attempt_3', 'confirmed', 'rejected', 'deleted')
    WHEN 'confirmed' THEN p_new_status IN ('uploaded', 'dispatch_scheduled', 'deleted')
    WHEN 'dispatch_scheduled' THEN p_new_status IN ('uploaded', 'deleted')
    WHEN 'uploaded' THEN p_new_status IN ('scanned', 'deleted')
    WHEN 'scanned' THEN p_new_status IN ('dispatched', 'deleted')
    WHEN 'dispatched' THEN p_new_status IN ('deposit', 'unverified', 'cancelled', 'deleted')
    WHEN 'deposit' THEN p_new_status IN ('in_transit', 'unverified', 'cancelled')
    WHEN 'in_transit' THEN p_new_status IN ('delivered', 'to_be_returned', 'unverified', 'cancelled')
    WHEN 'unverified' THEN p_new_status IN ('dispatched', 'deposit', 'in_transit', 'to_be_returned', 'delivered', 'cancelled')
    WHEN 'to_be_returned' THEN p_new_status IN ('returned', 'received', 'cancelled')
    ELSE false
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'invalid transition from % to %', v_current_status, p_new_status;
  END IF;

  IF p_new_status = 'rejected' AND p_rejection_reason IS NULL THEN
    RAISE EXCEPTION 'rejection_reason is required when transitioning to rejected';
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

-- ------------------------------------------------------------
-- dispatch_order — now lands on 'uploaded'
-- Source: 'confirmed' or 'dispatch_scheduled'.
-- Clears scheduled_dispatch_* on success regardless of source so
-- the cron-driven path doesn't leave stale fields behind.
-- ------------------------------------------------------------
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
    status = 'uploaded',
    carrier_id = p_carrier_id,
    tracking_number = p_tracking_number,
    carrier_extra = p_carrier_extra,
    scheduled_dispatch_at = NULL,
    scheduled_dispatch_auto = false,
    scheduled_dispatch_carrier_id = NULL
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
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
END;
$$;

-- ------------------------------------------------------------
-- scan_order_out — now requires 'uploaded'
-- Stock -1 still happens here. The label_prints check stays in place;
-- with the new model a label can only exist after a successful upload,
-- so this naturally enforces "uploaded → scanned".
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION scan_order_out(
  p_order_id UUID,
  p_actor_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id UUID;
  v_current_status order_status;
  v_product_id UUID;
  v_quantity INTEGER;
  v_market_id UUID;
  v_actor_market_id UUID;
  v_actor_role TEXT;
  v_has_label BOOLEAN;
  v_current_stock INTEGER;
  v_new_stock INTEGER;
  v_log_id UUID;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
BEGIN
  SELECT role, market_id INTO v_actor_role, v_actor_market_id
  FROM users
  WHERE id = p_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id;
  END IF;
  IF v_actor_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Actor role % cannot scan out', v_actor_role;
  END IF;

  SELECT id, status, product_id, quantity, market_id
  INTO v_order_id, v_current_status, v_product_id, v_quantity, v_market_id
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  IF v_actor_role <> 'super_admin' AND v_actor_market_id IS DISTINCT FROM v_market_id THEN
    RAISE EXCEPTION 'Order belongs to a different market';
  END IF;

  IF v_current_status <> 'uploaded' THEN
    RAISE EXCEPTION 'Order is not in uploaded status (current: %)', v_current_status;
  END IF;

  SELECT EXISTS (SELECT 1 FROM label_prints WHERE order_id = p_order_id) INTO v_has_label;
  IF NOT v_has_label THEN
    RAISE EXCEPTION 'Order has no printed label — print label before scanning';
  END IF;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Order has no linked product for stock adjustment';
  END IF;

  SELECT current_stock INTO v_current_stock
  FROM products
  WHERE id = v_product_id
  FOR UPDATE;

  IF v_current_stock IS NULL THEN
    RAISE EXCEPTION 'Product not found: %', v_product_id;
  END IF;

  v_new_stock := v_current_stock - v_quantity;
  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'stock cannot go below zero';
  END IF;

  UPDATE products SET current_stock = v_new_stock WHERE id = v_product_id;

  INSERT INTO inventory_log (product_id, order_id, change, reason, balance_after, is_damaged, actor_id, note)
  VALUES (v_product_id, p_order_id, -v_quantity, 'scanned', v_new_stock, false, p_actor_id, 'Scan sortie entrepôt')
  RETURNING id INTO v_log_id;

  UPDATE orders SET status = 'scanned' WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, 'uploaded', 'scanned', p_actor_id, 'agent', 'Scanné par l''entrepôt')
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', 'scanned',
    'stock_after', v_new_stock,
    'updated_at', v_updated_at,
    'history_id', v_history_id,
    'inventory_log_id', v_log_id
  );
END;
$$;

-- ------------------------------------------------------------
-- reopen_order — allowed source statuses now { rejected, uploaded, dispatched }
-- A plain 'confirmed' order has no carrier work to undo, so reopen
-- does not apply (the agent can transition normally).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION reopen_order(
  p_order_id    UUID,
  p_actor_id    UUID,
  p_void_outcome TEXT DEFAULT 'no_barcode'
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
  SELECT id, status, assigned_to, updated_at
    INTO v_order_id, v_status, v_assigned_to, v_updated_at
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  IF v_assigned_to IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Order not assigned to actor';
  END IF;

  IF v_status NOT IN ('rejected', 'uploaded', 'dispatched') THEN
    RAISE EXCEPTION 'Cannot reopen order in status %', v_status;
  END IF;

  IF v_updated_at < NOW() - INTERVAL '7 days' THEN
    RAISE EXCEPTION 'Reopen window expired (updated_at = %)', v_updated_at;
  END IF;

  v_history_note := CASE p_void_outcome
    WHEN 'carrier_voided' THEN 'Reouvert - code-barres annule chez transporteur'
    WHEN 'local_only'     THEN 'Reouvert - annulation transporteur echouee, coordination manuelle requise'
    ELSE                       'Reouvert par agent'
  END;

  UPDATE orders
  SET
    status = 'pending',
    tracking_number = NULL,
    carrier_id = NULL,
    carrier_extra = NULL,
    rejection_reason = NULL,
    rejection_note = NULL,
    updated_at = NOW()
  WHERE id = p_order_id;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_status, 'pending'::order_status, p_actor_id, 'agent', v_history_note);

  RETURN json_build_object(
    'order_id',     p_order_id,
    'from_status',  v_status,
    'void_outcome', p_void_outcome
  );
END;
$$;

-- ------------------------------------------------------------
-- create_order_follow_up — replace 'dispatching' with 'uploaded'
-- in the post-confirmation gate.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_order_follow_up(
  p_order_id           UUID,
  p_actor_id           UUID,
  p_actor_type         TEXT,
  p_delivery_man_phone TEXT DEFAULT NULL,
  p_description        TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order              orders%ROWTYPE;
  v_confirming_agent   UUID;
  v_follow_up_id       UUID;
  v_entry_id           UUID;
  v_updated_at         TIMESTAMPTZ;
BEGIN
  IF p_actor_type NOT IN ('system', 'agent', 'manager', 'super_admin') THEN
    RAISE EXCEPTION 'invalid actor_type: %', p_actor_type;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  IF v_order.status NOT IN ('confirmed', 'uploaded', 'dispatched', 'deposit', 'in_transit', 'to_be_returned') THEN
    RAISE EXCEPTION 'Order must be post-confirmation to open a follow-up (current status=%)', v_order.status;
  END IF;

  SELECT actor_id INTO v_confirming_agent
  FROM order_history
  WHERE order_id = p_order_id
    AND status_to = 'confirmed'
    AND actor_type = 'agent'
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO order_follow_ups (
    market_id, order_id, status, delivery_man_phone, description,
    confirming_agent_id, created_by
  )
  VALUES (
    v_order.market_id, p_order_id, 'open', p_delivery_man_phone, p_description,
    v_confirming_agent, p_actor_id
  )
  RETURNING id, updated_at INTO v_follow_up_id, v_updated_at;

  INSERT INTO order_follow_up_entries (follow_up_id, status_from, status_to, note, actor_id, actor_type)
  VALUES (v_follow_up_id, NULL, 'open', 'Follow-up created', p_actor_id, p_actor_type)
  RETURNING id INTO v_entry_id;

  RETURN json_build_object(
    'follow_up_id',        v_follow_up_id,
    'order_id',            p_order_id,
    'status',              'open',
    'confirming_agent_id', v_confirming_agent,
    'updated_at',          v_updated_at,
    'entry_id',            v_entry_id
  );
END;
$$;

-- ------------------------------------------------------------
-- orders RLS — agent allow-list for UPDATE includes 'uploaded'
-- so agents can re-trigger upload retries on their assigned orders.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "orders_update" ON orders;
CREATE POLICY "orders_update"
  ON orders FOR UPDATE
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (
      get_user_role() = 'agent'
      AND assigned_to = auth.uid()
      AND status IN (
        'pending',
        'assigned',
        'attempt_1',
        'attempt_2',
        'attempt_3',
        'callback_scheduled',
        'confirmed',
        'dispatch_scheduled',
        'uploaded'
      )
    )
  )
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (
      get_user_role() = 'agent'
      AND assigned_to = auth.uid()
      AND status IN (
        'pending',
        'assigned',
        'attempt_1',
        'attempt_2',
        'attempt_3',
        'callback_scheduled',
        'confirmed',
        'dispatch_scheduled',
        'uploaded'
      )
    )
  );

COMMIT;
