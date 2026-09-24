-- ============================================================
-- 20261003000009_variant_stock_axis.sql
-- La variante devient un objet qui porte du stock, un coût et un SKU.
--
-- INERTE. Aucun produit ne porte de variante d'attribut aujourd'hui (les deux
-- seules lignes de `product_variants` sont des paliers Biovera de test), donc
-- après cette migration rien ne bouge : pas un stock modifié, pas une ligne de
-- registre écrite. Le modèle ne s'active qu'à la création de la première
-- variante — exactement comme `product_site_stock`, resté totalement inerte
-- jusqu'au premier comptage physique (20260922000012, « Pas de ligne = ce
-- produit n'a jamais été compté sur ce site »).
--
-- DEUX AXES, PAS UNE MATRICE.
--   · kind='attribute' → un objet physique différent (Petit / Moyen / Grand).
--     Il porte SON stock, SON coût, SON SKU.
--   · kind='pack'      → une façon de vendre le même objet (« Pack 2 »).
--     Il ne porte pas de stock : il en consomme `quantity` fois celui de la
--     variante d'attribut choisie. C'est le sens que `quantity`,
--     `units_per_pack` et `price_basis` avaient déjà.
-- Ajouter une 4ᵉ taille ne crée donc pas 12 lignes.
--
-- LE TOTAL RESTE AU PRODUIT. `products.current_stock` demeure le total marché
-- que lisent les finances et ~51 fichiers source. On ajoute un grain plus fin
-- en dessous, maintenu par le registre, et la règle est une INÉGALITÉ :
-- somme(parties) <= total. Ce qui n'est pas encore ventilé reste au niveau du
-- dessus plutôt que d'inventer une répartition.
-- ============================================================

-- ── 1. product_variants : le nécessaire pour porter stock, coût et SKU ──────

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'pack',
  ADD COLUMN IF NOT EXISTS market_id UUID,
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS unit_cogs NUMERIC(10,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_stock INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS damaged_return_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Le défaut 'pack' est choisi pour que les deux lignes Biovera existantes
-- restent exactement ce qu'elles sont : des paliers de quantité.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname='product_variants_kind_check'
                   AND conrelid='public.product_variants'::regclass) THEN
    ALTER TABLE public.product_variants
      ADD CONSTRAINT product_variants_kind_check
      CHECK (kind IN ('attribute','pack'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname='product_variants_stock_nonneg'
                   AND conrelid='public.product_variants'::regclass) THEN
    ALTER TABLE public.product_variants
      ADD CONSTRAINT product_variants_stock_nonneg
      CHECK (current_stock >= 0 AND damaged_return_count >= 0);
  END IF;
END $$;

-- market_id dénormalisé depuis le parent : un index unique par marché ne peut
-- pas traverser la clé étrangère. Rempli puis rendu NOT NULL.
UPDATE public.product_variants v
   SET market_id = p.market_id
  FROM public.products p
 WHERE p.id = v.product_id AND v.market_id IS NULL;

ALTER TABLE public.product_variants
  ALTER COLUMN market_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.product_variant_sync_market()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Le marché suit le produit, toujours, et ne se saisit jamais à la main.
  SELECT p.market_id INTO NEW.market_id
    FROM public.products p WHERE p.id = NEW.product_id;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_variant_sync_market ON public.product_variants;
CREATE TRIGGER trg_product_variant_sync_market
  BEFORE INSERT OR UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.product_variant_sync_market();

-- ── 2. Le SKU : un seul espace de noms par marché ───────────────────────────
--
-- `product-resolver.ts` fait UNE recherche de SKU à l'intake. Si un produit et
-- une variante pouvaient porter le même SKU dans le même marché, le produit
-- gagnerait silencieusement et la commande arriverait sur la mauvaise ligne —
-- exactement la classe d'erreur contre laquelle `carrier-warehouse.ts` met
-- déjà en garde. Les deux tables partagent donc un espace de noms unique.

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_market_sku
  ON public.product_variants (market_id, sku) WHERE sku IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assert_sku_unique_in_market()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_market UUID;
  v_clash TEXT;
BEGIN
  IF NEW.sku IS NULL OR btrim(NEW.sku) = '' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'products' THEN
    v_market := NEW.market_id;
    SELECT 'variante « ' || v.label || ' »' INTO v_clash
      FROM public.product_variants v
     WHERE v.market_id = v_market AND v.sku = NEW.sku
     LIMIT 1;
  ELSE
    SELECT p.market_id INTO v_market FROM public.products p WHERE p.id = NEW.product_id;
    SELECT 'produit « ' || p.name || ' »' INTO v_clash
      FROM public.products p
     WHERE p.market_id = v_market AND p.sku = NEW.sku AND p.deleted_at IS NULL
     LIMIT 1;
  END IF;

  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'Le SKU % est déjà utilisé par le % dans ce marché', NEW.sku, v_clash
      USING ERRCODE = '23505', DETAIL = '{"code":"SKU_TAKEN"}';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_sku_unique ON public.products;
CREATE TRIGGER trg_products_sku_unique
  BEFORE INSERT OR UPDATE OF sku ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.assert_sku_unique_in_market();

DROP TRIGGER IF EXISTS trg_product_variants_sku_unique ON public.product_variants;
CREATE TRIGGER trg_product_variants_sku_unique
  BEFORE INSERT OR UPDATE OF sku ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.assert_sku_unique_in_market();

-- ── 3. Les nouvelles colonnes doivent être LISIBLES ────────────────────────
--
-- ATTENTION, piège vérifié en prod : les privilèges de `product_variants` sont
-- accordés COLONNE PAR COLONNE (agent_note, display_price, id, is_active,
-- label, price_basis, product_id, quantity, units_per_pack). Une colonne
-- ajoutée n'hérite de rien. Or `GET /api/products/[id]` fait
-- `select("*, product_variants(*)")` avec le client de l'utilisateur : si une
-- seule colonne manque au rôle `authenticated`, tout le SELECT part en
-- « permission denied ». Ajouter une colonne sans la GRANT casserait donc la
-- fiche produit pour tout le monde sauf le service role.
--
-- Sur `unit_cogs` : la doc et CLAUDE.md affirment que le coût est révoqué de
-- `authenticated`. Ce n'est PAS le cas en production — `products.unit_cogs`
-- lui est bel et bien accordé aujourd'hui. On s'aligne donc sur le réel plutôt
-- que sur la doc, sinon `select("*")` casse. Verrouiller vraiment le coût est
-- un chantier à part : il faut d'abord remplacer chaque `select("*")` par une
-- liste de colonnes explicite, sur les deux tables.

GRANT SELECT (kind, market_id, sku, unit_cogs, current_stock,
              damaged_return_count, created_at, updated_at)
  ON public.product_variants TO authenticated;

-- `anon` ne reçoit QUE ce qui est déjà public sur cette table : pas de coût,
-- pas de stock. Le webhook d'intake tourne en service role et n'en a pas besoin.
GRANT SELECT (kind, sku) ON public.product_variants TO anon;

-- ── 4. Le registre et la ventilation apprennent la variante ────────────────

ALTER TABLE public.inventory_log
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id);

CREATE INDEX IF NOT EXISTS idx_inventory_log_variant
  ON public.inventory_log (variant_id) WHERE variant_id IS NOT NULL;

ALTER TABLE public.product_site_stock
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id);

-- La clé passe de (produit, site) à (produit, variante, site). NULL = le stock
-- du produit sans variante. PostgreSQL 15+ permet NULLS NOT DISTINCT, donc
-- deux lignes (p, NULL, w) restent impossibles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname='product_site_stock_pkey'
               AND conrelid='public.product_site_stock'::regclass) THEN
    ALTER TABLE public.product_site_stock DROP CONSTRAINT product_site_stock_pkey;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_stock_product_variant_site
  ON public.product_site_stock (product_id, variant_id, warehouse_id) NULLS NOT DISTINCT;

-- ── 5. order_items : quelle variante, et quel palier ───────────────────────
-- `variant_id` désigne la variante d'ATTRIBUT — c'est elle qui bouge le stock.
-- `pack_variant_id` consigne quel PALIER a été vendu, pour pouvoir répondre à
-- « combien de Pack 2 avons-nous vendus ». Le stock n'a besoin d'aucune
-- colonne de plus : un palier, c'est déjà `order_items.quantity`.

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS pack_variant_id UUID REFERENCES public.product_variants(id);

-- ── 6. L'inégalité : somme(variantes) <= total produit ─────────────────────

CREATE OR REPLACE FUNCTION public.assert_variant_stock_within_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_product UUID;
  v_sum INTEGER;
  v_total INTEGER;
BEGIN
  v_product := COALESCE(NEW.product_id, OLD.product_id);

  SELECT COALESCE(SUM(current_stock),0) INTO v_sum
    FROM public.product_variants
   WHERE product_id = v_product AND kind = 'attribute';

  SELECT current_stock INTO v_total
    FROM public.products WHERE id = v_product;

  IF v_sum > COALESCE(v_total, 0) THEN
    RAISE EXCEPTION
      'Le stock des variantes (%) dépasse le total du produit (%)', v_sum, v_total
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

-- ── 7. Le registre applique le mouvement à la variante ─────────────────────
-- Extension de inventory_log_apply_to_site (20260922000012). Les deux sorties
-- anticipées d'origine sont conservées : pas de site → rien ; 'stock_count'
-- POSE une valeur et ne se propage pas.

CREATE OR REPLACE FUNCTION public.inventory_log_apply_to_site()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reason = 'stock_count' THEN
    RETURN NULL;
  END IF;

  -- Total marché de la variante. Indépendant du site : une variante peut
  -- bouger sans qu'aucun entrepôt ne l'ait encore comptée.
  IF NEW.variant_id IS NOT NULL THEN
    UPDATE public.product_variants
       SET current_stock = CASE WHEN NEW.is_damaged THEN current_stock
                                ELSE current_stock + NEW.change END,
           damaged_return_count = CASE WHEN NEW.is_damaged
                                       THEN damaged_return_count + ABS(NEW.change)
                                       ELSE damaged_return_count END,
           updated_at = now()
     WHERE id = NEW.variant_id;
  END IF;

  IF NEW.warehouse_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Pas de ligne = ce produit (ou cette variante) n'a jamais été compté sur ce
  -- site. Les unités restent « non ventilées » au niveau du dessus plutôt que
  -- de créer une ligne négative ou d'inventer une répartition.
  UPDATE public.product_site_stock s
  SET current_stock = CASE WHEN NEW.is_damaged THEN s.current_stock
                           ELSE s.current_stock + NEW.change END,
      damaged_return_count = CASE WHEN NEW.is_damaged
                                  THEN s.damaged_return_count + ABS(NEW.change)
                                  ELSE s.damaged_return_count END
  WHERE s.product_id = NEW.product_id
    AND s.warehouse_id = NEW.warehouse_id
    AND s.variant_id IS NOT DISTINCT FROM NEW.variant_id;

  RETURN NULL;
END;
$$;

-- ── 8. RLS : rien à faire, et c'est important ──────────────────────────────
--
-- `product_variants` porte DÉJÀ quatre politiques, plus fines que ce qu'on
-- aurait écrit : lecture pour super_admin, market_manager (son marché) et
-- agent (son marché, produit actif ET variante active) ; insert et update
-- super_admin seul ; delete super_admin ou market_manager de son marché.
-- Une politique `FOR ALL ... super_admin` ajoutée ici aurait RETIRÉ la lecture
-- aux agents et aux managers — les paliers auraient disparu de la fiche
-- produit en plein appel. On n'y touche pas.
--
-- (Ces politiques appellent `get_user_role()` sans `(SELECT ...)`, donc hors
-- InitPlan : ré-évalué par ligne. Sans effet ici — la table compte 2 lignes —
-- mais à corriger si elle grossit. Voir la note InitPlan du projet.)

COMMENT ON COLUMN public.product_variants.kind IS
  '''attribute'' = objet physique distinct, porte son stock/coût/SKU. '
  '''pack'' = palier de quantité, ne porte pas de stock, en consomme quantity.';
COMMENT ON COLUMN public.product_variants.current_stock IS
  'Total marché de cette variante. Ventilé par site dans product_site_stock. '
  'Invariant : somme(variantes attribute) <= products.current_stock.';
COMMENT ON COLUMN public.order_items.pack_variant_id IS
  'Quel PALIER a été vendu. Le stock bouge via variant_id x quantity ; '
  'cette colonne ne sert qu''au reporting commercial.';
