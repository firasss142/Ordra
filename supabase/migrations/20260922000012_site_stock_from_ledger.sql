-- Le mouvement par site se déduit du registre, en un seul endroit.
--
-- POURQUOI PAS CINQ FONCTIONS RÉÉCRITES
--   Cinq RPC déplacent du stock (scan_order_out, scan_return_in,
--   scan_received_in, record_stock_count, adjust_product_stock) et une sixième
--   le rend (manual_delete_orders). Leur ajouter à chacune l'arithmétique par
--   site, c'est six occasions de la faire subtilement différemment, et six
--   fonctions à relire à chaque évolution.
--
--   Or elles ont déjà un point commun : chacune écrit EXACTEMENT une ligne
--   d'inventory_log par mouvement, avec le produit, le signe et le drapeau
--   « endommagé ». Le registre est donc le seul endroit où tout mouvement passe.
--   La ventilation par site s'y branche : un trigger lit la ligne et applique le
--   même mouvement à la ligne de site. Une seule implémentation, atomique par
--   construction, et les RPC existantes n'ont rien à savoir du modèle.
--
-- LE SIGNE DE `change` N'EST PAS FIABLE SUR LES LIGNES ENDOMMAGÉES
--   scan_return_in écrit change=+qty pour une casse ; adjust_product_stock écrit
--   change=−qty pour la même chose. Les deux veulent dire « damaged_return_count
--   augmente de ABS(change) ». Le trigger lit donc is_damaged d'abord et prend
--   la valeur absolue — reproduire le bug plutôt que l'inventer ailleurs.
--
-- CE TRIGGER NE PEUT PAS BLOQUER UN SCAN
--   Il n'agit que si une ligne (produit, site) existe déjà. Elle n'est créée que
--   par un comptage physique. Tant que l'entrepôt n'a pas compté, le modèle par
--   site est donc totalement inerte : rien ne change, rien ne peut casser.

-- ── 1. D'où vient le site d'un mouvement ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.inventory_log_fill_warehouse()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Un mouvement lié à une commande a lieu là où la commande est préparée.
  -- Les autres (comptage, correction) nomment leur site explicitement.
  IF NEW.warehouse_id IS NULL AND NEW.order_id IS NOT NULL THEN
    SELECT o.warehouse_id INTO NEW.warehouse_id
    FROM public.orders o WHERE o.id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_log_fill_warehouse ON public.inventory_log;
CREATE TRIGGER trg_inventory_log_fill_warehouse
  BEFORE INSERT ON public.inventory_log
  FOR EACH ROW EXECUTE FUNCTION public.inventory_log_fill_warehouse();

-- ── 2. Le mouvement, appliqué à la ligne de site ────────────────────────────

CREATE OR REPLACE FUNCTION public.inventory_log_apply_to_site()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.warehouse_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Un comptage n'est pas un delta à propager : record_stock_count POSE la
  -- valeur du site et ajuste le total du même écart. Propager ici doublerait.
  IF NEW.reason = 'stock_count' THEN
    RETURN NULL;
  END IF;

  -- Pas de ligne = ce produit n'a jamais été compté sur ce site. Les unités
  -- restent « non ventilées » au niveau marché plutôt que de créer une ligne
  -- négative ou d'inventer une répartition.
  UPDATE public.product_site_stock s
  SET current_stock = CASE WHEN NEW.is_damaged THEN s.current_stock
                           ELSE s.current_stock + NEW.change END,
      damaged_return_count = CASE WHEN NEW.is_damaged
                                  THEN s.damaged_return_count + ABS(NEW.change)
                                  ELSE s.damaged_return_count END
  WHERE s.product_id = NEW.product_id
    AND s.warehouse_id = NEW.warehouse_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_log_apply_to_site ON public.inventory_log;
CREATE TRIGGER trg_inventory_log_apply_to_site
  AFTER INSERT ON public.inventory_log
  FOR EACH ROW EXECUTE FUNCTION public.inventory_log_apply_to_site();

-- ── 3. Compter, c'est compter un bâtiment ───────────────────────────────────
--
-- Le comptage physique est l'acte qui fait entrer un produit dans le modèle par
-- site : il crée la ligne. Sans site nommé, l'ancien comportement est conservé
-- au mot près (un comptage marché), pour la Tunisie et pour tout appelant qui
-- n'a pas encore de site à donner.
--
-- L'ancienne signature à 4 arguments est supprimée : deux surcharges qui ne
-- diffèrent que par un paramètre font échouer PostgREST avec « function is not
-- unique » (déjà vu en 20260506010000).

DROP FUNCTION IF EXISTS public.record_stock_count(UUID, INTEGER, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.record_stock_count(
  p_product_id   UUID,
  p_counted_qty  INTEGER,
  p_actor_id     UUID,
  p_note         TEXT,
  p_warehouse_id UUID DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
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
    -- Comptage marché, comportement d'origine.
    v_delta := p_counted_qty - v_current;
    v_new_total := p_counted_qty;
  ELSE
    SELECT current_stock INTO v_site_before
    FROM public.product_site_stock
    WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
    FOR UPDATE;
    v_site_before := COALESCE(v_site_before, 0);
    v_delta := p_counted_qty - v_site_before;
    v_new_total := v_current + v_delta;

    IF v_new_total < 0 THEN
      RAISE EXCEPTION 'Ce comptage ferait passer le total marché sous zéro'
        USING DETAIL = '{"code":"STOCK_UNDERFLOW"}';
    END IF;

    INSERT INTO public.product_site_stock (product_id, warehouse_id, current_stock, last_counted_at)
    VALUES (p_product_id, p_warehouse_id, p_counted_qty, now())
    ON CONFLICT (product_id, warehouse_id) DO UPDATE
      SET current_stock = EXCLUDED.current_stock,
          last_counted_at = EXCLUDED.last_counted_at;
  END IF;

  IF v_delta <> 0 OR p_warehouse_id IS NOT NULL THEN
    UPDATE products
    SET current_stock = v_new_total, updated_at = now()
    WHERE id = p_product_id;
  END IF;

  -- Une ligne même à delta nul : c'est la preuve que le chiffre a été vérifié
  -- ce jour-là, et c'est ce que lit get_count_accuracy.
  INSERT INTO inventory_log (
    product_id, order_id, change, reason, balance_after, actor_id, note, warehouse_id
  )
  VALUES (
    p_product_id, NULL, v_delta, 'stock_count', v_new_total, p_actor_id,
    btrim(p_note), p_warehouse_id
  )
  RETURNING id INTO v_log_id;

  RETURN json_build_object(
    'product_id', p_product_id,
    'warehouse_id', p_warehouse_id,
    'counted', p_counted_qty,
    'previous', CASE WHEN p_warehouse_id IS NULL THEN v_current ELSE v_site_before END,
    'delta', v_delta,
    'stock_after', v_new_total,
    'site_stock_after', CASE WHEN p_warehouse_id IS NULL THEN NULL ELSE p_counted_qty END,
    'inventory_log_id', v_log_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_stock_count(UUID, INTEGER, UUID, TEXT, UUID) TO PUBLIC;
