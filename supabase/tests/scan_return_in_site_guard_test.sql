-- Un retour rentre dans UN bâtiment.
--
-- CE QUE CE FICHIER PROUVE
--   `scan_return_in` gardait le marché mais pas le bâtiment : un agent
--   d'entrepôt de Tripoli clôturait un retour de Benghazi — le stock remontait
--   sur une étagère qui n'a jamais vu le colis — et un agent sans bâtiment
--   clôturait n'importe lequel des deux. C'est l'erreur de remise que le modèle
--   à deux sites existe pour empêcher, et que `precheck_scan_out` et
--   `unscan_order` refusent déjà (NO_SITE_ASSIGNED / WRONG_SITE).
--
--   1. un agent du bâtiment A ne rentre pas un colis du bâtiment B ;
--   2. un agent sans bâtiment ne rentre rien ;
--   3. un colis sans bâtiment (Darb le garde chez lui) n'est pas à l'agent ;
--   4. l'agent du bon bâtiment rentre le colis ;
--   5. un manager du marché rentre un colis de l'un ou l'autre bâtiment ;
--   6. anon ne peut toujours pas exécuter la fonction (CREATE OR REPLACE
--      garde l'ACL ; un DROP+CREATE l'aurait rouverte).
--
-- TESTÉ SOUS UN VRAI JWT : `auth.uid()` est NULL sans jeton, et le contrôle
-- d'acteur de la fonction deviendrait invisible.

\set ON_ERROR_STOP on
\i _helpers.sql

\echo ''
\echo '── fixture ────────────────────────────────────────────────────────────'

DO $fixture$
DECLARE
  v_market  UUID := '00000000-0000-0000-0000-000000000002';  -- Libye
  v_tag     TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_wa_a    UUID := 'bbbbbbbb-0000-4000-8000-000000000001';  -- agent de Tripoli
  v_wa_b    UUID := 'bbbbbbbb-0000-4000-8000-000000000002';  -- agent de Benghazi
  v_wa_none UUID := 'bbbbbbbb-0000-4000-8000-000000000003';  -- agent sans bâtiment
  v_mm      UUID := 'bbbbbbbb-0000-4000-8000-000000000004';  -- manager libyen
  v_site_a  UUID;
  v_site_b  UUID;
  v_car_a   UUID;
  v_car_b   UUID;
  v_store   UUID := gen_random_uuid();
  v_prod    UUID := gen_random_uuid();
BEGIN
  SELECT id INTO v_site_a FROM warehouses WHERE market_id = v_market AND code = 'tripoli';
  SELECT id INTO v_site_b FROM warehouses WHERE market_id = v_market AND code = 'benghazi';
  -- orders.warehouse_id suit carrier_id par déclencheur : on choisit donc le
  -- bâtiment d'un colis par son compte transporteur.
  SELECT id INTO v_car_a FROM carriers WHERE warehouse_id = v_site_a LIMIT 1;
  SELECT id INTO v_car_b FROM carriers WHERE warehouse_id = v_site_b LIMIT 1;

  IF v_site_a IS NULL OR v_site_b IS NULL OR v_car_a IS NULL OR v_car_b IS NULL THEN
    RAISE EXCEPTION 'Fixture incomplète : tripoli=%, benghazi=%, transporteurs=%/%',
      v_site_a, v_site_b, v_car_a, v_car_b;
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  VALUES
    (v_wa_a,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sqltest.ret.a@oms.local', 'x', now(), now(), now()),
    (v_wa_b,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sqltest.ret.b@oms.local', 'x', now(), now(), now()),
    (v_wa_none, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sqltest.ret.none@oms.local', 'x', now(), now(), now()),
    (v_mm,      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sqltest.ret.mm@oms.local', 'x', now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, email, full_name, role, market_id, warehouse_id, is_active)
  VALUES
    (v_wa_a,    'sqltest.ret.a@oms.local',    'SQL Ret A',    'warehouse_agent', v_market, v_site_a, TRUE),
    (v_wa_b,    'sqltest.ret.b@oms.local',    'SQL Ret B',    'warehouse_agent', v_market, v_site_b, TRUE),
    (v_wa_none, 'sqltest.ret.none@oms.local', 'SQL Ret None', 'warehouse_agent', v_market, NULL,     TRUE),
    (v_mm,      'sqltest.ret.mm@oms.local',   'SQL Ret MM',   'market_manager',  v_market, NULL,     TRUE)
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role, market_id = EXCLUDED.market_id, warehouse_id = EXCLUDED.warehouse_id;

  INSERT INTO storefronts (id, market_id, platform, name, webhook_secret)
  VALUES (v_store, v_market, 'manual', 'SQLTEST RET ' || v_tag, 'sqltest-' || v_tag);

  INSERT INTO products (id, market_id, name, sku, unit_cogs, default_price,
                        initial_stock, current_stock, is_active)
  VALUES (v_prod, v_market, 'SQLTEST RET ' || v_tag, 'SQLTEST-RET-' || v_tag,
          10, 99, 0, 0, TRUE);

  PERFORM set_config('r.market', v_market::TEXT, FALSE);
  PERFORM set_config('r.wa_a', v_wa_a::TEXT, FALSE);
  PERFORM set_config('r.wa_b', v_wa_b::TEXT, FALSE);
  PERFORM set_config('r.wa_none', v_wa_none::TEXT, FALSE);
  PERFORM set_config('r.mm', v_mm::TEXT, FALSE);
  PERFORM set_config('r.site_a', v_site_a::TEXT, FALSE);
  PERFORM set_config('r.site_b', v_site_b::TEXT, FALSE);
  PERFORM set_config('r.car_a', v_car_a::TEXT, FALSE);
  PERFORM set_config('r.car_b', v_car_b::TEXT, FALSE);
  PERFORM set_config('r.store', v_store::TEXT, FALSE);
  PERFORM set_config('r.prod', v_prod::TEXT, FALSE);
  PERFORM set_config('r.tag', v_tag, FALSE);
END
$fixture$;

-- Un colis `to_be_returned` du bâtiment porté par ce transporteur (NULL = aucun).
CREATE OR REPLACE FUNCTION pg_temp.ret_order(p_carrier UUID, p_n INT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                      customer_name, customer_phone, product_name, product_id, quantity,
                      unit_price, total_price, status, carrier_id)
  VALUES (v_id, current_setting('r.market')::UUID, current_setting('r.store')::UUID,
          'SQLTEST-RET-' || current_setting('r.tag') || '-' || p_n, 'manual',
          'Client', '9100000' || p_n, 'SQLTEST RET', current_setting('r.prod')::UUID, 1,
          99, 99, 'to_be_returned', p_carrier);
  RETURN v_id;
END $$;

-- Appelle scan_return_in SOUS LA SESSION de l'acteur et rend le DETAIL.code
-- de la levée, ou 'NO_ERROR'.
CREATE OR REPLACE FUNCTION pg_temp.return_as(p_actor UUID, p_order UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_detail TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', p_actor, 'role', 'authenticated')::TEXT, TRUE);
  BEGIN
    PERFORM scan_return_in(p_order, p_actor, FALSE, NULL, NULL, NULL);
    PERFORM set_config('request.jwt.claims', '', TRUE);
    RETURN 'NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    PERFORM set_config('request.jwt.claims', '', TRUE);
    RETURN COALESCE(NULLIF(v_detail, '')::JSON->>'code', SQLERRM);
  END;
END $$;

\echo ''
\echo '── 1. un agent de Tripoli ne rentre pas un colis de Benghazi ──────────'

DO $t1$
DECLARE v_ord UUID := pg_temp.ret_order(current_setting('r.car_b')::UUID, 1);
BEGIN
  PERFORM pg_temp.eq((SELECT warehouse_id FROM orders WHERE id = v_ord),
    current_setting('r.site_b')::UUID, 'le colis est bien à Benghazi');
  PERFORM pg_temp.eq(pg_temp.return_as(current_setting('r.wa_a')::UUID, v_ord), 'WRONG_SITE',
    'l''agent de Tripoli est refusé (WRONG_SITE)');
  PERFORM pg_temp.eq((SELECT status::TEXT FROM orders WHERE id = v_ord), 'to_be_returned',
    'le colis de Benghazi n''a pas bougé');
END
$t1$;

\echo '── 2. un agent sans bâtiment ne rentre rien ───────────────────────────'

DO $t2$
DECLARE v_ord UUID := pg_temp.ret_order(current_setting('r.car_a')::UUID, 2);
BEGIN
  PERFORM pg_temp.eq(pg_temp.return_as(current_setting('r.wa_none')::UUID, v_ord), 'NO_SITE_ASSIGNED',
    'l''agent sans bâtiment est refusé (NO_SITE_ASSIGNED)');
  PERFORM pg_temp.eq((SELECT status::TEXT FROM orders WHERE id = v_ord), 'to_be_returned',
    'le colis n''a pas bougé');
END
$t2$;

\echo '── 3. un colis sans bâtiment n''est pas à l''agent ─────────────────────'

DO $t3$
DECLARE v_ord UUID := pg_temp.ret_order(NULL, 3);
BEGIN
  PERFORM pg_temp.ok((SELECT warehouse_id FROM orders WHERE id = v_ord) IS NULL,
    'le colis n''a pas de bâtiment');
  PERFORM pg_temp.eq(pg_temp.return_as(current_setting('r.wa_a')::UUID, v_ord), 'WRONG_SITE',
    'l''agent est refusé sur un colis sans bâtiment');
END
$t3$;

\echo '── 4. l''agent du bon bâtiment rentre le colis ─────────────────────────'

DO $t4$
DECLARE
  v_ord    UUID := pg_temp.ret_order(current_setting('r.car_b')::UUID, 4);
  v_before INT  := (SELECT current_stock FROM products WHERE id = current_setting('r.prod')::UUID);
BEGIN
  PERFORM pg_temp.eq(pg_temp.return_as(current_setting('r.wa_b')::UUID, v_ord), 'NO_ERROR',
    'l''agent de Benghazi rentre le colis de Benghazi');
  PERFORM pg_temp.eq((SELECT status::TEXT FROM orders WHERE id = v_ord), 'returned',
    'le colis est rentré');
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = current_setting('r.prod')::UUID),
    v_before + 1, 'le stock est remonté d''une unité');
END
$t4$;

\echo '── 5. un manager rentre un colis de l''un ou l''autre bâtiment ─────────'

DO $t5$
DECLARE
  v_a UUID := pg_temp.ret_order(current_setting('r.car_a')::UUID, 5);
  v_n UUID := pg_temp.ret_order(NULL, 6);
BEGIN
  PERFORM pg_temp.eq(pg_temp.return_as(current_setting('r.mm')::UUID, v_a), 'NO_ERROR',
    'le manager rentre un colis de Tripoli');
  PERFORM pg_temp.eq(pg_temp.return_as(current_setting('r.mm')::UUID, v_n), 'NO_ERROR',
    'le manager rentre un colis sans bâtiment');
END
$t5$;

\echo '── 6. anon ne peut toujours pas l''exécuter ────────────────────────────'

-- has_function_privilege, jamais un appel en anon : sur cette base locale,
-- appeler une fonction révoquée en anon fait tomber le serveur.
SELECT pg_temp.ok(
  NOT has_function_privilege('anon',
    'public.scan_return_in(uuid,uuid,boolean,return_reason,text,text)', 'execute'),
  'anon ne peut pas exécuter scan_return_in');
SELECT pg_temp.ok(
  has_function_privilege('authenticated',
    'public.scan_return_in(uuid,uuid,boolean,return_reason,text,text)', 'execute'),
  'authenticated le peut toujours');
