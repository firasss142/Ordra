-- ============================================================
-- 20260924140000_product_variants_delete_lockdown.sql
-- Supprimer une variante redevient super_admin, comme tout le reste du modèle.
--
-- LA FAILLE. `product_variants_delete_sa_mm` date du schéma initial
-- (00000000000002_rls_policies.sql) et autorise le super_admin OU le
-- market_manager du marché du produit. Le verrouillage du stock
-- (20260427221856_product_stock_lockdown.sql) a resserré INSERT et UPDATE de
-- `product_variants` à super_admin seul, et a fait de même pour le DELETE de
-- `products` — mais n'a jamais touché le DELETE de `product_variants`. Aucune
-- migration n'y est revenue depuis.
--
-- CE QUE ÇA PERMETTAIT. `authenticated` porte le privilège DELETE sur la table,
-- donc un market_manager pouvait appeler PostgREST directement :
--
--     DELETE /rest/v1/product_variants?id=eq.<uuid>
--
-- et contourner d'un coup TROIS choses que la route DELETE venait d'ajouter :
--   · le verrou super_admin (`canManageProducts`) ;
--   · le refus de supprimer une variante qui porte encore du stock — aucune
--     contrainte ne le bloque en base, le déclencheur d'invariant ne se
--     déclenchant qu'`AFTER INSERT OR UPDATE OF current_stock`, jamais DELETE ;
--   · le retrait en douceur quand l'histoire s'y réfère. Et c'est le pire :
--     `order_items.variant_id`, `orders.product_variant_id` et
--     `storefront_product_mappings.product_variant_id` sont tous
--     `ON DELETE SET NULL`, donc une commande passée sur « Grand » perdait le
--     lien EN SILENCE. Seul `inventory_log.variant_id` est protégé en base
--     (pas de clause ON DELETE, donc NO ACTION) — la seule référence sûre est
--     aussi celle que la route vérifie en dernier.
--
-- CE QUI NE CHANGE PAS : la LECTURE. `product_variants_select` reste intacte —
-- super_admin, market_manager de son marché, et agent sur produit actif ET
-- variante active. Une politique `FOR ALL ... super_admin` posée à la place
-- aurait retiré la lecture aux agents et fait disparaître les paliers de la
-- fiche produit en plein appel téléphonique.
-- ============================================================

DROP POLICY IF EXISTS product_variants_delete_sa_mm ON public.product_variants;

CREATE POLICY product_variants_delete_sa ON public.product_variants
  FOR DELETE
  USING (public.get_user_role() = 'super_admin');

COMMENT ON POLICY product_variants_delete_sa ON public.product_variants IS
  'Supprimer une variante est un acte de stock : super_admin seul, comme '
  'INSERT et UPDATE depuis 20260427221856. Le market_manager garde la LECTURE '
  'et le note agent (update_variant_agent_note).';

-- Vérification, pas intention : la politique permissive de suppression doit
-- être unique et ne nommer que super_admin.
DO $$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(polname, ', ') INTO v_bad
  FROM pg_policy
  WHERE polrelid = 'public.product_variants'::regclass
    AND polcmd = 'd'
    AND pg_get_expr(polqual, polrelid) LIKE '%market_manager%';

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Une politique de suppression laisse encore passer un market_manager : %', v_bad;
  END IF;
END $$;
