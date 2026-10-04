-- ════════════════════════════════════════════════════════════════════════════
-- LES RÉCLAMATIONS FOURNISSEUR — l'avarie devient une action
-- plans/reception-v4-quai-et-bureau.md · étape 7
--
-- POURQUOI. `reception_lines.damaged_qty` existe depuis le 30 septembre, il est
-- saisi sur le quai, et il est lu par PERSONNE : aucune somme, aucun écran,
-- aucune décision. Une donnée écrite et jamais relue est le défaut que tout ce
-- chantier traque — et celui-ci est cher, parce que ce qui arrive cassé a été
-- PAYÉ.
--
-- ET SURTOUT : L'ÉCRAN LE PROMET DÉJÀ. Le dialogue de soldage affiche, en
-- toutes lettres, « Le litige reste visible dans Achats jusqu'à sa résolution ».
-- Aujourd'hui il écrit `discrepancy_reason = 'claim'` sur la réception et c'est
-- tout : aucune ardoise, aucune relance, aucune résolution. Une promesse faite à
-- l'utilisateur et non tenue par la base est pire qu'une fonction absente.
--
-- CE QU'ON RÉCLAME N'EST PAS CE QU'ON DOIT, ET CE N'EST PAS RIEN NON PLUS. Au
-- soldage, `invoice_total` porte ce qui est ENTRÉ EN STOCK : on refuse de devoir
-- les unités cassées. L'écart reste dehors — ni payable, ni oublié.
--
-- POURQUOI LE CONCÉDÉ S'AJOUTE AU LIEU DE CORRIGER LA FACTURE.
-- `reception_immutable_once_posted` refuse toute écriture sur une réception
-- soldée, donc `invoice_total` ne peut pas remonter. C'est la bonne contrainte :
-- on n'efface pas une écriture, on écrit la suite — la discipline
-- d'`inventory_log` et des contre-passations, appliquée à l'argent.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · La table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.supplier_claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id       UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  supplier_id     UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  -- La réception d'où le litige est né. `ON DELETE SET NULL` et non CASCADE :
  -- une créance ne disparaît pas parce qu'on a rangé le document.
  reception_id    UUID REFERENCES public.receptions(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('damaged', 'shortage', 'overbilled')),
  -- Strictement positif : un litige de zéro dinar n'est pas un litige.
  amount          NUMERIC(12,3) NOT NULL CHECK (amount > 0),
  -- NULL pour un pur écart de prix, qui ne porte aucune unité.
  units           INTEGER CHECK (units IS NULL OR units > 0),
  -- Trois états, TROIS CONSÉQUENCES FINANCIÈRES DISTINCTES :
  --   open     → on conteste, ce n'est pas dû ;
  --   credited → avoir reçu : on ne l'a jamais dû, c'est clos ;
  --   conceded → on renonce : le montant rejoint l'ardoise.
  -- Un quatrième mot pour la même conséquence (« retiré », « abandonné ») serait
  -- du bruit : deux noms sous un seul effet finissent comptés deux fois.
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'credited', 'conceded')),
  note            TEXT,
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_by       UUID REFERENCES public.users(id),
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES public.users(id),
  resolution_note TEXT,
  -- La référence de l'avoir du fournisseur, quand il en émet un. C'est la pièce
  -- qui justifie qu'on ne doive plus rien.
  credit_ref      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Un litige résolu porte sa date ; un litige ouvert n'en porte pas. Sans
  -- cette contrainte, « résolu sans date » devient indétectable.
  CONSTRAINT supplier_claims_resolution_coherent CHECK (
    (status = 'open'  AND resolved_at IS NULL)
    OR (status <> 'open' AND resolved_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.supplier_claims IS
  'Ce qu''on réclame à un fournisseur : avarie à l''arrivée, manquant facturé, '
  'ou surfacturation inexpliquée. Un litige OUVERT n''est pas dû ; un litige '
  'CONCÉDÉ s''ajoute à l''ardoise (la facture, elle, est immuable).';

COMMENT ON COLUMN public.supplier_claims.amount IS
  'Le montant réclamé, marchandises seules et en devise du marché. Pour une '
  'avarie c''est damaged_qty × unit_cost — le chiffre que la base sait calculer '
  'elle-même, et qui explique souvent l''écart de facture exactement.';

-- UN SEUL LITIGE OUVERT PAR RÉCEPTION. Deux soldages ne peuvent pas avoir lieu
-- (la réception devient `settled`), mais une reprise manuelle, elle, pourrait
-- doubler la créance. L'index est le garde-fou, pas la relecture.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_claims_one_open_per_reception
  ON public.supplier_claims (reception_id)
  WHERE status = 'open' AND reception_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS supplier_claims_open_idx
  ON public.supplier_claims (market_id, supplier_id) WHERE status = 'open';

-- ── 2 · RLS ─────────────────────────────────────────────────────────────────
--
-- UN LITIGE EST DE L'ARGENT, DONC C'EST UNE AFFAIRE DE BUREAU. L'agent du quai
-- compte les unités cassées — il est la SOURCE du chiffre — mais il ne voit ni
-- le prix, ni le montant réclamé, ni l'ardoise. Même frontière que les coûts.

ALTER TABLE public.supplier_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_claims_select ON public.supplier_claims;
CREATE POLICY supplier_claims_select ON public.supplier_claims FOR SELECT TO authenticated
USING (
  (SELECT get_user_role()) = 'super_admin'
  OR ((SELECT get_user_role()) = 'market_manager'
      AND market_id = (SELECT get_user_market_id()))
);

-- AUCUNE POLITIQUE D'ÉCRITURE : ouvrir et résoudre passent par les RPC
-- ci-dessous, qui portent les règles. Une table sans politique d'INSERT refuse
-- toute insertion directe, et c'est exactement ce qu'on veut.

GRANT SELECT ON public.supplier_claims TO authenticated;

CREATE OR REPLACE FUNCTION public.supplier_claims_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_claims_touch ON public.supplier_claims;
CREATE TRIGGER supplier_claims_touch BEFORE UPDATE ON public.supplier_claims
  FOR EACH ROW EXECUTE FUNCTION public.supplier_claims_touch();

-- ── 3 · RÉSOUDRE ───────────────────────────────────────────────────────────
--
-- Deux issues, et chacune dit quelque chose de différent sur le fournisseur.
-- `credited` est une bonne nouvelle qu'on garde ; `conceded` est une perte qu'on
-- assume, et elle rejoint l'ardoise au lieu de réécrire la facture.

CREATE OR REPLACE FUNCTION public.resolve_supplier_claim(
  p_claim_id  UUID,
  p_actor_id  UUID,
  p_outcome   TEXT,
  p_credit_ref TEXT DEFAULT NULL,
  p_note      TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role  TEXT;
  v_mkt   UUID;
  v_claim RECORD;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Un litige ne se résout pas au nom d''un autre'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;

  IF p_outcome NOT IN ('credited', 'conceded') THEN
    RAISE EXCEPTION 'Issue inconnue : %', p_outcome
      USING DETAIL = '{"code":"BAD_OUTCOME"}';
  END IF;

  SELECT role, market_id INTO v_role, v_mkt FROM users WHERE id = p_actor_id;
  IF v_role NOT IN ('market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Le rôle % ne résout pas un litige', v_role
      USING ERRCODE = '42501', DETAIL = '{"code":"FORBIDDEN"}';
  END IF;

  SELECT * INTO v_claim FROM supplier_claims WHERE id = p_claim_id FOR UPDATE;
  IF v_claim.id IS NULL THEN
    RAISE EXCEPTION 'Litige introuvable' USING DETAIL = '{"code":"NOT_FOUND"}';
  END IF;
  IF v_role <> 'super_admin' AND v_mkt IS DISTINCT FROM v_claim.market_id THEN
    RAISE EXCEPTION 'Ce litige appartient à un autre marché'
      USING ERRCODE = '42501', DETAIL = '{"code":"MARKET_MISMATCH"}';
  END IF;
  IF v_claim.status <> 'open' THEN
    RAISE EXCEPTION 'Ce litige est déjà %', v_claim.status
      USING DETAIL = '{"code":"ALREADY_RESOLVED"}';
  END IF;

  -- UN AVOIR SE PROUVE. Dire « le fournisseur a crédité » sans pouvoir nommer
  -- la pièce, c'est effacer une créance sur une parole ; c'est exactement
  -- l'écriture qu'un audit demandera à voir.
  IF p_outcome = 'credited' AND COALESCE(btrim(COALESCE(p_credit_ref, '')), '') = '' THEN
    RAISE EXCEPTION 'La référence de l''avoir est requise'
      USING DETAIL = '{"code":"CREDIT_REF_REQUIRED"}';
  END IF;

  UPDATE supplier_claims
     SET status          = p_outcome,
         resolved_at     = now(),
         resolved_by     = p_actor_id,
         credit_ref      = NULLIF(btrim(COALESCE(p_credit_ref, '')), ''),
         resolution_note = NULLIF(btrim(COALESCE(p_note, '')), '')
   WHERE id = p_claim_id;

  RETURN json_build_object(
    'claim_id', p_claim_id,
    'status',   p_outcome,
    'amount',   v_claim.amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_supplier_claim(UUID, UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_supplier_claim(UUID, UUID, TEXT, TEXT, TEXT)
  TO authenticated;

-- ── 4 · SOLDER PEUT DÉSORMAIS OUVRIR UN LITIGE ─────────────────────────────
--
-- DROP + CREATE, parce que la SIGNATURE change (`p_claim_amount` s'ajoute).
-- `DROP FUNCTION` RÉINITIALISE L'ACL et rouvre EXECUTE à `anon` : le re-REVOKE
-- ci-dessous n'est pas de la politesse, c'est la correction d'un trou. Cf.
-- docs/product-variants.md et la note du dépôt sur les RPC anon-appelables.

DROP FUNCTION IF EXISTS public.settle_reception(UUID, UUID, UUID, NUMERIC, DATE, TEXT);

CREATE FUNCTION public.settle_reception(
  p_reception_id      UUID,
  p_actor_id          UUID,
  p_supplier_id       UUID,
  p_invoice_total     NUMERIC DEFAULT NULL,
  p_due_at            DATE DEFAULT NULL,
  p_discrepancy_reason TEXT DEFAULT NULL,
  -- CE QU'ON REFUSE DE DEVOIR. Non nul = on solde en ne devant que ce qui est
  -- entré en stock, et l'écart devient un LITIGE porté par `supplier_claims`
  -- au lieu de disparaitre dans un `discrepancy_reason`.
  p_claim_amount      NUMERIC DEFAULT NULL
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
  v_damaged_units  INTEGER;
  v_damaged_value  NUMERIC(14,3);
  v_claim_kind     TEXT;
  v_claim_units    INTEGER;
  v_claim_id       UUID;
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

  -- UN LITIGE NE SE RÉCLAME QUE CONTRE UN ÉCART RÉEL. Sans facture saisie il
  -- n'y a rien à contester : accepter un montant libre ici fabriquerait une
  -- créance que rien ne justifie, et c'est exactement le genre de chiffre qui
  -- traverse ensuite tous les écrans sans que personne sache d'où il vient.
  IF p_claim_amount IS NOT NULL AND p_claim_amount > 0 THEN
    IF p_invoice_total IS NULL THEN
      RAISE EXCEPTION 'On ne réclame rien sans facture à contester'
        USING DETAIL = '{"code":"CLAIM_WITHOUT_INVOICE"}';
    END IF;
    -- Le litige ne peut pas dépasser le surplus facturé. Au-delà, on ne
    -- réclame plus : on invente.
    IF p_claim_amount > v_gap + 0.0005 THEN
      RAISE EXCEPTION 'Le litige (%) dépasse le surplus facturé (%)',
        p_claim_amount, v_gap
        USING DETAIL = '{"code":"CLAIM_EXCEEDS_GAP"}';
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

  -- ── LE LITIGE ──────────────────────────────────────────────────────────
  --
  -- Écrit APRÈS le soldage et dans LA MÊME TRANSACTION. L'écran a promis que
  -- « le litige reste visible dans Achats jusqu'à sa résolution » : deux appels
  -- séparés laisseraient une fenêtre où la réception est soldée et la promesse
  -- perdue, en silence.
  IF p_claim_amount IS NOT NULL AND p_claim_amount > 0 THEN
    SELECT COALESCE(SUM(damaged_qty), 0),
           COALESCE(SUM(damaged_qty * COALESCE(unit_cost, 0)), 0)
      INTO v_damaged_units, v_damaged_value
      FROM reception_lines WHERE reception_id = p_reception_id;

    -- LA NATURE SE DÉDUIT, ELLE NE SE DEMANDE PAS. Quand l'avarie explique le
    -- trou au millième près, le système le SAIT : c'est ce qui permet de
    -- remplacer un formulaire de motifs par deux boutons. Sinon on ne devine
    -- pas, et « surfacturé » dit honnêtement « la facture dépasse, on ne sait
    -- pas pourquoi ».
    IF v_damaged_units > 0 AND abs(v_damaged_value - p_claim_amount) < 0.0005 THEN
      v_claim_kind  := 'damaged';
      v_claim_units := v_damaged_units;
    ELSE
      v_claim_kind  := 'overbilled';
      v_claim_units := NULL;
    END IF;

    INSERT INTO supplier_claims (
      market_id, supplier_id, reception_id, kind, amount, units,
      status, note, opened_by
    ) VALUES (
      v_rec.market_id, p_supplier_id, p_reception_id, v_claim_kind,
      ROUND(p_claim_amount, 3), v_claim_units,
      'open', NULLIF(btrim(COALESCE(p_discrepancy_reason, '')), ''), p_actor_id
    )
    RETURNING id INTO v_claim_id;
  END IF;

  RETURN json_build_object(
    'reception_id',  p_reception_id,
    'claim_id',      v_claim_id,
    'claim_amount',  CASE WHEN v_claim_id IS NULL THEN NULL
                          ELSE ROUND(p_claim_amount, 3) END,
    'claim_kind',    v_claim_kind,
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


REVOKE ALL ON FUNCTION public.settle_reception(UUID, UUID, UUID, NUMERIC, DATE, TEXT, NUMERIC)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_reception(UUID, UUID, UUID, NUMERIC, DATE, TEXT, NUMERIC)
  TO authenticated;
