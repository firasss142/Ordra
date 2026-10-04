-- ════════════════════════════════════════════════════════════════════════════
-- FRAIS D'APPROCHE ET POLITIQUE DE COÛT
-- plans/reception-v4-quai-et-bureau.md · étape 4
--
-- LE PRIX DU FOURNISSEUR N'EST PAS CE QUE LA MARCHANDISE COÛTE. La migration de
-- réception ne portait aucune trace du transport, de la douane ou du
-- dédouanement : tout COGS adopté depuis une réception était donc
-- SYSTÉMATIQUEMENT TROP BAS, ce qui gonfle la marge de chaque produit, le seuil
-- de rentabilité et les relevés investisseurs. Pour un importateur, c'est le
-- plus gros écart de justesse du modèle.
--
-- ET LA CASE À COCHER DEVIENT UN RÉGLAGE. `p_adopt_costs` posait la question à
-- qui validait, dans une modale, case décochée : la base de coût de l'entreprise
-- devenait fonction de l'attention de quelqu'un à 23 h sur un quai. Un an de ça
-- donne un `unit_cogs` qui fait une marche aléatoire entre les prix d'achat.
-- C'est une politique comptable : elle se pose une fois, par marché.
--
-- SÛR À APPLIQUER : zéro réception validée en production (0 ligne de registre
-- `reason='reception'`), donc rien à rétro-calculer et aucun COGS déjà écrit par
-- cette voie.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Les frais d'une réception ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reception_costs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reception_id UUID NOT NULL REFERENCES public.receptions(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'other'
    CHECK (kind IN ('freight', 'customs', 'clearing', 'handling', 'other')),
  label        TEXT,
  amount       NUMERIC(12,3) NOT NULL CHECK (amount >= 0),
  created_by   UUID REFERENCES public.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reception_costs_reception_idx
  ON public.reception_costs (reception_id);

COMMENT ON TABLE public.reception_costs IS
  'Frais d''approche : ce qui a été payé pour que la marchandise arrive ici. '
  'Répartis au prorata sur les lignes, ils forment le coût de revient.';

-- LE CRITÈRE DE RÉPARTITION EST UN CHOIX, PAS UN DÉFAUT CACHÉ. Une palette de
-- livres et un carton de jouets ne partagent pas le transport de la même façon ;
-- « par valeur » est le choix courant, « par unité » existe pour le fret au
-- volume.
ALTER TABLE public.receptions
  ADD COLUMN IF NOT EXISTS fee_basis TEXT NOT NULL DEFAULT 'value'
    CHECK (fee_basis IN ('value', 'units'));

-- LE CHIFFRE QUI DEVIENT LE COGS. `unit_cost` reste le prix du fournisseur —
-- histoire permanente, jamais réécrite ; `landed_unit_cost` y ajoute la part de
-- frais de la ligne.
ALTER TABLE public.reception_lines
  ADD COLUMN IF NOT EXISTS landed_unit_cost NUMERIC(12,3);

COMMENT ON COLUMN public.reception_lines.landed_unit_cost IS
  'Prix fournisseur + part des frais d''approche, par unité. Écrit au moment de '
  'la validation. C''est CE chiffre qui alimente unit_cogs, jamais unit_cost.';

-- ── 2 · La répartition, sans millième perdu ────────────────────────────────
--
-- TOUT SE CALCULE EN MILLIÈMES, puis la méthode du plus grand reste distribue
-- les quelques millièmes qui restent. Arrondir chaque part séparément perdrait
-- un millième (1 499,999 au lieu de 1 500,000), et ce millième manquant rendrait
-- le rapprochement contre la facture faux pour toujours.
--
-- Le miroir TypeScript est `src/lib/receptions/landed.ts` : l'écran montre la
-- répartition avant de valider, la base la refait seule au moment d'écrire. Les
-- deux doivent donner le même résultat — si l'un change, l'autre change.

CREATE OR REPLACE FUNCTION public.allocate_reception_fees(p_reception_id UUID)
RETURNS TABLE (line_id UUID, share NUMERIC)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH rec AS (
    SELECT fee_basis FROM receptions WHERE id = p_reception_id
  ),
  fees AS (
    SELECT COALESCE(ROUND(SUM(amount) * 1000), 0)::BIGINT AS total_m
      FROM reception_costs WHERE reception_id = p_reception_id
  ),
  w AS (
    SELECT l.id,
           CASE
             WHEN COALESCE(l.received_qty, 0) <= 0 THEN 0
             WHEN (SELECT fee_basis FROM rec) = 'units'
               THEN ROUND(l.received_qty * 1000)
             -- Une ligne sans prix ne pèse rien dans une répartition par valeur,
             -- parce qu'elle n'a pas de valeur — pas parce qu'elle vaut zéro.
             ELSE ROUND(COALESCE(l.unit_cost, 0) * l.received_qty * 1000)
           END::BIGINT AS weight
      FROM reception_lines l
     WHERE l.reception_id = p_reception_id
  ),
  tot AS (SELECT NULLIF(SUM(weight), 0) AS sw FROM w),
  exact AS (
    SELECT w.id, ((SELECT total_m FROM fees) * w.weight)::NUMERIC / (SELECT sw FROM tot) AS raw
      FROM w WHERE (SELECT sw FROM tot) IS NOT NULL
  ),
  f AS (SELECT id, FLOOR(raw)::BIGINT AS fl, raw - FLOOR(raw) AS rem FROM exact),
  d AS (SELECT (SELECT total_m FROM fees) - COALESCE(SUM(fl), 0) AS deficit FROM f),
  ranked AS (SELECT id, fl, ROW_NUMBER() OVER (ORDER BY rem DESC, id) AS rn FROM f)
  SELECT id,
         (fl + CASE WHEN rn <= (SELECT deficit FROM d) THEN 1 ELSE 0 END)::NUMERIC / 1000
    FROM ranked;
$$;

REVOKE ALL ON FUNCTION public.allocate_reception_fees(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_reception_fees(UUID) TO authenticated;

-- ── 3 · RLS des frais ──────────────────────────────────────────────────────
-- Un frais est une information d'ARGENT : même porte que les paiements, donc
-- pas pour l'agent d'entrepôt.

ALTER TABLE public.reception_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reception_costs_all ON public.reception_costs;
CREATE POLICY reception_costs_all ON public.reception_costs FOR ALL TO authenticated
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reception_costs TO authenticated;
REVOKE ALL ON public.reception_costs FROM anon;

-- ── 4 · Valider : le coût de revient, et la politique du marché ────────────
--
-- LA SIGNATURE CHANGE, DONC ON RE-RÉVOQUE. `DROP FUNCTION` remet l'ACL à zéro et
-- rouvre l'exécution à `anon` (note « DROP FUNCTION resets grants ») : le REVOKE
-- qui suit le CREATE n'est pas décoratif.

DROP FUNCTION IF EXISTS public.post_reception(UUID, UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION public.post_reception(
  p_reception_id UUID,
  p_actor_id     UUID
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
  v_fees         NUMERIC(14,3) := 0;
  v_lines        INTEGER := 0;
  v_costs        INTEGER := 0;
  v_adopt        BOOLEAN;
  v_stock_before INTEGER;
  v_cogs_before  NUMERIC(10,3);
  v_landed       NUMERIC(12,3);
BEGIN
  -- L'acteur EST la session. Forme stricte : `auth.uid() IS NULL` refuse aussi.
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

  -- LA POLITIQUE DE COÛT DU MARCHÉ, pas une case cochée sur ce document-ci.
  -- Absente, elle vaut FAUX : on n'allume pas une réécriture du P&L par défaut.
  SELECT COALESCE((value)::text = 'true', FALSE) INTO v_adopt
    FROM settings
   WHERE market_id = v_rec.market_id AND key = 'costing_update_on_settle';
  v_adopt := COALESCE(v_adopt, FALSE);

  SELECT COALESCE(SUM(amount), 0) INTO v_fees
    FROM reception_costs WHERE reception_id = p_reception_id;

  FOR v_line IN
    SELECT l.*, p.market_id AS product_market, p.name AS product_name,
           p.current_stock AS product_stock, p.unit_cogs AS product_cogs,
           v.kind AS variant_kind, v.product_id AS variant_product,
           COALESCE(s.share, 0) AS fee_share
      FROM reception_lines l
      JOIN products p ON p.id = l.product_id
      LEFT JOIN product_variants v ON v.id = l.variant_id
      -- La fonction ensembliste est évaluée UNE fois dans le FROM : pas de
      -- table temporaire, pas de ON COMMIT DROP à surveiller.
      LEFT JOIN allocate_reception_fees(p_reception_id) s ON s.line_id = l.id
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
      IF v_line.variant_kind <> 'attribute' THEN
        RAISE EXCEPTION 'On ne reçoit pas un palier de quantité, mais un objet'
          USING DETAIL = '{"code":"BAD_LINE"}';
      END IF;
    END IF;

    -- LA LIGNE DE SITE. Le trigger de ventilation fait un UPDATE : sans cette
    -- ligne, le bâtiment est manqué en silence.
    INSERT INTO product_site_stock (product_id, variant_id, warehouse_id, current_stock)
    VALUES (v_line.product_id, v_line.variant_id, v_rec.warehouse_id, 0)
    ON CONFLICT (product_id, variant_id, warehouse_id) DO NOTHING;

    UPDATE products
       SET current_stock = current_stock + v_line.received_qty, updated_at = now()
     WHERE id = v_line.product_id
    RETURNING current_stock INTO v_new_total;

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

    -- LE COÛT DE REVIENT : prix fournisseur + part des frais, par unité. Sans
    -- prix fournisseur il reste NULL — on ne devine pas un coût à partir des
    -- seuls frais.
    v_landed := NULL;
    IF v_line.unit_cost IS NOT NULL THEN
      v_landed := ROUND(v_line.unit_cost + (v_line.fee_share / v_line.received_qty), 3);
    END IF;
    UPDATE reception_lines SET landed_unit_cost = v_landed WHERE id = v_line.id;

    -- Moyenne pondérée sur le stock AVANT cette réception, à partir du COÛT DE
    -- REVIENT et jamais du seul prix fournisseur.
    IF v_adopt AND v_landed IS NOT NULL THEN
      IF v_line.variant_id IS NULL THEN
        v_stock_before := v_line.product_stock;
        v_cogs_before  := v_line.product_cogs;
        UPDATE products
           SET unit_cogs = ROUND(
                 ((GREATEST(v_stock_before, 0) * v_cogs_before)
                   + (v_line.received_qty * v_landed))
                 / NULLIF(GREATEST(v_stock_before, 0) + v_line.received_qty, 0), 3),
               updated_at = now()
         WHERE id = v_line.product_id;
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

  UPDATE receptions
     SET status = 'posted', posted_at = now(), posted_by = p_actor_id, updated_at = now()
   WHERE id = p_reception_id;

  RETURN json_build_object(
    'reception_id',  p_reception_id,
    'reference',     v_rec.reference,
    'warehouse_id',  v_rec.warehouse_id,
    'lines',         v_lines,
    'units',         v_units,
    'damaged',       v_damaged,
    'value',         v_value,
    'fees',          v_fees,
    'landed_value',  v_value + v_fees,
    'costs_adopted', v_costs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.post_reception(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_reception(UUID, UUID) TO authenticated;
