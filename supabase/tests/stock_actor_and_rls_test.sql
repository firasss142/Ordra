-- Qui a le droit, et au nom de qui.
--
-- CE QUE CE FICHIER PROUVE
--   1. Une RPC de stock ne peut pas être portée au crédit d'un AUTRE opérateur.
--      `scan_order_out`, `unscan_order`, `record_stock_count` et
--      `manual_delete_orders` refusaient déjà ; `scan_return_in` et
--      `scan_received_in` ne refusaient PAS, alors que
--      20260909132021 annonçait noir sur blanc qu'elles recevraient « le même
--      contrôle d'acteur ». La migration promise n'a jamais existé, et les deux
--      fonctions ont été réécrites deux fois depuis sans jamais l'obtenir.
--
--      Ce n'est pas qu'une question de signature au registre : ces fonctions
--      décident du MARCHÉ en lisant `users` par `p_actor_id`. Passer l'id d'un
--      collègue de l'autre marché fait donc évaluer la garde de marché comme si
--      on était lui.
--
--   2. Un `market_manager` ne peut pas supprimer une variante. La politique
--      `product_variants_delete_sa_mm` date du schéma initial ;
--      20260427221856 a resserré INSERT et UPDATE à super_admin et a oublié
--      DELETE. Comme `authenticated` porte le privilège DELETE sur la table, un
--      manager pouvait appeler PostgREST directement et contourner d'un coup le
--      verrou super_admin de la route, son contrôle de stock, et son contrôle
--      de références — et `order_items.variant_id`, `orders.product_variant_id`
--      et `storefront_product_mappings.product_variant_id` sont tous
--      `ON DELETE SET NULL`, donc l'historique perdait le lien en silence.
--
-- TESTÉ SOUS UN VRAI JWT, jamais en propriétaire : `auth.uid()` est NULL sans
-- jeton, et la moitié de ces gardes deviennent alors invisibles. C'est le piège
-- de la note « RLS helpers search_path » et de la note InitPlan.

\set ON_ERROR_STOP on
\i _helpers.sql

\echo ''
\echo '── fixture ────────────────────────────────────────────────────────────'

DO $fixture$
DECLARE
  v_market UUID := '00000000-0000-0000-0000-000000000001';  -- Tunisia
  v_other  UUID := '00000000-0000-0000-0000-000000000002';  -- Libya
  v_sa     UUID := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_mm     UUID := 'aaaaaaaa-0000-4000-8000-000000000002';
  v_wh     UUID := 'aaaaaaaa-0000-4000-8000-000000000003';
  v_tag    TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_prod   UUID := gen_random_uuid();
  v_var    UUID := gen_random_uuid();
  v_site   UUID;
  v_store  UUID;
  v_carrier UUID;
BEGIN
  SELECT id INTO v_site    FROM warehouses  WHERE market_id = v_market AND is_active ORDER BY code LIMIT 1;
  SELECT id INTO v_store   FROM storefronts WHERE market_id = v_market LIMIT 1;
  SELECT id INTO v_carrier FROM carriers    WHERE market_id = v_market LIMIT 1;

  IF v_site IS NULL OR v_store IS NULL OR v_carrier IS NULL THEN
    RAISE EXCEPTION 'Fixture incomplète : entrepôt=%, boutique=%, transporteur=%',
      v_site, v_store, v_carrier;
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  VALUES
    (v_sa, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sqltest.sa@oms.local', 'x', now(), now(), now()),
    (v_mm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sqltest.mm@oms.local', 'x', now(), now(), now()),
    -- Un agent d'entrepôt de l'AUTRE marché : c'est son identité qu'on essaiera
    -- d'emprunter pour franchir la frontière.
    (v_wh, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sqltest.wh.ly@oms.local', 'x', now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, email, full_name, role, market_id, is_active)
  VALUES
    (v_sa, 'sqltest.sa@oms.local', 'SQL Test Admin',   'super_admin',    NULL,     TRUE),
    (v_mm, 'sqltest.mm@oms.local', 'SQL Test Manager', 'market_manager', v_market, TRUE),
    (v_wh, 'sqltest.wh.ly@oms.local', 'SQL Test WH LY', 'warehouse_agent', v_other, TRUE)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, market_id = EXCLUDED.market_id;

  INSERT INTO products (id, market_id, name, sku, unit_cogs, default_price,
                        initial_stock, current_stock, is_active)
  VALUES (v_prod, v_market, 'SQLTEST RLS ' || v_tag, 'SQLTEST-RLS-' || v_tag,
          10, 99, 0, 0, TRUE);

  INSERT INTO product_variants (id, product_id, kind, label, quantity,
                                unit_cogs, current_stock, display_price, is_active)
  VALUES (v_var, v_prod, 'attribute', 'Unique', 1, 10, 0, 99, TRUE);

  PERFORM set_config('r.market', v_market::TEXT, FALSE);
  PERFORM set_config('r.sa', v_sa::TEXT, FALSE);
  PERFORM set_config('r.mm', v_mm::TEXT, FALSE);
  PERFORM set_config('r.wh', v_wh::TEXT, FALSE);
  PERFORM set_config('r.prod', v_prod::TEXT, FALSE);
  PERFORM set_config('r.var', v_var::TEXT, FALSE);
  PERFORM set_config('r.site', v_site::TEXT, FALSE);
  PERFORM set_config('r.store', v_store::TEXT, FALSE);
  PERFORM set_config('r.carrier', v_carrier::TEXT, FALSE);
  PERFORM set_config('r.tag', v_tag, FALSE);
END
$fixture$;

\echo ''
\echo '── 1. une RPC de stock refuse d''être portée au crédit d''un autre ────'

/*
 * LE VRAI SCÉNARIO, et il n'est pas celui qu'on croit.
 *
 * Passer l'id de quelqu'un de l'AUTRE marché ne mène nulle part : la garde de
 * marché s'évalue alors contre ce marché-là et refuse. Le trou est l'inverse —
 * emprunter l'identité de quelqu'un du marché VISÉ.
 *
 * Ici la session est l'agent d'entrepôt libyen ; il passe l'id du super_admin
 * tunisien sur une commande tunisienne. Sans contrôle d'acteur,
 * `scan_return_in` lit `users` par `p_actor_id`, y trouve un super_admin, saute
 * la comparaison de marché — et un agent libyen vient de clore un retour
 * tunisien, inscrit au registre en écriture seule au nom de quelqu'un qui n'a
 * rien fait.
 */
DO $t1$
DECLARE
  v_prod UUID := current_setting('r.prod')::UUID;
  v_ord  UUID := gen_random_uuid();
  v_sa   UUID := current_setting('r.sa')::UUID;   -- super_admin, cible empruntée
  v_wh   UUID := current_setting('r.wh')::UUID;   -- agent LIBYEN, la session
  v_state TEXT;
BEGIN
  INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                      customer_name, customer_phone, product_name, product_id, quantity,
                      unit_price, total_price, status, carrier_id, warehouse_id)
  VALUES (v_ord, current_setting('r.market')::UUID, current_setting('r.store')::UUID,
          'SQLTEST-RLS-' || current_setting('r.tag') || '-1', 'manual',
          'Client', '20000099', 'SQLTEST RLS', v_prod, 1, 99, 99,
          'to_be_returned', current_setting('r.carrier')::UUID,
          current_setting('r.site')::UUID);

  -- La session EST l'agent libyen.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_wh, 'role', 'authenticated')::TEXT, TRUE);

  v_state := pg_temp.err(format(
    'SELECT scan_return_in(%L::UUID, %L::UUID, FALSE, NULL, NULL, NULL)', v_ord, v_sa));
  PERFORM pg_temp.ok(v_state <> 'NO_ERROR',
    'scan_return_in refuse un acteur qui n''est pas la session');
  PERFORM pg_temp.eq((SELECT status::TEXT FROM orders WHERE id = v_ord), 'to_be_returned',
    'la commande tunisienne n''a pas bougé');

  v_state := pg_temp.err(format(
    'SELECT scan_received_in(%L::UUID, %L::UUID)', v_ord, v_sa));
  PERFORM pg_temp.ok(v_state <> 'NO_ERROR',
    'scan_received_in refuse un acteur qui n''est pas la session');
  PERFORM pg_temp.eq((SELECT status::TEXT FROM orders WHERE id = v_ord), 'to_be_returned',
    'la commande tunisienne n''a toujours pas bougé');

  -- Et le même appel, signé par la personne qui agit vraiment, passe.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_sa, 'role', 'authenticated')::TEXT, TRUE);
  PERFORM scan_return_in(v_ord, v_sa, FALSE, NULL, NULL, NULL);
  PERFORM pg_temp.eq((SELECT status::TEXT FROM orders WHERE id = v_ord), 'returned',
    'le même scan, signé par la session, passe');

  PERFORM set_config('request.jwt.claims', '', TRUE);
END
$t1$;

\echo '── 2. sans jeton (service role), l''appel reste possible ─────────────'

-- Le webhook et les tâches planifiées tournent sans `auth.uid()`. La garde ne
-- doit donc mordre que lorsqu'une session est identifiée, exactement comme les
-- quatre fonctions qui la portaient déjà.
DO $t2$
DECLARE
  v_prod UUID := current_setting('r.prod')::UUID;
  v_ord  UUID := gen_random_uuid();
  v_sa   UUID := current_setting('r.sa')::UUID;
BEGIN
  INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                      customer_name, customer_phone, product_name, product_id, quantity,
                      unit_price, total_price, status, carrier_id, warehouse_id)
  VALUES (v_ord, current_setting('r.market')::UUID, current_setting('r.store')::UUID,
          'SQLTEST-RLS-' || current_setting('r.tag') || '-2', 'manual',
          'Client', '20000098', 'SQLTEST RLS', v_prod, 1, 99, 99,
          'to_be_returned', current_setting('r.carrier')::UUID,
          current_setting('r.site')::UUID);

  PERFORM scan_received_in(v_ord, v_sa);
  PERFORM pg_temp.eq((SELECT status::TEXT FROM orders WHERE id = v_ord), 'received',
    'sans jeton, la garde ne bloque pas le service role');
END
$t2$;

\echo ''
\echo '── 3. un market_manager ne supprime pas une variante ─────────────────'

-- Sous un VRAI rôle Postgres `authenticated` : c'est ainsi que PostgREST
-- exécute, et c'est la seule façon de faire jouer RLS. En propriétaire, RLS est
-- contourné et le test serait vert quoi qu'il arrive.
BEGIN;
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('r.mm'),
                                    'role', 'authenticated')::TEXT, TRUE);
SET LOCAL ROLE authenticated;

DELETE FROM public.product_variants WHERE id = current_setting('r.var')::UUID;

RESET ROLE;
COMMIT;

DO $t3$
BEGIN
  PERFORM pg_temp.ok(
    EXISTS (SELECT 1 FROM product_variants WHERE id = current_setting('r.var')::UUID),
    'la variante a survécu au DELETE direct d''un market_manager');
END
$t3$;

\echo ''
\echo '── 4. un market_manager LIT toujours les variantes ───────────────────'

-- Resserrer DELETE ne doit pas toucher la lecture : les paliers s'affichent sur
-- la fiche produit du manager et sur celle de l'agent, en plein appel. Une
-- politique `FOR ALL super_admin` posée à la place aurait emporté les deux.
BEGIN;
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('r.mm'),
                                    'role', 'authenticated')::TEXT, TRUE);
SET LOCAL ROLE authenticated;

SELECT set_config('r.mm_can_read',
                  (SELECT count(*) FROM public.product_variants
                    WHERE id = current_setting('r.var')::UUID)::TEXT, FALSE);

RESET ROLE;
COMMIT;

DO $t4$
BEGIN
  PERFORM pg_temp.eq(current_setting('r.mm_can_read')::INTEGER, 1,
    'le market_manager lit toujours la variante');
END
$t4$;

\echo ''
\echo '── 5. un super_admin supprime toujours ───────────────────────────────'

BEGIN;
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('r.sa'),
                                    'role', 'authenticated')::TEXT, TRUE);
SET LOCAL ROLE authenticated;

DELETE FROM public.product_variants WHERE id = current_setting('r.var')::UUID;

RESET ROLE;
COMMIT;

DO $t5$
BEGIN
  PERFORM pg_temp.ok(
    NOT EXISTS (SELECT 1 FROM product_variants WHERE id = current_setting('r.var')::UUID),
    'le super_admin supprime la variante');
END
$t5$;

\echo ''
\echo '✅ stock_actor_and_rls_test.sql — toutes les assertions passent'
