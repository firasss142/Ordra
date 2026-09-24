-- ============================================================
-- 20260817000001_promote_darb_status.sql
-- promote_darb_status: promote a Darb Assabil order's OMS status from a
-- carrier-side TERMINAL status, and persist the cached carrier slug + reference.
--
-- Context (Libya / Darb only):
--   Libya uses the confirmation system only — no warehouse, no stock, no
--   scan-out, no cost/deposit boundaries. Darb exposes a single status enum that
--   jumps straight to a terminal state. So unlike the Tunisia pipeline, a Darb
--   order legitimately moves uploaded -> delivered/returned/cancelled directly.
--   This RPC is the ONLY sanctioned path for that jump.
--
-- Model ("like Dexpress" — see plans/darb-assabil-status-sync-fix.md):
--   orders.status flips ONLY for the 3 terminal Darb states:
--     completed -> delivered, returned -> returned, cancelled -> cancelled.
--   In-flight Darb states (pending/booked/processing/on-branch/released/resent/
--   delayed/returning) do NOT touch orders.status — the caller writes only
--   carrier_status_slug for those (display pill), exactly like Dexpress.
--
-- HARD RULES honored:
--   * order_history is APPEND-ONLY — we INSERT one row, never update/delete.
--   * No stock / cost / revenue side-effects (irrelevant for Libya).
--   * Idempotent: if the order is already at the target terminal status, no-op.
--   * Guarded: only promotes Darb orders, and only from a promotable status.
--
-- Safe to run on existing terminal orders repeatedly.
-- ============================================================

CREATE OR REPLACE FUNCTION promote_darb_status(
  p_order_id   UUID,
  p_slug       TEXT,                 -- normalized Darb slug (e.g. 'completed')
  p_reference  TEXT DEFAULT NULL,    -- real carrier reference to repair tracking_number
  p_synced_at  TIMESTAMPTZ DEFAULT now(),
  p_actor_id   UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status order_status;
  v_carrier_id     UUID;
  v_carrier_code   TEXT;
  v_target_status  order_status;
  v_promoted       BOOLEAN := FALSE;
  v_history_id     UUID;
  v_updated_at     TIMESTAMPTZ;
BEGIN
  -- Lock the order row first (no join — FOR UPDATE can't apply to the nullable
  -- side of an outer join).
  SELECT status, carrier_id
    INTO v_current_status, v_carrier_id
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- Resolve carrier code separately.
  SELECT code INTO v_carrier_code FROM carriers WHERE id = v_carrier_id;

  IF v_carrier_code IS DISTINCT FROM 'darb_assabil' THEN
    RAISE EXCEPTION 'promote_darb_status only applies to Darb Assabil orders (got %)', v_carrier_code;
  END IF;

  -- Map terminal Darb slug -> OMS status. Non-terminal slugs leave status alone.
  v_target_status := CASE p_slug
    WHEN 'completed' THEN 'delivered'::order_status
    WHEN 'returned'  THEN 'returned'::order_status
    WHEN 'cancelled' THEN 'cancelled'::order_status
    ELSE NULL
  END;

  -- Decide whether to promote orders.status.
  IF v_target_status IS NOT NULL THEN
    IF v_current_status = v_target_status THEN
      -- Already there: idempotent no-op for status (still refresh slug/ref below).
      v_promoted := FALSE;
    ELSIF v_current_status = 'uploaded' THEN
      -- The sanctioned Darb jump. (uploaded is the only state Darb orders sit in
      -- pre-terminal, since Libya skips the scan/dispatch pipeline.)
      v_promoted := TRUE;
    ELSE
      -- Any other current status (already terminal/elsewhere) — do NOT override.
      -- Refresh slug/ref only; leave status untouched and report skipped.
      v_promoted := FALSE;
    END IF;
  END IF;

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
    -- No status change: just refresh the projection columns (+ optional reference).
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
    'status', COALESCE(v_target_status, v_current_status),
    'slug', p_slug,
    'tracking_number', p_reference,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
END;
$$;

COMMENT ON FUNCTION promote_darb_status IS
  'Promotes a Darb Assabil order from a terminal carrier status (completed->delivered, returned->returned, cancelled->cancelled) and refreshes carrier_status_slug / tracking_number. Append-only order_history, idempotent, Darb-only, no stock/cost side-effects. See plans/darb-assabil-status-sync-fix.md';
