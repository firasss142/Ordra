-- Entrepôt — unblock the Libya scan bench, and record the carrier's sticker.
--
-- WHY (label guard)
--   scan_order_out has always demanded a label_prints row: "print label before
--   scanning". That is right for Tunisia, where we print the label ourselves.
--   It is wrong for Libya: Darb Assabil supplies pre-printed stickers, so we
--   never print anything — and today all 407 of our-warehouse LY orders in
--   `uploaded` have zero label_prints rows. Every one of them fails the scan.
--   The guard becomes conditional on the carrier, not hardcoded per market.
--
-- WHY (sticker)
--   The number on a Darb parcel is the only link between our order and the
--   shipment they track. The scan records it. It is NOT pushed to Darb here:
--   their PATCH /shipments/reference accepts any number without checking it
--   belongs to us, so a carrier round-trip would add risk and latency to the
--   packing bench for no gain. Pushing it can be a later sweep.
--
-- Stock integrity is untouched: still one inventory_log row and one
-- order_history row per scan, still the same three mutation paths.

-- ── 1. Which carriers print their own labels ────────────────────────────────

ALTER TABLE public.carriers
  ADD COLUMN IF NOT EXISTS supplies_own_labels BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.carriers.supplies_own_labels IS
  'True when the carrier provides pre-printed labels/stickers, so the warehouse '
  'prints nothing and scan_order_out must not require a label_prints row.';

-- Both Darb rows (Tripoli and Benghazi) share the code and both use the same
-- pre-printed rolls, so matching on code is deliberate here — this is the one
-- case where we want every Darb account, not a specific one.
UPDATE public.carriers SET supplies_own_labels = TRUE WHERE code = 'darb_assabil';

-- ── 2. The sticker bound to a parcel ────────────────────────────────────────

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS carrier_sticker_ref TEXT;

COMMENT ON COLUMN public.orders.carrier_sticker_ref IS
  'Carrier pre-printed sticker number bound at scan-out (Darb Assabil). '
  'Unique per market: a sticker covers exactly one parcel.';

-- Partial + per-market: markets are isolated and their roll ranges are
-- independent, so uniqueness must not collide across them.
CREATE UNIQUE INDEX IF NOT EXISTS orders_carrier_sticker_ref_key
  ON public.orders (market_id, carrier_sticker_ref)
  WHERE carrier_sticker_ref IS NOT NULL;

-- ── 3. scan_order_out — conditional label guard + sticker ───────────────────

-- Dropped rather than replaced: adding a DEFAULT parameter to the existing
-- 2-arg function would leave both visible and make scan_order_out(uuid, uuid)
-- an ambiguous call.
DROP FUNCTION IF EXISTS public.scan_order_out(UUID, UUID);

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
  v_actor_market_id UUID;
  v_actor_role TEXT;
  v_carrier_labels BOOLEAN;
  v_has_label BOOLEAN;
  v_current_stock INTEGER;
  v_new_stock INTEGER;
  v_sticker TEXT;
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

  SELECT id, status, product_id, quantity, market_id, carrier_id
  INTO v_order_id, v_current_status, v_product_id, v_quantity, v_market_id, v_carrier_id
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

  -- The label guard applies only when WE are the ones who print. An order with
  -- no carrier yet cannot have had a carrier label, so it still needs ours.
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
    -- constraint error. The unique index below is still the authority: it
    -- closes the gap between this SELECT and the UPDATE.
    IF EXISTS (
      SELECT 1 FROM orders
      WHERE market_id = v_market_id
        AND carrier_sticker_ref = v_sticker
        AND id <> p_order_id
    ) THEN
      RAISE EXCEPTION 'Sticker % is already bound to another order', v_sticker;
    END IF;
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
  VALUES (p_order_id, 'uploaded', 'scanned', p_actor_id, 'agent', 'Scanné par l''entrepôt')
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', 'scanned',
    'stock_after', v_new_stock,
    'sticker_ref', v_sticker,
    'updated_at', v_updated_at,
    'history_id', v_history_id,
    'inventory_log_id', v_log_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.scan_order_out(UUID, UUID, TEXT) TO PUBLIC;
