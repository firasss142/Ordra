-- record_stock_count : un comptage de bâtiment puise dans le NON VENTILÉ.
--
-- LE BUG. Un bâtiment jamais compté était lu comme tenant ZÉRO : Benghazi
-- compte 900 Corans sur un registre de 943, l'écart vaut +900, le total marché
-- passe à 1 843. Chaque premier comptage doublait le stock — et la finance lit
-- ce total. Inerte jusqu'ici parce que personne n'avait jamais compté (0 ligne
-- `stock_count` en production le 2026-10-02) ; la tournée de comptage de
-- l'Entrepôt l'aurait déclenché sur chaque produit.
--
-- LA RÈGLE (décision du propriétaire, 2026-10-02, plans/entrepot-day-loop-redesign.md),
-- au grain produit × variante :
--   1. Ce qu'un bâtiment compte EN PLUS de ce qu'il tenait sort d'abord du non
--      ventilé (niveau − somme des bâtiments). Le total ne monte que de ce qui
--      dépasse ce réservoir.
--   2. Une baisse à un bâtiment est une perte : le total baisse d'autant.
--   3. Quand tous les bâtiments ACTIFS du marché ont compté (last_counted_at),
--      le niveau vaut exactement la somme des bâtiments : ce qu'aucun n'a trouvé
--      est l'écart de comptage. Un marché à un bâtiment (Tunisie) : compter le
--      bâtiment, c'est compter le marché.
-- Les deux inégalités (somme des sites ≤ niveau ≤ total) tiennent dans les trois
-- cas ; les déclencheurs différés restent le filet.
--
-- Le comptage MARCHÉ (p_warehouse_id NULL) ne change pas d'un mot.
--
-- CREATE OR REPLACE, même signature, même type de retour : l'ACL est conservée
-- (authenticated, service_role ; pas anon). DROP + CREATE la rouvrirait à anon.
-- La réponse gagne trois clés : site_delta, from_pool, closed. `delta` reste
-- l'écart du TOTAL MARCHÉ, ce qu'il a toujours voulu dire.

CREATE OR REPLACE FUNCTION public.record_stock_count(
  p_product_id uuid,
  p_counted_qty integer,
  p_actor_id uuid,
  p_note text,
  p_warehouse_id uuid DEFAULT NULL::uuid,
  p_variant_id uuid DEFAULT NULL::uuid
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role            TEXT;
  v_actor_market    UUID;
  v_actor_site      UUID;
  v_product_market  UUID;
  v_current         INTEGER;
  v_site_before     INTEGER;
  v_site_delta      INTEGER;
  v_level           INTEGER;
  v_sites_sum       INTEGER;
  v_pool            INTEGER;
  v_from_pool       INTEGER := 0;
  v_closed          BOOLEAN := FALSE;
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
    v_site_delta := p_counted_qty - v_site_before;

    -- Le NIVEAU compté : la variante nommée, ou le stock « produit nu » (le
    -- total moins ses variantes d'attribut) quand aucune n'est nommée.
    IF p_variant_id IS NOT NULL THEN
      v_level := v_variant_before;
    ELSE
      SELECT v_current - COALESCE(SUM(current_stock), 0) INTO v_level
      FROM product_variants
      WHERE product_id = p_product_id AND kind = 'attribute';
    END IF;

    -- Ce que les bâtiments déclarent déjà à ce niveau, celui-ci compris.
    SELECT COALESCE(SUM(current_stock), 0) INTO v_sites_sum
    FROM public.product_site_stock
    WHERE product_id = p_product_id
      AND variant_id IS NOT DISTINCT FROM p_variant_id;

    -- Le non ventilé : ce qu'aucun bâtiment n'a encore compté.
    v_pool := GREATEST(v_level - v_sites_sum, 0);

    -- Tous les AUTRES bâtiments actifs du marché ont-ils déjà compté ce niveau ?
    -- Avec celui-ci, le produit est alors entièrement compté.
    SELECT NOT EXISTS (
      SELECT 1
      FROM public.warehouses w
      WHERE w.market_id = v_product_market
        AND w.is_active
        AND w.id <> p_warehouse_id
        AND NOT EXISTS (
          SELECT 1 FROM public.product_site_stock s
          WHERE s.product_id = p_product_id
            AND s.warehouse_id = w.id
            AND s.variant_id IS NOT DISTINCT FROM p_variant_id
            AND s.last_counted_at IS NOT NULL
        )
    ) INTO v_closed;

    IF v_site_delta > 0 THEN
      v_from_pool := LEAST(v_pool, v_site_delta);
    END IF;

    IF v_closed THEN
      -- Règle 3 : le niveau vaut la somme des bâtiments après ce comptage.
      v_delta := (v_sites_sum - v_site_before + p_counted_qty) - v_level;
    ELSE
      -- Règles 1 et 2 : une hausse puise d'abord dans le non ventilé ; une
      -- baisse est une perte réelle.
      v_delta := v_site_delta - v_from_pool;
    END IF;

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
    'site_delta', v_site_delta,
    'from_pool', v_from_pool,
    'closed', v_closed,
    'stock_after', v_new_total,
    'variant_stock_after', v_variant_after,
    'site_stock_after', CASE WHEN p_warehouse_id IS NULL THEN NULL ELSE p_counted_qty END,
    'inventory_log_id', v_log_id
  );
END;
$function$;
