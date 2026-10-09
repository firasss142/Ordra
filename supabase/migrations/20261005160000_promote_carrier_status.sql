-- ============================================================
-- 20261005160000_promote_carrier_status.sql
--
-- A carrier-agnostic, rank-guarded status promoter, first for X-Delivery (Tunisia).
-- Plan: plans/xdelivery-integration.md.
--
-- WHY A NEW FUNCTION, NOT A CHANGE. Tunisia's carrier path
-- (fulfill_order_transition) is a strict chain built for Navex, and it lands
-- returns on `returned` from the carrier, stock included, with no warehouse scan.
-- X-Delivery's real lifecycle is Darb's: out ⇄ delayed, then refused → coming
-- back → receivable at the bench. So its parcels use the statuses Ordra already
-- has, ranked by order_status_rank, exactly as promote_darb_status does.
--
-- NOTHING SHARED IS EDITED: not the enum, not order_status_rank, not
-- promote_darb_status, fulfill_order_transition, scan_return_in or the worklist.
-- Libya cannot be affected, and Darb is explicitly refused here so its own
-- promoter stays the only path for it.
--
-- The vendor vocabulary is mapped in TypeScript (src/lib/carriers/xdelivery-statuses.ts);
-- this function only enforces the invariants:
--   * the order's carrier must be the caller's carrier, and not Darb;
--   * never backwards (rank), never out of a terminal state;
--   * never `returned` / `received` — stock comes back only through scan_return_in;
--   * a delivered parcel the carrier later turns into a return STAYS delivered,
--     and the answer says so (`conflict`) — owner decision 2026-10-05.
--   * service_role only: the webhook and the sync job call it, never a browser.
-- ============================================================

CREATE OR REPLACE FUNCTION public.promote_carrier_status(
  p_order_id     UUID,
  p_carrier_code TEXT,
  p_target       order_status,
  p_slug         TEXT,
  p_note         TEXT DEFAULT NULL,
  p_synced_at    TIMESTAMPTZ DEFAULT now()
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_status order_status;
  v_carrier_code   TEXT;
  v_promoted       BOOLEAN := FALSE;
  v_conflict       TEXT;
  v_history_id     UUID;
  v_updated_at     TIMESTAMPTZ;
  v_in_flight CONSTANT order_status[] := ARRAY[
    'uploaded','scanned','at_carrier','dispatched','deposit','unverified',
    'in_transit','out_for_delivery','delivery_delayed','returning','to_be_returned'
  ]::order_status[];
BEGIN
  IF p_carrier_code = 'darb_assabil' THEN
    RAISE EXCEPTION 'Darb Assabil has its own promoter (promote_darb_status)'
      USING DETAIL = '{"code":"WRONG_CARRIER"}';
  END IF;

  IF p_target IN ('returned', 'received') THEN
    RAISE EXCEPTION 'A carrier cannot set %: stock comes back only through the warehouse return scan', p_target
      USING DETAIL = '{"code":"SCAN_ONLY_STATUS"}';
  END IF;

  SELECT o.status, c.code INTO v_current_status, v_carrier_code
  FROM orders o LEFT JOIN carriers c ON c.id = o.carrier_id
  WHERE o.id = p_order_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id
      USING DETAIL = '{"code":"ORDER_NOT_FOUND"}';
  END IF;

  IF v_carrier_code IS DISTINCT FROM p_carrier_code THEN
    RAISE EXCEPTION 'Order % belongs to carrier %, not %', p_order_id, v_carrier_code, p_carrier_code
      USING DETAIL = '{"code":"WRONG_CARRIER"}';
  END IF;

  IF v_current_status = 'delivered' AND p_target IN ('returning', 'to_be_returned') THEN
    v_conflict := 'delivered_then_returned';
  END IF;

  v_promoted := p_target IS NOT NULL
    AND v_current_status <> p_target
    AND v_current_status = ANY (v_in_flight)
    AND public.order_status_rank(p_target) >= public.order_status_rank(v_current_status);

  IF v_promoted THEN
    UPDATE orders
    SET status = p_target,
        carrier_status_slug = p_slug,
        carrier_status_synced_at = p_synced_at
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;

    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (p_order_id, v_current_status, p_target, NULL, 'system',
            COALESCE(p_note, p_carrier_code || ': ' || p_slug))
    RETURNING id INTO v_history_id;
  ELSE
    UPDATE orders
    SET carrier_status_slug = p_slug,
        carrier_status_synced_at = p_synced_at
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;
  END IF;

  RETURN json_build_object(
    'order_id', p_order_id,
    'promoted', v_promoted,
    'status', CASE WHEN v_promoted THEN p_target ELSE v_current_status END,
    'slug', p_slug,
    'conflict', v_conflict,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
END;
$function$;

-- EXECUTE goes to PUBLIC by default, and anon inherits it. Revoke first.
REVOKE ALL ON FUNCTION public.promote_carrier_status(UUID, TEXT, order_status, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_carrier_status(UUID, TEXT, order_status, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;

-- The forensic log must accept the new carrier BEFORE any sync writes to it:
-- the sync routes swallow insert errors, so a missing code loses the whole trail
-- (see 20260817132233_carrier_event_log_widen.sql).
ALTER TABLE carrier_event_log
  DROP CONSTRAINT IF EXISTS carrier_event_log_carrier_code_check;
ALTER TABLE carrier_event_log
  ADD CONSTRAINT carrier_event_log_carrier_code_check
  CHECK (carrier_code IN ('navex', 'dexpress', 'darb_assabil', 'cosmos', 'xdelivery'));
