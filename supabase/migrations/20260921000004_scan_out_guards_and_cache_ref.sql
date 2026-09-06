-- Scan-out: two guards the bench was missing, and a way for the floor role
-- to remember what Darb told it.
--
-- 1. GONE AT CARRIER. A parcel whose carrier status is already released /
--    completed / returning / returned has left; the queue greys its "Take"
--    button, but nothing server-side refused the scan. Probed as the Libyan
--    agent through the API: a `released` parcel was scanned out, stock was
--    deducted a second time and a sticker was bound at Darb. The RPCs now
--    refuse it (code GONE_AT_CARRIER, with the slug) — the UI hint becomes a
--    rule.
--
-- 2. STICKER MUST BE A NUMBER. Darb's pre-printed stickers carry a plain
--    number; the QR encodes exactly that number and nothing else (confirmed
--    with the physical rolls). Anything else on the wire — a URL, a Tunisian
--    label, a mistyped code — is a mis-scan, and Darb would bind it without
--    complaint. Probed: "https://sabil.ly/track/7700011" was accepted and
--    bound. Refused now (code STICKER_NOT_NUMERIC) before any carrier write.
--    Digits only; leading zeros allowed (Cosmos-style prints). No length
--    rule: reference formats differ per account age (sync doc §4.7).
--
-- 3. cache_darb_shipment_ref. When an order lacks Darb's internal `_id`, the
--    scan-out route resolves it and writes it back to carrier_extra so the
--    next scan needs no lookup and the RPCs can read the branch group for
--    the roll colour. That write used the operator's session, and the
--    orders UPDATE policy has no warehouse_agent arm — so for the floor role
--    it silently updated zero rows (verified: two orders scanned by the agent
--    kept darb_assabil_id NULL after a successful lookup + bind). This
--    SECURITY DEFINER RPC does that one write, guarded like precheck.

-- ── precheck ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.precheck_scan_out(
  p_order_id uuid, p_actor_id uuid, p_sticker_ref text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_status         TEXT;
  v_market_id      UUID;
  v_branch_group   TEXT;
  v_carrier_slug   TEXT;
  v_actor_role     TEXT;
  v_actor_market   UUID;
  v_sticker        TEXT;
  v_needed_color   TEXT;
BEGIN
  SELECT role, market_id INTO v_actor_role, v_actor_market FROM public.users WHERE id = p_actor_id;
  IF v_actor_role IS NULL THEN
    RETURN json_build_object('ok', false, 'code', 'ACTOR_NOT_FOUND');
  END IF;

  SELECT o.status::TEXT, o.market_id, o.carrier_extra->>'darb_branch_group', o.carrier_status_slug
  INTO v_status, v_market_id, v_branch_group, v_carrier_slug
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
  IF v_carrier_slug IN ('released', 'completed', 'returning', 'returned') THEN
    RETURN json_build_object('ok', false, 'code', 'GONE_AT_CARRIER', 'carrier_status', v_carrier_slug);
  END IF;

  v_sticker := NULLIF(btrim(COALESCE(p_sticker_ref, '')), '');
  IF v_sticker IS NOT NULL AND v_sticker !~ '^[0-9]+$' THEN
    RETURN json_build_object('ok', false, 'code', 'STICKER_NOT_NUMERIC', 'sticker', v_sticker);
  END IF;

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
$function$;

-- ── scan_order_out: same two guards, as exceptions ──────────────────────────
CREATE OR REPLACE FUNCTION public.scan_order_out(
  p_order_id uuid, p_actor_id uuid, p_sticker_ref text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_order_id UUID;
  v_current_status order_status;
  v_product_id UUID;
  v_quantity INTEGER;
  v_market_id UUID;
  v_carrier_id UUID;
  v_branch_group TEXT;
  v_carrier_slug TEXT;
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
         carrier_extra->>'darb_branch_group', carrier_status_slug
  INTO v_order_id, v_current_status, v_product_id, v_quantity, v_market_id,
       v_carrier_id, v_branch_group, v_carrier_slug
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

  IF v_carrier_slug IN ('released', 'completed', 'returning', 'returned') THEN
    RAISE EXCEPTION 'Parcel already left the carrier (carrier status: %)', v_carrier_slug;
  END IF;

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

  IF v_sticker IS NOT NULL AND v_sticker !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Sticker % is not a number', v_sticker;
  END IF;

  IF v_sticker IS NOT NULL THEN
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
$function$;

-- ── cache_darb_shipment_ref ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cache_darb_shipment_ref(
  p_order_id uuid,
  p_actor_id uuid,
  p_darb_id text,
  p_branch_group text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_actor_role   TEXT;
  v_actor_market UUID;
  v_market_id    UUID;
  v_extra        JSONB;
BEGIN
  SELECT role, market_id INTO v_actor_role, v_actor_market FROM public.users WHERE id = p_actor_id;
  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id;
  END IF;
  IF v_actor_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Actor role % cannot cache carrier references', v_actor_role;
  END IF;
  IF NULLIF(btrim(COALESCE(p_darb_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'darb id is required';
  END IF;

  SELECT market_id, COALESCE(carrier_extra, '{}'::jsonb)
  INTO v_market_id, v_extra
  FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF v_market_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;
  IF v_actor_role <> 'super_admin' AND v_actor_market IS DISTINCT FROM v_market_id THEN
    RAISE EXCEPTION 'Order belongs to a different market';
  END IF;

  v_extra := v_extra || jsonb_build_object('darb_assabil_id', btrim(p_darb_id));
  IF NULLIF(btrim(COALESCE(p_branch_group, '')), '') IS NOT NULL THEN
    v_extra := v_extra || jsonb_build_object('darb_branch_group', btrim(p_branch_group));
  END IF;

  UPDATE public.orders SET carrier_extra = v_extra WHERE id = p_order_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'darb_assabil_id', v_extra->>'darb_assabil_id',
    'darb_branch_group', v_extra->>'darb_branch_group'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cache_darb_shipment_ref(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cache_darb_shipment_ref(uuid, uuid, text, text) TO authenticated;
