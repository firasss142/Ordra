-- Drop the sticker-roll registry.
--
-- WHY
--   It was built to catch a typo: Darb accepts any number without checking it
--   belongs to us, so a mistyped sticker binds silently. Catching that needs a
--   registry of every roll's number range, kept current by hand — someone
--   recording the first and last number of each roll as it is opened, and
--   marking it exhausted when it runs out.
--
--   That upkeep is the whole cost, and it only pays off if it never lapses. The
--   moment it does, the guard goes dormant and the console shows a permanent
--   "aucun rouleau enregistré" warning that means nothing. The floor rule is
--   already "always scan, never type" (docs/darb-warehouse-workflow.md rule 2),
--   which removes the typo at source.
--
-- WHAT SURVIVES — the part that was actually wanted
--   The COLOUR still comes from Darb's own branch directory and is still shown
--   on every queue row and above the scanner, so the agent knows which roll to
--   reach for before touching the parcel. darb_zones and darb_branches are
--   untouched. Only the number-range bookkeeping goes.
--
--   The cost of dropping it: a sticker from the wrong roll is no longer refused
--   automatically. The instruction on screen is the control now.
--
-- SAFE: sticker_rolls holds no rows. Nothing is lost.

DROP FUNCTION IF EXISTS public.get_sticker_rolls(UUID);
DROP FUNCTION IF EXISTS public.sticker_roll_for(UUID, TEXT);
DROP TABLE IF EXISTS public.sticker_rolls;

-- ── precheck_scan_out — without the roll tests ──────────────────────────────
--
-- Still worth calling before the carrier write: a duplicate sticker, a wrong
-- status or a foreign market are all cheap to detect and would otherwise cause
-- a PATCH to Darb for a scan that cannot commit. It also returns the required
-- colour, which the bench shows.

CREATE OR REPLACE FUNCTION public.precheck_scan_out(
  p_order_id    UUID,
  p_actor_id    UUID,
  p_sticker_ref TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_status         TEXT;
  v_market_id      UUID;
  v_branch_group   TEXT;
  v_actor_role     TEXT;
  v_actor_market   UUID;
  v_sticker        TEXT;
  v_needed_color   TEXT;
BEGIN
  SELECT role, market_id INTO v_actor_role, v_actor_market FROM public.users WHERE id = p_actor_id;
  IF v_actor_role IS NULL THEN
    RETURN json_build_object('ok', false, 'code', 'ACTOR_NOT_FOUND');
  END IF;

  SELECT o.status::TEXT, o.market_id, o.carrier_extra->>'darb_branch_group'
  INTO v_status, v_market_id, v_branch_group
  FROM public.orders o WHERE o.id = p_order_id;

  IF v_status IS NULL THEN
    RETURN json_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
  END IF;
  IF v_actor_role <> 'super_admin' AND v_actor_market IS DISTINCT FROM v_market_id THEN
    RETURN json_build_object('ok', false, 'code', 'MARKET_MISMATCH');
  END IF;
  IF v_status <> 'uploaded' THEN
    RETURN json_build_object('ok', false, 'code', 'INVALID_STATUS', 'status', v_status);
  END IF;

  v_sticker := NULLIF(btrim(COALESCE(p_sticker_ref, '')), '');
  v_needed_color := public.darb_color_for_branch_group(v_branch_group);

  IF v_sticker IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.orders
    WHERE market_id = v_market_id AND carrier_sticker_ref = v_sticker AND id <> p_order_id
  ) THEN
    RETURN json_build_object('ok', false, 'code', 'STICKER_ALREADY_USED', 'sticker', v_sticker);
  END IF;

  RETURN json_build_object(
    'ok', true, 'sticker', v_sticker,
    'required_color', v_needed_color, 'branch_group', v_branch_group
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.precheck_scan_out(UUID, UUID, TEXT) TO PUBLIC;

-- ── scan_order_out — back to the 20260823000001 body, minus the roll guards ──
--
-- Everything else is unchanged: still one inventory_log row and one
-- order_history row per scan, still the same three stock mutation paths, still
-- the carrier-conditional label guard and the per-market sticker uniqueness.

CREATE OR REPLACE FUNCTION public.scan_order_out(
  p_order_id UUID,
  p_actor_id UUID,
  p_sticker_ref TEXT DEFAULT NULL
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
  v_carrier_id UUID;
  v_branch_group TEXT;
  v_actor_market_id UUID;
  v_actor_role TEXT;
  v_carrier_labels BOOLEAN;
  v_has_label BOOLEAN;
  v_needed_color TEXT;
  v_current_stock INTEGER;
  v_new_stock INTEGER;
  v_sticker TEXT;
  v_log_id UUID;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
BEGIN
  SELECT role, market_id INTO v_actor_role, v_actor_market_id
  FROM users WHERE id = p_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id;
  END IF;
  IF v_actor_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Actor role % cannot scan out', v_actor_role;
  END IF;

  SELECT id, status, product_id, quantity, market_id, carrier_id,
         carrier_extra->>'darb_branch_group'
  INTO v_order_id, v_current_status, v_product_id, v_quantity, v_market_id,
       v_carrier_id, v_branch_group
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

  -- The label guard applies only when WE are the ones who print.
  SELECT COALESCE(supplies_own_labels, FALSE) INTO v_carrier_labels
  FROM carriers WHERE id = v_carrier_id;
  v_carrier_labels := COALESCE(v_carrier_labels, FALSE);

  IF NOT v_carrier_labels THEN
    SELECT EXISTS (SELECT 1 FROM label_prints WHERE order_id = p_order_id) INTO v_has_label;
    IF NOT v_has_label THEN
      RAISE EXCEPTION 'Order has no printed label — print label before scanning';
    END IF;
  END IF;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Order has no linked product for stock adjustment';
  END IF;

  v_sticker := NULLIF(BTRIM(COALESCE(p_sticker_ref, '')), '');

  IF v_sticker IS NOT NULL THEN
    -- Checked up front so the operator gets the real reason, not a raw
    -- constraint error. The unique index below is still the authority.
    IF EXISTS (
      SELECT 1 FROM orders
      WHERE market_id = v_market_id
        AND carrier_sticker_ref = v_sticker
        AND id <> p_order_id
    ) THEN
      RAISE EXCEPTION 'Sticker % is already bound to another order', v_sticker;
    END IF;
  END IF;

  v_needed_color := public.darb_color_for_branch_group(v_branch_group);

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
  VALUES (v_product_id, p_order_id, -v_quantity, 'scanned', v_new_stock, false, p_actor_id,
          COALESCE('Scan sortie entrepôt · sticker ' || v_sticker, 'Scan sortie entrepôt'))
  RETURNING id INTO v_log_id;

  BEGIN
    UPDATE orders
    SET status = 'scanned',
        carrier_sticker_ref = COALESCE(v_sticker, carrier_sticker_ref)
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Sticker % is already bound to another order', v_sticker;
  END;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, 'uploaded', 'scanned', p_actor_id, 'agent',
          COALESCE('Scanné par l''entrepôt · sticker ' || v_sticker, 'Scanné par l''entrepôt'))
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', 'scanned',
    'stock_after', v_new_stock,
    'sticker_ref', v_sticker,
    'required_color', v_needed_color,
    'updated_at', v_updated_at,
    'history_id', v_history_id,
    'inventory_log_id', v_log_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.scan_order_out(UUID, UUID, TEXT) TO PUBLIC;
