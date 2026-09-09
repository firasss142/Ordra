-- Ce qui arrive au colis APRÈS le scan — enfin visible, et réversible.
--
-- Jusqu'ici un colis scanné disparaissait : aucune liste, aucune reprise, aucun
-- retour en arrière. La seule marche arrière était manual_delete_orders, qui tue
-- la commande — et recover_deleted_order refuse ensuite de ressusciter ce qui a
-- été supprimé depuis `scanned`. Une erreur de scan coûtait donc la commande.
--
-- Or sur les 20 colis scannés le 8 septembre, 8 avaient un problème réel — 7
-- re-stickerisés par la réception Darb, 1 jamais enregistré — tous invisibles.
--
-- get_scanned_orders couvre les deux moments où le colis nous regarde encore :
-- `scanned` (sur le banc, en attente du transporteur) et `at_carrier` (parti,
-- mais rien ne bouge encore chez eux).

CREATE OR REPLACE FUNCTION public.get_scanned_orders(
  p_market_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_cursor_scanned_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID, customer_name TEXT, customer_phone TEXT, customer_city TEXT,
  customer_area TEXT, product_id UUID, product_name TEXT, variant_label TEXT,
  quantity INTEGER, total_price NUMERIC, status TEXT, created_at TIMESTAMPTZ,
  scanned_at TIMESTAMPTZ, scanned_by UUID, scanned_by_name TEXT,
  tracking_number TEXT, carrier_sticker_ref TEXT, carrier_status_slug TEXT,
  sticker_bind_state TEXT, carrier_reference_actual TEXT, branch_group TEXT,
  warehouse_id UUID, carrier_id UUID, carrier_name TEXT,
  current_stock INTEGER, low_stock_threshold INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH scans AS (
    -- inventory_log est l'horloge du scan : orders n'a pas de scanned_at.
    SELECT DISTINCT ON (il.order_id)
           il.order_id, il.created_at AS scanned_at, il.actor_id
    FROM inventory_log il
    WHERE il.reason = 'scanned'
    ORDER BY il.order_id, il.created_at DESC
  )
  SELECT
    o.id, o.customer_name, o.customer_phone, o.customer_city,
    o.carrier_extra->>'customer_area',
    o.product_id, o.product_name, o.variant_label, o.quantity, o.total_price,
    o.status::TEXT, o.created_at,
    s.scanned_at, s.actor_id, u.full_name,
    o.tracking_number, o.carrier_sticker_ref, o.carrier_status_slug,
    o.sticker_bind_state, o.carrier_reference_actual,
    o.carrier_extra->>'darb_branch_group',
    o.warehouse_id, o.carrier_id, c.name,
    COALESCE(ps.current_stock, p.current_stock), p.low_stock_threshold
  FROM orders o
  LEFT JOIN scans s ON s.order_id = o.id
  LEFT JOIN users u ON u.id = s.actor_id
  LEFT JOIN products p ON p.id = o.product_id
  LEFT JOIN product_site_stock ps
         ON ps.product_id = o.product_id AND ps.warehouse_id = o.warehouse_id
  LEFT JOIN carriers c ON c.id = o.carrier_id
  WHERE o.status IN ('scanned', 'at_carrier')
    AND o.archived_at IS NULL
    -- Jamais passé par nos mains : le transporteur l'expédie de son propre
    -- entrepôt, donc il n'a rien à faire dans une liste de colis scannés.
    AND (o.carrier_extra->>'fulfil_from_carrier_warehouse') IS DISTINCT FROM 'true'
    AND (p_market_id IS NULL OR o.market_id = p_market_id)
    AND (p_warehouse_id IS NULL OR o.warehouse_id = p_warehouse_id)
    AND (
      p_cursor_scanned_at IS NULL
      OR (COALESCE(s.scanned_at, o.created_at), o.id) < (p_cursor_scanned_at, p_cursor_id)
    )
  -- Le plus récent d'abord : on vérifie ce qu'on vient de faire.
  ORDER BY COALESCE(s.scanned_at, o.created_at) DESC, o.id DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_scanned_orders(UUID, UUID, INTEGER, TIMESTAMPTZ, UUID) TO PUBLIC;

-- ── Dé-scanner ──────────────────────────────────────────────────────────────
--
-- QUAND C'EST PERMIS. Tant que Darb n'a pas réservé le colis. Une fois qu'ils
-- l'ont accepté, il est chez eux : le reprendre est une affaire à régler avec
-- eux, pas un bouton chez nous. La fenêtre est large — environ 17 h mesurées
-- entre notre scan et leur réservation.
--
-- LE STICKER EST BRÛLÉ. Il est collé sur un carton et Darb le connaît peut-être
-- déjà. On le libère de la commande (sinon l'index unique interdirait d'en
-- recoller un) mais on ne prétend pas qu'il est neuf : le numéro reste dans la
-- note d'historique, pour toujours.

CREATE OR REPLACE FUNCTION public.unscan_order(
  p_order_id UUID, p_actor_id UUID, p_note TEXT DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status order_status; v_market_id UUID; v_site UUID; v_slug TEXT;
  v_sticker TEXT; v_product_id UUID; v_quantity INTEGER;
  v_actor_role TEXT; v_actor_market UUID; v_actor_site UUID;
  v_stock_before INTEGER; v_stock_after INTEGER;
  v_log_id UUID; v_history_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Un dé-scan ne peut pas être porté au crédit d''un autre opérateur'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;

  SELECT role, market_id, warehouse_id INTO v_actor_role, v_actor_market, v_actor_site
  FROM users WHERE id = p_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_NOT_FOUND"}';
  END IF;
  IF v_actor_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Actor role % cannot un-scan', v_actor_role
      USING ERRCODE = '42501', DETAIL = '{"code":"FORBIDDEN"}';
  END IF;

  SELECT status, market_id, warehouse_id, carrier_status_slug,
         carrier_sticker_ref, product_id, quantity
  INTO v_status, v_market_id, v_site, v_slug, v_sticker, v_product_id, v_quantity
  FROM orders WHERE id = p_order_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id USING DETAIL = '{"code":"ORDER_NOT_FOUND"}';
  END IF;
  IF v_actor_role <> 'super_admin' AND v_actor_market IS DISTINCT FROM v_market_id THEN
    RAISE EXCEPTION 'Order belongs to a different market' USING DETAIL = '{"code":"MARKET_MISMATCH"}';
  END IF;
  IF v_actor_role = 'warehouse_agent'
     AND v_actor_site IS NOT NULL AND v_site IS NOT NULL
     AND v_actor_site IS DISTINCT FROM v_site THEN
    RAISE EXCEPTION 'Ce colis appartient à un autre bâtiment'
      USING ERRCODE = '42501', DETAIL = '{"code":"WRONG_SITE"}';
  END IF;
  IF v_status <> 'scanned' THEN
    RAISE EXCEPTION 'Seul un colis scanné et non encore réservé peut être dé-scanné (état : %)', v_status
      USING DETAIL = '{"code":"INVALID_STATUS"}';
  END IF;
  IF v_slug IS NOT NULL AND v_slug NOT IN ('pending') THEN
    RAISE EXCEPTION 'Darb a déjà pris ce colis en charge (%) — à régler avec eux', v_slug
      USING DETAIL = '{"code":"TAKEN_BY_CARRIER"}';
  END IF;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Order has no linked product for stock adjustment'
      USING DETAIL = '{"code":"NO_PRODUCT"}';
  END IF;

  SELECT current_stock INTO v_stock_before FROM products WHERE id = v_product_id FOR UPDATE;
  v_stock_after := v_stock_before + v_quantity;
  UPDATE products SET current_stock = v_stock_after WHERE id = v_product_id;

  -- Le trigger de 20260922000012 reporte le même mouvement sur le bâtiment.
  INSERT INTO inventory_log (
    product_id, order_id, change, reason, balance_after, is_damaged, actor_id, note, warehouse_id
  )
  VALUES (
    v_product_id, p_order_id, v_quantity, 'scan_reversal', v_stock_after, false, p_actor_id,
    COALESCE('Dé-scan · sticker ' || v_sticker, 'Dé-scan') ||
      COALESCE(' · ' || NULLIF(btrim(p_note), ''), ''),
    v_site
  )
  RETURNING id INTO v_log_id;

  UPDATE orders
  SET status = 'uploaded',
      carrier_sticker_ref = NULL,
      sticker_bind_state = NULL,
      sticker_bind_checked_at = NULL,
      carrier_reference_actual = NULL
  WHERE id = p_order_id;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, 'scanned', 'uploaded', p_actor_id,
          CASE WHEN v_actor_role = 'warehouse_agent' THEN 'agent' ELSE 'manager' END,
          COALESCE('Dé-scan · sticker ' || v_sticker, 'Dé-scan') ||
            COALESCE(' · ' || NULLIF(btrim(p_note), ''), ''))
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id, 'status', 'uploaded',
    'stock_before', v_stock_before, 'stock_after', v_stock_after,
    'sticker_released', v_sticker,
    'inventory_log_id', v_log_id, 'history_id', v_history_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.unscan_order(UUID, UUID, TEXT) TO PUBLIC;
