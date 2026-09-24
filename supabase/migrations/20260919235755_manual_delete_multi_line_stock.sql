-- ============================================================
-- 20261003000007_manual_delete_multi_line_stock.sql
-- manual_delete_orders rend TOUTES les lignes, pas seulement la première.
--
-- 20260924000001_scan_multi_line_stock.sql a corrigé quatre RPC d'entrepôt
-- qui lisaient `orders.product_id` / `orders.quantity` — la ligne dénormalisée
-- — et ne bougeaient donc que le stock du premier produit d'un colis
-- multi-produits. Le cinquième chemin qui rend du stock, celui-ci, a été
-- oublié. `merge_orders` le consigne d'ailleurs noir sur blanc :
-- « The multi-product stock gap is pre-existing. »
--
-- Conséquence : supprimer une commande scannée à trois produits remettait un
-- seul produit en stock. Les deux autres restaient déduits pour toujours, sans
-- rien au registre pour l'expliquer — et `inventory_log` étant append-only, la
-- correction se fait en ajoutant, jamais en réécrivant.
--
-- La correction est celle des quatre autres : passer par
-- `order_stock_lines(p_order_id)`, l'unique résolveur « que contient ce colis ».
-- Il agrège PAR PRODUIT (deux variantes du même produit = un seul mouvement,
-- donc un seul `balance_after`, exact), retombe sur la ligne dénormalisée pour
-- les commandes d'avant `order_items`, et porte la garde de marché dans son
-- JOIN sur `products`.
--
-- `order_stock_lines` est REVOKE'd de PUBLIC ; cette fonction l'atteint par son
-- propre privilège de définisseur, comme les quatre autres.
-- ============================================================

CREATE OR REPLACE FUNCTION public.manual_delete_orders(
  p_order_ids UUID[],
  p_actor_id UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role TEXT;
  v_actor_market_id UUID;
  v_order_ids UUID[];
  v_order_id UUID;
  v_status public.order_status;
  v_market_id UUID;
  v_line RECORD;
  v_lines INTEGER;
  v_new_stock INTEGER;
  v_deleted_count INTEGER := 0;
  v_stock_restored_count INTEGER := 0;
  v_allowed_statuses public.order_status[] := ARRAY[
    'pending',
    'assigned',
    'attempt_1',
    'attempt_2',
    'attempt_3',
    'callback_scheduled',
    'confirmed',
    'dispatch_scheduled',
    'uploaded',
    'scanned'
  ]::public.order_status[];
BEGIN
  IF p_actor_id IS NULL OR auth.uid() IS NULL OR auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT role, market_id
    INTO v_actor_role, v_actor_market_id
    FROM public.users
   WHERE id = p_actor_id;

  IF NOT FOUND OR v_actor_role NOT IN ('super_admin', 'market_manager') THEN
    RAISE EXCEPTION 'Forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT ARRAY(SELECT DISTINCT unnest(p_order_ids))
    INTO v_order_ids;

  IF v_order_ids IS NULL OR cardinality(v_order_ids) = 0 THEN
    RAISE EXCEPTION 'manual_delete_orders requires at least one order id'
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_order_id IN ARRAY v_order_ids LOOP
    SELECT status, market_id
      INTO v_status, v_market_id
      FROM public.orders
     WHERE id = v_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order % not found', v_order_id
        USING ERRCODE = 'P0002';
    END IF;

    IF v_actor_role = 'market_manager' AND v_market_id IS DISTINCT FROM v_actor_market_id THEN
      RAISE EXCEPTION 'Forbidden'
        USING ERRCODE = '42501';
    END IF;

    IF NOT (v_status = ANY(v_allowed_statuses)) THEN
      RAISE EXCEPTION 'Order % cannot be manually deleted from status %', v_order_id, v_status
        USING ERRCODE = '23514';
    END IF;

    -- Le stock n'a bougé qu'au scan ; seul un colis scanné a quelque chose à
    -- rendre. Les autres statuts n'ont jamais déduit.
    IF v_status = 'scanned' THEN
      v_lines := 0;

      -- ORDER BY product_id : même ordre de verrouillage que les quatre autres
      -- RPC, donc pas d'interblocage si un scan tourne en parallèle.
      FOR v_line IN
        SELECT l.product_id, l.quantity
        FROM public.order_stock_lines(v_order_id) l
        ORDER BY l.product_id
      LOOP
        v_lines := v_lines + 1;

        UPDATE public.products
           SET current_stock = current_stock + v_line.quantity,
               updated_at = NOW()
         WHERE id = v_line.product_id
        RETURNING current_stock INTO v_new_stock;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Product % not found for order %', v_line.product_id, v_order_id
            USING ERRCODE = 'P0002';
        END IF;

        INSERT INTO public.inventory_log (
          product_id,
          order_id,
          change,
          reason,
          balance_after,
          is_damaged,
          actor_id,
          note
        )
        VALUES (
          v_line.product_id,
          v_order_id,
          v_line.quantity,
          'manual_delete_reversal',
          v_new_stock,
          false,
          p_actor_id,
          COALESCE(p_note, 'Suppression manuelle: restauration stock')
        );
      END LOOP;

      -- Zéro ligne = le résolveur n'a rien trouvé : ni `order_items`, ni
      -- produit dénormalisé, ou un produit de l'autre marché écarté par sa
      -- garde. On refuse plutôt que de supprimer un colis scanné en laissant
      -- son stock déduit sans trace.
      IF v_lines = 0 THEN
        RAISE EXCEPTION 'Order % has no product for stock restoration', v_order_id
          USING ERRCODE = '23502';
      END IF;

      v_stock_restored_count := v_stock_restored_count + 1;
    END IF;

    UPDATE public.orders
       SET status = 'deleted'::public.order_status,
           updated_at = NOW()
     WHERE id = v_order_id;

    INSERT INTO public.order_history (
      order_id,
      status_from,
      status_to,
      actor_id,
      actor_type,
      note
    )
    VALUES (
      v_order_id,
      v_status,
      'deleted'::public.order_status,
      p_actor_id,
      'manager',
      COALESCE(p_note, 'Suppression manuelle')
    );

    v_deleted_count := v_deleted_count + 1;
  END LOOP;

  -- `stock_restored` compte des COMMANDES remises en stock, pas des lignes —
  -- c'est ce que l'appelant affichait déjà, et le sens ne change pas.
  RETURN json_build_object(
    'deleted', v_deleted_count,
    'stock_restored', v_stock_restored_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.manual_delete_orders(UUID[], UUID, TEXT) TO authenticated;
