-- L'invariant de stock par site plantait sur toute écriture de `products`.
--
-- SYMPTÔME
--   ERROR: record "new" has no field "product_id"
--   CONTEXT: v_product_id := CASE TG_TABLE_NAME WHEN 'products' THEN NEW.id
--                                               ELSE NEW.product_id END
--            PL/pgSQL function assert_site_stock_within_total() line 7
--
--   Donc TOUT scan de sortie échouait au COMMIT — `scan_order_out` décrémente
--   `products.current_stock`, ce qui arme `trg_products_total_covers_sites`.
--   La branche 'products' n'était pas prise, on tombait sur `NEW.product_id`
--   qui n'existe pas sur cette table, et la transaction mourait.
--
-- POURQUOI C'ÉTAIT INVISIBLE
--   Les deux déclencheurs sont CONSTRAINT ... DEFERRABLE INITIALLY DEFERRED :
--   ils ne s'évaluent qu'à la validation. Un appel encadré d'un ROLLBACK — la
--   façon dont cette fonction avait été « vérifiée en production » le
--   2026-09-09 — ne les déclenche jamais. Le test passait, la vraie écriture
--   plantait. Reproduit ensuite avec SET CONSTRAINTS ALL IMMEDIATE.
--
-- LE CORRECTIF
--   Comparer TG_RELID, l'OID de la table, plutôt que TG_TABLE_NAME. L'OID est
--   toujours celui de la table qui a déclenché, sans dépendre du texte du nom
--   ni du search_path au moment différé de l'évaluation.
--
--   Ceinture et bretelles : on teste aussi la présence du champ avant de le
--   lire (to_jsonb ? 'product_id'), pour qu'un futur déclencheur posé sur une
--   troisième table dégrade en no-op au lieu de bloquer tout le stock.

CREATE OR REPLACE FUNCTION public.assert_site_stock_within_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_row        JSONB;
  v_product_id UUID;
  v_total      INTEGER;
  v_sites      INTEGER;
BEGIN
  v_row := to_jsonb(NEW);

  -- L'OID, jamais le nom : c'est la seule identité fiable dans un déclencheur
  -- de contrainte différé.
  IF TG_RELID = 'public.products'::regclass THEN
    v_product_id := (v_row->>'id')::UUID;
  ELSIF v_row ? 'product_id' THEN
    v_product_id := (v_row->>'product_id')::UUID;
  ELSE
    -- Table inattendue : ne rien casser, il n'y a rien à vérifier ici.
    RETURN NULL;
  END IF;

  IF v_product_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT current_stock INTO v_total FROM public.products WHERE id = v_product_id;
  SELECT COALESCE(SUM(current_stock), 0) INTO v_sites
  FROM public.product_site_stock WHERE product_id = v_product_id;

  IF v_total IS NOT NULL AND v_sites > v_total THEN
    RAISE EXCEPTION
      'Les sites déclarent % unités pour un total marché de % : dites quel site perd les unités',
      v_sites, v_total
      USING ERRCODE = '23514', DETAIL = '{"code":"SITE_STOCK_EXCEEDS_TOTAL"}';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.assert_site_stock_within_total() IS
  'Invariant somme(sites) <= total marché. Branche sur TG_RELID (l''OID) et non '
  'sur TG_TABLE_NAME : dans un déclencheur de contrainte différé, le nom ne '
  'résolvait pas et toute écriture de products plantait au COMMIT, ce qui '
  'bloquait tous les scans de sortie.';
