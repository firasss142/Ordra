-- Le stock, bâtiment par bâtiment — à CÔTÉ du total marché, pas à sa place.
--
-- POURQUOI PAS UN REMPLACEMENT
--   products.current_stock est lu par 51 fichiers source et 32 fonctions SQL :
--   la finance, le P&L, les faits investisseurs, les fiches produit. Le
--   remplacer d'un coup, c'est réécrire tout ça en même temps que le flux
--   entrepôt, et se priver de toute possibilité de livrer par morceaux.
--
--   Le total reste donc la vérité pour l'argent. product_site_stock est la
--   VENTILATION de ce total entre les bâtiments, et les RPC de stock déplacent
--   les deux dans la même transaction (20260922000012).
--
-- L'INVARIANT, ET POURQUOI IL EST UNE INÉGALITÉ
--   somme(sites) <= products.current_stock.
--
--   Une égalité serait fausse pendant toute la migration : la table naît vide et
--   ne se remplit qu'au comptage physique d'ouverture, site par site, produit
--   par produit. L'inégalité, elle, est vraie à chaque instant du chemin, et la
--   différence a un nom honnête — « non ventilé », des unités qu'on sait
--   posséder sans savoir encore où elles sont. Un produit entièrement compté a
--   une différence nulle et l'inégalité devient l'égalité voulue.
--
--   Le garde attrape le vrai danger : un ajustement qui abaisse le total sous ce
--   que les sites déclarent détenir. Il force alors à dire QUEL site perd les
--   unités, au lieu de laisser les deux chiffres diverger en silence.

CREATE TABLE IF NOT EXISTS public.product_site_stock (
  product_id           UUID NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  warehouse_id         UUID NOT NULL REFERENCES public.warehouses (id),
  current_stock        INTEGER NOT NULL DEFAULT 0,
  damaged_return_count INTEGER NOT NULL DEFAULT 0,
  -- NULL = jamais compté sur ce site. « Jamais vérifié » et « vérifié et juste »
  -- sont des faits opposés et ne partagent pas une valeur.
  last_counted_at      TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, warehouse_id),
  CONSTRAINT product_site_stock_non_negative CHECK (current_stock >= 0),
  CONSTRAINT product_site_damaged_non_negative CHECK (damaged_return_count >= 0)
);

CREATE INDEX IF NOT EXISTS product_site_stock_warehouse_idx
  ON public.product_site_stock (warehouse_id);

DROP TRIGGER IF EXISTS trg_product_site_stock_updated_at ON public.product_site_stock;
CREATE TRIGGER trg_product_site_stock_updated_at
  BEFORE UPDATE ON public.product_site_stock
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.product_site_stock IS
  'Ventilation de products.current_stock entre les bâtiments. La somme des '
  'lignes d''un produit ne peut jamais dépasser son total marché ; la '
  'différence est la part non encore ventilée (jamais comptée sur un site).';

-- ── Où a eu lieu le mouvement ───────────────────────────────────────────────

ALTER TABLE public.inventory_log
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES public.warehouses (id);

COMMENT ON COLUMN public.inventory_log.warehouse_id IS
  'Le bâtiment concerné. NULL sur les lignes antérieures au modèle par site, et '
  'sur un mouvement qui ne concerne que le total marché.';

CREATE INDEX IF NOT EXISTS inventory_log_warehouse_idx
  ON public.inventory_log (warehouse_id, created_at DESC)
  WHERE warehouse_id IS NOT NULL;

-- ── Le garde ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assert_site_stock_within_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_product_id UUID;
  v_total      INTEGER;
  v_sites      INTEGER;
BEGIN
  v_product_id := CASE TG_TABLE_NAME
                    WHEN 'products' THEN NEW.id
                    ELSE NEW.product_id
                  END;

  SELECT current_stock INTO v_total FROM public.products WHERE id = v_product_id;
  SELECT COALESCE(SUM(current_stock), 0) INTO v_sites
  FROM public.product_site_stock WHERE product_id = v_product_id;

  IF v_sites > v_total THEN
    RAISE EXCEPTION
      'Les sites déclarent % unités pour un total marché de % : dites quel site perd les unités',
      v_sites, v_total
      USING ERRCODE = '23514', DETAIL = '{"code":"SITE_STOCK_EXCEEDS_TOTAL"}';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_site_stock_within_total ON public.product_site_stock;
CREATE CONSTRAINT TRIGGER trg_product_site_stock_within_total
  AFTER INSERT OR UPDATE ON public.product_site_stock
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_site_stock_within_total();

DROP TRIGGER IF EXISTS trg_products_total_covers_sites ON public.products;
CREATE CONSTRAINT TRIGGER trg_products_total_covers_sites
  AFTER UPDATE OF current_stock ON public.products
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_site_stock_within_total();

-- ── Lecture ─────────────────────────────────────────────────────────────────

ALTER TABLE public.product_site_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_site_stock_select ON public.product_site_stock;
CREATE POLICY product_site_stock_select ON public.product_site_stock
  FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_site_stock.product_id
        AND p.market_id = public.get_user_market_id()
    )
  );

-- Aucune policy d'écriture : tout passe par les RPC SECURITY DEFINER, comme
-- products depuis 20260422_product_stock_lockdown.

/**
 * Le stock d'un produit, ventilé — avec la part qu'on n'a pas encore située.
 */
CREATE OR REPLACE FUNCTION public.get_product_site_stock(p_product_id UUID)
RETURNS TABLE (
  warehouse_id UUID,
  warehouse_code TEXT,
  warehouse_name_fr TEXT,
  warehouse_name_ar TEXT,
  current_stock INTEGER,
  damaged_return_count INTEGER,
  last_counted_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT w.id, w.code, w.name_fr, w.name_ar,
         COALESCE(s.current_stock, 0),
         COALESCE(s.damaged_return_count, 0),
         s.last_counted_at
  FROM public.warehouses w
  JOIN public.products p ON p.id = p_product_id AND p.market_id = w.market_id
  LEFT JOIN public.product_site_stock s
         ON s.product_id = p_product_id AND s.warehouse_id = w.id
  WHERE w.is_active
  ORDER BY w.is_default DESC, w.code;
$$;

GRANT EXECUTE ON FUNCTION public.get_product_site_stock(UUID) TO PUBLIC;
