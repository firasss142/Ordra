-- scan_order_out : l'acteur est vérifié, et chaque refus porte un code machine.
--
-- Le corps est celui de 20260921000004, inchangé dans sa logique. Deux ajouts :
--
--   · `auth.uid()` doit être l'acteur déclaré (ou absent : service_role).
--   · chaque RAISE porte DETAIL = {"code":"..."} ; PostgREST le rend comme
--     `error.details`, et scan-out/route.ts lit ce code au lieu de reconnaître
--     une phrase française par sous-chaîne.
--
-- scan_return_in, scan_received_in et record_stock_count reçoivent le même
-- contrôle d'acteur dans 20260922000012, où ils sont de toute façon réécrits
-- pour le stock par site — les réécrire deux fois serait deux occasions de se
-- tromper.

CREATE OR REPLACE FUNCTION public.scan_order_out(
  p_order_id uuid, p_actor_id uuid, p_sticker_ref text DEFAULT NULL::text
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
  -- Un scan est une signature. Une session ne peut pas l'attribuer à un autre.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Un scan ne peut pas être porté au crédit d''un autre opérateur'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;

  SELECT role, market_id INTO v_actor_role, v_actor_market_id
  FROM users WHERE id = p_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_NOT_FOUND"}';
  END IF;
  IF v_actor_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Actor role % cannot scan out', v_actor_role
      USING ERRCODE = '42501', DETAIL = '{"code":"FORBIDDEN"}';
  END IF;

  SELECT id, status, product_id, quantity, market_id, carrier_id,
         carrier_extra->>'darb_branch_group', carrier_status_slug
  INTO v_order_id, v_current_status, v_product_id, v_quantity, v_market_id,
       v_carrier_id, v_branch_group, v_carrier_slug
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id
      USING DETAIL = '{"code":"ORDER_NOT_FOUND"}';
  END IF;

  IF v_actor_role <> 'super_admin' AND v_actor_market_id IS DISTINCT FROM v_market_id THEN
    RAISE EXCEPTION 'Order belongs to a different market'
      USING DETAIL = '{"code":"MARKET_MISMATCH"}';
  END IF;

  IF v_current_status <> 'uploaded' THEN
    RAISE EXCEPTION 'Order is not in uploaded status (current: %)', v_current_status
      USING DETAIL = '{"code":"INVALID_STATUS"}';
  END IF;

  IF v_carrier_slug IN ('released', 'completed', 'returning', 'returned') THEN
    RAISE EXCEPTION 'Parcel already left the carrier (carrier status: %)', v_carrier_slug
      USING DETAIL = '{"code":"GONE_AT_CARRIER"}';
  END IF;

  SELECT COALESCE(supplies_own_labels, FALSE) INTO v_carrier_labels
  FROM carriers WHERE id = v_carrier_id;
  v_carrier_labels := COALESCE(v_carrier_labels, FALSE);

  IF NOT v_carrier_labels THEN
    SELECT EXISTS (SELECT 1 FROM label_prints WHERE order_id = p_order_id) INTO v_has_label;
    IF NOT v_has_label THEN
      RAISE EXCEPTION 'Order has no printed label — print label before scanning'
        USING DETAIL = '{"code":"NO_LABEL_PRINTED"}';
    END IF;
  END IF;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Order has no linked product for stock adjustment'
      USING DETAIL = '{"code":"NO_PRODUCT"}';
  END IF;

  v_sticker := NULLIF(BTRIM(COALESCE(p_sticker_ref, '')), '');

  IF v_sticker IS NOT NULL AND v_sticker !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Sticker % is not a number', v_sticker
      USING DETAIL = '{"code":"STICKER_NOT_NUMERIC"}';
  END IF;

  IF v_sticker IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM orders
      WHERE market_id = v_market_id
        AND carrier_sticker_ref = v_sticker
        AND id <> p_order_id
    ) THEN
      RAISE EXCEPTION 'Sticker % is already bound to another order', v_sticker
        USING DETAIL = '{"code":"STICKER_ALREADY_USED"}';
    END IF;
  END IF;

  v_needed_color := public.darb_color_for_branch_group(v_branch_group);

  SELECT current_stock INTO v_current_stock
  FROM products
  WHERE id = v_product_id
  FOR UPDATE;

  IF v_current_stock IS NULL THEN
    RAISE EXCEPTION 'Product not found: %', v_product_id
      USING DETAIL = '{"code":"NO_PRODUCT"}';
  END IF;

  v_new_stock := v_current_stock - v_quantity;
  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'stock cannot go below zero'
      USING DETAIL = '{"code":"STOCK_UNDERFLOW"}';
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
    RAISE EXCEPTION 'Sticker % is already bound to another order', v_sticker
      USING DETAIL = '{"code":"STICKER_ALREADY_USED"}';
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

GRANT EXECUTE ON FUNCTION public.scan_order_out(UUID, UUID, TEXT) TO PUBLIC;
