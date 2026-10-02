-- ============================================================
-- 20260930120000_goods_reception.sql
-- Ce qui entre en stock devient un document.
--
-- LE PROBLÈME. Le stock ne peut monter que par trois portes, et aucune ne
-- décrit une livraison : `initial_stock` à la création d'un produit (7 lignes
-- depuis toujours), un `manual_adjustment` positif réservé au super_admin
-- (3 lignes), et un comptage physique (0 ligne à ce jour). Une livraison
-- fournisseur est donc aujourd'hui un nombre tapé dans une fiche produit :
-- pas de fournisseur, pas de bon de livraison, pas d'écart entre l'attendu et
-- le reçu, pas de coût, pas de bâtiment. « D'où viennent ces 40 unités » n'a
-- pas de réponse.
--
-- DÉJÀ CONÇU, ABANDONNÉ DEUX FOIS. docs/prototypes/entrepot-redesign.md §7
-- spécifiait `record_reception` et un motif `reception`. Le filtre
-- « Réceptions » a été retiré du Journal dans docs/design/entrepot/README.md
-- puis dans plans/entrepot-light-rebuild.md, pour une seule raison écrite noir
-- sur blanc : « ces flux n'existent pas dans le modèle de données ». Ce
-- fichier est ce modèle.
--
-- DEUX PERSONNES, DEUX GESTES. L'agent compte et DÉCLARE (`submitted`) ; le
-- manager VALIDE (`posted`), et la validation seule écrit le registre.
-- Recevoir est le seul mouvement qui crée des unités à partir de rien sans
-- document en face : une sortie a sa commande, un retour a son colis. C'est
-- aussi un ASSOUPLISSEMENT de l'état actuel (super_admin seul), pas un
-- durcissement : l'agent qui décharge le camion gagne un chemin d'écriture
-- qu'il n'avait pas.
--
-- LE REGISTRE FAIT LA VENTILATION, PAS CETTE RPC. `inventory_log_apply_to_site`
-- (20260909133813, étendu par 20260920162309) applique chaque mouvement au
-- total de la variante et à la ligne de site. `post_reception` écrit donc UNE
-- ligne de registre par ligne de réception et ne fait aucune arithmétique de
-- variante ni de site — sauf une chose : elle CRÉE la ligne de site.
--
--   Le trigger fait un UPDATE, jamais un upsert : « pas de ligne = ce produit
--   n'a jamais été compté sur ce site ». Sans création préalable, une
--   réception sur un (produit, variante, site) jamais compté bougerait le
--   total marché et manquerait SILENCIEUSEMENT le bâtiment. Or une livraison
--   est la meilleure preuve possible de l'endroit où sont les unités — aussi
--   bonne qu'un comptage pour celles qu'elle apporte. On insère donc la ligne
--   à 0 et on laisse le trigger ajouter : aucune répartition n'est inventée
--   pour les unités que la réception n'a pas apportées.
--
-- LE COÛT EST CAPTURÉ TOUJOURS, PROPAGÉ JAMAIS TOUT SEUL. `products.unit_cogs`
-- est un scalaire COURANT que le P&L (fenêtré sur événements) et
-- `investor_order_facts` lisent en direct. Le réécrire recalculerait la marge
-- des commandes DÉJÀ LIVRÉES et les chiffres investisseurs, en effet de bord
-- d'un geste d'entrepôt. `reception_lines.unit_cost` garde donc le prix payé
-- pour toujours, et `p_adopt_costs` (faux par défaut) est le seul chemin vers
-- `unit_cogs`. Capturer ne coûte rien : FIFO ou une vraie moyenne pondérée se
-- construiront plus tard sur cet historique, sans reprise de données.
--
-- ABÎMÉ À L'ARRIVÉE N'ENTRE PAS EN STOCK. `damaged_qty` vit sur la ligne et
-- nulle part ailleurs. Ce n'est PAS `damaged_return_count` : ce compteur veut
-- dire « revenu cassé d'un client » et alimente le taux de retour. Des unités
-- arrivées cassées n'ont jamais été vendables et ne sont pas un retour — c'est
-- un litige fournisseur. Deux fausses lignes de registre évitées, une
-- métrique préservée.
--
-- « EN RETARD » N'EST PAS UN STATUT. C'est `expected_at < today` sur une
-- réception non validée, calculé à la lecture. Un drapeau stocké demanderait
-- un cron et serait faux le jour où il ne tourne pas.
--
-- LE PAIEMENT EST UNE LISTE, PAS UNE CASE. « payé / partiellement payé » est
-- DÉDUIT de somme(paiements) contre la valeur reçue. Deux acomptes sur une
-- livraison marchent dès le premier jour, et le reste à payer ne peut pas se
-- désynchroniser de ses lignes. Limite assumée : un seul paiement couvrant
-- TROIS livraisons n'a pas sa place ici — il faudra une facture fournisseur,
-- et ces lignes s'y rebrancheront sans être réécrites (d'où
-- `supplier_invoice_id`, nullable, qui ne pointe encore sur rien).
-- ============================================================

-- ── 1. Le vocabulaire du registre s'élargit de deux mots ────────────────────

ALTER TABLE public.inventory_log DROP CONSTRAINT IF EXISTS inventory_log_reason_check;
ALTER TABLE public.inventory_log ADD CONSTRAINT inventory_log_reason_check
  CHECK (reason IN (
    'initial_stock', 'scanned', 'scan_reversal', 'returned', 'received_back',
    'damaged_writeoff', 'manual_adjustment', 'stock_count',
    'manual_delete_reversal', 'deposit',
    'reception', 'reception_reversal'
  ));

-- ── 2. Les tables ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.receptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id             UUID NOT NULL REFERENCES public.markets (id),
  warehouse_id          UUID NOT NULL REFERENCES public.warehouses (id),
  reference             TEXT NOT NULL,
  supplier_name         TEXT,
  supplier_ref          TEXT,
  status                TEXT NOT NULL DEFAULT 'draft',
  expected_at           DATE,
  note                  TEXT,
  photo_url             TEXT,
  -- Le côté argent, volontairement minimal. `supplier_invoice_id` ne pointe
  -- sur aucune table : c'est la porte laissée ouverte pour une comptabilité
  -- fournisseur ultérieure, sans migration de reprise.
  supplier_invoice_id   UUID,
  reverses_reception_id UUID REFERENCES public.receptions (id),
  submitted_at          TIMESTAMPTZ, submitted_by UUID REFERENCES public.users (id),
  posted_at             TIMESTAMPTZ, posted_by    UUID REFERENCES public.users (id),
  created_by            UUID NOT NULL REFERENCES public.users (id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT receptions_status_check
    CHECK (status IN ('draft', 'submitted', 'posted', 'cancelled', 'reversed')),
  CONSTRAINT receptions_market_reference_key UNIQUE (market_id, reference)
);

CREATE INDEX IF NOT EXISTS receptions_market_status_idx
  ON public.receptions (market_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS receptions_warehouse_idx
  ON public.receptions (warehouse_id, status);
-- « En route » lit les réceptions non soldées : un index partiel suffit.
CREATE INDEX IF NOT EXISTS receptions_open_idx
  ON public.receptions (market_id, expected_at)
  WHERE status IN ('draft', 'submitted');

CREATE TABLE IF NOT EXISTS public.reception_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reception_id  UUID NOT NULL REFERENCES public.receptions (id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES public.products (id),
  variant_id    UUID REFERENCES public.product_variants (id),
  expected_qty  INTEGER,
  received_qty  INTEGER,
  damaged_qty   INTEGER NOT NULL DEFAULT 0,
  unit_cost     NUMERIC(10,3),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reception_lines_expected_nonneg CHECK (expected_qty IS NULL OR expected_qty >= 0),
  CONSTRAINT reception_lines_received_nonneg CHECK (received_qty IS NULL OR received_qty >= 0),
  CONSTRAINT reception_lines_damaged_nonneg  CHECK (damaged_qty >= 0),
  CONSTRAINT reception_lines_cost_nonneg     CHECK (unit_cost IS NULL OR unit_cost >= 0)
);

-- Une ligne par (produit, variante) dans une réception. NULLS NOT DISTINCT
-- pour que deux lignes « produit nu » restent impossibles — même raison que
-- `idx_site_stock_product_variant_site` (20260920162309).
CREATE UNIQUE INDEX IF NOT EXISTS idx_reception_lines_unique
  ON public.reception_lines (reception_id, product_id, variant_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS reception_lines_product_idx
  ON public.reception_lines (product_id);

CREATE TABLE IF NOT EXISTS public.reception_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reception_id  UUID NOT NULL REFERENCES public.receptions (id) ON DELETE CASCADE,
  paid_at       DATE NOT NULL DEFAULT CURRENT_DATE,
  amount        NUMERIC(12,3) NOT NULL,
  method        TEXT,
  note          TEXT,
  created_by    UUID NOT NULL REFERENCES public.users (id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reception_payments_amount_positive CHECK (amount > 0),
  CONSTRAINT reception_payments_method_check
    CHECK (method IS NULL OR method IN ('cash', 'bank_transfer', 'cheque', 'other'))
);

CREATE INDEX IF NOT EXISTS reception_payments_reception_idx
  ON public.reception_payments (reception_id, paid_at);

-- ── 3. Le lien registre → réception ─────────────────────────────────────────

ALTER TABLE public.inventory_log
  ADD COLUMN IF NOT EXISTS reception_id UUID REFERENCES public.receptions (id);

CREATE INDEX IF NOT EXISTS idx_inventory_log_reception
  ON public.inventory_log (reception_id) WHERE reception_id IS NOT NULL;

-- ── 4. Une réception validée ne se modifie plus ─────────────────────────────
--
-- Ce n'est PAS l'append-only du registre : un brouillon doit rester modifiable.
-- C'est une immutabilité APRÈS validation. Même discipline que
-- `ledger_append_only()`, portée différente. `posted_at`/`posted_by` sont
-- écrits par la RPC elle-même, donc la garde s'évalue sur l'ANCIEN statut.

CREATE OR REPLACE FUNCTION public.reception_immutable_once_posted()
RETURNS TRIGGER LANGUAGE plpgsql
-- `search_path` épinglé : SECURITY INVOKER ou non, une fonction qui résout
-- `public.receptions` sans chemin fixe est le piège documenté du projet.
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted', 'reversed') THEN
      RAISE EXCEPTION 'Une réception validée ne se supprime pas — contre-passez-la'
        USING ERRCODE = '42501', DETAIL = '{"code":"RECEPTION_IMMUTABLE"}';
    END IF;
    RETURN OLD;
  END IF;

  -- La transition posted → reversed est le seul changement autorisé sur une
  -- réception validée, et c'est `reverse_reception` qui l'écrit.
  IF OLD.status = 'posted' AND NEW.status = 'reversed' THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Une réception validée est définitive — contre-passez-la'
      USING ERRCODE = '42501', DETAIL = '{"code":"RECEPTION_IMMUTABLE"}';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reception_immutable ON public.receptions;
CREATE TRIGGER trg_reception_immutable
  BEFORE UPDATE OR DELETE ON public.receptions
  FOR EACH ROW EXECUTE FUNCTION public.reception_immutable_once_posted();

-- Les lignes d'une réception validée sont tout aussi définitives.
CREATE OR REPLACE FUNCTION public.reception_line_immutable_once_posted()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM public.receptions
   WHERE id = COALESCE(NEW.reception_id, OLD.reception_id);

  IF v_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Les lignes d''une réception validée sont définitives'
      USING ERRCODE = '42501', DETAIL = '{"code":"RECEPTION_IMMUTABLE"}';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reception_line_immutable ON public.reception_lines;
CREATE TRIGGER trg_reception_line_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.reception_lines
  FOR EACH ROW EXECUTE FUNCTION public.reception_line_immutable_once_posted();

-- ── 5. La référence ─────────────────────────────────────────────────────────
-- REC-LY-2026-0042. Lisible, triable, et le compteur est par (marché, année)
-- afin qu'un marché ne consomme pas les numéros de l'autre.

CREATE OR REPLACE FUNCTION public.next_reception_reference(p_market_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
  v_year TEXT := to_char(CURRENT_DATE, 'YYYY');
  v_seq  INTEGER;
BEGIN
  SELECT upper(code) INTO v_code FROM markets WHERE id = p_market_id;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Marché introuvable' USING DETAIL = '{"code":"NO_MARKET"}';
  END IF;

  -- On lit le plus grand numéro déjà émis pour ce marché et cette année.
  -- La contrainte UNIQUE (market_id, reference) est le vrai garde-fou en cas
  -- de course : l'appelant réessaie.
  SELECT COALESCE(MAX(substring(reference FROM '(\d+)$')::INTEGER), 0) + 1
    INTO v_seq
    FROM receptions
   WHERE market_id = p_market_id
     AND reference LIKE 'REC-' || v_code || '-' || v_year || '-%';

  RETURN 'REC-' || v_code || '-' || v_year || '-' || lpad(v_seq::TEXT, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_reception_reference(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_reception_reference(UUID) TO authenticated;

-- ── 6. Valider : le seul moment où le stock bouge ───────────────────────────

CREATE OR REPLACE FUNCTION public.post_reception(
  p_reception_id UUID,
  p_actor_id     UUID,
  p_adopt_costs  BOOLEAN DEFAULT FALSE
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role         TEXT;
  v_actor_market UUID;
  v_rec          RECORD;
  v_line         RECORD;
  v_new_total    INTEGER;
  v_units        INTEGER := 0;
  v_damaged      INTEGER := 0;
  v_value        NUMERIC(14,3) := 0;
  v_lines        INTEGER := 0;
  v_costs        INTEGER := 0;
  v_stock_before INTEGER;
  v_cogs_before  NUMERIC(10,3);
BEGIN
  -- L'acteur EST la session. Forme stricte : `auth.uid() IS NULL` refuse aussi.
  -- La forme « IS NOT NULL AND <> » de record_stock_count laisse passer un
  -- appel anon, et `p_actor_id` décide du MARCHÉ — c'est la note
  -- « RPC actor id not bound to session ».
  IF auth.uid() IS NULL OR auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Une réception ne peut pas être validée au nom d''un autre'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;

  SELECT role, market_id INTO v_role, v_actor_market FROM users WHERE id = p_actor_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Acteur introuvable'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_NOT_FOUND"}';
  END IF;
  IF v_role NOT IN ('market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Le rôle % ne peut pas valider une réception', v_role
      USING ERRCODE = '42501', DETAIL = '{"code":"FORBIDDEN"}';
  END IF;

  SELECT * INTO v_rec FROM receptions WHERE id = p_reception_id FOR UPDATE;
  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'Réception introuvable' USING DETAIL = '{"code":"NO_RECEPTION"}';
  END IF;
  IF v_role <> 'super_admin' AND v_actor_market IS DISTINCT FROM v_rec.market_id THEN
    RAISE EXCEPTION 'Cette réception appartient à un autre marché'
      USING ERRCODE = '42501', DETAIL = '{"code":"MARKET_MISMATCH"}';
  END IF;
  IF v_rec.status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION 'Cette réception est déjà %', v_rec.status
      USING DETAIL = '{"code":"ALREADY_POSTED"}';
  END IF;

  SELECT count(*) INTO v_lines FROM reception_lines
   WHERE reception_id = p_reception_id AND COALESCE(received_qty, 0) > 0;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'Aucune quantité reçue — rien à entrer en stock'
      USING DETAIL = '{"code":"EMPTY_RECEPTION"}';
  END IF;

  FOR v_line IN
    SELECT l.*, p.market_id AS product_market, p.name AS product_name,
           p.current_stock AS product_stock, p.unit_cogs AS product_cogs,
           v.kind AS variant_kind, v.product_id AS variant_product
      FROM reception_lines l
      JOIN products p ON p.id = l.product_id
      LEFT JOIN product_variants v ON v.id = l.variant_id
     WHERE l.reception_id = p_reception_id
       AND COALESCE(l.received_qty, 0) > 0
     ORDER BY l.product_id, l.variant_id
     FOR UPDATE OF l
  LOOP
    IF v_line.product_market IS DISTINCT FROM v_rec.market_id THEN
      RAISE EXCEPTION 'Le produit « % » appartient à un autre marché', v_line.product_name
        USING DETAIL = '{"code":"BAD_LINE"}';
    END IF;
    IF v_line.variant_id IS NOT NULL THEN
      IF v_line.variant_product IS DISTINCT FROM v_line.product_id THEN
        RAISE EXCEPTION 'La variante ne correspond pas au produit « % »', v_line.product_name
          USING DETAIL = '{"code":"BAD_LINE"}';
      END IF;
      -- Un palier ne porte pas de stock : il en consomme. Le recevoir n'a pas
      -- de sens physique (20260920162309).
      IF v_line.variant_kind <> 'attribute' THEN
        RAISE EXCEPTION 'On ne reçoit pas un palier de quantité, mais un objet'
          USING DETAIL = '{"code":"BAD_LINE"}';
      END IF;
    END IF;

    -- LA LIGNE DE SITE. Le trigger de ventilation fait un UPDATE : sans cette
    -- ligne, le bâtiment est manqué en silence. On la crée à 0 et le trigger
    -- ajoutera — aucune répartition inventée pour les unités non apportées.
    INSERT INTO product_site_stock (product_id, variant_id, warehouse_id, current_stock)
    VALUES (v_line.product_id, v_line.variant_id, v_rec.warehouse_id, 0)
    ON CONFLICT (product_id, variant_id, warehouse_id) DO NOTHING;

    UPDATE products
       SET current_stock = current_stock + v_line.received_qty, updated_at = now()
     WHERE id = v_line.product_id
    RETURNING current_stock INTO v_new_total;

    -- UNE ligne de registre. Le trigger en déduit la variante et le site.
    INSERT INTO inventory_log (
      product_id, variant_id, order_id, change, reason, balance_after,
      actor_id, note, warehouse_id, reception_id
    ) VALUES (
      v_line.product_id, v_line.variant_id, NULL, v_line.received_qty,
      'reception', v_new_total, p_actor_id,
      COALESCE(v_rec.reference, '') ||
        CASE WHEN v_rec.supplier_name IS NOT NULL
             THEN ' · ' || v_rec.supplier_name ELSE '' END,
      v_rec.warehouse_id, p_reception_id
    );

    v_units   := v_units + v_line.received_qty;
    v_damaged := v_damaged + v_line.damaged_qty;
    IF v_line.unit_cost IS NOT NULL THEN
      v_value := v_value + (v_line.unit_cost * v_line.received_qty);
    END IF;

    -- Le coût, seulement si un humain l'a demandé. Moyenne pondérée sur le
    -- stock AVANT cette réception.
    IF p_adopt_costs AND v_line.unit_cost IS NOT NULL THEN
      IF v_line.variant_id IS NULL THEN
        v_stock_before := v_line.product_stock;
        v_cogs_before  := v_line.product_cogs;
        UPDATE products
           SET unit_cogs = ROUND(
                 ((GREATEST(v_stock_before, 0) * v_cogs_before)
                   + (v_line.received_qty * v_line.unit_cost))
                 / NULLIF(GREATEST(v_stock_before, 0) + v_line.received_qty, 0), 3),
               updated_at = now()
         WHERE id = v_line.product_id;
      ELSE
        UPDATE product_variants v
           SET unit_cogs = ROUND(
                 ((GREATEST(v.current_stock - v_line.received_qty, 0) * v.unit_cogs)
                   + (v_line.received_qty * v_line.unit_cost))
                 / NULLIF(GREATEST(v.current_stock - v_line.received_qty, 0)
                          + v_line.received_qty, 0), 3),
               updated_at = now()
         WHERE v.id = v_line.variant_id;
      END IF;
      v_costs := v_costs + 1;
    END IF;
  END LOOP;

  UPDATE receptions
     SET status = 'posted', posted_at = now(), posted_by = p_actor_id, updated_at = now()
   WHERE id = p_reception_id;

  RETURN json_build_object(
    'reception_id', p_reception_id,
    'reference',    v_rec.reference,
    'warehouse_id', v_rec.warehouse_id,
    'lines',        v_lines,
    'units',        v_units,
    'damaged',      v_damaged,
    'value',        v_value,
    'costs_adopted', v_costs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.post_reception(UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_reception(UUID, UUID, BOOLEAN) TO authenticated;

-- ── 7. Contre-passer ────────────────────────────────────────────────────────
-- Le registre est en écriture seule : on corrige en ajoutant l'inverse.

CREATE OR REPLACE FUNCTION public.reverse_reception(
  p_reception_id UUID,
  p_actor_id     UUID,
  p_note         TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role      TEXT;
  v_rec       RECORD;
  v_line      RECORD;
  v_new_total INTEGER;
  v_new_id    UUID;
  v_units     INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Une contre-passation ne se signe pas au nom d''un autre'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;

  SELECT role INTO v_role FROM users WHERE id = p_actor_id;
  IF v_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Seul un super_admin contre-passe une réception'
      USING ERRCODE = '42501', DETAIL = '{"code":"FORBIDDEN"}';
  END IF;

  SELECT * INTO v_rec FROM receptions WHERE id = p_reception_id FOR UPDATE;
  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'Réception introuvable' USING DETAIL = '{"code":"NO_RECEPTION"}';
  END IF;
  IF v_rec.status <> 'posted' THEN
    RAISE EXCEPTION 'Seule une réception validée se contre-passe'
      USING DETAIL = '{"code":"NOT_POSTED"}';
  END IF;

  -- Refus AVANT toute écriture si les unités sont déjà parties : réécrire
  -- l'histoire n'est pas la réponse, un comptage ou une sortie l'est.
  FOR v_line IN
    SELECT l.product_id, l.variant_id, l.received_qty, p.current_stock, p.name
      FROM reception_lines l JOIN products p ON p.id = l.product_id
     WHERE l.reception_id = p_reception_id AND COALESCE(l.received_qty, 0) > 0
     ORDER BY l.product_id
     FOR UPDATE OF p
  LOOP
    IF v_line.current_stock < v_line.received_qty THEN
      RAISE EXCEPTION
        'Le stock de « % » (%) est déjà sous les % unités reçues — comptez-le plutôt',
        v_line.name, v_line.current_stock, v_line.received_qty
        USING DETAIL = '{"code":"STOCK_UNDERFLOW"}';
    END IF;
  END LOOP;

  -- Créée en BROUILLON, puis validée à la fin. Le trigger d'immutabilité
  -- refuse l'insertion de lignes sous une réception déjà `posted` — et il a
  -- raison : c'est la garde qui protège l'historique. La contre-passation
  -- n'est pas une exception à la règle, elle en respecte l'ordre.
  INSERT INTO receptions (
    market_id, warehouse_id, reference, supplier_name, supplier_ref,
    status, note, reverses_reception_id, created_by
  ) VALUES (
    v_rec.market_id, v_rec.warehouse_id,
    next_reception_reference(v_rec.market_id),
    v_rec.supplier_name, v_rec.supplier_ref,
    'draft',
    COALESCE(p_note, 'Contre-passation de ' || v_rec.reference),
    p_reception_id, p_actor_id
  ) RETURNING id INTO v_new_id;

  FOR v_line IN
    SELECT * FROM reception_lines
     WHERE reception_id = p_reception_id AND COALESCE(received_qty, 0) > 0
     ORDER BY product_id, variant_id
  LOOP
    INSERT INTO reception_lines (
      reception_id, product_id, variant_id, expected_qty, received_qty,
      damaged_qty, unit_cost, note
    ) VALUES (
      v_new_id, v_line.product_id, v_line.variant_id, NULL,
      -- La ligne miroir consigne ce qui repart ; le registre porte le signe.
      v_line.received_qty, 0, v_line.unit_cost, 'contre-passation'
    );

    UPDATE products
       SET current_stock = current_stock - v_line.received_qty, updated_at = now()
     WHERE id = v_line.product_id
    RETURNING current_stock INTO v_new_total;

    INSERT INTO inventory_log (
      product_id, variant_id, order_id, change, reason, balance_after,
      actor_id, note, warehouse_id, reception_id
    ) VALUES (
      v_line.product_id, v_line.variant_id, NULL, -v_line.received_qty,
      'reception_reversal', v_new_total, p_actor_id,
      'Contre-passation de ' || v_rec.reference, v_rec.warehouse_id, v_new_id
    );

    v_units := v_units + v_line.received_qty;
  END LOOP;

  -- Les lignes sont écrites : la contre-passation devient définitive à son tour.
  UPDATE receptions
     SET status = 'posted', posted_at = now(), posted_by = p_actor_id, updated_at = now()
   WHERE id = v_new_id;

  UPDATE receptions SET status = 'reversed', updated_at = now() WHERE id = p_reception_id;

  RETURN json_build_object(
    'reversed_reception_id', p_reception_id,
    'reversal_reception_id', v_new_id,
    'units', v_units
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_reception(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_reception(UUID, UUID, TEXT) TO authenticated;

-- ── 8. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE public.receptions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_payments ENABLE ROW LEVEL SECURITY;

-- `get_user_role()` et `get_user_market_id()` sont enveloppés dans (SELECT …)
-- pour rester dans l'InitPlan : sans cela le helper est ré-évalué PAR LIGNE
-- (note « RLS InitPlan »).

DROP POLICY IF EXISTS receptions_select ON public.receptions;
CREATE POLICY receptions_select ON public.receptions FOR SELECT TO authenticated
USING (
  (SELECT get_user_role()) = 'super_admin'
  OR ((SELECT get_user_role()) IN ('market_manager', 'warehouse_agent')
      AND market_id = (SELECT get_user_market_id()))
);

-- Écriture sur les BROUILLONS. Le trigger d'immutabilité protège le reste, et
-- la validation passe par la RPC.
DROP POLICY IF EXISTS receptions_write ON public.receptions;
CREATE POLICY receptions_write ON public.receptions FOR INSERT TO authenticated
WITH CHECK (
  (SELECT get_user_role()) = 'super_admin'
  OR ((SELECT get_user_role()) IN ('market_manager', 'warehouse_agent')
      AND market_id = (SELECT get_user_market_id()))
);

DROP POLICY IF EXISTS receptions_update ON public.receptions;
CREATE POLICY receptions_update ON public.receptions FOR UPDATE TO authenticated
USING (
  (SELECT get_user_role()) = 'super_admin'
  OR ((SELECT get_user_role()) IN ('market_manager', 'warehouse_agent')
      AND market_id = (SELECT get_user_market_id()))
);

DROP POLICY IF EXISTS receptions_delete ON public.receptions;
CREATE POLICY receptions_delete ON public.receptions FOR DELETE TO authenticated
USING (
  (SELECT get_user_role()) = 'super_admin'
  OR ((SELECT get_user_role()) = 'market_manager'
      AND market_id = (SELECT get_user_market_id()))
);

-- Les lignes suivent leur réception : une seule règle, exprimée une fois.
DROP POLICY IF EXISTS reception_lines_all ON public.reception_lines;
CREATE POLICY reception_lines_all ON public.reception_lines FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.receptions r WHERE r.id = reception_id))
WITH CHECK (EXISTS (SELECT 1 FROM public.receptions r WHERE r.id = reception_id));

-- Le paiement est une information d'argent : pas pour l'agent d'entrepôt.
DROP POLICY IF EXISTS reception_payments_all ON public.reception_payments;
CREATE POLICY reception_payments_all ON public.reception_payments FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.receptions r
     WHERE r.id = reception_id
       AND ((SELECT get_user_role()) = 'super_admin'
            OR ((SELECT get_user_role()) = 'market_manager'
                AND r.market_id = (SELECT get_user_market_id())))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.receptions r
     WHERE r.id = reception_id
       AND ((SELECT get_user_role()) = 'super_admin'
            OR ((SELECT get_user_role()) = 'market_manager'
                AND r.market_id = (SELECT get_user_market_id())))
  )
);

-- Privilèges de table : `anon` n'a rien à faire ici.
REVOKE ALL ON public.receptions, public.reception_lines, public.reception_payments
  FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.receptions, public.reception_lines, public.reception_payments
  TO authenticated;

COMMENT ON TABLE public.receptions IS
  'Bon de réception fournisseur. draft → submitted → posted (écrit le registre) '
  '→ reversed. « En retard » se calcule : expected_at < today et statut non validé.';
COMMENT ON COLUMN public.reception_lines.damaged_qty IS
  'Abîmé à l''arrivée. N''ENTRE PAS en stock et n''est PAS damaged_return_count '
  '(qui veut dire « revenu cassé d''un client ») : c''est un litige fournisseur.';
COMMENT ON COLUMN public.receptions.supplier_invoice_id IS
  'Porte laissée ouverte pour une comptabilité fournisseur. Ne référence aucune '
  'table aujourd''hui — volontaire.';
COMMENT ON COLUMN public.reception_lines.unit_cost IS
  'Prix payé, devise du marché. Historique permanent. Ne touche products.unit_cogs '
  'que si post_reception est appelée avec p_adopt_costs.';
