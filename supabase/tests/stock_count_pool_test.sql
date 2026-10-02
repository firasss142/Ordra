-- Un comptage de bâtiment puise dans le NON VENTILÉ avant de créer du stock.
--
-- LE BUG QUE CE FICHIER FIGE (trouvé le 2026-10-02, avant le premier comptage
-- de l'histoire de la base). `record_stock_count` traitait un bâtiment jamais
-- compté comme tenant ZÉRO : Benghazi compte 900 Corans sur un registre de 943,
-- l'écart vaut +900 et le total marché passe à 1 843. Chaque premier comptage
-- doublait le stock du produit, et la finance lit ce total.
--
-- LA RÈGLE (décision du propriétaire, 2026-10-02 — plans/entrepot-day-loop-redesign.md)
--   1. Ce qu'un bâtiment compte EN PLUS de ce qu'il tenait sort d'abord du non
--      ventilé (le stock qu'aucun bâtiment n'a encore compté). Le total ne monte
--      que si le bâtiment tient plus que ce réservoir.
--   2. Une BAISSE à un bâtiment déjà compté est une perte : le total baisse.
--   3. Quand TOUS les bâtiments actifs du marché ont compté le produit (au grain
--      produit × variante), le total vaut exactement la somme des comptages ; ce
--      qu'aucun n'a trouvé est inscrit comme écart de comptage.
--   Conséquence voulue : dans un marché à un seul bâtiment (Tunisie), compter
--   le bâtiment, c'est compter le marché.
--
-- Fixture neuve à chaque passage, écarts relatifs : rejouable sans reset.
-- À LANCER sur une base locale jetable : supabase/tests/run.sh stock_count_pool_test.sql

\set ON_ERROR_STOP on
\i _helpers.sql

\echo ''
\echo '── fixture ────────────────────────────────────────────────────────────'

DO $fixture$
DECLARE
  v_ly    UUID := '00000000-0000-0000-0000-000000000002';
  v_tn    UUID := '00000000-0000-0000-0000-000000000001';
  v_sa    UUID := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_tag   TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_trip  UUID;
  v_beng  UUID;
  v_tunis UUID;
  v_coran UUID := gen_random_uuid();
  v_doll  UUID := gen_random_uuid();
  v_tnp   UUID := gen_random_uuid();
  v_varp  UUID := gen_random_uuid();
  v_petit UUID := gen_random_uuid();
BEGIN
  SELECT id INTO v_trip  FROM warehouses WHERE market_id = v_ly AND code = 'tripoli';
  SELECT id INTO v_beng  FROM warehouses WHERE market_id = v_ly AND code = 'benghazi';
  SELECT id INTO v_tunis FROM warehouses WHERE market_id = v_tn AND is_active ORDER BY code LIMIT 1;
  IF v_trip IS NULL OR v_beng IS NULL OR v_tunis IS NULL THEN
    RAISE EXCEPTION 'Fixture incomplète : tripoli=%, benghazi=%, tunis=%', v_trip, v_beng, v_tunis;
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  VALUES (v_sa, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'sqltest.sa@oms.local', 'x', now(), now(), now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.users (id, email, full_name, role, market_id, warehouse_id, is_active)
  VALUES (v_sa, 'sqltest.sa@oms.local', 'SQL Test Admin', 'super_admin', NULL, NULL, TRUE)
  ON CONFLICT (id) DO UPDATE SET role = 'super_admin';

  -- Tout entre par le registre, comme en vrai : produits ouverts à zéro.
  INSERT INTO products (id, market_id, name, sku, unit_cogs, default_price, initial_stock, current_stock, is_active)
  VALUES
    (v_coran, v_ly, 'SQLTEST Coran ' || v_tag,   'SQLTEST-C-' || v_tag, 40, 249, 0, 0, TRUE),
    (v_doll,  v_ly, 'SQLTEST Poupée ' || v_tag,  'SQLTEST-D-' || v_tag, 25, 129, 0, 0, TRUE),
    (v_tnp,   v_tn, 'SQLTEST Tunis ' || v_tag,   'SQLTEST-T-' || v_tag, 10,  59, 0, 0, TRUE),
    (v_varp,  v_ly, 'SQLTEST Doudoune ' || v_tag,'SQLTEST-V-' || v_tag, 20, 129, 0, 0, TRUE);

  INSERT INTO product_variants (id, product_id, kind, label, sku, quantity, unit_cogs, current_stock, display_price, is_active)
  VALUES (v_petit, v_varp, 'attribute', 'Petit', 'SQLTEST-V-' || v_tag || '-P', 1, 18, 0, 129, TRUE);

  PERFORM adjust_product_stock(v_coran, 943, 'manual_adjustment', 'registre de départ', v_sa, FALSE, NULL);
  PERFORM adjust_product_stock(v_doll,  100, 'manual_adjustment', 'registre de départ', v_sa, FALSE, NULL);
  PERFORM adjust_product_stock(v_tnp,    50, 'manual_adjustment', 'registre de départ', v_sa, FALSE, NULL);
  PERFORM adjust_product_stock(v_varp,   40, 'manual_adjustment', 'registre de départ', v_sa, FALSE, v_petit);

  PERFORM set_config('t.sa',    v_sa::TEXT,    FALSE);
  PERFORM set_config('t.trip',  v_trip::TEXT,  FALSE);
  PERFORM set_config('t.beng',  v_beng::TEXT,  FALSE);
  PERFORM set_config('t.tunis', v_tunis::TEXT, FALSE);
  PERFORM set_config('t.coran', v_coran::TEXT, FALSE);
  PERFORM set_config('t.doll',  v_doll::TEXT,  FALSE);
  PERFORM set_config('t.tnp',   v_tnp::TEXT,   FALSE);
  PERFORM set_config('t.varp',  v_varp::TEXT,  FALSE);
  PERFORM set_config('t.petit', v_petit::TEXT, FALSE);
  RAISE NOTICE '  fixture %', v_tag;
END
$fixture$;

\echo ''
\echo '── 1. le premier comptage d''un bâtiment ne double pas le stock ────────'

DO $t1$
DECLARE
  v_p  UUID := current_setting('t.coran')::UUID;
  v_r  JSON;
BEGIN
  v_r := record_stock_count(v_p, 900, current_setting('t.sa')::UUID, 'premier comptage',
                            current_setting('t.beng')::UUID);

  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 943,
    'le total marché reste 943 — les 900 sortent du non ventilé');
  PERFORM pg_temp.eq((SELECT current_stock FROM product_site_stock
                       WHERE product_id = v_p AND warehouse_id = current_setting('t.beng')::UUID
                         AND variant_id IS NULL), 900,
    'Benghazi porte 900');
  PERFORM pg_temp.eq((v_r->>'delta')::INTEGER, 0, 'la RPC rend un écart marché nul');
  PERFORM pg_temp.eq((v_r->>'from_pool')::INTEGER, 900, 'et dit que 900 sont venus du non ventilé');
  PERFORM pg_temp.eq((SELECT change FROM inventory_log WHERE product_id = v_p AND reason = 'stock_count'
                       ORDER BY created_at DESC LIMIT 1), 0,
    'le registre inscrit un écart nul (la preuve du comptage, sans faux stock)');
END
$t1$;

\echo ''
\echo '── 2. le dernier bâtiment ferme le compte : total = somme des comptages ─'

DO $t2$
DECLARE
  v_p UUID := current_setting('t.coran')::UUID;
  v_r JSON;
BEGIN
  v_r := record_stock_count(v_p, 30, current_setting('t.sa')::UUID, 'premier comptage',
                            current_setting('t.trip')::UUID);

  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 930,
    'tous les bâtiments ont compté : le total vaut 900 + 30');
  PERFORM pg_temp.eq((v_r->>'delta')::INTEGER, -13, 'les 13 introuvables sont l''écart de comptage');
  PERFORM pg_temp.eq((v_r->>'closed')::BOOLEAN, TRUE, 'la RPC dit que le produit est entièrement compté');
  PERFORM pg_temp.eq((SELECT balance_after FROM inventory_log WHERE product_id = v_p AND reason = 'stock_count'
                       ORDER BY created_at DESC LIMIT 1), 930,
    'le registre finit au même chiffre que le total');
END
$t2$;

\echo ''
\echo '── 3. une fois tout compté, chaque recomptage pose la somme ────────────'

DO $t3$
DECLARE
  v_p UUID := current_setting('t.coran')::UUID;
BEGIN
  PERFORM record_stock_count(v_p, 880, current_setting('t.sa')::UUID, 'recomptage', current_setting('t.beng')::UUID);
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 910,
    'Benghazi perd 20 : 880 + 30');

  PERFORM record_stock_count(v_p, 950, current_setting('t.sa')::UUID, 'recomptage', current_setting('t.beng')::UUID);
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 980,
    'Benghazi en trouve 70 de plus : 950 + 30');
END
$t3$;

\echo ''
\echo '── 4. un bâtiment qui tient plus que le non ventilé crée la différence ─'

DO $t4$
DECLARE
  v_p UUID := current_setting('t.doll')::UUID;
  v_r JSON;
BEGIN
  v_r := record_stock_count(v_p, 130, current_setting('t.sa')::UUID, 'premier comptage', current_setting('t.beng')::UUID);
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 130,
    'registre 100, Benghazi en compte 130 : le total monte de 30, pas de 130');
  PERFORM pg_temp.eq((v_r->>'from_pool')::INTEGER, 100, 'les 100 du registre sont absorbés');
  PERFORM pg_temp.eq((v_r->>'delta')::INTEGER, 30, 'seul l''excédent est du stock nouveau');
END
$t4$;

\echo ''
\echo '── 5. un seul bâtiment : compter le bâtiment, c''est compter le marché ─'

DO $t5$
DECLARE
  v_p UUID := current_setting('t.tnp')::UUID;
BEGIN
  PERFORM record_stock_count(v_p, 45, current_setting('t.sa')::UUID, 'premier comptage', current_setting('t.tunis')::UUID);
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 45,
    'Tunisie : 50 au registre, 45 sur l''étagère, le total vaut 45');
END
$t5$;

\echo ''
\echo '── 6. la même règle au grain de la variante ────────────────────────────'

DO $t6$
DECLARE
  v_p  UUID := current_setting('t.varp')::UUID;
  v_vp UUID := current_setting('t.petit')::UUID;
BEGIN
  PERFORM record_stock_count(v_p, 25, current_setting('t.sa')::UUID, 'premier comptage Petit',
                             current_setting('t.beng')::UUID, v_vp);
  PERFORM pg_temp.eq((SELECT current_stock FROM product_variants WHERE id = v_vp), 40,
    'Petit reste 40 : les 25 de Benghazi sortent du non ventilé de la variante');
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 40, 'le produit aussi');

  PERFORM record_stock_count(v_p, 10, current_setting('t.sa')::UUID, 'premier comptage Petit',
                             current_setting('t.trip')::UUID, v_vp);
  PERFORM pg_temp.eq((SELECT current_stock FROM product_variants WHERE id = v_vp), 35,
    'les deux bâtiments ont compté Petit : 25 + 10');
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 35,
    'le produit suit la variante, du même écart');
END
$t6$;

\echo ''
\echo '── 7. rien n''est devenu exécutable sans connexion ──────────────────────'

DO $t7$
BEGIN
  PERFORM pg_temp.ok(
    NOT has_function_privilege('anon', 'public.record_stock_count(uuid,integer,uuid,text,uuid,uuid)', 'EXECUTE'),
    'record_stock_count reste fermé à anon');
END
$t7$;

\echo ''
\echo '✅ stock_count_pool_test.sql — toutes les assertions passent'
