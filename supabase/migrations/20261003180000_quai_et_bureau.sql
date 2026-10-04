-- ════════════════════════════════════════════════════════════════════════════
-- LE QUAI ET LE BUREAU
-- plans/reception-v4-quai-et-bureau.md · étape 5
--
-- UNE RÉCEPTION N'EST PAS CRÉÉE, ELLE EST SOLDÉE.
--
-- Le quai enregistre des ARRIVAGES — deux champs — et le stock entre
-- immédiatement, parce que c'est à ce moment-là qu'il est vrai. Le bureau SOLDE
-- le groupe (bâtiment + jour) une fois la semaine : fournisseur, prix, frais
-- d'approche, rapprochement contre la facture. L'argent entre là, et la
-- référence REC-… naît là.
--
-- POURQUOI L'INVERSION. L'état `submitted` était une fenêtre où la marchandise
-- est sur l'étagère et où Ordra dit qu'elle n'existe pas. Quelqu'un la vendra.
-- Réel-mais-non-chiffré est un mensonge bien plus sûr que réel-mais-invisible.
--
-- POURQUOI MAINTENANT. Zéro réception validée en production, zéro ligne, zéro
-- paiement, zéro ligne de registre `reason='reception'` : la seule réception qui
-- existe est un brouillon vide du 1er octobre. C'est la fenêtre la moins chère
-- qu'on aura jamais pour changer cette structure — dans six mois, ce serait une
-- migration de données.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Les états ───────────────────────────────────────────────────────────
--
-- open → settled → reversed. `draft`, `submitted`, `posted` et `cancelled`
-- disparaissent : il n'y a plus de moment où la marchandise est là sans être
-- en stock, donc plus rien à déclarer ni à valider.

ALTER TABLE public.receptions DROP CONSTRAINT IF EXISTS receptions_status_check;

-- LE DÉCLENCHEUR D'IMMUABILITÉ BLOQUE SA PROPRE MIGRATION. `trg_reception_immutable`
-- refuse toute écriture sur une réception `posted` ou `reversed` — y compris
-- celle qui la renomme `settled`, et celle qui lui pose `arrival_date`. En
-- production il n'y a aucune réception validée, donc rien ne se verrait ; sur
-- une base qui en porte (46 en local) la migration s'arrête au milieu. On
-- désactive donc le garde-fou pour la seule durée du remplissage, puis on le
-- remet — et c'est le seul endroit de tout Ordra où on a le droit de le faire,
-- parce qu'ici la réécriture EST la migration.
ALTER TABLE public.receptions DISABLE TRIGGER trg_reception_immutable;

UPDATE public.receptions
   SET status = CASE
         WHEN status IN ('draft', 'submitted') THEN 'open'
         WHEN status = 'posted' THEN 'settled'
         WHEN status = 'cancelled' THEN 'reversed'
         ELSE status
       END
 WHERE status IN ('draft', 'submitted', 'posted', 'cancelled');

ALTER TABLE public.receptions
  ADD CONSTRAINT receptions_status_check
  CHECK (status IN ('open', 'settled', 'reversed'));

ALTER TABLE public.receptions ALTER COLUMN status SET DEFAULT 'open';

-- LA RÉFÉRENCE NAÎT AU SOLDAGE. Le numéro est l'identité du DOCUMENT, et le
-- document naît au bureau ; un groupe en cours a un lieu et un jour, pas un
-- numéro. L'unicité (market_id, reference) tolère plusieurs NULL.
ALTER TABLE public.receptions ALTER COLUMN reference DROP NOT NULL;

ALTER TABLE public.receptions
  ADD COLUMN IF NOT EXISTS settled_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settled_by  UUID REFERENCES public.users(id),
  -- LE JOUR OÙ LA MARCHANDISE EST ARRIVÉE : c'est la clé de regroupement du
  -- quai, et elle est posée par la base, jamais par le téléphone.
  ADD COLUMN IF NOT EXISTS arrival_date DATE,
  -- Ce qui justifie un écart accepté contre la facture.
  ADD COLUMN IF NOT EXISTS discrepancy_reason TEXT;

UPDATE public.receptions
   SET arrival_date = COALESCE(arrival_date, (created_at AT TIME ZONE 'UTC')::DATE)
 WHERE arrival_date IS NULL;

ALTER TABLE public.receptions ENABLE TRIGGER trg_reception_immutable;

COMMENT ON COLUMN public.receptions.arrival_date IS
  'Le jour local du marché où les arrivages ont été comptés. Clé de '
  'regroupement : un bâtiment, un jour, une réception ouverte.';

-- UN SEUL GROUPE OUVERT PAR BÂTIMENT ET PAR JOUR. Deux agents qui comptent en
-- même temps ne doivent pas créer deux documents ; l'index est le vrai garde-fou
-- et `record_arrival` s'appuie dessus plutôt que sur une lecture préalable.
CREATE UNIQUE INDEX IF NOT EXISTS receptions_one_open_per_site_day
  ON public.receptions (warehouse_id, arrival_date) WHERE status = 'open';

-- ── 2 · Les mouvements du quai ─────────────────────────────────────────────

ALTER TABLE public.inventory_log DROP CONSTRAINT IF EXISTS inventory_log_reason_check;
ALTER TABLE public.inventory_log
  ADD CONSTRAINT inventory_log_reason_check CHECK (reason IN (
    'initial_stock', 'scanned', 'scan_reversal', 'returned', 'received_back',
    'damaged_writeoff', 'manual_adjustment', 'stock_count',
    'manual_delete_reversal', 'deposit',
    'reception', 'reception_reversal',
    -- L'arrivage fait entrer le stock ; la correction écrit le DELTA, parce que
    -- le registre est en ajout seul et qu'on ne réécrit jamais une ligne.
    'arrival', 'arrival_correction'
  ));

-- ── 3 · L'immuabilité suit le nouvel état ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.reception_immutable_once_posted()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('settled', 'reversed') THEN
      RAISE EXCEPTION 'Une réception soldée ne se supprime pas — contre-passez-la'
        USING ERRCODE = '42501', DETAIL = '{"code":"RECEPTION_IMMUTABLE"}';
    END IF;
    RETURN OLD;
  END IF;

  -- settled → reversed est le seul changement autorisé sur une réception
  -- soldée, et c'est `reverse_reception` qui l'écrit.
  IF OLD.status = 'settled' AND NEW.status = 'reversed' THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('settled', 'reversed') THEN
    RAISE EXCEPTION 'Une réception soldée est définitive — contre-passez-la'
      USING ERRCODE = '42501', DETAIL = '{"code":"RECEPTION_IMMUTABLE"}';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reception_line_immutable_once_posted()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM public.receptions
   WHERE id = COALESCE(NEW.reception_id, OLD.reception_id);

  IF v_status IN ('settled', 'reversed') THEN
    RAISE EXCEPTION 'Les lignes d''une réception soldée sont définitives'
      USING ERRCODE = '42501', DETAIL = '{"code":"RECEPTION_IMMUTABLE"}';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ── 4 · Le jour local du marché ────────────────────────────────────────────
--
-- `markets` ne porte pas de fuseau (vérifié : id, code, name, language,
-- currency, direction, is_active, …) et aucune fonction SQL n'en expose un. On
-- le dérive donc du CODE, qui est la seule source disponible. Sans cela, un
-- carton déchargé à 01 h à Tripoli (UTC+2) serait rangé dans la journée de la
-- veille — et le bureau solderait deux groupes là où il y en a un.

CREATE OR REPLACE FUNCTION public.market_local_date(p_market_id UUID)
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (now() AT TIME ZONE CASE upper(m.code)
            WHEN 'LY' THEN 'Africa/Tripoli'
            WHEN 'TN' THEN 'Africa/Tunis'
            ELSE 'UTC'
          END)::DATE
    FROM markets m WHERE m.id = p_market_id;
$$;

REVOKE ALL ON FUNCTION public.market_local_date(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.market_local_date(UUID) TO authenticated;

-- ── 5 · ENREGISTRER UN ARRIVAGE ────────────────────────────────────────────
--
-- Le seul chemin d'entrée de stock du quai. Deux champs côté téléphone : le
-- produit et la quantité. Le bâtiment vient de l'agent, le marché du bâtiment,
-- le jour de la base, et le document se trouve ou se crée tout seul.

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
BEGIN
  -- L'acteur EST la session. Forme stricte : `auth.uid() IS NULL` refuse aussi.
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

  -- UN AGENT SANS BÂTIMENT NE REÇOIT RIEN. « Non assigné » ne veut pas dire
  -- « partout » — c'est la règle du projet, et elle vaut ici comme au scan.
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
    -- Un palier ne porte pas de stock : il en consomme.
    IF v_var_kind <> 'attribute' THEN
      RAISE EXCEPTION 'On ne reçoit pas un palier de quantité, mais un objet'
        USING DETAIL = '{"code":"BAD_LINE"}';
    END IF;
  ELSE
    -- LE PRODUIT NU EST REFUSÉ QUAND IL EST VENTILÉ. « Quelle taille le client
    -- a-t-il reçue ? » n'a pas de réponse sur des unités entrées sans taille,
    -- et `scan_order_out` les refusera à la sortie. Autant refuser à l'entrée.
    IF EXISTS (
      SELECT 1 FROM product_variants
       WHERE product_id = p_product_id AND kind = 'attribute' AND is_active
    ) THEN
      RAISE EXCEPTION 'Le produit « % » se reçoit par taille', v_prod_name
        USING DETAIL = '{"code":"VARIANT_REQUIRED"}';
    END IF;
  END IF;

  v_today := market_local_date(v_wh_market);

  -- LE DOCUMENT SE TROUVE OU SE CRÉE. L'index partiel unique est le garde-fou
  -- contre deux agents qui comptent en même temps ; on tente l'insertion et on
  -- relit, plutôt que de lire puis insérer (ce qui laisse une course ouverte).
  -- La cible est NOMMÉE : un `ON CONFLICT DO NOTHING` nu avalerait aussi une
  -- violation qu'on n'a pas prévue, et on croirait avoir trouvé un document.
  INSERT INTO receptions (market_id, warehouse_id, status, arrival_date, created_by)
  VALUES (v_wh_market, p_warehouse_id, 'open', v_today, p_actor_id)
  ON CONFLICT (warehouse_id, arrival_date) WHERE status = 'open' DO NOTHING;

  SELECT id INTO v_rec_id FROM receptions
   WHERE warehouse_id = p_warehouse_id AND arrival_date = v_today AND status = 'open'
   FOR UPDATE;

  -- Une insertion concurrente non encore validée rend la ligne invisible ici.
  -- Mieux vaut demander à l'appelant de réessayer que d'écrire du stock sur un
  -- document NULL.
  IF v_rec_id IS NULL THEN
    RAISE EXCEPTION 'Un autre comptage est en cours sur ce bâtiment — réessayez'
      USING DETAIL = '{"code":"RETRY"}';
  END IF;

  -- UNE LIGNE PAR (produit, taille). Re-compter le même article s'ajoute à la
  -- ligne : c'est le même carton qu'on finit de vider, pas un second document.
  INSERT INTO reception_lines (reception_id, product_id, variant_id, received_qty, damaged_qty)
  VALUES (v_rec_id, p_product_id, p_variant_id, p_qty, COALESCE(p_damaged, 0))
  ON CONFLICT (reception_id, product_id, variant_id) DO UPDATE
     SET received_qty = COALESCE(reception_lines.received_qty, 0) + EXCLUDED.received_qty,
         damaged_qty  = reception_lines.damaged_qty + EXCLUDED.damaged_qty
  RETURNING id INTO v_line_id;

  -- LA LIGNE DE SITE. Le trigger de ventilation fait un UPDATE : sans elle, le
  -- bâtiment est manqué en silence.
  INSERT INTO product_site_stock (product_id, variant_id, warehouse_id, current_stock)
  VALUES (p_product_id, p_variant_id, p_warehouse_id, 0)
  ON CONFLICT (product_id, variant_id, warehouse_id) DO NOTHING;

  UPDATE products
     SET current_stock = current_stock + p_qty, updated_at = now()
   WHERE id = p_product_id
  RETURNING current_stock INTO v_new_total;

  -- UNE ligne de registre. Le trigger en déduit la variante et le site.
  -- LES ABÎMÉES N'ENTRENT PAS : elles n'étaient jamais vendables et ne sont pas
  -- à nous — c'est une réclamation fournisseur, pas du stock.
  INSERT INTO inventory_log (
    product_id, variant_id, order_id, change, reason, balance_after,
    actor_id, note, warehouse_id, reception_id
  ) VALUES (
    p_product_id, p_variant_id, NULL, p_qty, 'arrival', v_new_total,
    p_actor_id, 'arrivage', p_warehouse_id, v_rec_id
  );

  RETURN json_build_object(
    'reception_id',  v_rec_id,
    'line_id',       v_line_id,
    'arrival_date',  v_today,
    'product_total', v_new_total,
    'site_total',    (SELECT current_stock FROM product_site_stock
                       WHERE product_id = p_product_id
                         AND variant_id IS NOT DISTINCT FROM p_variant_id
                         AND warehouse_id = p_warehouse_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_arrival(UUID, UUID, INTEGER, INTEGER, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_arrival(UUID, UUID, INTEGER, INTEGER, UUID, UUID) TO authenticated;

-- ── 6 · CORRIGER UN COMPTAGE ───────────────────────────────────────────────
--
-- Le registre est en ajout seul : on n'efface rien, on écrit le DELTA. La ligne
-- porte alors « corrigée », et le soldage ferme la porte.

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

  -- On ne descend pas le stock sous zéro par une correction de comptage.
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

  RETURN json_build_object(
    'line_id', p_line_id, 'delta', v_delta, 'product_total', v_new_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.correct_arrival(UUID, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_arrival(UUID, INTEGER, UUID) TO authenticated;

-- ── 7 · SOLDER ─────────────────────────────────────────────────────────────
--
-- Le stock a déjà bougé. Solder écrit l'ARGENT : le fournisseur, les prix, les
-- frais répartis, le coût de revient, le dû — et frappe la référence.
--
-- LE RAPPROCHEMENT EST LA BARRIÈRE. Une deuxième signature ne crée pas de
-- preuve ; comparer deux sources indépendantes, si. Un écart entre ce que
-- l'agent a compté à l'aveugle et ce que le fournisseur réclame par écrit DOIT
-- être justifié, sinon le soldage est refusé.

CREATE OR REPLACE FUNCTION public.settle_reception(
  p_reception_id      UUID,
  p_actor_id          UUID,
  p_supplier_id       UUID,
  p_invoice_total     NUMERIC DEFAULT NULL,
  p_due_at            DATE DEFAULT NULL,
  p_discrepancy_reason TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role       TEXT;
  v_actor_mkt  UUID;
  v_rec        RECORD;
  v_line       RECORD;
  v_goods      NUMERIC(14,3) := 0;
  v_fees       NUMERIC(14,3) := 0;
  v_lines      INTEGER := 0;
  v_costs      INTEGER := 0;
  v_adopt      BOOLEAN;
  v_landed     NUMERIC(12,3);
  v_ref        TEXT;
  v_gap        NUMERIC(14,3);
  v_sup_market UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Une réception ne se solde pas au nom d''un autre'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;

  SELECT role, market_id INTO v_role, v_actor_mkt FROM users WHERE id = p_actor_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Acteur introuvable'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_NOT_FOUND"}';
  END IF;
  -- Solder est un geste de BUREAU : l'agent du quai compte, il ne chiffre pas.
  IF v_role NOT IN ('market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Le rôle % ne solde pas une réception', v_role
      USING ERRCODE = '42501', DETAIL = '{"code":"FORBIDDEN"}';
  END IF;

  SELECT * INTO v_rec FROM receptions WHERE id = p_reception_id FOR UPDATE;
  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'Réception introuvable' USING DETAIL = '{"code":"NO_RECEPTION"}';
  END IF;
  IF v_role <> 'super_admin' AND v_actor_mkt IS DISTINCT FROM v_rec.market_id THEN
    RAISE EXCEPTION 'Cette réception appartient à un autre marché'
      USING ERRCODE = '42501', DETAIL = '{"code":"MARKET_MISMATCH"}';
  END IF;
  IF v_rec.status <> 'open' THEN
    RAISE EXCEPTION 'Cette réception est déjà %', v_rec.status
      USING DETAIL = '{"code":"ALREADY_SETTLED"}';
  END IF;

  SELECT count(*) INTO v_lines FROM reception_lines
   WHERE reception_id = p_reception_id AND COALESCE(received_qty, 0) > 0;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'Aucun arrivage à solder' USING DETAIL = '{"code":"EMPTY_RECEPTION"}';
  END IF;

  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Un fournisseur est requis pour solder'
      USING DETAIL = '{"code":"SUPPLIER_REQUIRED"}';
  END IF;
  SELECT market_id INTO v_sup_market FROM suppliers WHERE id = p_supplier_id;
  IF v_sup_market IS NULL THEN
    RAISE EXCEPTION 'Fournisseur introuvable' USING DETAIL = '{"code":"NO_SUPPLIER"}';
  END IF;
  IF v_sup_market IS DISTINCT FROM v_rec.market_id THEN
    RAISE EXCEPTION 'Ce fournisseur appartient à un autre marché'
      USING DETAIL = '{"code":"MARKET_MISMATCH"}';
  END IF;

  SELECT COALESCE(SUM(COALESCE(unit_cost, 0) * received_qty), 0) INTO v_goods
    FROM reception_lines
   WHERE reception_id = p_reception_id AND COALESCE(received_qty, 0) > 0;

  SELECT COALESCE(SUM(amount), 0) INTO v_fees
    FROM reception_costs WHERE reception_id = p_reception_id;

  -- LE RAPPROCHEMENT. Les frais d'approche sont EXCLUS : ils sont dus à
  -- d'autres, et la facture du fournisseur ne porte que la marchandise.
  IF p_invoice_total IS NOT NULL THEN
    v_gap := p_invoice_total - v_goods;
    IF abs(v_gap) >= 0.0005 AND COALESCE(btrim(p_discrepancy_reason), '') = '' THEN
      RAISE EXCEPTION 'La facture ne tombe pas sur le compte : écart de %', v_gap
        USING DETAIL = '{"code":"DISCREPANCY"}';
    END IF;
  END IF;

  -- La politique de coût du marché. Absente, elle vaut FAUX.
  SELECT COALESCE((value)::text = 'true', FALSE) INTO v_adopt
    FROM settings
   WHERE market_id = v_rec.market_id AND key = 'costing_update_on_settle';
  v_adopt := COALESCE(v_adopt, FALSE);

  FOR v_line IN
    SELECT l.*, p.current_stock AS product_stock, p.unit_cogs AS product_cogs,
           COALESCE(s.share, 0) AS fee_share
      FROM reception_lines l
      JOIN products p ON p.id = l.product_id
      LEFT JOIN allocate_reception_fees(p_reception_id) s ON s.line_id = l.id
     WHERE l.reception_id = p_reception_id
       AND COALESCE(l.received_qty, 0) > 0
     ORDER BY l.product_id, l.variant_id
     FOR UPDATE OF l
  LOOP
    v_landed := NULL;
    IF v_line.unit_cost IS NOT NULL THEN
      v_landed := ROUND(v_line.unit_cost + (v_line.fee_share / v_line.received_qty), 3);
    END IF;
    UPDATE reception_lines SET landed_unit_cost = v_landed WHERE id = v_line.id;

    -- LE STOCK A DÉJÀ BOUGÉ au moment de l'arrivage : on ne le touche pas ici.
    -- La moyenne pondérée porte donc sur le stock AVANT cet arrivage, qu'on
    -- reconstitue en retirant ce que la réception a apporté.
    IF v_adopt AND v_landed IS NOT NULL THEN
      IF v_line.variant_id IS NULL THEN
        UPDATE products p
           SET unit_cogs = ROUND(
                 ((GREATEST(p.current_stock - v_line.received_qty, 0) * p.unit_cogs)
                   + (v_line.received_qty * v_landed))
                 / NULLIF(GREATEST(p.current_stock - v_line.received_qty, 0)
                          + v_line.received_qty, 0), 3),
               updated_at = now()
         WHERE p.id = v_line.product_id;
      ELSE
        UPDATE product_variants v
           SET unit_cogs = ROUND(
                 ((GREATEST(v.current_stock - v_line.received_qty, 0) * v.unit_cogs)
                   + (v_line.received_qty * v_landed))
                 / NULLIF(GREATEST(v.current_stock - v_line.received_qty, 0)
                          + v_line.received_qty, 0), 3),
               updated_at = now()
         WHERE v.id = v_line.variant_id;
      END IF;
      v_costs := v_costs + 1;
    END IF;
  END LOOP;

  -- LA RÉFÉRENCE NAÎT ICI.
  v_ref := next_reception_reference(v_rec.market_id);

  UPDATE receptions
     SET status = 'settled',
         reference = v_ref,
         supplier_id = p_supplier_id,
         invoice_total = p_invoice_total,
         due_at = p_due_at,
         discrepancy_reason = NULLIF(btrim(COALESCE(p_discrepancy_reason, '')), ''),
         settled_at = now(),
         settled_by = p_actor_id,
         updated_at = now()
   WHERE id = p_reception_id;

  RETURN json_build_object(
    'reception_id',  p_reception_id,
    'reference',     v_ref,
    'lines',         v_lines,
    'goods',         v_goods,
    'fees',          v_fees,
    'landed_value',  v_goods + v_fees,
    'gap',           v_gap,
    'costs_adopted', v_costs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.settle_reception(UUID, UUID, UUID, NUMERIC, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_reception(UUID, UUID, UUID, NUMERIC, DATE, TEXT) TO authenticated;

-- ── 8 · Contre-passer suit le nouvel état ──────────────────────────────────

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

  UPDATE receptions SET status = 'reversed', updated_at = now()
   WHERE id = p_reception_id;

  RETURN json_build_object(
    'reception_id', p_reception_id, 'reference', v_rec.reference, 'units', v_units
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_reception(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_reception(UUID, UUID, TEXT) TO authenticated;

-- ── 9 · `post_reception` n'a plus d'objet ──────────────────────────────────
-- Le stock n'entre plus à la validation : il entre à l'arrivage. La fonction
-- n'a jamais été appelée en production (zéro ligne de registre `reception`).

DROP FUNCTION IF EXISTS public.post_reception(UUID, UUID);
