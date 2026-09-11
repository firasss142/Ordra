-- Le stock suit TOUTES les lignes du colis, pas seulement la première.
--
-- LE DÉFAUT. `order_items` existe depuis juin 2026 et porte la vérité : un colis
-- peut contenir trois produits différents. Les quatre RPC de l'entrepôt lisaient
-- pourtant `orders.product_id` / `orders.quantity` — un seul produit, une seule
-- quantité. Sur les 28 commandes libyennes multi-produits déjà passées, deux ont
-- été scannées : le stock du premier produit a bougé, celui des deux autres non.
-- Le registre est en écriture seule, donc l'écart ne se rattrape pas ; il se
-- constate au comptage physique, des semaines plus tard, sans explication.
--
-- LA RÈGLE. `order_stock_lines(order_id)` est la seule définition de « ce que
-- contient ce colis » : les lignes d'`order_items` quand il y en a, sinon la
-- ligne dénormalisée d'`orders`. Une commande d'avant `order_items` se comporte
-- donc exactement comme avant, et une commande à trois produits déduit trois
-- fois. Une seule implémentation, quatre appelants.
--
-- CE QUI NE CHANGE PAS :
--   · un mouvement = une ligne d'inventory_log ; le trigger de 20260922000012
--     ventile chacune sur le bâtiment, aucun calcul par site n'est fait ici ;
--   · `stock_after` reste le stock de la ligne PRINCIPALE (le produit porté par
--     `orders.product_id`), parce que la feuille de scan affiche « 12 ← 11 »
--     pour le produit qu'elle vient de montrer à l'agent ;
--   · toutes les gardes existantes, dans le même ordre, avec les mêmes codes.
--
-- CE QUI CHANGE : `STOCK_UNDERFLOW` est vérifié sur TOUTES les lignes AVANT la
-- première écriture. Déduire deux produits puis refuser le troisième laisserait
-- un colis à moitié sorti du stock, sans statut pour le dire.

-- ─────────────────────────────────────────────────────────────────────────────
-- Ce que contient un colis.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.order_stock_lines(p_order_id UUID)
RETURNS TABLE (product_id UUID, quantity INTEGER, is_primary BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  /*
   * UNE LIGNE PAR PRODUIT, pas une par ligne de commande.
   *
   * `order_items` peut porter le même produit plusieurs fois — deux variantes,
   * ou un ajout successif. En production, huit commandes sont dans ce cas, dont
   * une actuellement sur le banc avec quatre lignes du même produit. Boucler
   * sur les lignes brutes ferait quatre UPDATE sur le même produit et
   * inscrirait au registre quatre `balance_after` dont trois seraient déjà
   * périmés au moment de leur écriture. On agrège d'abord, on écrit ensuite :
   * un produit, un mouvement, un solde exact.
   */
  SELECT oi.product_id, SUM(oi.quantity)::INTEGER,
         bool_or(oi.product_id IS NOT DISTINCT FROM o.product_id) AS is_primary
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  JOIN products p ON p.id = oi.product_id AND p.market_id = o.market_id
  WHERE oi.order_id = p_order_id
    AND oi.product_id IS NOT NULL
  GROUP BY oi.product_id
  UNION ALL
  -- Sinon la ligne dénormalisée : les commandes d'avant order_items, et toute
  -- la Tunisie. Le NOT EXISTS empêche de compter la commande deux fois.
  SELECT o.product_id, o.quantity, TRUE
  FROM orders o
  JOIN products p ON p.id = o.product_id AND p.market_id = o.market_id
  WHERE o.id = p_order_id
    AND o.product_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM order_items oi
      WHERE oi.order_id = p_order_id AND oi.product_id IS NOT NULL
    );
$$;

/*
 * PAS DE GRANT PUBLIC.
 *
 * Cette fonction ne prend pas d'acteur et ne compare pas de marché : publiée
 * via PostgREST, un id de commande aurait suffi pour lire le contenu de
 * n'importe quelle commande des deux marchés. Ses seuls appelants sont les
 * quatre RPC SECURITY DEFINER ci-dessous, qui l'atteignent par leur propre
 * privilège de définisseur.
 *
 * Le JOIN sur `products` ci-dessus porte la garde de marché : une ligne dont
 * le produit appartient à l'autre marché ne sort pas, donc `v_lines` tombe à
 * zéro et le scan échoue avec NO_PRODUCT — jamais une déduction partielle.
 */
REVOKE EXECUTE ON FUNCTION public.order_stock_lines(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.order_stock_lines(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.order_stock_lines(UUID) FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- scan_order_out : sortie d'entrepôt, toutes lignes déduites.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.scan_order_out(
  p_order_id uuid, p_actor_id uuid, p_sticker_ref text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_new_stock INTEGER;
  v_primary_after INTEGER;
  v_sticker TEXT;
  v_log_id UUID;
  v_first_log_id UUID;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
  v_line RECORD;
  v_lines INTEGER := 0;
  v_moves JSON[] := ARRAY[]::JSON[];
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

  /*
   * Toutes les lignes verrouillées et vérifiées AVANT la première écriture.
   * Déduire deux produits puis refuser le troisième laisserait le colis à
   * moitié sorti du stock, sans statut pour le dire et sans moyen de revenir
   * en arrière (le registre est en écriture seule).
   *
   * Le verrou est pris ligne par ligne dans l'ordre des UUID : deux scans
   * simultanés portant les mêmes produits les prennent dans le même ordre et
   * ne peuvent pas se bloquer mutuellement.
   */
  FOR v_line IN
    SELECT l.product_id, l.quantity
    FROM public.order_stock_lines(p_order_id) l
    ORDER BY l.product_id
  LOOP
    v_lines := v_lines + 1;
    DECLARE
      v_stock INTEGER;
    BEGIN
      SELECT current_stock INTO v_stock FROM products WHERE id = v_line.product_id FOR UPDATE;
      IF v_stock IS NULL THEN
        RAISE EXCEPTION 'Product not found: %', v_line.product_id
          USING DETAIL = '{"code":"NO_PRODUCT"}';
      END IF;
      IF v_stock - v_line.quantity < 0 THEN
        RAISE EXCEPTION 'stock cannot go below zero'
          USING DETAIL = '{"code":"STOCK_UNDERFLOW"}';
      END IF;
    END;
  END LOOP;

  IF v_lines = 0 THEN
    RAISE EXCEPTION 'Order has no linked product for stock adjustment'
      USING DETAIL = '{"code":"NO_PRODUCT"}';
  END IF;

  -- Un mouvement, une ligne de registre. Le trigger le ventile sur le bâtiment.
  FOR v_line IN
    SELECT l.product_id, l.quantity, l.is_primary
    FROM public.order_stock_lines(p_order_id) l
    ORDER BY l.is_primary DESC, l.product_id
  LOOP
    UPDATE products
    SET current_stock = current_stock - v_line.quantity
    WHERE id = v_line.product_id
    RETURNING current_stock INTO v_new_stock;

    INSERT INTO inventory_log (product_id, order_id, change, reason, balance_after, is_damaged, actor_id, note)
    VALUES (v_line.product_id, p_order_id, -v_line.quantity, 'scanned', v_new_stock, false, p_actor_id,
            COALESCE('Scan sortie entrepôt · sticker ' || v_sticker, 'Scan sortie entrepôt'))
    RETURNING id INTO v_log_id;

    IF v_first_log_id IS NULL THEN v_first_log_id := v_log_id; END IF;
    -- `stock_after` reste celui du produit que la feuille de scan a montré.
    IF v_line.is_primary THEN v_primary_after := v_new_stock; END IF;

    v_moves := v_moves || json_build_object(
      'product_id', v_line.product_id, 'change', -v_line.quantity, 'stock_after', v_new_stock
    );
  END LOOP;

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
          COALESCE('Scanné par l''entrepôt · sticker ' || v_sticker, 'Scanné par l''entrepôt')
          || CASE WHEN v_lines > 1 THEN ' · ' || v_lines || ' produits' ELSE '' END)
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', 'scanned',
    'stock_after', COALESCE(v_primary_after, (v_moves[array_upper(v_moves, 1)]->>'stock_after')::INTEGER),
    'sticker_ref', v_sticker,
    'required_color', v_needed_color,
    'updated_at', v_updated_at,
    'history_id', v_history_id,
    'inventory_log_id', v_first_log_id,
    'lines', v_lines,
    'movements', array_to_json(v_moves)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.scan_order_out(UUID, UUID, TEXT) TO PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- unscan_order : le colis revient sur le banc, toutes lignes rendues.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unscan_order(
  p_order_id uuid, p_actor_id uuid, p_note text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_status order_status;
  v_market_id UUID;
  v_site UUID;
  v_slug TEXT;
  v_sticker TEXT;
  v_product_id UUID;
  v_quantity INTEGER;
  v_actor_role TEXT;
  v_actor_market UUID;
  v_actor_site UUID;
  v_stock_after INTEGER;
  v_primary_after INTEGER;
  v_log_id UUID;
  v_first_log_id UUID;
  v_history_id UUID;
  v_line RECORD;
  v_lines INTEGER := 0;
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
  IF v_actor_role = 'warehouse_agent' AND v_actor_site IS NULL THEN
    RAISE EXCEPTION 'Votre compte n''est rattaché à aucun bâtiment'
      USING ERRCODE = '42501', DETAIL = '{"code":"NO_SITE_ASSIGNED"}';
  END IF;

  SELECT status, market_id, warehouse_id, carrier_status_slug,
         carrier_sticker_ref, product_id, quantity
  INTO v_status, v_market_id, v_site, v_slug, v_sticker, v_product_id, v_quantity
  FROM orders WHERE id = p_order_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id
      USING DETAIL = '{"code":"ORDER_NOT_FOUND"}';
  END IF;
  IF v_actor_role <> 'super_admin' AND v_actor_market IS DISTINCT FROM v_market_id THEN
    RAISE EXCEPTION 'Order belongs to a different market'
      USING DETAIL = '{"code":"MARKET_MISMATCH"}';
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

  -- Le dé-scan rend exactement ce que le scan avait pris : les mêmes lignes.
  FOR v_line IN
    SELECT l.product_id, l.quantity, l.is_primary
    FROM public.order_stock_lines(p_order_id) l
    ORDER BY l.is_primary DESC, l.product_id
  LOOP
    v_lines := v_lines + 1;
    UPDATE products
    SET current_stock = current_stock + v_line.quantity
    WHERE id = v_line.product_id
    RETURNING current_stock INTO v_stock_after;

    INSERT INTO inventory_log (
      product_id, order_id, change, reason, balance_after, is_damaged, actor_id, note, warehouse_id
    )
    VALUES (
      v_line.product_id, p_order_id, v_line.quantity, 'scan_reversal', v_stock_after, false, p_actor_id,
      COALESCE('Dé-scan · sticker ' || v_sticker, 'Dé-scan') ||
        COALESCE(' · ' || NULLIF(btrim(p_note), ''), ''),
      v_site
    )
    RETURNING id INTO v_log_id;

    IF v_first_log_id IS NULL THEN v_first_log_id := v_log_id; END IF;
    IF v_line.is_primary THEN v_primary_after := v_stock_after; END IF;
  END LOOP;

  UPDATE orders
  SET status = 'uploaded',
      -- Libéré pour que l'index unique n'interdise pas de recoller un sticker,
      -- mais consigné dans l'historique : ce numéro a existé sur ce colis.
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
    'order_id', p_order_id,
    'status', 'uploaded',
    'stock_after', COALESCE(v_primary_after, v_stock_after),
    'sticker_ref', v_sticker,
    'history_id', v_history_id,
    'inventory_log_id', v_first_log_id,
    'lines', v_lines
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.unscan_order(UUID, UUID, TEXT) TO PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- scan_return_in : retour clos, toutes lignes remises (ou décomptées casse).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.scan_return_in(
  p_order_id uuid, p_actor_id uuid, p_is_damaged boolean DEFAULT false,
  p_return_reason return_reason DEFAULT NULL::return_reason,
  p_return_photo_url text DEFAULT NULL::text,
  p_return_reason_note text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order_id UUID;
  v_current_status order_status;
  v_product_id UUID;
  v_quantity INTEGER;
  v_market_id UUID;
  v_customer_name TEXT;
  v_actor_market_id UUID;
  v_actor_role TEXT;
  v_balance_after INTEGER;
  v_primary_balance INTEGER;
  v_log_reason TEXT;
  v_log_note TEXT;
  v_log_id UUID;
  v_first_log_id UUID;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
  v_trimmed_note TEXT;
  v_line RECORD;
  v_lines INTEGER := 0;
BEGIN
  IF p_is_damaged AND p_return_reason IS NULL THEN
    RAISE EXCEPTION 'return_reason is required when is_damaged=true';
  END IF;

  v_trimmed_note := NULLIF(btrim(COALESCE(p_return_reason_note, '')), '');
  IF p_is_damaged AND p_return_reason = 'other' AND v_trimmed_note IS NULL THEN
    RAISE EXCEPTION 'return_reason_note is required when return_reason=other';
  END IF;

  SELECT role, market_id INTO v_actor_role, v_actor_market_id
  FROM users WHERE id = p_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id;
  END IF;
  IF v_actor_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Actor role % cannot scan returns', v_actor_role;
  END IF;

  SELECT id, status, product_id, quantity, market_id, customer_name
  INTO v_order_id, v_current_status, v_product_id, v_quantity, v_market_id, v_customer_name
  FROM orders WHERE id = p_order_id FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;
  IF v_actor_role <> 'super_admin' AND v_actor_market_id IS DISTINCT FROM v_market_id THEN
    RAISE EXCEPTION 'Order belongs to a different market';
  END IF;
  IF v_current_status <> 'to_be_returned' THEN
    RAISE EXCEPTION 'Order is not in to_be_returned status (current: %)', v_current_status;
  END IF;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Order has no linked product for stock adjustment';
  END IF;

  v_log_reason := CASE WHEN p_is_damaged THEN 'damaged_writeoff' ELSE 'returned' END;
  v_log_note := CASE WHEN p_is_damaged THEN 'Scan retour endommagé' ELSE 'Scan retour normal' END;

  /*
   * Un colis abîmé l'est en entier : les trois produits reviennent cassés, pas
   * seulement le premier. La casse alimente `damaged_return_count` de chaque
   * produit, jamais `current_stock` — c'est le même partage qu'avant, ligne
   * par ligne.
   */
  FOR v_line IN
    SELECT l.product_id, l.quantity, l.is_primary
    FROM public.order_stock_lines(p_order_id) l
    ORDER BY l.is_primary DESC, l.product_id
  LOOP
    v_lines := v_lines + 1;
    IF p_is_damaged THEN
      UPDATE products
      SET damaged_return_count = damaged_return_count + v_line.quantity
      WHERE id = v_line.product_id
      RETURNING damaged_return_count INTO v_balance_after;
    ELSE
      UPDATE products
      SET current_stock = current_stock + v_line.quantity
      WHERE id = v_line.product_id
      RETURNING current_stock INTO v_balance_after;
    END IF;

    IF v_balance_after IS NULL THEN
      RAISE EXCEPTION 'Product not found: %', v_line.product_id;
    END IF;

    INSERT INTO inventory_log (
      product_id, order_id, change, reason, balance_after, is_damaged,
      actor_id, note, return_reason, return_photo_url, return_reason_note
    )
    VALUES (
      v_line.product_id, p_order_id, v_line.quantity, v_log_reason, v_balance_after, p_is_damaged,
      p_actor_id, v_log_note,
      CASE WHEN p_is_damaged THEN p_return_reason ELSE NULL END,
      CASE WHEN p_is_damaged THEN p_return_photo_url ELSE NULL END,
      CASE WHEN p_is_damaged THEN v_trimmed_note ELSE NULL END
    )
    RETURNING id INTO v_log_id;

    IF v_first_log_id IS NULL THEN v_first_log_id := v_log_id; END IF;
    IF v_line.is_primary THEN v_primary_balance := v_balance_after; END IF;
  END LOOP;

  IF v_lines = 0 THEN
    RAISE EXCEPTION 'Product not found: %', v_product_id;
  END IF;

  UPDATE orders SET status = 'returned' WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (
    p_order_id, 'to_be_returned', 'returned', p_actor_id, 'agent',
    CASE
      WHEN p_is_damaged THEN 'Retour scanné (endommagé: ' || p_return_reason::TEXT || ')'
      ELSE 'Retour scanné'
    END || CASE WHEN v_lines > 1 THEN ' · ' || v_lines || ' produits' ELSE '' END
  )
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'customer_name', v_customer_name,
    'status', 'returned',
    'is_damaged', p_is_damaged,
    'return_reason', p_return_reason,
    'return_photo_url', CASE WHEN p_is_damaged THEN p_return_photo_url ELSE NULL END,
    'balance_after', COALESCE(v_primary_balance, v_balance_after),
    'updated_at', v_updated_at,
    'history_id', v_history_id,
    'inventory_log_id', v_first_log_id,
    'lines', v_lines
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.scan_return_in(UUID, UUID, BOOLEAN, return_reason, TEXT, TEXT) TO PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- scan_received_in : réception sans clôture, toutes lignes remises en stock.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.scan_received_in(p_order_id uuid, p_actor_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order_id UUID;
  v_current_status order_status;
  v_product_id UUID;
  v_quantity INTEGER;
  v_market_id UUID;
  v_customer_name TEXT;
  v_actor_market_id UUID;
  v_actor_role TEXT;
  v_new_stock INTEGER;
  v_primary_after INTEGER;
  v_log_id UUID;
  v_first_log_id UUID;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
  v_line RECORD;
  v_lines INTEGER := 0;
BEGIN
  SELECT role, market_id INTO v_actor_role, v_actor_market_id
  FROM users WHERE id = p_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id;
  END IF;
  IF v_actor_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Actor role % cannot scan received', v_actor_role;
  END IF;

  SELECT id, status, product_id, quantity, market_id, customer_name
  INTO v_order_id, v_current_status, v_product_id, v_quantity, v_market_id, v_customer_name
  FROM orders WHERE id = p_order_id FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;
  IF v_actor_role <> 'super_admin' AND v_actor_market_id IS DISTINCT FROM v_market_id THEN
    RAISE EXCEPTION 'Order belongs to a different market';
  END IF;
  IF v_current_status <> 'to_be_returned' THEN
    RAISE EXCEPTION 'Order is not in to_be_returned status (current: %)', v_current_status;
  END IF;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Order has no linked product for stock adjustment';
  END IF;

  FOR v_line IN
    SELECT l.product_id, l.quantity, l.is_primary
    FROM public.order_stock_lines(p_order_id) l
    ORDER BY l.is_primary DESC, l.product_id
  LOOP
    v_lines := v_lines + 1;
    UPDATE products
    SET current_stock = current_stock + v_line.quantity
    WHERE id = v_line.product_id
    RETURNING current_stock INTO v_new_stock;

    IF v_new_stock IS NULL THEN
      RAISE EXCEPTION 'Product not found: %', v_line.product_id;
    END IF;

    INSERT INTO inventory_log (
      product_id, order_id, change, reason, balance_after, is_damaged, actor_id, note
    )
    VALUES (
      v_line.product_id, p_order_id, v_line.quantity, 'received_back', v_new_stock, false,
      p_actor_id, 'Réception sans clôture — colis re-déposé en stock'
    )
    RETURNING id INTO v_log_id;

    IF v_first_log_id IS NULL THEN v_first_log_id := v_log_id; END IF;
    IF v_line.is_primary THEN v_primary_after := v_new_stock; END IF;
  END LOOP;

  IF v_lines = 0 THEN
    RAISE EXCEPTION 'Product not found: %', v_product_id;
  END IF;

  UPDATE orders SET status = 'received' WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (
    p_order_id, 'to_be_returned', 'received', p_actor_id, 'agent',
    'Colis re-réceptionné (non clos, re-livrable)'
    || CASE WHEN v_lines > 1 THEN ' · ' || v_lines || ' produits' ELSE '' END
  )
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'customer_name', v_customer_name,
    'status', 'received',
    'balance_after', COALESCE(v_primary_after, v_new_stock),
    'updated_at', v_updated_at,
    'history_id', v_history_id,
    'inventory_log_id', v_first_log_id,
    'lines', v_lines
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.scan_received_in(UUID, UUID) TO PUBLIC;
