-- Un retour rentre dans UN bâtiment.
--
-- POURQUOI
--   `scan_return_in` gardait le marché, pas le bâtiment. Un agent d'entrepôt
--   de Tripoli pouvait clôturer un retour de Benghazi — le stock remontait sur
--   une étagère qui n'a jamais vu le colis — et un agent sans bâtiment pouvait
--   clôturer n'importe lequel. `precheck_scan_out` et `unscan_order` refusent
--   déjà ces deux cas (20260909155230) ; le retour avait été oublié.
--
--   Les routes /api/warehouse/returns* filtrent désormais par bâtiment ; cette
--   garde est la défense en profondeur, côté serveur, qui est la seule autorité.
--
-- CE QUI CHANGE
--   Deux additions, rien d'autre :
--     · agent sans bâtiment → 42501, DETAIL {"code":"NO_SITE_ASSIGNED"}
--     · agent d'un autre bâtiment que le colis (ou colis sans bâtiment)
--       → 42501, DETAIL {"code":"WRONG_SITE"}
--   Les états acceptés NE changent PAS (to_be_returned seulement) : c'est une
--   décision produit à part.
--
-- CORPS repris TEL QUEL de 20260924130000_variant_stock_rpcs.sql (vérifié
-- identique à la base locale avec pg_get_functiondef). CREATE OR REPLACE avec la
-- MÊME signature : un DROP+CREATE remettrait l'ACL par défaut et rouvrirait la
-- fonction à anon (voir 20260924 « anon-executable RPCs swept »).

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
  v_actor_site UUID;
  v_order_site UUID;
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
  /*
   * UN SCAN EST UNE SIGNATURE. Sans ce contrôle, la fonction lit `users` par
   * `p_actor_id` — donc la garde de marché s'évalue contre le marché de
   * QUELQU'UN D'AUTRE. Un agent d'entrepôt libyen passant l'id d'un
   * super_admin tunisien clôturait un retour tunisien, inscrit au registre en
   * écriture seule au nom de quelqu'un qui n'avait rien fait.
   *
   * 20260909132021 annonçait que `scan_return_in`, `scan_received_in` et
   * `record_stock_count` recevraient « le même contrôle d'acteur dans
   * 20260922000012 ». Cette migration n'a jamais existé ; seule
   * `record_stock_count` l'a obtenu. Les deux autres ont été réécrites deux
   * fois depuis sans jamais l'avoir.
   *
   * `auth.uid() IS NOT NULL` d'abord : le webhook et les tâches planifiées
   * tournent en service role, sans session, et doivent continuer à passer.
   */
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Une opération de stock ne peut pas être portée au crédit d''un autre opérateur'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;

  IF p_is_damaged AND p_return_reason IS NULL THEN
    RAISE EXCEPTION 'return_reason is required when is_damaged=true';
  END IF;

  v_trimmed_note := NULLIF(btrim(COALESCE(p_return_reason_note, '')), '');
  IF p_is_damaged AND p_return_reason = 'other' AND v_trimmed_note IS NULL THEN
    RAISE EXCEPTION 'return_reason_note is required when return_reason=other';
  END IF;

  SELECT role, market_id, warehouse_id INTO v_actor_role, v_actor_market_id, v_actor_site
  FROM users WHERE id = p_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id;
  END IF;
  IF v_actor_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Actor role % cannot scan returns', v_actor_role;
  END IF;
  -- ADDITION 20261007100000 (1/2). Sans bâtiment, un agent ne rentre rien —
  -- même règle que precheck_scan_out et unscan_order.
  IF v_actor_role = 'warehouse_agent' AND v_actor_site IS NULL THEN
    RAISE EXCEPTION 'Votre compte n''est rattaché à aucun bâtiment'
      USING ERRCODE = '42501', DETAIL = '{"code":"NO_SITE_ASSIGNED"}';
  END IF;

  SELECT id, status, product_id, quantity, market_id, customer_name, warehouse_id
  INTO v_order_id, v_current_status, v_product_id, v_quantity, v_market_id, v_customer_name, v_order_site
  FROM orders WHERE id = p_order_id FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;
  IF v_actor_role <> 'super_admin' AND v_actor_market_id IS DISTINCT FROM v_market_id THEN
    RAISE EXCEPTION 'Order belongs to a different market';
  END IF;
  -- ADDITION 20261007100000 (2/2). Un agent ne rentre que les colis de SON
  -- bâtiment. Plus strict que unscan_order, qui laisse passer un colis sans
  -- bâtiment : un retour sans bâtiment est un colis que Darb garde chez lui,
  -- il ne revient sur aucune de nos étagères.
  IF v_actor_role = 'warehouse_agent' AND v_order_site IS DISTINCT FROM v_actor_site THEN
    RAISE EXCEPTION 'Ce colis appartient à un autre bâtiment'
      USING ERRCODE = '42501', DETAIL = '{"code":"WRONG_SITE"}';
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
   * Un colis abîmé l'est en entier : toutes ses lignes reviennent cassées, pas
   * seulement la première. La casse alimente `damaged_return_count`, jamais
   * `current_stock` — et le trigger fait le même partage sur la variante.
   */
  FOR v_line IN
    SELECT l.product_id, l.quantity, l.is_primary, l.variant_id
    FROM public.order_stock_lines(p_order_id) l
    ORDER BY l.is_primary DESC, l.product_id, l.variant_id NULLS FIRST
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
      product_id, variant_id, order_id, change, reason, balance_after, is_damaged,
      actor_id, note, return_reason, return_photo_url, return_reason_note
    )
    VALUES (
      v_line.product_id, v_line.variant_id, p_order_id, v_line.quantity,
      v_log_reason, v_balance_after, p_is_damaged,
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
    END || CASE WHEN v_lines > 1 THEN ' · ' || v_lines || ' lignes' ELSE '' END
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

COMMENT ON FUNCTION public.scan_return_in(uuid, uuid, boolean, return_reason, text, text) IS
  'Rentre un retour (to_be_returned → returned) : remonte le stock ou compte la '
  'casse, ligne par ligne. Un agent d''entrepôt sans bâtiment est refusé '
  '(NO_SITE_ASSIGNED) ; un agent ne rentre que les colis de son bâtiment (WRONG_SITE).';
