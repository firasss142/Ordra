-- ============================================================
-- 20260924130000_variant_stock_rpcs.sql
-- Le stock bouge à la variante.
--
-- La phase 1 (20260920162309) a créé le grain : `product_variants` porte un
-- stock, `inventory_log` et `product_site_stock` portent une `variant_id`, et
-- un trigger applique tout mouvement de registre à la variante nommée. Mais
-- AUCUNE RPC n'écrivait cette colonne : le grain existait et restait vide.
-- Cette migration apprend la variante aux sept chemins qui déplacent du stock.
--
-- ─────────────────────────────────────────────────────────────────────────
-- UNE RÉGRESSION À RÉPARER D'ABORD (introduite par la phase 1)
--
-- La phase 1 a remplacé la clé primaire de `product_site_stock`,
-- (product_id, warehouse_id), par un index unique
-- (product_id, variant_id, warehouse_id) NULLS NOT DISTINCT — sans toucher au
-- `ON CONFLICT (product_id, warehouse_id)` de `record_stock_count`. Or un
-- ON CONFLICT doit désigner EXACTEMENT les colonnes d'un index unique. Depuis,
-- tout comptage par site meurt en 42P10 :
--
--   there is no unique or exclusion constraint matching the ON CONFLICT
--   specification
--
-- Invisible jusqu'ici parce que `product_site_stock` est vide en production :
-- personne n'a encore compté un bâtiment. C'était une mine, pas un cratère.
--
-- ─────────────────────────────────────────────────────────────────────────
-- CE QUI PORTE DU STOCK, ET CE QUI N'EN PORTE PAS
--
-- Seule une variante `kind='attribute'` est un objet en rayon. Un palier
-- (`kind='pack'`) est une FAÇON DE VENDRE le même objet : « Pack 2 » ne
-- s'empile pas à côté de « Grand », il en consomme deux. `order_stock_lines`
-- normalise donc : une `order_items.variant_id` qui désigne un palier est
-- ramenée à NULL, et le mouvement se fait au niveau du produit. Sans cela on
-- déduirait le stock d'une ligne qui n'en a jamais eu, et le total marché
-- s'éloignerait du rayon sans que rien ne le signale.
--
-- ─────────────────────────────────────────────────────────────────────────
-- CE QUI CHANGE DANS LE REGISTRE — ET POURQUOI C'EST UN REVIREMENT ASSUMÉ
--
-- 20260910155554 écrivait « un produit, un mouvement, un solde exact », en
-- agrégeant les lignes d'une commande PAR PRODUIT pour ne pas inscrire quatre
-- `balance_after` dont trois seraient périmés. On écrit désormais une ligne
-- par (produit, variante) : une commande portant Petit ×3 et Grand ×2 laisse
-- DEUX lignes au registre. Ce n'est pas un retour en arrière :
--   · les soldes restent exacts — les UPDATE sont séquentiels dans la même
--     transaction, chaque `balance_after` est lu APRÈS son propre mouvement ;
--   · `balance_after` reste le TOTAL MARCHÉ du produit, jamais celui de la
--     variante, pour que les finances lisent la même grandeur qu'avant ;
--   · et sans ces deux lignes, rien ne dirait laquelle des deux tailles est
--     partie — ce que la variante existe précisément pour dire.
-- Deux paliers du même produit, eux, restent agrégés en un seul mouvement :
-- ils désignent le même objet.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LE PIÈGE DU SOUS-DÉBIT AGRÉGÉ
--
-- Passer du grain « produit » au grain « produit × variante » ouvre un trou
-- qui n'existait pas : avec un produit à 5 unités, une ligne Petit ×3 et une
-- ligne Grand ×3 passent CHACUNE le test « 5 − 3 >= 0 », et le total tombe à
-- −1. La garde produit se fait donc sur la SOMME des lignes du produit, et la
-- garde variante ligne par ligne. Deux boucles, deux grains.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LES PRIVILÈGES : VÉRIFIÉ, PAS SUPPOSÉ
--
-- `CREATE OR REPLACE FUNCTION` CONSERVE les privilèges existants.
-- `DROP FUNCTION` + `CREATE FUNCTION` les REMET À ZÉRO, et le défaut de
-- PostgreSQL est EXECUTE pour PUBLIC — donc pour `anon`, donc sans connexion.
-- Trois fonctions ci-dessous changent de signature et doivent être DROP :
-- `order_stock_lines`, `record_stock_count`, `adjust_product_stock`. Sans le
-- REVOKE explicite de la section 9, cette migration rouvrirait à elle seule le
-- trou refermé la veille par 20260924120000 — sur le lecteur du contenu de
-- n'importe quelle commande et sur les deux RPC qui écrivent le stock.
-- La section 9 le révoque, puis l'affirme.
-- ============================================================

-- ── 1. Ce que contient un colis, variante comprise ─────────────────────────

-- Le type de retour gagne une colonne : CREATE OR REPLACE ne peut pas, il faut
-- DROP. Les corps PL/pgSQL qui l'appellent résolvent au moment de l'exécution,
-- donc aucune dépendance ne s'y oppose.
DROP FUNCTION IF EXISTS public.order_stock_lines(UUID);

CREATE FUNCTION public.order_stock_lines(p_order_id UUID)
RETURNS TABLE (product_id UUID, quantity INTEGER, is_primary BOOLEAN, variant_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH resolved AS (
    SELECT
      oi.product_id,
      oi.quantity,
      (oi.product_id IS NOT DISTINCT FROM o.product_id) AS on_primary_product,
      -- Un palier ne porte pas de stock : ramené à NULL, son mouvement se fait
      -- au produit. Une variante d'un AUTRE produit est également ignorée —
      -- une ligne mal liée ne doit pas déduire le stock d'un tiers.
      (SELECT v.id
         FROM product_variants v
        WHERE v.id = oi.variant_id
          AND v.product_id = oi.product_id
          AND v.kind = 'attribute') AS variant_id
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id AND p.market_id = o.market_id
    WHERE oi.order_id = p_order_id
      AND oi.product_id IS NOT NULL
  ),
  agg AS (
    SELECT r.product_id, r.variant_id,
           SUM(r.quantity)::INTEGER AS quantity,
           bool_or(r.on_primary_product) AS on_primary_product
    FROM resolved r
    GROUP BY r.product_id, r.variant_id
  )
  SELECT
    a.product_id,
    a.quantity,
    -- UNE SEULE ligne principale. Au grain produit, une seule pouvait porter
    -- `orders.product_id` ; au grain variante, deux le peuvent, et
    -- `stock_after` finirait par dépendre de l'ordre de la boucle. Le
    -- `row_number()` tranche de façon déterministe.
    a.on_primary_product
      AND row_number() OVER (ORDER BY a.on_primary_product DESC,
                                      a.product_id,
                                      a.variant_id NULLS FIRST) = 1 AS is_primary,
    a.variant_id
  FROM agg a
  UNION ALL
  -- La ligne dénormalisée : commandes d'avant `order_items`, et toute la
  -- Tunisie. `orders.product_variant_id` existe depuis longtemps et n'est
  -- rempli nulle part (0 sur 8 581) ; on le lit tout de même, avec la même
  -- normalisation, pour que le jour où l'intake le remplira il soit suivi.
  SELECT
    o.product_id,
    o.quantity,
    TRUE,
    (SELECT v.id
       FROM product_variants v
      WHERE v.id = o.product_variant_id
        AND v.product_id = o.product_id
        AND v.kind = 'attribute')
  FROM orders o
  JOIN products p ON p.id = o.product_id AND p.market_id = o.market_id
  WHERE o.id = p_order_id
    AND o.product_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM order_items oi
      WHERE oi.order_id = p_order_id AND oi.product_id IS NOT NULL
    );
$$;

COMMENT ON FUNCTION public.order_stock_lines(UUID) IS
  'Unique définition de « que contient ce colis », au grain (produit, variante '
  'd''attribut). Les paliers sont ramenés au produit : ils ne portent pas de '
  'stock. Jamais exposée à PostgREST — elle ne prend pas d''acteur et un simple '
  'id de commande suffirait à lire le contenu de n''importe quelle commande.';

-- ── 2. scan_order_out ──────────────────────────────────────────────────────

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
   * PRÉ-VOL, deux grains, AVANT la première écriture. Déduire deux lignes puis
   * refuser la troisième laisserait le colis à moitié sorti du stock, sans
   * statut pour le dire et sans retour possible (le registre est append-only).
   *
   * Grain PRODUIT d'abord, sur la SOMME de ses lignes : deux variantes à 3
   * chacune sur un produit qui n'a que 5 unités passeraient chacune le test
   * individuellement et laisseraient le total à −1.
   *
   * Les verrous sont pris produits d'abord (par id), variantes ensuite (par
   * id) : deux scans concurrents les prennent dans le même ordre global et ne
   * peuvent pas s'interbloquer.
   */
  FOR v_line IN
    SELECT l.product_id, SUM(l.quantity)::INTEGER AS quantity
    FROM public.order_stock_lines(p_order_id) l
    GROUP BY l.product_id
    ORDER BY l.product_id
  LOOP
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

  -- Grain VARIANTE. Une variante à 40 refuse une ligne de 50 même si le
  -- produit en a 100 : les 60 autres sont d'une autre taille et ne peuvent pas
  -- être mises dans ce colis.
  FOR v_line IN
    SELECT l.variant_id, SUM(l.quantity)::INTEGER AS quantity
    FROM public.order_stock_lines(p_order_id) l
    WHERE l.variant_id IS NOT NULL
    GROUP BY l.variant_id
    ORDER BY l.variant_id
  LOOP
    DECLARE
      v_vstock INTEGER;
    BEGIN
      SELECT current_stock INTO v_vstock
      FROM product_variants WHERE id = v_line.variant_id FOR UPDATE;
      IF v_vstock IS NULL THEN
        RAISE EXCEPTION 'Variant not found: %', v_line.variant_id
          USING DETAIL = '{"code":"NO_PRODUCT"}';
      END IF;
      IF v_vstock - v_line.quantity < 0 THEN
        RAISE EXCEPTION 'stock cannot go below zero'
          USING DETAIL = '{"code":"STOCK_UNDERFLOW"}';
      END IF;
    END;
  END LOOP;

  /*
   * Grain « NON VENTILÉ ». Ce qui part sans variante nommée ne peut sortir que
   * du stock non encore attribué à une variante, soit
   * `total − somme(variantes d'attribut)`.
   *
   * Sans ce contrôle, un colis « produit nu » sur un produit entièrement
   * ventilé ferait tomber le total SOUS la somme de ses variantes. L'invariant
   * différé le refuserait — mais seulement au COMMIT, avec un code (23514)
   * que la route d'API ne sait pas traduire, donc un 500 illisible au lieu
   * d'un « stock insuffisant » à l'écran. La garde est ici pour que le refus
   * arrive tôt et nommé.
   *
   * Sur un produit sans variante, `non ventilé` vaut le total : la garde se
   * confond avec celle du dessus et ne change rien.
   */
  FOR v_line IN
    SELECT l.product_id, SUM(l.quantity)::INTEGER AS quantity
    FROM public.order_stock_lines(p_order_id) l
    WHERE l.variant_id IS NULL
    GROUP BY l.product_id
    ORDER BY l.product_id
  LOOP
    DECLARE
      v_unallocated INTEGER;
    BEGIN
      SELECT p.current_stock - COALESCE((
               SELECT SUM(v.current_stock) FROM product_variants v
                WHERE v.product_id = p.id AND v.kind = 'attribute'), 0)
        INTO v_unallocated
        FROM products p WHERE p.id = v_line.product_id;

      IF v_unallocated < v_line.quantity THEN
        RAISE EXCEPTION 'stock cannot go below zero'
          USING DETAIL = '{"code":"STOCK_UNDERFLOW"}';
      END IF;
    END;
  END LOOP;

  SELECT count(*)::INTEGER INTO v_lines FROM public.order_stock_lines(p_order_id);

  IF v_lines = 0 THEN
    RAISE EXCEPTION 'Order has no linked product for stock adjustment'
      USING DETAIL = '{"code":"NO_PRODUCT"}';
  END IF;

  -- Un mouvement, une ligne de registre. Le trigger de 20260920162309 applique
  -- la ligne à `product_variants` et à `product_site_stock` : aucune
  -- arithmétique de variante ici, sous peine de compter deux fois.
  FOR v_line IN
    SELECT l.product_id, l.quantity, l.is_primary, l.variant_id
    FROM public.order_stock_lines(p_order_id) l
    ORDER BY l.is_primary DESC, l.product_id, l.variant_id NULLS FIRST
  LOOP
    UPDATE products
    SET current_stock = current_stock - v_line.quantity
    WHERE id = v_line.product_id
    RETURNING current_stock INTO v_new_stock;

    INSERT INTO inventory_log (product_id, variant_id, order_id, change, reason,
                               balance_after, is_damaged, actor_id, note)
    VALUES (v_line.product_id, v_line.variant_id, p_order_id, -v_line.quantity, 'scanned',
            v_new_stock, false, p_actor_id,
            COALESCE('Scan sortie entrepôt · sticker ' || v_sticker, 'Scan sortie entrepôt'))
    RETURNING id INTO v_log_id;

    IF v_first_log_id IS NULL THEN v_first_log_id := v_log_id; END IF;
    -- `stock_after` reste celui du produit que la feuille de scan a montré.
    IF v_line.is_primary THEN v_primary_after := v_new_stock; END IF;

    v_moves := v_moves || json_build_object(
      'product_id', v_line.product_id, 'variant_id', v_line.variant_id,
      'change', -v_line.quantity, 'stock_after', v_new_stock
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
          || CASE WHEN v_lines > 1 THEN ' · ' || v_lines || ' lignes' ELSE '' END)
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

-- ── 3. unscan_order ────────────────────────────────────────────────────────

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

  -- Le dé-scan rend exactement ce que le scan avait pris : les mêmes lignes,
  -- au même grain, variante comprise.
  FOR v_line IN
    SELECT l.product_id, l.quantity, l.is_primary, l.variant_id
    FROM public.order_stock_lines(p_order_id) l
    ORDER BY l.is_primary DESC, l.product_id, l.variant_id NULLS FIRST
  LOOP
    v_lines := v_lines + 1;
    UPDATE products
    SET current_stock = current_stock + v_line.quantity
    WHERE id = v_line.product_id
    RETURNING current_stock INTO v_stock_after;

    INSERT INTO inventory_log (
      product_id, variant_id, order_id, change, reason, balance_after,
      is_damaged, actor_id, note, warehouse_id
    )
    VALUES (
      v_line.product_id, v_line.variant_id, p_order_id, v_line.quantity,
      'scan_reversal', v_stock_after, false, p_actor_id,
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

-- ── 4. scan_return_in ──────────────────────────────────────────────────────

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

-- ── 5. scan_received_in ────────────────────────────────────────────────────

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
    SELECT l.product_id, l.quantity, l.is_primary, l.variant_id
    FROM public.order_stock_lines(p_order_id) l
    ORDER BY l.is_primary DESC, l.product_id, l.variant_id NULLS FIRST
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
      product_id, variant_id, order_id, change, reason, balance_after,
      is_damaged, actor_id, note
    )
    VALUES (
      v_line.product_id, v_line.variant_id, p_order_id, v_line.quantity,
      'received_back', v_new_stock, false,
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
    || CASE WHEN v_lines > 1 THEN ' · ' || v_lines || ' lignes' ELSE '' END
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

-- ── 6. manual_delete_orders : la restitution nomme aussi la variante ───────
-- Seule la boucle de stock change ; toutes les gardes restent au mot près.

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
    'pending', 'assigned', 'attempt_1', 'attempt_2', 'attempt_3',
    'callback_scheduled', 'confirmed', 'dispatch_scheduled', 'uploaded', 'scanned'
  ]::public.order_status[];
BEGIN
  IF p_actor_id IS NULL OR auth.uid() IS NULL OR auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT role, market_id INTO v_actor_role, v_actor_market_id
    FROM public.users WHERE id = p_actor_id;

  IF NOT FOUND OR v_actor_role NOT IN ('super_admin', 'market_manager') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT ARRAY(SELECT DISTINCT unnest(p_order_ids)) INTO v_order_ids;

  IF v_order_ids IS NULL OR cardinality(v_order_ids) = 0 THEN
    RAISE EXCEPTION 'manual_delete_orders requires at least one order id'
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_order_id IN ARRAY v_order_ids LOOP
    SELECT status, market_id INTO v_status, v_market_id
      FROM public.orders WHERE id = v_order_id FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order % not found', v_order_id USING ERRCODE = 'P0002';
    END IF;

    IF v_actor_role = 'market_manager' AND v_market_id IS DISTINCT FROM v_actor_market_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;

    IF NOT (v_status = ANY(v_allowed_statuses)) THEN
      RAISE EXCEPTION 'Order % cannot be manually deleted from status %', v_order_id, v_status
        USING ERRCODE = '23514';
    END IF;

    -- Le stock n'a bougé qu'au scan ; seul un colis scanné a quelque chose à
    -- rendre. Les autres statuts n'ont jamais déduit.
    IF v_status = 'scanned' THEN
      v_lines := 0;

      -- Même ordre de verrouillage que les autres RPC : produit puis variante.
      FOR v_line IN
        SELECT l.product_id, l.quantity, l.variant_id
        FROM public.order_stock_lines(v_order_id) l
        ORDER BY l.product_id, l.variant_id NULLS FIRST
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
          product_id, variant_id, order_id, change, reason, balance_after,
          is_damaged, actor_id, note
        )
        VALUES (
          v_line.product_id, v_line.variant_id, v_order_id, v_line.quantity,
          'manual_delete_reversal', v_new_stock, false, p_actor_id,
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
       SET status = 'deleted'::public.order_status, updated_at = NOW()
     WHERE id = v_order_id;

    INSERT INTO public.order_history (
      order_id, status_from, status_to, actor_id, actor_type, note
    )
    VALUES (
      v_order_id, v_status, 'deleted'::public.order_status, p_actor_id, 'manager',
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

-- ── 7. record_stock_count : la régression 42P10, et la variante ────────────
--
-- L'ancienne signature est SUPPRIMÉE avant d'être recréée : deux surcharges ne
-- différant que par un paramètre font échouer PostgREST avec « function is not
-- unique » (déjà vu en 20260506010000). `p_variant_id` arrive DONC en dernier
-- et avec un défaut, pour que l'appelant actuel
-- (src/app/api/warehouse/stock/count/route.ts) continue sans changement.
--
-- `SET search_path = public` est ajouté au passage : la fonction n'en avait
-- pas, ce qui la laissait sensible au search_path de l'appelant — un des
-- avertissements ouverts du linter Supabase.

-- L'ancienne signature ET la nouvelle : sans le second DROP, ré-appliquer la
-- migration (rebuild local, replay sur une branche) échoue avec « function
-- already exists with same argument types ». Une migration doit pouvoir être
-- rejouée sur une base qui l'a déjà vue.
DROP FUNCTION IF EXISTS public.record_stock_count(UUID, INTEGER, UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.record_stock_count(UUID, INTEGER, UUID, TEXT, UUID, UUID);

CREATE FUNCTION public.record_stock_count(
  p_product_id   UUID,
  p_counted_qty  INTEGER,
  p_actor_id     UUID,
  p_note         TEXT,
  p_warehouse_id UUID DEFAULT NULL,
  p_variant_id   UUID DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_role            TEXT;
  v_actor_market    UUID;
  v_actor_site      UUID;
  v_product_market  UUID;
  v_current         INTEGER;
  v_site_before     INTEGER;
  v_delta           INTEGER;
  v_new_total       INTEGER;
  v_variant_before  INTEGER;
  v_variant_after   INTEGER;
  v_site_market     UUID;
  v_log_id          UUID;
BEGIN
  IF p_counted_qty IS NULL OR p_counted_qty < 0 THEN
    RAISE EXCEPTION 'counted quantity must be zero or more'
      USING DETAIL = '{"code":"BAD_QUANTITY"}';
  END IF;

  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'a note is required for a stock count'
      USING DETAIL = '{"code":"NOTE_REQUIRED"}';
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Un comptage ne peut pas être porté au crédit d''un autre opérateur'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;

  SELECT role, market_id, warehouse_id INTO v_role, v_actor_market, v_actor_site
  FROM users WHERE id = p_actor_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_NOT_FOUND"}';
  END IF;
  IF v_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Actor role % cannot count stock', v_role
      USING ERRCODE = '42501', DETAIL = '{"code":"FORBIDDEN"}';
  END IF;

  SELECT market_id, current_stock INTO v_product_market, v_current
  FROM products WHERE id = p_product_id
  FOR UPDATE;

  IF v_product_market IS NULL THEN
    RAISE EXCEPTION 'Product not found'
      USING DETAIL = '{"code":"NO_PRODUCT"}';
  END IF;

  IF v_role <> 'super_admin' AND v_actor_market IS DISTINCT FROM v_product_market THEN
    RAISE EXCEPTION 'Product belongs to another market'
      USING DETAIL = '{"code":"MARKET_MISMATCH"}';
  END IF;

  -- La variante doit appartenir au produit compté, et porter du stock. Compter
  -- « 12 Pack 2 » n'a pas de sens : un palier n'est pas un objet en rayon.
  IF p_variant_id IS NOT NULL THEN
    SELECT current_stock INTO v_variant_before
    FROM product_variants
    WHERE id = p_variant_id AND product_id = p_product_id AND kind = 'attribute'
    FOR UPDATE;

    IF v_variant_before IS NULL THEN
      RAISE EXCEPTION 'Cette variante n''appartient pas au produit, ou ne porte pas de stock'
        USING DETAIL = '{"code":"NO_VARIANT"}';
    END IF;
  END IF;

  IF p_warehouse_id IS NOT NULL THEN
    SELECT market_id INTO v_site_market FROM public.warehouses WHERE id = p_warehouse_id;
    IF v_site_market IS DISTINCT FROM v_product_market THEN
      RAISE EXCEPTION 'Ce site n''appartient pas au marché du produit'
        USING DETAIL = '{"code":"MARKET_MISMATCH"}';
    END IF;
    -- Un agent compte son propre bâtiment. Un manager compte n'importe lequel
    -- des siens : c'est lui qui arbitre quand les deux sites se contredisent.
    IF v_role = 'warehouse_agent' AND v_actor_site IS NOT NULL
       AND v_actor_site IS DISTINCT FROM p_warehouse_id THEN
      RAISE EXCEPTION 'Vous ne comptez pas ce bâtiment'
        USING ERRCODE = '42501', DETAIL = '{"code":"WRONG_SITE"}';
    END IF;
  END IF;

  IF p_warehouse_id IS NULL THEN
    -- Comptage marché, comportement d'origine. Avec une variante nommée, c'est
    -- la variante entière qu'on recompte, tous sites confondus — l'écart se
    -- reporte sur le total du produit. Sans variante, `v_current + v_delta`
    -- vaut exactement `p_counted_qty` : le comportement d'origine, au mot près.
    v_delta := p_counted_qty - COALESCE(v_variant_before, v_current);
    v_new_total := v_current + v_delta;

    IF v_new_total < 0 THEN
      RAISE EXCEPTION 'Ce comptage ferait passer le total marché sous zéro'
        USING DETAIL = '{"code":"STOCK_UNDERFLOW"}';
    END IF;
  ELSE
    SELECT current_stock INTO v_site_before
    FROM public.product_site_stock
    WHERE product_id = p_product_id
      AND warehouse_id = p_warehouse_id
      AND variant_id IS NOT DISTINCT FROM p_variant_id
    FOR UPDATE;
    v_site_before := COALESCE(v_site_before, 0);
    v_delta := p_counted_qty - v_site_before;
    v_new_total := v_current + v_delta;

    IF v_new_total < 0 THEN
      RAISE EXCEPTION 'Ce comptage ferait passer le total marché sous zéro'
        USING DETAIL = '{"code":"STOCK_UNDERFLOW"}';
    END IF;

    -- ON CONFLICT doit désigner EXACTEMENT les colonnes de l'index unique, qui
    -- porte la variante depuis 20260920162309. Le viser sur (produit, site)
    -- lève 42P10 et tuait tout comptage par site.
    INSERT INTO public.product_site_stock
      (product_id, variant_id, warehouse_id, current_stock, last_counted_at)
    VALUES (p_product_id, p_variant_id, p_warehouse_id, p_counted_qty, now())
    ON CONFLICT (product_id, variant_id, warehouse_id) DO UPDATE
      SET current_stock = EXCLUDED.current_stock,
          last_counted_at = EXCLUDED.last_counted_at;
  END IF;

  -- La variante suit le même écart que le total : elle est la somme de ses
  -- sites, comme le produit est la somme de tout.
  IF p_variant_id IS NOT NULL THEN
    v_variant_after := v_variant_before + v_delta;
    IF v_variant_after < 0 THEN
      RAISE EXCEPTION 'Ce comptage ferait passer la variante sous zéro'
        USING DETAIL = '{"code":"STOCK_UNDERFLOW"}';
    END IF;
    UPDATE product_variants
       SET current_stock = v_variant_after, updated_at = now()
     WHERE id = p_variant_id;
  END IF;

  IF v_delta <> 0 OR p_warehouse_id IS NOT NULL THEN
    UPDATE products
    SET current_stock = v_new_total, updated_at = now()
    WHERE id = p_product_id;
  END IF;

  -- Une ligne même à delta nul : c'est la preuve que le chiffre a été vérifié
  -- ce jour-là, et c'est ce que lit get_count_accuracy. Le trigger de
  -- ventilation s'arrête sur `stock_count` — un comptage POSE une valeur, il
  -- ne se propage pas — d'où l'arithmétique faite ici, à la main.
  INSERT INTO inventory_log (
    product_id, variant_id, order_id, change, reason, balance_after,
    actor_id, note, warehouse_id
  )
  VALUES (
    p_product_id, p_variant_id, NULL, v_delta, 'stock_count', v_new_total,
    p_actor_id, btrim(p_note), p_warehouse_id
  )
  RETURNING id INTO v_log_id;

  RETURN json_build_object(
    'product_id', p_product_id,
    'variant_id', p_variant_id,
    'warehouse_id', p_warehouse_id,
    'counted', p_counted_qty,
    'previous', CASE
                  WHEN p_warehouse_id IS NOT NULL THEN v_site_before
                  WHEN p_variant_id IS NOT NULL THEN v_variant_before
                  ELSE v_current
                END,
    'delta', v_delta,
    'stock_after', v_new_total,
    'variant_stock_after', v_variant_after,
    'site_stock_after', CASE WHEN p_warehouse_id IS NULL THEN NULL ELSE p_counted_qty END,
    'inventory_log_id', v_log_id
  );
END;
$function$;

-- ── 8. adjust_product_stock : une correction peut viser une variante ───────
--
-- Une entrée de variante fait monter le total marché du même nombre : ce sont
-- des unités qui ARRIVENT, pas une répartition d'unités déjà comptées. La
-- répartition, c'est `record_stock_count`.
--
-- La fonction n'écrit QUE `products` : le trigger de 20260920162309 applique
-- la ligne de registre à `product_variants`. Le faire ici aussi compterait
-- deux fois.

DROP FUNCTION IF EXISTS public.adjust_product_stock(UUID, INTEGER, TEXT, TEXT, UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.adjust_product_stock(UUID, INTEGER, TEXT, TEXT, UUID, BOOLEAN, UUID);

CREATE FUNCTION public.adjust_product_stock(
  p_product_id UUID,
  p_change     INTEGER,
  p_reason     TEXT,
  p_note       TEXT,
  p_actor_id   UUID,
  p_is_damaged_writeoff BOOLEAN DEFAULT false,
  p_variant_id UUID DEFAULT NULL
) RETURNS TABLE(new_stock INTEGER, new_damaged INTEGER)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role        TEXT;
  v_product     products%ROWTYPE;
  v_variant     product_variants%ROWTYPE;
  v_new_stock   INTEGER;
  v_new_damaged INTEGER;
BEGIN
  -- Ici la garde protège l'ATTRIBUTION : la fonction est déjà réservée au
  -- super_admin quel que soit l'id passé, mais le registre est en écriture
  -- seule, donc une ligne signée du mauvais nom ne se corrige jamais.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Une correction de stock ne peut pas être portée au crédit d''un autre opérateur'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;

  SELECT role INTO v_role FROM users WHERE id = p_actor_id;
  IF v_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can adjust stock';
  END IF;

  IF p_reason NOT IN ('manual_adjustment', 'damaged_writeoff') THEN
    RAISE EXCEPTION 'Invalid reason: %', p_reason;
  END IF;

  IF p_change = 0 THEN
    RAISE EXCEPTION 'change must be non-zero';
  END IF;

  IF p_is_damaged_writeoff AND p_change >= 0 THEN
    RAISE EXCEPTION 'damaged_writeoff requires negative change';
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT * INTO v_variant FROM product_variants
     WHERE id = p_variant_id AND product_id = p_product_id AND kind = 'attribute'
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cette variante n''appartient pas au produit, ou ne porte pas de stock'
        USING DETAIL = '{"code":"NO_VARIANT"}';
    END IF;
    -- Une variante ne peut pas passer sous zéro, même si le produit le peut.
    IF NOT p_is_damaged_writeoff AND v_variant.current_stock + p_change < 0 THEN
      RAISE EXCEPTION 'stock cannot go below zero';
    END IF;
    IF p_is_damaged_writeoff AND v_variant.current_stock < ABS(p_change) THEN
      RAISE EXCEPTION 'stock cannot go below zero';
    END IF;
  END IF;

  IF p_is_damaged_writeoff THEN
    v_new_stock   := v_product.current_stock;
    v_new_damaged := v_product.damaged_return_count + ABS(p_change);
    UPDATE products SET damaged_return_count = v_new_damaged, updated_at = now()
      WHERE id = p_product_id;
    INSERT INTO inventory_log (
      product_id, variant_id, order_id, change, reason, balance_after,
      is_damaged, actor_id, note
    ) VALUES (
      p_product_id, p_variant_id, NULL, p_change, 'damaged_writeoff',
      v_new_damaged, true, p_actor_id, p_note
    );
  ELSE
    v_new_stock := v_product.current_stock + p_change;
    IF v_new_stock < 0 THEN
      RAISE EXCEPTION 'stock cannot go below zero';
    END IF;
    -- Un retrait qui ne nomme pas de variante prend dans le NON VENTILÉ. Le
    -- refuser ici plutôt que de laisser l'invariant différé le faire au COMMIT :
    -- même refus, mais avec un message qui dit quoi faire.
    IF p_variant_id IS NULL AND p_change < 0 THEN
      IF v_new_stock < COALESCE((SELECT SUM(v.current_stock) FROM product_variants v
                                  WHERE v.product_id = p_product_id AND v.kind = 'attribute'), 0) THEN
        RAISE EXCEPTION 'Ce retrait ferait passer le total sous la somme de ses variantes — retirez d''une variante'
          USING ERRCODE = '23514', DETAIL = '{"code":"VARIANT_STOCK_EXCEEDS_TOTAL"}';
      END IF;
    END IF;
    v_new_damaged := v_product.damaged_return_count;
    UPDATE products SET current_stock = v_new_stock, updated_at = now()
      WHERE id = p_product_id;
    INSERT INTO inventory_log (
      product_id, variant_id, order_id, change, reason, balance_after,
      is_damaged, actor_id, note
    ) VALUES (
      p_product_id, p_variant_id, NULL, p_change, 'manual_adjustment',
      v_new_stock, false, p_actor_id, p_note
    );
  END IF;

  RETURN QUERY SELECT v_new_stock, v_new_damaged;
END;
$$;

-- ── 9. L'invariant variante, armé DES DEUX CÔTÉS ──────────────────────────
--
-- La phase 1 n'avait posé le déclencheur que sur `product_variants` : faire
-- DESCENDRE `products.current_stock` sous la somme de ses variantes passait
-- donc sans rien dire. Il faut les deux tables — et c'est exactement ce que
-- fait déjà `assert_site_stock_within_total`.
--
-- ATTENTION, leçon de 20260909195032 : dans un déclencheur de contrainte
-- DIFFÉRÉ, on branche sur TG_RELID (l'OID), jamais sur TG_TABLE_NAME. Le nom
-- ne résolvait pas au moment différé, `NEW.product_id` était lu sur `products`
-- qui n'a pas cette colonne, et TOUT scan mourait au COMMIT. La version de la
-- phase 1 lisait `COALESCE(NEW.product_id, OLD.product_id)` : posée telle
-- quelle sur `products`, elle aurait reproduit ce bug à l'identique.

CREATE OR REPLACE FUNCTION public.assert_variant_stock_within_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_row     JSONB;
  v_product UUID;
  v_sum     INTEGER;
  v_total   INTEGER;
BEGIN
  v_row := to_jsonb(COALESCE(NEW, OLD));

  IF TG_RELID = 'public.products'::regclass THEN
    v_product := (v_row->>'id')::UUID;
  ELSIF v_row ? 'product_id' THEN
    v_product := (v_row->>'product_id')::UUID;
  ELSE
    RETURN NULL;
  END IF;

  IF v_product IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(current_stock), 0) INTO v_sum
    FROM public.product_variants
   WHERE product_id = v_product AND kind = 'attribute';

  SELECT current_stock INTO v_total
    FROM public.products WHERE id = v_product;

  IF v_total IS NOT NULL AND v_sum > v_total THEN
    RAISE EXCEPTION
      'Les variantes déclarent % unités pour un total produit de % : dites quelle variante perd les unités',
      v_sum, v_total
      USING ERRCODE = '23514', DETAIL = '{"code":"VARIANT_STOCK_EXCEEDS_TOTAL"}';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_variant_stock_within_total ON public.product_variants;
CREATE CONSTRAINT TRIGGER trg_variant_stock_within_total
  AFTER INSERT OR UPDATE OF current_stock ON public.product_variants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_variant_stock_within_total();

DROP TRIGGER IF EXISTS trg_products_total_covers_variants ON public.products;
CREATE CONSTRAINT TRIGGER trg_products_total_covers_variants
  AFTER UPDATE OF current_stock ON public.products
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_variant_stock_within_total();

-- L'inégalité du dessous : les sites d'une variante ne peuvent pas déclarer
-- plus que la variante entière. Même forme, même raison.
CREATE OR REPLACE FUNCTION public.assert_variant_site_stock_within_variant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_row     JSONB;
  v_variant UUID;
  v_sum     INTEGER;
  v_total   INTEGER;
BEGIN
  v_row := to_jsonb(COALESCE(NEW, OLD));

  IF TG_RELID = 'public.product_variants'::regclass THEN
    v_variant := (v_row->>'id')::UUID;
  ELSIF v_row ? 'variant_id' THEN
    v_variant := (v_row->>'variant_id')::UUID;
  ELSE
    RETURN NULL;
  END IF;

  -- Une ligne de site sans variante est déjà couverte par
  -- assert_site_stock_within_total : rien à vérifier ici.
  IF v_variant IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(current_stock), 0) INTO v_sum
    FROM public.product_site_stock WHERE variant_id = v_variant;

  SELECT current_stock INTO v_total
    FROM public.product_variants WHERE id = v_variant;

  IF v_total IS NOT NULL AND v_sum > v_total THEN
    RAISE EXCEPTION
      'Les sites déclarent % unités de cette variante pour un total de % : dites quel site perd les unités',
      v_sum, v_total
      USING ERRCODE = '23514', DETAIL = '{"code":"VARIANT_SITE_STOCK_EXCEEDS_TOTAL"}';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_variant_site_within_variant ON public.product_site_stock;
CREATE CONSTRAINT TRIGGER trg_variant_site_within_variant
  AFTER INSERT OR UPDATE OF current_stock ON public.product_site_stock
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_variant_site_stock_within_variant();

DROP TRIGGER IF EXISTS trg_variant_covers_its_sites ON public.product_variants;
CREATE CONSTRAINT TRIGGER trg_variant_covers_its_sites
  AFTER UPDATE OF current_stock ON public.product_variants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_variant_site_stock_within_variant();

-- ── 10. Les privilèges, reposés puis AFFIRMÉS ─────────────────────────────
--
-- Les trois fonctions DROP + CREATE ci-dessus sont reparties du défaut
-- PostgreSQL : EXECUTE pour PUBLIC, donc pour `anon`, donc sans connexion.
-- On les referme, et on refuse d'appliquer la migration si l'une d'elles est
-- restée ouverte — la vérification vaut mieux que l'intention.

-- Interne aux RPC ci-dessus, qui l'atteignent par leur privilège de
-- définisseur. Elle ne prend pas d'acteur et ne compare pas de marché :
-- publiée, un id de commande suffirait à lire le contenu de n'importe quelle
-- commande des deux marchés.
REVOKE ALL ON FUNCTION public.order_stock_lines(UUID) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.record_stock_count(UUID, INTEGER, UUID, TEXT, UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_count(UUID, INTEGER, UUID, TEXT, UUID, UUID)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.adjust_product_stock(UUID, INTEGER, TEXT, TEXT, UUID, BOOLEAN, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_product_stock(UUID, INTEGER, TEXT, TEXT, UUID, BOOLEAN, UUID)
  TO authenticated, service_role;

DO $$
DECLARE
  v_open TEXT;
BEGIN
  SELECT string_agg(p.oid::regprocedure::TEXT, ', ') INTO v_open
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.proname IN ('order_stock_lines', 'scan_order_out', 'unscan_order',
                      'scan_return_in', 'scan_received_in', 'record_stock_count',
                      'adjust_product_stock', 'manual_delete_orders')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'Ces RPC de stock sont restées exécutables sans connexion : %', v_open;
  END IF;
END $$;

COMMENT ON FUNCTION public.record_stock_count(UUID, INTEGER, UUID, TEXT, UUID, UUID) IS
  'Comptage physique. Sans site : recompte le total (marché, ou variante si '
  'nommée). Avec site : POSE la valeur du site et reporte l''écart sur la '
  'variante puis sur le total. Crée la ligne de site — c''est le comptage qui '
  'fait entrer un produit dans le modèle par bâtiment.';
