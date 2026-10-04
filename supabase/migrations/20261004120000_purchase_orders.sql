-- ════════════════════════════════════════════════════════════════════════════
-- LES BONS DE COMMANDE, NÉS DU MANQUE
-- plans/reception-v4-quai-et-bureau.md · étape 6
--
-- POURQUOI `expected_qty` SERA ÉTERNELLEMENT NULL SANS CETTE TABLE. Personne
-- n'écrit un attendu dans un formulaire vide. La v3 demandait à quelqu'un de
-- saisir, à l'avance, produit par produit, ce qu'un camion allait apporter — et
-- en production, sur la seule réception existante, `expected_qty` est NULL
-- partout. Ce n'était pas de la négligence : c'était une saisie sans occasion.
--
-- L'OCCASION EXISTE DÉJÀ, AILLEURS. Niveaux calcule `reorder_by_date` et sait
-- dire « couverture 9 jours · rupture le 8 oct ». C'est là que naît l'intention
-- d'acheter, et c'est donc là que le bon de commande doit naître : pré-rempli du
-- produit, de la quantité manquante, du fournisseur habituel et de la date
-- voulue. Un geste, pas une saisie.
--
-- CE QUE ÇA DÉBLOQUE. Trois chiffres qu'Ordra ne peut pas calculer aujourd'hui
-- et qui sont les seules raisons honnêtes de capter un écart :
--   · le TAUX DE SERVICE  — commandé 150, reçu 141 : à qui puis-je me fier ;
--   · le DÉLAI réel       — de la commande au quai, ce qui rend
--                            `reorder_by_date` honnête au lieu d'un réglage ;
--   · « EN ROUTE »        — commandé et pas encore arrivé. Sous le modèle de
--                            l'arrivage, c'est la SEULE définition qui ne
--                            compte pas deux fois le même carton.
--
-- CE QUE ÇA NE FAIT PAS. Aucun stock ne bouge ici. Un bon de commande est une
-- INTENTION ; le stock entre toujours au quai et nulle part ailleurs. La liste
-- des chemins d'entrée de stock de CLAUDE.md n'est pas allongée.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Le document ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id    UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  -- On commande POUR UN BÂTIMENT. « Combien en route » n'a pas de sens au grain
  -- du marché quand la Libye a deux entrepôts à 1 000 km l'un de l'autre.
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  supplier_id  UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  reference    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'cancelled')),
  -- La date VOULUE, celle que le réassort a calculée. Elle n'est pas une
  -- promesse du fournisseur : c'est notre plan, et l'écart se mesure contre lui.
  wanted_by    DATE,
  ordered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ordered_by   UUID NOT NULL REFERENCES public.users(id),
  closed_at    TIMESTAMPTZ,
  closed_by    UUID REFERENCES public.users(id),
  -- Pourquoi on a arrêté d'attendre le reste. Renseigné à la clôture manuelle.
  close_reason TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT purchase_orders_reference_key UNIQUE (market_id, reference)
);

COMMENT ON TABLE public.purchase_orders IS
  'Bons de commande fournisseur. Une INTENTION d''achat : aucun stock ne bouge '
  'ici. Nés du réassort sur Entrepôt › Stock › Niveaux.';

COMMENT ON COLUMN public.purchase_orders.wanted_by IS
  'La date à laquelle on veut la marchandise — issue de reorder_by_date, pas '
  'une promesse du fournisseur. NULL quand le bon est saisi à la main sans date.';

CREATE INDEX IF NOT EXISTS purchase_orders_open_idx
  ON public.purchase_orders (market_id, warehouse_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS purchase_orders_supplier_idx
  ON public.purchase_orders (supplier_id, ordered_at DESC);

-- ── 2 · Les lignes ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.purchase_order_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id        UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  -- NULL = le stock non ventilé du produit, exactement comme partout ailleurs.
  variant_id        UUID REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  ordered_qty       INTEGER NOT NULL CHECK (ordered_qty > 0),
  -- Le prix ANNONCÉ. Comparé plus tard au prix facturé : deux factures sur six
  -- qui ne tombent pas dessus, c'est une information sur le fournisseur.
  unit_cost         NUMERIC(10,3) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_lines_grain_key
  ON public.purchase_order_lines (purchase_order_id, product_id, variant_id)
  NULLS NOT DISTINCT;

-- L'allocation d'un arrivage balaie les lignes ouvertes de ce grain : l'index
-- doit porter le grain, pas le document.
CREATE INDEX IF NOT EXISTS purchase_order_lines_grain_idx
  ON public.purchase_order_lines (product_id, variant_id);

-- ── 3 · L'allocation — un registre, pas un compteur ────────────────────────
--
-- POURQUOI UNE TABLE ET PAS UNE COLONNE `received_qty`. Un arrivage de 120
-- unités peut solder une commande de 100 et entamer la suivante ; une
-- correction de comptage doit pouvoir se défaire. Un compteur sur la ligne ne
-- sait faire ni l'un ni l'autre sans réécrire du passé. Ici chaque rattachement
-- est une ligne SIGNÉE, en ajout seul — la même discipline qu'`inventory_log`.
-- Ce qu'une ligne de commande a reçu est toujours la SOMME.

CREATE TABLE IF NOT EXISTS public.purchase_order_receipts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_line_id UUID NOT NULL REFERENCES public.purchase_order_lines(id) ON DELETE CASCADE,
  reception_line_id      UUID NOT NULL REFERENCES public.reception_lines(id) ON DELETE CASCADE,
  -- Signé : une correction à la baisse écrit un négatif. Jamais zéro.
  qty                    INTEGER NOT NULL CHECK (qty <> 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS purchase_order_receipts_line_idx
  ON public.purchase_order_receipts (purchase_order_line_id);
CREATE INDEX IF NOT EXISTS purchase_order_receipts_reception_idx
  ON public.purchase_order_receipts (reception_line_id);

COMMENT ON TABLE public.purchase_order_receipts IS
  'Rattachement d''un comptage du quai à une ligne de commande. EN AJOUT SEUL '
  'et SIGNÉ : une correction écrit le delta. Le reçu d''une ligne est la somme.';

-- Le registre refuse qu'on le réécrive, comme ses aînés.
CREATE OR REPLACE FUNCTION public.purchase_order_receipts_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'purchase_order_receipts est en ajout seul : écrivez le delta'
    USING DETAIL = '{"code":"APPEND_ONLY"}';
END;
$$;

DROP TRIGGER IF EXISTS purchase_order_receipts_append_only ON public.purchase_order_receipts;
CREATE TRIGGER purchase_order_receipts_append_only
  BEFORE UPDATE OR DELETE ON public.purchase_order_receipts
  FOR EACH ROW EXECUTE FUNCTION public.purchase_order_receipts_append_only();

-- ── 4 · L'avancement, en une seule définition ──────────────────────────────
--
-- `security_invoker` : la vue ne contourne pas la RLS des tables de base. Sans
-- cela elle s'exécuterait avec les droits du propriétaire et rendrait l'attendu
-- lisible par l'agent du quai — exactement l'ancre qu'on vient de retirer.

CREATE OR REPLACE VIEW public.purchase_order_line_progress
WITH (security_invoker = true) AS
SELECT
  pol.id,
  pol.purchase_order_id,
  pol.product_id,
  pol.variant_id,
  pol.ordered_qty,
  pol.unit_cost,
  COALESCE(r.received_qty, 0)::INTEGER AS received_qty,
  GREATEST(pol.ordered_qty - COALESCE(r.received_qty, 0), 0)::INTEGER AS outstanding_qty,
  r.first_received_at
FROM public.purchase_order_lines pol
LEFT JOIN (
  SELECT purchase_order_line_id,
         SUM(qty)        AS received_qty,
         MIN(created_at) AS first_received_at
    FROM public.purchase_order_receipts
   GROUP BY purchase_order_line_id
) r ON r.purchase_order_line_id = pol.id;

COMMENT ON VIEW public.purchase_order_line_progress IS
  'Commandé, reçu, et ce qui reste à venir par ligne de commande. '
  '`outstanding_qty` est la définition de « en route ».';

-- ── 5 · RLS ─────────────────────────────────────────────────────────────────
--
-- L'AGENT DU QUAI NE LIT PAS LES BONS DE COMMANDE. C'est la règle du comptage à
-- l'aveugle, appliquée là où elle tient vraiment : dans la base. L'écart lui est
-- révélé par la VALEUR DE RETOUR de `record_arrival`, après que son compte est
-- écrit — jamais par une lecture qu'il pourrait faire avant.

ALTER TABLE public.purchase_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_orders_select ON public.purchase_orders;
CREATE POLICY purchase_orders_select ON public.purchase_orders FOR SELECT TO authenticated
USING (
  (SELECT get_user_role()) = 'super_admin'
  OR ((SELECT get_user_role()) = 'market_manager'
      AND market_id = (SELECT get_user_market_id()))
);

DROP POLICY IF EXISTS purchase_order_lines_select ON public.purchase_order_lines;
CREATE POLICY purchase_order_lines_select ON public.purchase_order_lines FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.purchase_orders po
     WHERE po.id = purchase_order_lines.purchase_order_id
       AND ((SELECT get_user_role()) = 'super_admin'
            OR ((SELECT get_user_role()) = 'market_manager'
                AND po.market_id = (SELECT get_user_market_id())))
  )
);

DROP POLICY IF EXISTS purchase_order_receipts_select ON public.purchase_order_receipts;
CREATE POLICY purchase_order_receipts_select ON public.purchase_order_receipts FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.purchase_order_lines pol
      JOIN public.purchase_orders po ON po.id = pol.purchase_order_id
     WHERE pol.id = purchase_order_receipts.purchase_order_line_id
       AND ((SELECT get_user_role()) = 'super_admin'
            OR ((SELECT get_user_role()) = 'market_manager'
                AND po.market_id = (SELECT get_user_market_id())))
  )
);

-- AUCUNE POLITIQUE D'ÉCRITURE. Commander, clôturer, annuler et allouer passent
-- par les RPC ci-dessous, qui portent les règles. Une table sans politique
-- d'INSERT refuse toute insertion directe, et c'est ce qu'on veut.

GRANT SELECT ON public.purchase_orders          TO authenticated;
GRANT SELECT ON public.purchase_order_lines     TO authenticated;
GRANT SELECT ON public.purchase_order_receipts  TO authenticated;
GRANT SELECT ON public.purchase_order_line_progress TO authenticated;

-- ── 6 · La référence ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.next_purchase_order_reference(p_market_id UUID)
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

  SELECT COALESCE(MAX(substring(reference FROM '(\d+)$')::INTEGER), 0) + 1
    INTO v_seq
    FROM purchase_orders
   WHERE market_id = p_market_id
     AND reference LIKE 'BC-' || v_code || '-' || v_year || '-%';

  RETURN 'BC-' || v_code || '-' || v_year || '-' || lpad(v_seq::TEXT, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_purchase_order_reference(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_purchase_order_reference(UUID) TO authenticated;

-- ── 7 · COMMANDER ──────────────────────────────────────────────────────────
--
-- `p_lines` : [{"product_id":…, "variant_id":…|null, "qty":150, "unit_cost":…|null}]
-- Un seul appel, une seule transaction : un bon de commande à moitié écrit
-- fausserait « en route » dès la ligne suivante.

CREATE OR REPLACE FUNCTION public.create_purchase_order(
  p_actor_id     UUID,
  p_supplier_id  UUID,
  p_warehouse_id UUID,
  p_lines        JSONB,
  p_wanted_by    DATE DEFAULT NULL,
  p_note         TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role      TEXT;
  v_actor_mkt UUID;
  v_wh_market UUID;
  v_sup_mkt   UUID;
  v_po_id     UUID;
  v_ref       TEXT;
  v_count     INTEGER := 0;
  v_units     INTEGER := 0;
  v_line      JSONB;
  v_prod_mkt  UUID;
  v_prod_name TEXT;
  v_qty       INTEGER;
  v_var_kind  TEXT;
  v_var_prod  UUID;
  v_var_id    UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Une commande ne se passe pas au nom d''un autre'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;

  SELECT role, market_id INTO v_role, v_actor_mkt FROM users WHERE id = p_actor_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Acteur introuvable'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_NOT_FOUND"}';
  END IF;
  -- COMMANDER EST UN GESTE DU BUREAU. C'est un engagement de trésorerie ;
  -- l'agent du quai ne voit même pas les prix.
  IF v_role NOT IN ('market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Le rôle % ne passe pas de commande', v_role
      USING ERRCODE = '42501', DETAIL = '{"code":"FORBIDDEN"}';
  END IF;

  SELECT market_id INTO v_wh_market FROM warehouses WHERE id = p_warehouse_id;
  IF v_wh_market IS NULL THEN
    RAISE EXCEPTION 'Bâtiment introuvable' USING DETAIL = '{"code":"NO_WAREHOUSE"}';
  END IF;
  IF v_role <> 'super_admin' AND v_actor_mkt IS DISTINCT FROM v_wh_market THEN
    RAISE EXCEPTION 'Ce bâtiment appartient à un autre marché'
      USING ERRCODE = '42501', DETAIL = '{"code":"MARKET_MISMATCH"}';
  END IF;

  SELECT market_id INTO v_sup_mkt FROM suppliers WHERE id = p_supplier_id;
  IF v_sup_mkt IS NULL THEN
    RAISE EXCEPTION 'Fournisseur introuvable' USING DETAIL = '{"code":"NO_SUPPLIER"}';
  END IF;
  IF v_sup_mkt IS DISTINCT FROM v_wh_market THEN
    RAISE EXCEPTION 'Ce fournisseur appartient à un autre marché'
      USING DETAIL = '{"code":"MARKET_MISMATCH"}';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Une commande sans ligne n''est pas une commande'
      USING DETAIL = '{"code":"EMPTY_ORDER"}';
  END IF;

  v_ref := next_purchase_order_reference(v_wh_market);

  INSERT INTO purchase_orders (
    market_id, warehouse_id, supplier_id, reference, status, wanted_by, ordered_by, note
  ) VALUES (
    v_wh_market, p_warehouse_id, p_supplier_id, v_ref, 'open', p_wanted_by, p_actor_id,
    NULLIF(btrim(COALESCE(p_note, '')), '')
  )
  RETURNING id INTO v_po_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := NULLIF(v_line->>'qty', '')::INTEGER;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Chaque ligne doit porter une quantité strictement positive'
        USING DETAIL = '{"code":"BAD_QTY"}';
    END IF;

    SELECT market_id, name INTO v_prod_mkt, v_prod_name
      FROM products WHERE id = (v_line->>'product_id')::UUID;
    IF v_prod_mkt IS NULL THEN
      RAISE EXCEPTION 'Produit introuvable' USING DETAIL = '{"code":"NO_PRODUCT"}';
    END IF;
    IF v_prod_mkt IS DISTINCT FROM v_wh_market THEN
      RAISE EXCEPTION 'Le produit « % » appartient à un autre marché', v_prod_name
        USING DETAIL = '{"code":"BAD_LINE"}';
    END IF;

    v_var_id := NULLIF(v_line->>'variant_id', '')::UUID;
    IF v_var_id IS NOT NULL THEN
      SELECT kind, product_id INTO v_var_kind, v_var_prod
        FROM product_variants WHERE id = v_var_id;
      IF v_var_kind IS NULL OR v_var_prod IS DISTINCT FROM (v_line->>'product_id')::UUID THEN
        RAISE EXCEPTION 'La variante ne correspond pas au produit « % »', v_prod_name
          USING DETAIL = '{"code":"BAD_LINE"}';
      END IF;
      -- On commande des OBJETS, pas des paliers de prix.
      IF v_var_kind <> 'attribute' THEN
        RAISE EXCEPTION 'On ne commande pas un palier de quantité, mais un objet'
          USING DETAIL = '{"code":"BAD_LINE"}';
      END IF;
    ELSE
      -- MÊME RÈGLE QU'AU QUAI. Commander un « produit nu » ventilé fabriquerait
      -- un attendu que l'arrivage ne pourra jamais rattacher : le quai refuse
      -- le produit nu, donc le compte tomberait toujours sur une taille et la
      -- ligne resterait éternellement « en route ».
      IF EXISTS (
        SELECT 1 FROM product_variants
         WHERE product_id = (v_line->>'product_id')::UUID AND kind = 'attribute' AND is_active
      ) THEN
        RAISE EXCEPTION 'Le produit « % » se commande par taille', v_prod_name
          USING DETAIL = '{"code":"VARIANT_REQUIRED"}';
      END IF;
    END IF;

    INSERT INTO purchase_order_lines (
      purchase_order_id, product_id, variant_id, ordered_qty, unit_cost, note
    ) VALUES (
      v_po_id, (v_line->>'product_id')::UUID, v_var_id, v_qty,
      NULLIF(v_line->>'unit_cost', '')::NUMERIC,
      NULLIF(btrim(COALESCE(v_line->>'note', '')), '')
    )
    ON CONFLICT (purchase_order_id, product_id, variant_id) DO UPDATE
       SET ordered_qty = purchase_order_lines.ordered_qty + EXCLUDED.ordered_qty;

    v_count := v_count + 1;
    v_units := v_units + v_qty;
  END LOOP;

  RETURN json_build_object(
    'purchase_order_id', v_po_id,
    'reference',         v_ref,
    'lines',             v_count,
    'units',             v_units
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_purchase_order(UUID, UUID, UUID, JSONB, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(UUID, UUID, UUID, JSONB, DATE, TEXT) TO authenticated;

-- ── 8 · L'ALLOCATION D'UN ARRIVAGE ─────────────────────────────────────────
--
-- Appelée par `record_arrival` et `correct_arrival`, jamais depuis le réseau.
-- Elle balaie les lignes de commande OUVERTES de ce grain, du plus ancien
-- besoin au plus récent, et rattache ce qu'elle peut. Ce qui dépasse n'est
-- rattaché à rien — une sur-livraison ou un arrivage non commandé est un fait,
-- pas une erreur à forcer dans une case.
--
-- UNE COMMANDE SE CLÔT QUAND TOUTES SES LIGNES SONT SERVIES, et seulement
-- alors. Une livraison courte est le cas NORMAL : le bon reste ouvert, et c'est
-- l'acheteur qui décide d'arrêter d'attendre le reste.

CREATE OR REPLACE FUNCTION public.allocate_arrival_to_purchase_orders(
  p_reception_line_id UUID,
  p_product_id        UUID,
  p_variant_id        UUID,
  p_warehouse_id      UUID,
  p_qty               INTEGER
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_left     INTEGER := p_qty;
  v_take     INTEGER;
  v_ordered  INTEGER;
  v_matched  INTEGER := 0;
  v_po_ids   UUID[] := ARRAY[]::UUID[];
  v_rec      RECORD;
BEGIN
  IF p_qty IS NULL OR p_qty = 0 THEN
    RETURN json_build_object('ordered', NULL, 'allocated', 0);
  END IF;

  IF p_qty > 0 THEN
    FOR v_rec IN
      SELECT pol.id AS line_id,
             po.id  AS po_id,
             pol.ordered_qty - COALESCE((
               SELECT SUM(qty) FROM purchase_order_receipts
                WHERE purchase_order_line_id = pol.id
             ), 0) AS outstanding
        FROM purchase_order_lines pol
        JOIN purchase_orders po ON po.id = pol.purchase_order_id
       WHERE po.status = 'open'
         AND po.warehouse_id = p_warehouse_id
         AND pol.product_id = p_product_id
         AND pol.variant_id IS NOT DISTINCT FROM p_variant_id
       ORDER BY po.wanted_by ASC NULLS LAST, po.ordered_at ASC
       FOR UPDATE OF pol, po
    LOOP
      IF v_left <= 0 OR v_rec.outstanding <= 0 THEN CONTINUE; END IF;

      v_take := LEAST(v_left, v_rec.outstanding);
      INSERT INTO purchase_order_receipts (purchase_order_line_id, reception_line_id, qty)
      VALUES (v_rec.line_id, p_reception_line_id, v_take);

      v_left    := v_left - v_take;
      v_matched := v_matched + v_take;
      v_po_ids  := array_append(v_po_ids, v_rec.po_id);
    END LOOP;
  ELSE
    -- CORRECTION À LA BAISSE. On défait ce que CE comptage avait rattaché, du
    -- plus récent au plus ancien, en écrivant des négatifs. Rien n'est effacé.
    FOR v_rec IN
      SELECT purchase_order_line_id AS line_id, SUM(qty) AS allocated
        FROM purchase_order_receipts
       WHERE reception_line_id = p_reception_line_id
       GROUP BY purchase_order_line_id
      HAVING SUM(qty) > 0
       ORDER BY MAX(created_at) DESC
    LOOP
      IF v_left >= 0 THEN EXIT; END IF;
      v_take := LEAST(-v_left, v_rec.allocated);
      INSERT INTO purchase_order_receipts (purchase_order_line_id, reception_line_id, qty)
      VALUES (v_rec.line_id, p_reception_line_id, -v_take);
      v_left    := v_left + v_take;
      v_matched := v_matched - v_take;
      v_po_ids  := array_append(v_po_ids, (
        SELECT purchase_order_id FROM purchase_order_lines WHERE id = v_rec.line_id
      ));
    END LOOP;
  END IF;

  -- Clôture automatique : toutes les lignes servies, et rien de moins.
  UPDATE purchase_orders po
     SET status = 'closed', closed_at = NOW(), updated_at = NOW()
   WHERE po.id = ANY(v_po_ids)
     AND po.status = 'open'
     AND NOT EXISTS (
       SELECT 1 FROM purchase_order_line_progress p
        WHERE p.purchase_order_id = po.id AND p.outstanding_qty > 0
     );

  -- Une commande rouverte par une correction à la baisse redevient ouverte :
  -- `closed_by` est NULL, donc la clôture était automatique, donc elle était la
  -- conséquence d'un chiffre qui vient de changer.
  UPDATE purchase_orders po
     SET status = 'open', closed_at = NULL, updated_at = NOW()
   WHERE po.id = ANY(v_po_ids)
     AND po.status = 'closed'
     AND po.closed_by IS NULL
     AND EXISTS (
       SELECT 1 FROM purchase_order_line_progress p
        WHERE p.purchase_order_id = po.id AND p.outstanding_qty > 0
     );

  -- CE CONTRE QUOI LE COMPTE SE MESURE, en une seule définition : ce qui est
  -- commandé pour cet article dans ce bâtiment et qu'on attend encore, PLUS ce
  -- que ce comptage-ci a déjà servi. Sans le second terme, un deuxième carton
  -- sur la même commande afficherait « commandé 56 · compté 150 » — deux
  -- chiffres qui ne parlent pas de la même chose.
  --
  -- `SUM` sans `COALESCE` : aucune ligne donne NULL, et NULL est la bonne
  -- réponse. « Rien n'était commandé » et « on a commandé zéro » ne sont pas la
  -- même phrase, et l'écran doit pouvoir se taire.
  SELECT SUM(pol.ordered_qty) INTO v_ordered
    FROM purchase_order_lines pol
    JOIN purchase_orders po ON po.id = pol.purchase_order_id
   WHERE pol.product_id = p_product_id
     AND pol.variant_id IS NOT DISTINCT FROM p_variant_id
     AND po.warehouse_id = p_warehouse_id
     AND (po.status = 'open'
          OR EXISTS (
            SELECT 1 FROM purchase_order_receipts r
             WHERE r.purchase_order_line_id = pol.id
               AND r.reception_line_id = p_reception_line_id
          ));

  RETURN json_build_object(
    'ordered',   v_ordered,
    'allocated', v_matched
  );
END;
$$;

-- ON RÉVOQUE AUSSI À `authenticated`, ET C'EST LE POINT IMPORTANT. Le projet
-- porte `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE ON FUNCTIONS TO anon,
-- authenticated, service_role` : toute fonction neuve naît exécutable par les
-- trois. Le `REVOKE … FROM PUBLIC, anon` habituel ne suffit donc pas ici —
-- cette fonction-ci n'a AUCUN contrôle d'acteur (ses appelantes les portent), et
-- la laisser ouverte permettrait à n'importe quel compte connecté de fabriquer
-- des rattachements et de flatter le taux de service de son choix.
REVOKE ALL ON FUNCTION public.allocate_arrival_to_purchase_orders(UUID, UUID, UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;

-- ── 9 · CLÔTURER / ANNULER ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.close_purchase_order(
  p_purchase_order_id UUID,
  p_actor_id          UUID,
  p_reason            TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   TEXT;
  v_mkt    UUID;
  v_po     RECORD;
  v_recvd  BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Une clôture ne se signe pas au nom d''un autre'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;

  SELECT role, market_id INTO v_role, v_mkt FROM users WHERE id = p_actor_id;
  IF v_role NOT IN ('market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Le rôle % ne clôture pas une commande', v_role
      USING ERRCODE = '42501', DETAIL = '{"code":"FORBIDDEN"}';
  END IF;

  SELECT * INTO v_po FROM purchase_orders WHERE id = p_purchase_order_id FOR UPDATE;
  IF v_po.id IS NULL THEN
    RAISE EXCEPTION 'Commande introuvable' USING DETAIL = '{"code":"NOT_FOUND"}';
  END IF;
  IF v_role <> 'super_admin' AND v_mkt IS DISTINCT FROM v_po.market_id THEN
    RAISE EXCEPTION 'Cette commande appartient à un autre marché'
      USING ERRCODE = '42501', DETAIL = '{"code":"MARKET_MISMATCH"}';
  END IF;
  IF v_po.status <> 'open' THEN
    RAISE EXCEPTION 'Cette commande n''est plus ouverte'
      USING DETAIL = '{"code":"ALREADY_CLOSED"}';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM purchase_order_receipts r
      JOIN purchase_order_lines l ON l.id = r.purchase_order_line_id
     WHERE l.purchase_order_id = p_purchase_order_id
  ) INTO v_recvd;

  UPDATE purchase_orders
     -- ANNULER ET CLÔTURER NE DISENT PAS LA MÊME CHOSE. Une commande dont rien
     -- n'est arrivé est annulée : elle ne doit compter ni dans le taux de
     -- service ni dans le délai, parce qu'elle n'a jamais été servie. Une
     -- commande servie en partie est clôturée courte, et c'est précisément
     -- l'événement que le taux de service doit retenir.
     SET status       = CASE WHEN v_recvd THEN 'closed' ELSE 'cancelled' END,
         closed_at    = NOW(),
         closed_by    = p_actor_id,
         close_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
         updated_at   = NOW()
   WHERE id = p_purchase_order_id;

  RETURN json_build_object(
    'purchase_order_id', p_purchase_order_id,
    'status', CASE WHEN v_recvd THEN 'closed' ELSE 'cancelled' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_purchase_order(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_purchase_order(UUID, UUID, TEXT) TO authenticated;

-- ── 10 · LE QUAI ALLOUE, ET RÉVÈLE APRÈS ───────────────────────────────────
--
-- CREATE OR REPLACE, signature INCHANGÉE : l'ACL est conservée (c'est DROP qui
-- la rouvre à `anon`). Les REVOKE/GRANT sont répétés par discipline, pas par
-- nécessité.
--
-- La révélation voyage dans la VALEUR DE RETOUR, après l'écriture. L'agent ne
-- peut pas la lire avant : la RLS de `purchase_orders` lui est fermée.

CREATE OR REPLACE FUNCTION public.record_arrival(
  p_product_id   UUID,
  p_variant_id   UUID,
  p_qty          INTEGER,
  p_damaged      INTEGER,
  p_warehouse_id UUID,
  p_actor_id     UUID
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role       TEXT;
  v_actor_mkt  UUID;
  v_actor_wh   UUID;
  v_wh_market  UUID;
  v_today      DATE;
  v_rec_id     UUID;
  v_line_id    UUID;
  v_new_total  INTEGER;
  v_prod_mkt   UUID;
  v_prod_name  TEXT;
  v_var_kind   TEXT;
  v_var_prod   UUID;
  v_alloc      json;
  v_counted    INTEGER;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Un arrivage ne s''enregistre pas au nom d''un autre'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;

  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'La quantité doit être strictement positive'
      USING DETAIL = '{"code":"BAD_QTY"}';
  END IF;
  IF COALESCE(p_damaged, 0) < 0 THEN
    RAISE EXCEPTION 'Les unités abîmées ne peuvent pas être négatives'
      USING DETAIL = '{"code":"BAD_QTY"}';
  END IF;

  SELECT role, market_id, warehouse_id INTO v_role, v_actor_mkt, v_actor_wh
    FROM users WHERE id = p_actor_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Acteur introuvable'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_NOT_FOUND"}';
  END IF;
  IF v_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Le rôle % ne reçoit pas de marchandise', v_role
      USING ERRCODE = '42501', DETAIL = '{"code":"FORBIDDEN"}';
  END IF;

  SELECT market_id INTO v_wh_market FROM warehouses WHERE id = p_warehouse_id;
  IF v_wh_market IS NULL THEN
    RAISE EXCEPTION 'Bâtiment introuvable' USING DETAIL = '{"code":"NO_WAREHOUSE"}';
  END IF;
  IF v_role <> 'super_admin' AND v_actor_mkt IS DISTINCT FROM v_wh_market THEN
    RAISE EXCEPTION 'Ce bâtiment appartient à un autre marché'
      USING ERRCODE = '42501', DETAIL = '{"code":"MARKET_MISMATCH"}';
  END IF;

  IF v_role = 'warehouse_agent' THEN
    IF v_actor_wh IS NULL THEN
      RAISE EXCEPTION 'Aucun bâtiment ne vous est assigné'
        USING ERRCODE = '42501', DETAIL = '{"code":"NO_SITE_ASSIGNED"}';
    END IF;
    IF v_actor_wh <> p_warehouse_id THEN
      RAISE EXCEPTION 'Vous ne recevez que dans votre bâtiment'
        USING ERRCODE = '42501', DETAIL = '{"code":"WRONG_SITE"}';
    END IF;
  END IF;

  SELECT market_id, name INTO v_prod_mkt, v_prod_name FROM products WHERE id = p_product_id;
  IF v_prod_mkt IS NULL THEN
    RAISE EXCEPTION 'Produit introuvable' USING DETAIL = '{"code":"NO_PRODUCT"}';
  END IF;
  IF v_prod_mkt IS DISTINCT FROM v_wh_market THEN
    RAISE EXCEPTION 'Le produit « % » appartient à un autre marché', v_prod_name
      USING DETAIL = '{"code":"BAD_LINE"}';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT kind, product_id INTO v_var_kind, v_var_prod
      FROM product_variants WHERE id = p_variant_id;
    IF v_var_kind IS NULL THEN
      RAISE EXCEPTION 'Variante introuvable' USING DETAIL = '{"code":"BAD_LINE"}';
    END IF;
    IF v_var_prod IS DISTINCT FROM p_product_id THEN
      RAISE EXCEPTION 'La variante ne correspond pas au produit « % »', v_prod_name
        USING DETAIL = '{"code":"BAD_LINE"}';
    END IF;
    IF v_var_kind <> 'attribute' THEN
      RAISE EXCEPTION 'On ne reçoit pas un palier de quantité, mais un objet'
        USING DETAIL = '{"code":"BAD_LINE"}';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM product_variants
       WHERE product_id = p_product_id AND kind = 'attribute' AND is_active
    ) THEN
      RAISE EXCEPTION 'Le produit « % » se reçoit par taille', v_prod_name
        USING DETAIL = '{"code":"VARIANT_REQUIRED"}';
    END IF;
  END IF;

  v_today := market_local_date(v_wh_market);

  INSERT INTO receptions (market_id, warehouse_id, status, arrival_date, created_by)
  VALUES (v_wh_market, p_warehouse_id, 'open', v_today, p_actor_id)
  ON CONFLICT (warehouse_id, arrival_date) WHERE status = 'open' DO NOTHING;

  SELECT id INTO v_rec_id FROM receptions
   WHERE warehouse_id = p_warehouse_id AND arrival_date = v_today AND status = 'open'
   FOR UPDATE;

  IF v_rec_id IS NULL THEN
    RAISE EXCEPTION 'Un autre comptage est en cours sur ce bâtiment — réessayez'
      USING DETAIL = '{"code":"RETRY"}';
  END IF;

  INSERT INTO reception_lines (reception_id, product_id, variant_id, received_qty, damaged_qty)
  VALUES (v_rec_id, p_product_id, p_variant_id, p_qty, COALESCE(p_damaged, 0))
  ON CONFLICT (reception_id, product_id, variant_id) DO UPDATE
     SET received_qty = COALESCE(reception_lines.received_qty, 0) + EXCLUDED.received_qty,
         damaged_qty  = reception_lines.damaged_qty + EXCLUDED.damaged_qty
  RETURNING id, received_qty INTO v_line_id, v_counted;

  INSERT INTO product_site_stock (product_id, variant_id, warehouse_id, current_stock)
  VALUES (p_product_id, p_variant_id, p_warehouse_id, 0)
  ON CONFLICT (product_id, variant_id, warehouse_id) DO NOTHING;

  UPDATE products
     SET current_stock = current_stock + p_qty, updated_at = now()
   WHERE id = p_product_id
  RETURNING current_stock INTO v_new_total;

  INSERT INTO inventory_log (
    product_id, variant_id, order_id, change, reason, balance_after,
    actor_id, note, warehouse_id, reception_id
  ) VALUES (
    p_product_id, p_variant_id, NULL, p_qty, 'arrival', v_new_total,
    p_actor_id, 'arrivage', p_warehouse_id, v_rec_id
  );

  -- APRÈS l'écriture, et seulement après.
  v_alloc := allocate_arrival_to_purchase_orders(
    v_line_id, p_product_id, p_variant_id, p_warehouse_id, p_qty
  );

  RETURN json_build_object(
    'reception_id',  v_rec_id,
    'line_id',       v_line_id,
    'arrival_date',  v_today,
    'product_total', v_new_total,
    'site_total',    (SELECT current_stock FROM product_site_stock
                       WHERE product_id = p_product_id
                         AND variant_id IS NOT DISTINCT FROM p_variant_id
                         AND warehouse_id = p_warehouse_id),
    -- LA RÉVÉLATION. `ordered` est NULL quand rien n'était commandé : l'écran
    -- se tait alors au lieu d'afficher un écart contre un plan inexistant.
    'ordered',       (v_alloc->>'ordered')::INTEGER,
    'counted',       v_counted,
    'allocated',     (v_alloc->>'allocated')::INTEGER
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_arrival(UUID, UUID, INTEGER, INTEGER, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_arrival(UUID, UUID, INTEGER, INTEGER, UUID, UUID) TO authenticated;

-- ── 11 · LA CORRECTION DÉFAIT SON ALLOCATION ───────────────────────────────
--
-- Compter 100 puis corriger à 94 doit rendre 6 unités « en route » : sans cela
-- la commande resterait servie à 100 pour l'éternité et le taux de service du
-- fournisseur serait flatté par notre propre faute de frappe.

CREATE OR REPLACE FUNCTION public.correct_arrival(
  p_line_id  UUID,
  p_new_qty  INTEGER,
  p_actor_id UUID
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role      TEXT;
  v_actor_mkt UUID;
  v_actor_wh  UUID;
  v_line      RECORD;
  v_rec       RECORD;
  v_delta     INTEGER;
  v_new_total INTEGER;
  v_alloc     json;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Une correction ne s''écrit pas au nom d''un autre'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;
  IF p_new_qty IS NULL OR p_new_qty < 0 THEN
    RAISE EXCEPTION 'La quantité corrigée ne peut pas être négative'
      USING DETAIL = '{"code":"BAD_QTY"}';
  END IF;

  SELECT role, market_id, warehouse_id INTO v_role, v_actor_mkt, v_actor_wh
    FROM users WHERE id = p_actor_id;
  IF v_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Le rôle % ne corrige pas un comptage', v_role
      USING ERRCODE = '42501', DETAIL = '{"code":"FORBIDDEN"}';
  END IF;

  SELECT * INTO v_line FROM reception_lines WHERE id = p_line_id FOR UPDATE;
  IF v_line.id IS NULL THEN
    RAISE EXCEPTION 'Ligne introuvable' USING DETAIL = '{"code":"NO_LINE"}';
  END IF;

  SELECT * INTO v_rec FROM receptions WHERE id = v_line.reception_id FOR UPDATE;
  IF v_rec.status <> 'open' THEN
    RAISE EXCEPTION 'Cette réception est soldée — contre-passez-la'
      USING DETAIL = '{"code":"ALREADY_SETTLED"}';
  END IF;
  IF v_role <> 'super_admin' AND v_actor_mkt IS DISTINCT FROM v_rec.market_id THEN
    RAISE EXCEPTION 'Cette réception appartient à un autre marché'
      USING ERRCODE = '42501', DETAIL = '{"code":"MARKET_MISMATCH"}';
  END IF;
  IF v_role = 'warehouse_agent' AND v_actor_wh IS DISTINCT FROM v_rec.warehouse_id THEN
    RAISE EXCEPTION 'Vous ne corrigez que dans votre bâtiment'
      USING ERRCODE = '42501', DETAIL = '{"code":"WRONG_SITE"}';
  END IF;

  v_delta := p_new_qty - COALESCE(v_line.received_qty, 0);
  IF v_delta = 0 THEN
    RETURN json_build_object('line_id', p_line_id, 'delta', 0, 'unchanged', TRUE);
  END IF;

  IF v_delta < 0 AND (SELECT current_stock FROM products WHERE id = v_line.product_id) + v_delta < 0 THEN
    RAISE EXCEPTION 'La correction ferait passer le stock sous zéro'
      USING DETAIL = '{"code":"STOCK_UNDERFLOW"}';
  END IF;

  UPDATE reception_lines SET received_qty = p_new_qty, updated_at = now()
   WHERE id = p_line_id;

  UPDATE products
     SET current_stock = current_stock + v_delta, updated_at = now()
   WHERE id = v_line.product_id
  RETURNING current_stock INTO v_new_total;

  INSERT INTO inventory_log (
    product_id, variant_id, order_id, change, reason, balance_after,
    actor_id, note, warehouse_id, reception_id
  ) VALUES (
    v_line.product_id, v_line.variant_id, NULL, v_delta, 'arrival_correction',
    v_new_total, p_actor_id, 'correction du comptage',
    v_rec.warehouse_id, v_rec.id
  );

  v_alloc := allocate_arrival_to_purchase_orders(
    p_line_id, v_line.product_id, v_line.variant_id, v_rec.warehouse_id, v_delta
  );

  RETURN json_build_object(
    'line_id',       p_line_id,
    'delta',         v_delta,
    'product_total', v_new_total,
    'ordered',       (v_alloc->>'ordered')::INTEGER,
    'counted',       p_new_qty,
    'allocated',     (v_alloc->>'allocated')::INTEGER
  );
END;
$$;

REVOKE ALL ON FUNCTION public.correct_arrival(UUID, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_arrival(UUID, INTEGER, UUID) TO authenticated;

-- ── 12 · CONTRE-PASSER REND CE QUI ÉTAIT ARRIVÉ ────────────────────────────
--
-- `reverse_reception` annule le stock d'une réception soldée. Les unités
-- n'étant plus arrivées, elles ne sont plus reçues : le rattachement doit se
-- défaire aussi, sinon la commande reste servie par une réception annulée.
-- On écrit des négatifs — on n'efface pas.

CREATE OR REPLACE FUNCTION public.unallocate_reception(p_reception_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec   RECORD;
  v_n     INTEGER := 0;
  v_pos   UUID[] := ARRAY[]::UUID[];
BEGIN
  FOR v_rec IN
    SELECT r.purchase_order_line_id AS line_id,
           r.reception_line_id      AS rl_id,
           SUM(r.qty)               AS allocated,
           l.purchase_order_id      AS po_id
      FROM purchase_order_receipts r
      JOIN purchase_order_lines l ON l.id = r.purchase_order_line_id
      JOIN reception_lines rl     ON rl.id = r.reception_line_id
     WHERE rl.reception_id = p_reception_id
     GROUP BY r.purchase_order_line_id, r.reception_line_id, l.purchase_order_id
    HAVING SUM(r.qty) <> 0
  LOOP
    -- Le négatif est écrit CONTRE LE MÊME COMPTAGE : c'est ce comptage-là qui
    -- n'a plus eu lieu, et la paire (commande, comptage) reste lisible.
    INSERT INTO purchase_order_receipts (purchase_order_line_id, reception_line_id, qty)
    VALUES (v_rec.line_id, v_rec.rl_id, -v_rec.allocated);
    v_n   := v_n + 1;
    v_pos := array_append(v_pos, v_rec.po_id);
  END LOOP;

  -- Une commande que la contre-passation rouvre redevient ouverte, sauf si
  -- quelqu'un l'avait clôturée à la main : cette décision-là reste la sienne.
  UPDATE purchase_orders po
     SET status = 'open', closed_at = NULL, updated_at = NOW()
   WHERE po.id = ANY(v_pos)
     AND po.status = 'closed'
     AND po.closed_by IS NULL
     AND EXISTS (
       SELECT 1 FROM purchase_order_line_progress p
        WHERE p.purchase_order_id = po.id AND p.outstanding_qty > 0
     );

  RETURN v_n;
END;
$$;

-- Même raison : appelée uniquement par `reverse_reception`, qui porte la règle
-- (super_admin seul). Ouverte, elle effacerait des rattachements sans trace.
REVOKE ALL ON FUNCTION public.unallocate_reception(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

-- ── 13 · CONTRE-PASSER DÉFAIT AUSSI LE RATTACHEMENT ─────────────────
--
-- CREATE OR REPLACE, signature inchangee : l'ACL survit. Seule la ligne
-- `unallocate_reception` est nouvelle.

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
  v_units     INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Une contre-passation ne s''écrit pas au nom d''un autre'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;

  SELECT role INTO v_role FROM users WHERE id = p_actor_id;
  IF v_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Seul un super_admin contre-passe une réception'
      USING ERRCODE = '42501', DETAIL = '{"code":"FORBIDDEN"}';
  END IF;

  SELECT * INTO v_rec FROM receptions WHERE id = p_reception_id FOR UPDATE;
  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'Réception introuvable' USING DETAIL = '{"code":"NO_RECEPTION"}';
  END IF;
  IF v_rec.status <> 'settled' THEN
    RAISE EXCEPTION 'Seule une réception soldée se contre-passe'
      USING DETAIL = '{"code":"NOT_SETTLED"}';
  END IF;

  FOR v_line IN
    SELECT l.* FROM reception_lines l
     WHERE l.reception_id = p_reception_id AND COALESCE(l.received_qty, 0) > 0
     ORDER BY l.product_id, l.variant_id
  LOOP
    IF (SELECT current_stock FROM products WHERE id = v_line.product_id) < v_line.received_qty THEN
      RAISE EXCEPTION 'Ces unités sont déjà parties — faites un comptage ou une perte'
        USING DETAIL = '{"code":"STOCK_UNDERFLOW"}';
    END IF;

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
      COALESCE(p_note, 'contre-passation ' || COALESCE(v_rec.reference, '')),
      v_rec.warehouse_id, p_reception_id
    );

    v_units := v_units + v_line.received_qty;
  END LOOP;

  -- CE QUI N'EST PLUS ARRIVÉ N'EST PLUS REÇU. Sans cela la commande resterait
  -- servie par une réception annulée, et le taux de service du fournisseur
  -- serait flatté par une écriture qu'on vient de défaire.
  PERFORM unallocate_reception(p_reception_id);

  UPDATE receptions SET status = 'reversed', updated_at = now()
   WHERE id = p_reception_id;

  RETURN json_build_object(
    'reception_id', p_reception_id, 'reference', v_rec.reference, 'units', v_units
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_reception(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_reception(UUID, UUID, TEXT) TO authenticated;
