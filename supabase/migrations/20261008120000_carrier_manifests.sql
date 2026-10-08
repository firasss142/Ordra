-- Manifestes transporteur — la liste retour scannée jusqu'au bout, la liste
-- d'enlèvement qu'on défait. Plan : plans/xdelivery-manifests.md ; contrat
-- d'API : docs/xdelivery-manifests.md. Test : supabase/tests/carrier_manifests_test.sql.
--
-- POURQUOI
--   * Les retours étaient scannés au hasard, sans ligne d'arrivée. X-Delivery (et
--     la plupart des transporteurs tunisiens) remet chaque jour un « manifeste
--     retour » : on le scanne jusqu'au bout et ce qui manque se voit.
--   * La demande d'enlèvement se fait par lot, à la demande ; supprimer une liste
--     (ou en retirer des colis) — chez nous ou sur leur portail — ramène les
--     commandes à `uploaded`, stock rendu comme un dé-scan.
--
-- CE QUE CETTE MIGRATION AJOUTE
--   1. Trois tables, lecture seule par marché ; toute écriture passe par les RPC
--      ci-dessous ou par le service role.
--   2. `get_user_warehouse_id()` — le bâtiment de l'appelant, pour la RLS.
--   3. `_reverse_scan_stock` — le cœur du dé-scan, sorti de `unscan_order` pour être
--      partagé avec `release_pickup_parcel` : UN seul endroit écrit `scan_reversal`.
--   4. `unscan_order` — même contrat ; un colis X-Delivery jamais demandé (slug
--      `CREATED`) se dé-scanne enfin ; sur une liste d'enlèvement (`PENDING`), refus
--      explicite.
--   5. `release_pickup_parcel` (service role) — scanné → uploadé quand la liste
--      d'enlèvement est défaite.
--   6. `scan_manifest_return`, `mark_manifest_return_damaged`, `close_return_manifest`.
--
-- AUCUN nouveau motif de registre : les écritures utilisent `scan_reversal`,
-- `returned` et `damaged_writeoff`, déjà dans inventory_log_reason_check.

-- ── 1 · Les tables ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.carrier_manifests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id          UUID NOT NULL REFERENCES public.markets(id),
  carrier_id         UUID NOT NULL REFERENCES public.carriers(id),
  -- Le bâtiment du compte transporteur ; NULL si le compte n'en a pas.
  warehouse_id       UUID REFERENCES public.warehouses(id),
  kind               TEXT NOT NULL CHECK (kind IN ('pickup', 'return', 'exchange')),
  -- Leur identifiant interne (`_id`) : la clé de rapprochement.
  external_id        TEXT NOT NULL,
  -- Le numéro imprimé en code-barres sur la feuille (listes retour).
  code               TEXT,
  carrier_status     TEXT,
  carrier_created_at TIMESTAMPTZ,
  -- Une liste d'enlèvement demandée depuis Ordra (NULL = faite sur leur portail).
  requested_by       UUID REFERENCES public.users(id),
  -- Une liste d'enlèvement supprimée. Jamais de DELETE : la suppression est un tampon.
  deleted_at         TIMESTAMPTZ,
  deleted_by         UUID REFERENCES public.users(id),
  deleted_source     TEXT CHECK (deleted_source IN ('ordra', 'carrier')),
  -- Une liste retour clôturée par l'entrepôt (les lignes encore attendues = manquants).
  closed_at          TIMESTAMPTZ,
  closed_by          UUID REFERENCES public.users(id),
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, external_id)
);

CREATE INDEX IF NOT EXISTS carrier_manifests_market_kind
  ON public.carrier_manifests (market_id, kind, carrier_created_at DESC);
CREATE INDEX IF NOT EXISTS carrier_manifests_code
  ON public.carrier_manifests (code) WHERE code IS NOT NULL;

COMMENT ON TABLE public.carrier_manifests IS
  'Listes du transporteur : enlèvement (pickup), retour, échange. Écrites par la synchro '
  '(service role) et les RPC de manifeste ; jamais supprimées. docs/xdelivery-manifests.md';

CREATE TABLE IF NOT EXISTS public.carrier_manifest_parcels (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id        UUID NOT NULL REFERENCES public.carrier_manifests(id),
  -- NULL : le colis n'est pas une commande Ordra (Converty en crée encore la plupart).
  order_id           UUID REFERENCES public.orders(id),
  barcode            TEXT NOT NULL,
  external_parcel_id TEXT,
  state              TEXT NOT NULL DEFAULT 'expected'
                     CHECK (state IN ('expected', 'received', 'damaged', 'removed')),
  received_at        TIMESTAMPTZ,
  received_by        UUID REFERENCES public.users(id),
  removed_at         TIMESTAMPTZ,
  removed_source     TEXT CHECK (removed_source IN ('ordra', 'carrier')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (manifest_id, barcode)
);

CREATE INDEX IF NOT EXISTS carrier_manifest_parcels_order
  ON public.carrier_manifest_parcels (order_id) WHERE order_id IS NOT NULL;

COMMENT ON COLUMN public.carrier_manifest_parcels.state IS
  'expected = sur la liste ; received/damaged = scanné à l''entrepôt (liste retour) ; '
  'removed = retiré d''une liste d''enlèvement.';

CREATE TABLE IF NOT EXISTS public.return_set_asides (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id            UUID NOT NULL REFERENCES public.markets(id),
  warehouse_id         UUID REFERENCES public.warehouses(id),
  order_id             UUID NOT NULL REFERENCES public.orders(id),
  scanned_code         TEXT NOT NULL,
  -- La liste ouverte qui l'a refusé.
  manifest_id          UUID REFERENCES public.carrier_manifests(id),
  set_aside_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  set_aside_by         UUID REFERENCES public.users(id),
  resolved_at          TIMESTAMPTZ,
  resolved_manifest_id UUID REFERENCES public.carrier_manifests(id)
);

-- Un colis n'est « de côté » qu'une fois à la fois, quel que soit le code scanné.
CREATE UNIQUE INDEX IF NOT EXISTS return_set_asides_one_open
  ON public.return_set_asides (order_id) WHERE resolved_at IS NULL;

COMMENT ON TABLE public.return_set_asides IS
  'Colis retour refusé parce qu''absent de la liste ouverte : mis de côté, résolu quand une '
  'liste suivante le contient et qu''il y est scanné.';

-- ── 2 · Lecture par marché, aucune écriture directe ─────────────────────────

CREATE OR REPLACE FUNCTION public.get_user_warehouse_id()
RETURNS UUID
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT warehouse_id FROM users WHERE id = auth.uid();
$function$;

ALTER TABLE public.carrier_manifests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_manifest_parcels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_set_asides        ENABLE ROW LEVEL SECURITY;

-- Agent d'entrepôt : son marché ET son bâtiment (une liste sans bâtiment est à tous
-- ceux du marché). Sans bâtiment, il ne lit rien : non affecté ≠ sans restriction.
DROP POLICY IF EXISTS carrier_manifests_select ON public.carrier_manifests;
CREATE POLICY carrier_manifests_select ON public.carrier_manifests FOR SELECT TO authenticated
USING (
  (SELECT get_user_role()) = 'super_admin'
  OR ((SELECT get_user_role()) = 'market_manager'
      AND market_id = (SELECT get_user_market_id()))
  OR ((SELECT get_user_role()) = 'warehouse_agent'
      AND market_id = (SELECT get_user_market_id())
      AND (SELECT get_user_warehouse_id()) IS NOT NULL
      AND (warehouse_id IS NULL OR warehouse_id = (SELECT get_user_warehouse_id())))
);

DROP POLICY IF EXISTS carrier_manifest_parcels_select ON public.carrier_manifest_parcels;
CREATE POLICY carrier_manifest_parcels_select ON public.carrier_manifest_parcels FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.carrier_manifests m WHERE m.id = manifest_id));

DROP POLICY IF EXISTS return_set_asides_select ON public.return_set_asides;
CREATE POLICY return_set_asides_select ON public.return_set_asides FOR SELECT TO authenticated
USING (
  (SELECT get_user_role()) = 'super_admin'
  OR ((SELECT get_user_role()) = 'market_manager'
      AND market_id = (SELECT get_user_market_id()))
  OR ((SELECT get_user_role()) = 'warehouse_agent'
      AND market_id = (SELECT get_user_market_id())
      AND (SELECT get_user_warehouse_id()) IS NOT NULL
      AND (warehouse_id IS NULL OR warehouse_id = (SELECT get_user_warehouse_id())))
);

-- Sans politique d'écriture, un UPDATE toucherait 0 ligne SANS erreur : on retire
-- le privilège pour qu'une tentative échoue franchement.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.carrier_manifests        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.carrier_manifest_parcels FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.return_set_asides        FROM anon, authenticated;
REVOKE ALL ON public.carrier_manifests, public.carrier_manifest_parcels, public.return_set_asides FROM anon;

-- ── 3 · Le cœur du dé-scan, partagé ────────────────────────────────────────
--
-- Rend exactement ce que le scan avait pris (mêmes lignes, même grain, variante
-- comprise), passe la commande à `uploaded`, libère le sticker et écrit
-- l'historique. L'APPELANT a déjà verrouillé la commande et vérifié qui agit et
-- l'état : ce cœur ne décide rien. Appelable par personne d'autre que les RPC.

CREATE OR REPLACE FUNCTION public._reverse_scan_stock(
  p_order_id uuid, p_actor_id uuid, p_note text, p_actor_type text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_site UUID;
  v_sticker TEXT;
  v_product_id UUID;
  v_stock_after INTEGER;
  v_primary_after INTEGER;
  v_log_id UUID;
  v_first_log_id UUID;
  v_history_id UUID;
  v_line RECORD;
  v_lines INTEGER := 0;
  v_label TEXT;
BEGIN
  SELECT warehouse_id, carrier_sticker_ref, product_id
  INTO v_site, v_sticker, v_product_id
  FROM orders WHERE id = p_order_id;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Order has no linked product for stock adjustment'
      USING DETAIL = '{"code":"NO_PRODUCT"}';
  END IF;

  v_label := COALESCE('Dé-scan · sticker ' || v_sticker, 'Dé-scan') ||
             COALESCE(' · ' || NULLIF(btrim(p_note), ''), '');

  FOR v_line IN
    SELECT l.product_id, l.quantity, l.is_primary, l.variant_id
    FROM public.order_stock_lines(p_order_id) l
    ORDER BY l.is_primary DESC, l.product_id, l.variant_id NULLS FIRST
  LOOP
    v_lines := v_lines + 1;
    UPDATE products
    SET current_stock = current_stock + v_line.quantity
    WHERE id = v_line.product_id
    RETURNING current_stock INTO v_stock_after;

    INSERT INTO inventory_log (
      product_id, variant_id, order_id, change, reason, balance_after,
      is_damaged, actor_id, note, warehouse_id
    )
    VALUES (
      v_line.product_id, v_line.variant_id, p_order_id, v_line.quantity,
      'scan_reversal', v_stock_after, false, p_actor_id, v_label, v_site
    )
    RETURNING id INTO v_log_id;

    IF v_first_log_id IS NULL THEN v_first_log_id := v_log_id; END IF;
    IF v_line.is_primary THEN v_primary_after := v_stock_after; END IF;
  END LOOP;

  UPDATE orders
  SET status = 'uploaded',
      -- Libéré pour que l'index unique n'interdise pas de recoller un sticker,
      -- mais consigné dans l'historique : ce numéro a existé sur ce colis.
      carrier_sticker_ref = NULL,
      sticker_bind_state = NULL,
      sticker_bind_checked_at = NULL,
      carrier_reference_actual = NULL
  WHERE id = p_order_id;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, 'scanned', 'uploaded', p_actor_id, p_actor_type, v_label)
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', 'uploaded',
    'stock_after', COALESCE(v_primary_after, v_stock_after),
    'sticker_ref', v_sticker,
    'history_id', v_history_id,
    'inventory_log_id', v_first_log_id,
    'lines', v_lines
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._reverse_scan_stock(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ── 4 · unscan_order : même contrat, cœur partagé, X-Delivery compris ─────────
--
-- CREATE OR REPLACE conserve les privilèges existants (voir la note
-- « DROP FUNCTION resets grants »). Seule différence de comportement : le slug.
-- Avant, tout slug autre que Darb `pending` refusait — donc un colis X-Delivery,
-- dont la synchro écrit `CREATED` dès l'envoi, ne pouvait JAMAIS être dé-scanné.

CREATE OR REPLACE FUNCTION public.unscan_order(
  p_order_id uuid, p_actor_id uuid, p_note text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_status order_status;
  v_market_id UUID;
  v_site UUID;
  v_slug TEXT;
  v_product_id UUID;
  v_actor_role TEXT;
  v_actor_market UUID;
  v_actor_site UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Un dé-scan ne peut pas être porté au crédit d''un autre opérateur'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;

  SELECT role, market_id, warehouse_id INTO v_actor_role, v_actor_market, v_actor_site
  FROM users WHERE id = p_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_NOT_FOUND"}';
  END IF;
  IF v_actor_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Actor role % cannot un-scan', v_actor_role
      USING ERRCODE = '42501', DETAIL = '{"code":"FORBIDDEN"}';
  END IF;
  IF v_actor_role = 'warehouse_agent' AND v_actor_site IS NULL THEN
    RAISE EXCEPTION 'Votre compte n''est rattaché à aucun bâtiment'
      USING ERRCODE = '42501', DETAIL = '{"code":"NO_SITE_ASSIGNED"}';
  END IF;

  SELECT status, market_id, warehouse_id, carrier_status_slug, product_id
  INTO v_status, v_market_id, v_site, v_slug, v_product_id
  FROM orders WHERE id = p_order_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id
      USING DETAIL = '{"code":"ORDER_NOT_FOUND"}';
  END IF;
  IF v_actor_role <> 'super_admin' AND v_actor_market IS DISTINCT FROM v_market_id THEN
    RAISE EXCEPTION 'Order belongs to a different market'
      USING DETAIL = '{"code":"MARKET_MISMATCH"}';
  END IF;
  IF v_actor_role = 'warehouse_agent'
     AND v_actor_site IS NOT NULL AND v_site IS NOT NULL
     AND v_actor_site IS DISTINCT FROM v_site THEN
    RAISE EXCEPTION 'Ce colis appartient à un autre bâtiment'
      USING ERRCODE = '42501', DETAIL = '{"code":"WRONG_SITE"}';
  END IF;
  IF v_status <> 'scanned' THEN
    RAISE EXCEPTION 'Seul un colis scanné et non encore réservé peut être dé-scanné (état : %)', v_status
      USING DETAIL = '{"code":"INVALID_STATUS"}';
  END IF;
  -- X-Delivery `PENDING` = sur une liste d'enlèvement : la liste doit être défaite
  -- d'abord (chez eux), sinon leur livreur viendrait chercher un colis « uploadé ».
  IF v_slug = 'PENDING' THEN
    RAISE EXCEPTION 'Ce colis est sur une liste d''enlèvement X-Delivery — retirez-le de la liste'
      USING DETAIL = '{"code":"ON_PICKUP_LIST"}';
  END IF;
  -- Darb `pending` et X-Delivery `CREATED` : le transporteur n'a encore rien fait.
  IF v_slug IS NOT NULL AND v_slug NOT IN ('pending', 'CREATED') THEN
    RAISE EXCEPTION 'Le transporteur a déjà pris ce colis en charge (%) — à régler avec lui', v_slug
      USING DETAIL = '{"code":"TAKEN_BY_CARRIER"}';
  END IF;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Order has no linked product for stock adjustment'
      USING DETAIL = '{"code":"NO_PRODUCT"}';
  END IF;

  RETURN public._reverse_scan_stock(
    p_order_id, p_actor_id, p_note,
    CASE WHEN v_actor_role = 'warehouse_agent' THEN 'agent' ELSE 'manager' END
  );
END;
$function$;

-- ── 5 · release_pickup_parcel : la liste d'enlèvement est défaite ────────────
--
-- Service role seulement : la route a vérifié qui agit (rôle, bâtiment) ET que
-- X-Delivery tient de nouveau le colis pour `CREATED` avant d'appeler ; la synchro
-- appelle avec un acteur NULL quand la liste a été défaite sur leur portail.
-- Idempotente : une commande qui n'est plus `scanned` est rapportée, pas refusée —
-- la synchro repasse toutes les dix minutes.

CREATE OR REPLACE FUNCTION public.release_pickup_parcel(
  p_order_id uuid, p_actor_id uuid DEFAULT NULL, p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_status order_status;
  v_role TEXT;
  v_result JSON;
BEGIN
  SELECT status INTO v_status FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id
      USING DETAIL = '{"code":"ORDER_NOT_FOUND"}';
  END IF;

  IF v_status <> 'scanned' THEN
    RETURN json_build_object('order_id', p_order_id, 'released', false, 'status', v_status);
  END IF;

  IF p_actor_id IS NOT NULL THEN
    SELECT role INTO v_role FROM users WHERE id = p_actor_id;
    IF v_role IS NULL THEN
      RAISE EXCEPTION 'Actor not found: %', p_actor_id
        USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_NOT_FOUND"}';
    END IF;
  END IF;

  v_result := public._reverse_scan_stock(
    p_order_id, p_actor_id,
    COALESCE(NULLIF(btrim(p_note), ''), 'Retiré de la liste d''enlèvement'),
    CASE WHEN p_actor_id IS NULL THEN 'system'
         WHEN v_role = 'warehouse_agent' THEN 'agent'
         ELSE 'manager' END
  );

  -- Chez X-Delivery le colis est de nouveau « en attente » : le slug le dit, et un
  -- prochain scan de sortie le remettra dans une prochaine liste.
  UPDATE orders SET carrier_status_slug = 'CREATED' WHERE id = p_order_id;

  RETURN (v_result::jsonb || jsonb_build_object('released', true))::json;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_pickup_parcel(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_pickup_parcel(uuid, uuid, text) TO service_role;

-- ── 6 · La liste retour ─────────────────────────────────────────────────────

-- Qui peut agir sur une liste : rôle d'entrepôt, même marché, et pour un agent
-- son propre bâtiment. Rend le rôle. Interne.
CREATE OR REPLACE FUNCTION public._assert_manifest_actor(
  p_actor_id uuid, p_market_id uuid, p_warehouse_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_role TEXT;
  v_market UUID;
  v_site UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Un scan ne peut pas être porté au crédit d''un autre opérateur'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;

  SELECT role, market_id, warehouse_id INTO v_role, v_market, v_site
  FROM users WHERE id = p_actor_id AND is_active;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_NOT_FOUND"}';
  END IF;
  IF v_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Le rôle % ne reçoit pas les retours', v_role
      USING ERRCODE = '42501', DETAIL = '{"code":"FORBIDDEN"}';
  END IF;
  IF v_role = 'warehouse_agent' AND v_site IS NULL THEN
    RAISE EXCEPTION 'Votre compte n''est rattaché à aucun bâtiment'
      USING ERRCODE = '42501', DETAIL = '{"code":"NO_SITE_ASSIGNED"}';
  END IF;
  IF v_role <> 'super_admin' AND v_market IS DISTINCT FROM p_market_id THEN
    RAISE EXCEPTION 'Cette liste appartient à un autre marché'
      USING ERRCODE = '42501', DETAIL = '{"code":"MARKET_MISMATCH"}';
  END IF;
  IF v_role = 'warehouse_agent' AND p_warehouse_id IS NOT NULL AND v_site <> p_warehouse_id THEN
    RAISE EXCEPTION 'Cette liste appartient à un autre bâtiment'
      USING ERRCODE = '42501', DETAIL = '{"code":"WRONG_SITE"}';
  END IF;
  RETURN v_role;
END;
$function$;

REVOKE ALL ON FUNCTION public._assert_manifest_actor(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Les compteurs que toute réponse de scan rend : la barre de progression et « De côté ».
CREATE OR REPLACE FUNCTION public._manifest_counts(p_manifest_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT jsonb_build_object(
    'received', (SELECT count(*) FROM carrier_manifest_parcels
                 WHERE manifest_id = p_manifest_id AND state IN ('received', 'damaged')),
    'expected', (SELECT count(*) FROM carrier_manifest_parcels
                 WHERE manifest_id = p_manifest_id AND state <> 'removed'),
    'set_aside', (SELECT count(*) FROM return_set_asides s, carrier_manifests m
                  WHERE m.id = p_manifest_id AND s.market_id = m.market_id
                    AND s.warehouse_id IS NOT DISTINCT FROM m.warehouse_id
                    AND s.resolved_at IS NULL)
  );
$function$;

REVOKE ALL ON FUNCTION public._manifest_counts(uuid) FROM PUBLIC, anon, authenticated, service_role;

/*
 * Un scan sur la liste retour ouverte. `p_code` = leur code-barres OU notre QR
 * (l'id de commande) ; espaces ignorés.
 *
 * result :
 *   received           — sur la liste, commande Ordra : stock rendu (bon état)
 *   received_unlinked  — sur la liste, pas une commande Ordra : coché, pas de stock
 *   already_received   — déjà scanné sur cette liste : rien ne bouge
 *   already_returned   — sur la liste mais déjà rentré (ancien écran Retours) : coché
 *   not_on_manifest    — commande Ordra absente de la liste : mise de côté
 *   unknown_code       — rien ne correspond : rien n'est écrit (un code mal lu)
 * Refus (exception, DETAIL.code) : DELIVERED_CONFLICT, INVALID_STATUS,
 * MANIFEST_NOT_FOUND, NOT_A_RETURN_MANIFEST, BAD_CODE, et les refus d'acteur.
 */
CREATE OR REPLACE FUNCTION public.scan_manifest_return(
  p_manifest_id uuid, p_code text, p_actor_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_m carrier_manifests%ROWTYPE;
  v_code TEXT;
  v_line carrier_manifest_parcels%ROWTYPE;
  v_order_id UUID;
  v_status order_status;
  v_customer TEXT;
  v_result TEXT;
BEGIN
  SELECT * INTO v_m FROM carrier_manifests WHERE id = p_manifest_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Liste introuvable' USING DETAIL = '{"code":"MANIFEST_NOT_FOUND"}';
  END IF;

  PERFORM public._assert_manifest_actor(p_actor_id, v_m.market_id, v_m.warehouse_id);

  IF v_m.kind NOT IN ('return', 'exchange') THEN
    RAISE EXCEPTION 'Ce n''est pas une liste retour' USING DETAIL = '{"code":"NOT_A_RETURN_MANIFEST"}';
  END IF;

  v_code := regexp_replace(COALESCE(p_code, ''), '\s', '', 'g');
  IF v_code = '' THEN
    RAISE EXCEPTION 'Code vide' USING DETAIL = '{"code":"BAD_CODE"}';
  END IF;

  -- La ligne de CETTE liste : par leur code-barres, ou par notre QR.
  SELECT * INTO v_line FROM carrier_manifest_parcels
  WHERE manifest_id = p_manifest_id
    AND state <> 'removed'
    AND (barcode = v_code OR order_id::TEXT = lower(v_code))
  ORDER BY (barcode = v_code) DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT id INTO v_order_id FROM orders
    WHERE market_id = v_m.market_id
      AND (tracking_number = v_code OR id::TEXT = lower(v_code))
    LIMIT 1;

    IF v_order_id IS NULL THEN
      RETURN (jsonb_build_object('result', 'unknown_code', 'code', v_code)
              || public._manifest_counts(p_manifest_id))::json;
    END IF;

    INSERT INTO return_set_asides (market_id, warehouse_id, order_id, scanned_code, manifest_id, set_aside_by)
    VALUES (v_m.market_id, v_m.warehouse_id, v_order_id, v_code, p_manifest_id, p_actor_id)
    ON CONFLICT (order_id) WHERE resolved_at IS NULL DO NOTHING;

    RETURN (jsonb_build_object('result', 'not_on_manifest', 'order_id', v_order_id, 'code', v_code)
            || public._manifest_counts(p_manifest_id))::json;
  END IF;

  IF v_line.state IN ('received', 'damaged') THEN
    RETURN (jsonb_build_object('result', 'already_received', 'parcel_id', v_line.id,
                               'order_id', v_line.order_id, 'barcode', v_line.barcode)
            || public._manifest_counts(p_manifest_id))::json;
  END IF;

  IF v_line.order_id IS NULL THEN
    v_result := 'received_unlinked';
  ELSE
    SELECT status, customer_name INTO v_status, v_customer
    FROM orders WHERE id = v_line.order_id FOR UPDATE;

    IF v_status = 'returned' THEN
      v_result := 'already_returned';
    ELSIF v_status = 'delivered' THEN
      -- Décision 7 du plan d'intégration : un colis livré reste livré. Revenu
      -- physiquement sur une liste retour, c'est au responsable de trancher.
      RAISE EXCEPTION 'Ce colis est « livré » dans Ordra — à régler par le responsable'
        USING DETAIL = '{"code":"DELIVERED_CONFLICT"}';
    ELSIF v_status IN ('scanned', 'at_carrier', 'dispatched', 'deposit', 'unverified',
                       'in_transit', 'out_for_delivery', 'delivery_delayed', 'returning') THEN
      -- La liste retour EST la parole du transporteur : la synchro a simplement du
      -- retard. On trace le passage avant le scan habituel.
      UPDATE orders SET status = 'to_be_returned' WHERE id = v_line.order_id;
      INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
      VALUES (v_line.order_id, v_status, 'to_be_returned', p_actor_id, 'system',
              'Sur la liste retour ' || COALESCE(v_m.code, v_m.external_id));
      v_status := 'to_be_returned';
    END IF;

    IF v_status = 'to_be_returned' THEN
      PERFORM public.scan_return_in(v_line.order_id, p_actor_id, false, NULL, NULL, NULL);
      v_result := 'received';
    ELSIF v_result IS NULL THEN
      RAISE EXCEPTION 'Cette commande ne peut pas rentrer en retour (état : %)', v_status
        USING DETAIL = '{"code":"INVALID_STATUS"}';
    END IF;

    UPDATE return_set_asides
    SET resolved_at = now(), resolved_manifest_id = p_manifest_id
    WHERE order_id = v_line.order_id AND resolved_at IS NULL;
  END IF;

  UPDATE carrier_manifest_parcels
  SET state = 'received', received_at = now(), received_by = p_actor_id
  WHERE id = v_line.id;

  RETURN (jsonb_build_object('result', v_result, 'parcel_id', v_line.id,
                             'order_id', v_line.order_id, 'barcode', v_line.barcode,
                             'customer_name', v_customer)
          || public._manifest_counts(p_manifest_id))::json;
END;
$function$;

/*
 * « Endommagé » sur un colis déjà scanné en bon état. Le registre est en ajout
 * seul : on n'efface pas l'entrée « bon état », on l'annule (−qty, `returned`) et on
 * écrit la casse exactement comme un scan endommagé (+qty, `damaged_writeoff`,
 * is_damaged). Une seule fois, et seulement tant que la liste est ouverte.
 * Sens unique : défaire une casse demanderait une ligne endommagée NÉGATIVE, que le
 * déclencheur du registre ajouterait à la casse (ABS) — donc refusé, pas à moitié fait.
 */
CREATE OR REPLACE FUNCTION public.mark_manifest_return_damaged(
  p_parcel_id uuid, p_actor_id uuid, p_return_reason return_reason, p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_line carrier_manifest_parcels%ROWTYPE;
  v_m carrier_manifests%ROWTYPE;
  v_status order_status;
  v_note TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_line_s RECORD;
  v_stock INTEGER;
  v_after INTEGER;
  v_lines INTEGER := 0;
BEGIN
  SELECT * INTO v_line FROM carrier_manifest_parcels WHERE id = p_parcel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ligne introuvable' USING DETAIL = '{"code":"PARCEL_NOT_FOUND"}';
  END IF;
  SELECT * INTO v_m FROM carrier_manifests WHERE id = v_line.manifest_id;

  PERFORM public._assert_manifest_actor(p_actor_id, v_m.market_id, v_m.warehouse_id);

  IF p_return_reason IS NULL THEN
    RAISE EXCEPTION 'Le motif de casse est obligatoire' USING DETAIL = '{"code":"REASON_REQUIRED"}';
  END IF;
  IF p_return_reason = 'other' AND v_note IS NULL THEN
    RAISE EXCEPTION 'Une note est obligatoire pour « autre »' USING DETAIL = '{"code":"NOTE_REQUIRED"}';
  END IF;
  IF v_m.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'La liste est clôturée' USING DETAIL = '{"code":"MANIFEST_CLOSED"}';
  END IF;
  IF v_line.state = 'damaged' THEN
    RAISE EXCEPTION 'Déjà compté endommagé' USING DETAIL = '{"code":"ALREADY_DAMAGED"}';
  END IF;
  IF v_line.state <> 'received' OR v_line.order_id IS NULL THEN
    RAISE EXCEPTION 'Seul un colis Ordra reçu sur cette liste peut être déclaré endommagé'
      USING DETAIL = '{"code":"NOT_RECEIVED"}';
  END IF;

  SELECT status INTO v_status FROM orders WHERE id = v_line.order_id FOR UPDATE;
  IF v_status <> 'returned' THEN
    RAISE EXCEPTION 'La commande n''est pas rentrée (état : %)', v_status
      USING DETAIL = '{"code":"INVALID_STATUS"}';
  END IF;

  FOR v_line_s IN
    SELECT l.product_id, l.quantity, l.variant_id
    FROM public.order_stock_lines(v_line.order_id) l
    ORDER BY l.is_primary DESC, l.product_id, l.variant_id NULLS FIRST
  LOOP
    v_lines := v_lines + 1;
    SELECT current_stock INTO v_stock FROM products WHERE id = v_line_s.product_id FOR UPDATE;
    IF v_stock < v_line_s.quantity THEN
      RAISE EXCEPTION 'Le stock a déjà bougé depuis le scan — correction impossible ici'
        USING DETAIL = '{"code":"STOCK_MOVED"}';
    END IF;

    UPDATE products SET current_stock = current_stock - v_line_s.quantity
    WHERE id = v_line_s.product_id RETURNING current_stock INTO v_after;
    INSERT INTO inventory_log (product_id, variant_id, order_id, change, reason, balance_after,
                               is_damaged, actor_id, note)
    VALUES (v_line_s.product_id, v_line_s.variant_id, v_line.order_id, -v_line_s.quantity,
            'returned', v_after, false, p_actor_id,
            'Retour requalifié endommagé — annule l''entrée en bon état');

    UPDATE products SET damaged_return_count = damaged_return_count + v_line_s.quantity
    WHERE id = v_line_s.product_id RETURNING damaged_return_count INTO v_after;
    INSERT INTO inventory_log (product_id, variant_id, order_id, change, reason, balance_after,
                               is_damaged, actor_id, note, return_reason, return_reason_note)
    VALUES (v_line_s.product_id, v_line_s.variant_id, v_line.order_id, v_line_s.quantity,
            'damaged_writeoff', v_after, true, p_actor_id, 'Scan retour endommagé',
            p_return_reason, v_note);
  END LOOP;

  UPDATE carrier_manifest_parcels SET state = 'damaged' WHERE id = p_parcel_id;

  RETURN (jsonb_build_object('result', 'damaged', 'parcel_id', p_parcel_id,
                             'order_id', v_line.order_id, 'lines', v_lines)
          || public._manifest_counts(v_line.manifest_id))::json;
END;
$function$;

/*
 * « Terminer ». Tamponne la clôture (une seule fois) et rend les lignes encore
 * attendues : ce sont les manquants, qui alimentent l'alerte responsable
 * `return_missing` et restent scannables sur cette liste.
 */
CREATE OR REPLACE FUNCTION public.close_return_manifest(p_manifest_id uuid, p_actor_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_m carrier_manifests%ROWTYPE;
  v_missing JSONB;
BEGIN
  SELECT * INTO v_m FROM carrier_manifests WHERE id = p_manifest_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Liste introuvable' USING DETAIL = '{"code":"MANIFEST_NOT_FOUND"}';
  END IF;

  PERFORM public._assert_manifest_actor(p_actor_id, v_m.market_id, v_m.warehouse_id);

  IF v_m.kind NOT IN ('return', 'exchange') THEN
    RAISE EXCEPTION 'Ce n''est pas une liste retour' USING DETAIL = '{"code":"NOT_A_RETURN_MANIFEST"}';
  END IF;

  IF v_m.closed_at IS NULL THEN
    UPDATE carrier_manifests SET closed_at = now(), closed_by = p_actor_id WHERE id = p_manifest_id;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('parcel_id', id, 'order_id', order_id, 'barcode', barcode)
                            ORDER BY barcode), '[]'::jsonb)
  INTO v_missing
  FROM carrier_manifest_parcels
  WHERE manifest_id = p_manifest_id AND state = 'expected';

  RETURN (jsonb_build_object('manifest_id', p_manifest_id,
                             'missing', v_missing,
                             'missing_count', jsonb_array_length(v_missing))
          || public._manifest_counts(p_manifest_id))::json;
END;
$function$;

REVOKE ALL ON FUNCTION public.scan_manifest_return(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_manifest_return_damaged(uuid, uuid, return_reason, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_return_manifest(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scan_manifest_return(uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_manifest_return_damaged(uuid, uuid, return_reason, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_return_manifest(uuid, uuid) TO authenticated, service_role;
