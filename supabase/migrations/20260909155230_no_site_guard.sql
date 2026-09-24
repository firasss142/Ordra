-- Un agent d'entrepôt sans bâtiment ne scanne rien.
--
-- POURQUOI
--   La garde de site (20260922000013) ne s'arme que si l'agent ET la commande
--   portent un site :
--
--     IF v_actor_role = 'warehouse_agent'
--        AND v_actor_site IS NOT NULL AND v_order_site IS NOT NULL
--        AND v_actor_site IS DISTINCT FROM v_order_site
--
--   Le commentaire d'origine assumait cette inertie : « la garde reste inerte
--   tant qu'un manager n'a pas affecté les agents ». Sauf que rien ne pouvait
--   affecter un agent — `users.warehouse_id` existait sans aucun chemin
--   d'écriture. La garde n'a donc jamais pu s'armer, et `tarek`, sans site,
--   pouvait scanner indifféremment un colis de Tripoli ou de Benghazi.
--
--   Non affecté valait non restreint : exactement l'erreur de remise que le
--   modèle à deux sites existe pour empêcher. Un colis monté sur le compte
--   Benghazi et remis à Darb Tripoli n'existe pas dans leur système — il ne
--   peut être ni suivi, ni payé, ni retourné.
--
--   Depuis l'écran d'administration des utilisateurs, l'affectation est
--   désormais possible ; cette migration ferme le trou côté serveur, qui est
--   la seule autorité.
--
-- ORDRE DE DÉPLOIEMENT
--   Affecter les agents AVANT d'appliquer ce fichier, sinon ils sont bloqués à
--   leur prochaine prise de poste. Contrôle :
--     SELECT email FROM users
--     WHERE role = 'warehouse_agent' AND is_active AND deleted_at IS NULL
--       AND warehouse_id IS NULL;

-- ── 1. Le pré-contrôle du scan ──────────────────────────────────────────────
-- Corps repris TEL QUEL de la production, à la seule addition de la garde
-- NO_SITE_ASSIGNED. Recopier de mémoire ferait perdre en silence
-- `darb_color_for_branch_group`, le cadrage marché du contrôle de sticker et
-- les clés `sticker` / `warehouse_id` de la réponse.

CREATE OR REPLACE FUNCTION public.precheck_scan_out(p_order_id uuid, p_actor_id uuid, p_sticker_ref text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_status         TEXT;
  v_market_id      UUID;
  v_branch_group   TEXT;
  v_carrier_slug   TEXT;
  v_order_site     UUID;
  v_actor_role     TEXT;
  v_actor_market   UUID;
  v_actor_site     UUID;
  v_sticker        TEXT;
  v_needed_color   TEXT;
BEGIN
  SELECT role, market_id, warehouse_id INTO v_actor_role, v_actor_market, v_actor_site
  FROM public.users WHERE id = p_actor_id;
  IF v_actor_role IS NULL THEN
    RETURN json_build_object('ok', false, 'code', 'ACTOR_NOT_FOUND');
  END IF;

  -- LA SEULE ADDITION. La garde de site plus bas exige les deux côtés non nuls ;
  -- un agent sans bâtiment la traversait donc sans jamais la déclencher, et
  -- pouvait scanner indifféremment un colis de Tripoli ou de Benghazi.
  IF v_actor_role = 'warehouse_agent' AND v_actor_site IS NULL THEN
    RETURN json_build_object('ok', false, 'code', 'NO_SITE_ASSIGNED');
  END IF;

  SELECT o.status::TEXT, o.market_id, o.carrier_extra->>'darb_branch_group',
         o.carrier_status_slug, o.warehouse_id
  INTO v_status, v_market_id, v_branch_group, v_carrier_slug, v_order_site
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
  IF v_actor_role = 'warehouse_agent'
     AND v_actor_site IS NOT NULL AND v_order_site IS NOT NULL
     AND v_actor_site IS DISTINCT FROM v_order_site THEN
    RETURN json_build_object(
      'ok', false, 'code', 'WRONG_SITE',
      'warehouse_id', v_order_site,
      'warehouse_name', (SELECT name_fr FROM public.warehouses WHERE id = v_order_site)
    );
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
    'required_color', v_needed_color, 'branch_group', v_branch_group,
    'warehouse_id', v_order_site
  );
END;
$function$;

COMMENT ON FUNCTION public.precheck_scan_out(uuid, uuid, text) IS
  'Contrôles avant l''écriture du scan. Un agent d''entrepôt sans bâtiment est '
  'refusé (NO_SITE_ASSIGNED) : la garde de site ne peut pas comparer deux sites '
  'quand l''agent n''en a pas, et laisser passer revient à autoriser la remise '
  'd''un colis de Benghazi à Darb Tripoli.';

-- ── 2. Le dé-scan ───────────────────────────────────────────────────────────
-- Corps repris TEL QUEL de la production (20260922000030 + correctifs), à la
-- seule addition de la garde NO_SITE_ASSIGNED. Un CREATE OR REPLACE écrase
-- silencieusement tout ce qu'on oublierait de recopier : la remise à NULL de
-- `sticker_bind_state`, `balance_after`, `actor_type`, la clé de retour
-- `inventory_log_id`. Chacun de ces oublis serait une régression invisible.

CREATE OR REPLACE FUNCTION public.unscan_order(p_order_id uuid, p_actor_id uuid, p_note text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
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
  v_stock_before INTEGER;
  v_stock_after INTEGER;
  v_log_id UUID;
  v_history_id UUID;
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
  -- LA SEULE ADDITION. Sans bâtiment, la garde de site ci-dessous ne peut rien
  -- comparer et laissait donc passer n'importe quel colis des deux entrepôts.
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
    'stock_before', v_stock_before,
    'stock_after', v_stock_after,
    'sticker_released', v_sticker,
    'inventory_log_id', v_log_id,
    'history_id', v_history_id
  );
END;
$function$;

COMMENT ON FUNCTION public.unscan_order(uuid, uuid, text) IS
  'Annule un scan tant que Darb n''a pas réservé le colis : rend le stock au '
  'bâtiment, libère le sticker et repasse la commande en `uploaded`. Un agent '
  'sans bâtiment est refusé (NO_SITE_ASSIGNED).';
