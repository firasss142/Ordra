-- Dépenses pub — mapping par ensemble, plusieurs produits, historique daté
-- (20260930225232_ad_spend_adset_mapping.sql).
--
-- CE QUE CE FICHIER PROUVE
--   1. Personne d'autre que le service role n'exécute les trois RPC : ni anon,
--      ni authenticated (EXECUTE part à PUBLIC par défaut).
--   2. set_ad_spend_mapping remplace sans effacer : « tout l'historique »
--      remplace toutes les versions vivantes, « à partir de D » seulement celles
--      qui commencent à D ou après ; l'ancienne reste lisible, marquée.
--   3. Il refuse ce qui fausserait l'argent : parts manuelles ≠ 100, produit
--      d'un autre marché, produit en double, campagne qui « hérite ».
--   4. L'historique est intouchable : ni UPDATE d'une version, ni DELETE, ni
--      modification d'une ligne.
--   5. replace_meta_ad_spend réécrit exactement son périmètre, et refuse tout le
--      lot si une ligne en déborde (rien n'a bougé).
--   6. order_counts_by_product_day coupe le jour dans le fuseau demandé :
--      23:30 UTC est déjà le lendemain à Tunis.

\set ON_ERROR_STOP on
\i _helpers.sql

-- 1. Grants -----------------------------------------------------------------
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'set_ad_spend_mapping(uuid,text,text,text,date,text,text,jsonb)',
    'replace_meta_ad_spend(text,date,date,text[],jsonb)',
    'order_counts_by_product_day(uuid,date,date,text,uuid[])'
  ] LOOP
    PERFORM pg_temp.ok(NOT has_function_privilege('anon', f, 'EXECUTE'), 'anon ne peut pas exécuter ' || f);
    PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', f, 'EXECUTE'), 'authenticated ne peut pas exécuter ' || f);
    PERFORM pg_temp.ok(has_function_privilege('service_role', f, 'EXECUTE'), 'service_role exécute ' || f);
  END LOOP;
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'ad_spend_mappings', 'INSERT'),
                     'authenticated ne peut pas écrire une version directement');
  PERFORM pg_temp.ok(NOT has_table_privilege('anon', 'meta_adset_daily', 'SELECT'),
                     'anon ne lit pas les faits Meta');
END $$;

-- Fixture -------------------------------------------------------------------
CREATE TEMP TABLE fx (k TEXT PRIMARY KEY, v TEXT);

DO $fixture$
DECLARE
  v_tn    UUID := '00000000-0000-0000-0000-000000000001';
  v_ly    UUID := '00000000-0000-0000-0000-000000000002';
  v_tag   TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 10);
  v_acct  TEXT := 'sqltest' || v_tag;
  v_a     UUID := gen_random_uuid();
  v_b     UUID := gen_random_uuid();
  v_c     UUID := gen_random_uuid();
  v_ly_p  UUID := gen_random_uuid();
BEGIN
  INSERT INTO meta_ad_accounts (market_id, ad_account_id, account_currency, account_timezone, access_token)
  VALUES (v_tn, v_acct, 'USD', 'Africa/Tunis', 'not-a-token');

  INSERT INTO products (id, market_id, name, sku, unit_cogs, default_price, initial_stock, current_stock, is_active)
  VALUES (v_a, v_tn, 'SQLTEST Poupée S ' || v_tag, 'SQLTEST-S-' || v_tag, 20, 129, 0, 0, TRUE),
         (v_b, v_tn, 'SQLTEST Poupée M ' || v_tag, 'SQLTEST-M-' || v_tag, 20, 179, 0, 0, TRUE),
         (v_c, v_tn, 'SQLTEST Poupée L ' || v_tag, 'SQLTEST-L-' || v_tag, 20, 199, 0, 0, TRUE),
         (v_ly_p, v_ly, 'SQLTEST Libye ' || v_tag, 'SQLTEST-LY-' || v_tag, 20, 199, 0, 0, TRUE);

  INSERT INTO fx VALUES ('acct', v_acct), ('a', v_a::TEXT), ('b', v_b::TEXT), ('c', v_c::TEXT),
                        ('ly', v_ly_p::TEXT), ('tag', v_tag), ('tn', v_tn::TEXT);
END $fixture$;

-- 2 & 3. set_ad_spend_mapping ------------------------------------------------
DO $$
DECLARE
  acct TEXT := (SELECT v FROM fx WHERE k = 'acct');
  a UUID := (SELECT v FROM fx WHERE k = 'a')::UUID;
  b UUID := (SELECT v FROM fx WHERE k = 'b')::UUID;
  c UUID := (SELECT v FROM fx WHERE k = 'c')::UUID;
  ly UUID := (SELECT v FROM fx WHERE k = 'ly')::UUID;
  v1 UUID; v2 UUID; v3 UUID;
  live INT;
BEGIN
  -- one product, since the beginning
  v1 := set_ad_spend_mapping(NULL, acct, 'CAMP1', NULL, NULL, 'products', NULL,
          jsonb_build_array(jsonb_build_object('product_id', c)));
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM ad_spend_mappings WHERE ad_account_id = acct AND superseded_at IS NULL), 1,
                     'une version vivante après le premier mapping');
  PERFORM pg_temp.eq((SELECT split_mode FROM ad_spend_mappings WHERE id = v1), NULL::TEXT,
                     'un seul produit : pas de mode de répartition');

  -- from 2026-08-01, three products, manual 60/25/15: the first version stays in force before
  v2 := set_ad_spend_mapping(NULL, acct, 'CAMP1', NULL, DATE '2026-08-01', 'products', 'manual',
          jsonb_build_array(jsonb_build_object('product_id', b, 'share_pct', 60),
                            jsonb_build_object('product_id', a, 'share_pct', 25),
                            jsonb_build_object('product_id', c, 'share_pct', 15)));
  SELECT count(*) INTO live FROM ad_spend_mappings WHERE ad_account_id = acct AND superseded_at IS NULL;
  PERFORM pg_temp.eq(live, 2, '« à partir du 1er août » garde la version d''avant en vigueur jusque-là');
  PERFORM pg_temp.eq((SELECT sum(share_pct) FROM ad_spend_mapping_lines WHERE mapping_id = v2), 100.00::NUMERIC,
                     'les parts manuelles sont enregistrées et font 100');

  -- a second "from 2026-08-01" replaces the first one starting that day, not the older one
  v3 := set_ad_spend_mapping(NULL, acct, 'CAMP1', NULL, DATE '2026-08-01', 'products', 'auto_orders',
          jsonb_build_array(jsonb_build_object('product_id', b), jsonb_build_object('product_id', a)));
  PERFORM pg_temp.ok((SELECT superseded_by = v3 AND superseded_at IS NOT NULL FROM ad_spend_mappings WHERE id = v2),
                     'la version du 1er août est remplacée, et dit par quoi');
  PERFORM pg_temp.ok((SELECT superseded_at IS NULL FROM ad_spend_mappings WHERE id = v1),
                     'la version « depuis le début » reste en vigueur avant le 1er août');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM ad_spend_mapping_lines WHERE mapping_id = v3 AND share_pct IS NULL), 2,
                     'répartition auto : aucune part figée');

  -- all history replaces everything live
  PERFORM set_ad_spend_mapping(NULL, acct, 'CAMP1', NULL, NULL, 'market_level', NULL, '[]'::JSONB);
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM ad_spend_mappings WHERE ad_account_id = acct AND superseded_at IS NULL), 1,
                     '« tout l''historique » ne laisse qu''une version vivante');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM ad_spend_mappings WHERE ad_account_id = acct), 4,
                     'et les trois anciennes restent lisibles');

  -- an ad set's own mapping, then back to following its campaign
  PERFORM set_ad_spend_mapping(NULL, acct, 'CAMP1', 'SET9', NULL, 'products', NULL,
          jsonb_build_array(jsonb_build_object('product_id', a)));
  PERFORM set_ad_spend_mapping(NULL, acct, 'CAMP1', 'SET9', DATE '2026-09-01', 'inherit', NULL, NULL);
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM ad_spend_mappings WHERE ad_account_id = acct AND external_adset_id = 'SET9' AND superseded_at IS NULL), 2,
                     'un ensemble peut revenir à sa campagne à partir d''une date');

  -- refusals
  PERFORM pg_temp.eq(pg_temp.err(format(
    $q$SELECT set_ad_spend_mapping(NULL, %L, 'CAMP2', NULL, NULL, 'products', 'manual',
         '[{"product_id":"%s","share_pct":60},{"product_id":"%s","share_pct":30}]'::jsonb)$q$, acct, a, b)),
    '22023', 'des parts manuelles qui font 90 sont refusées');
  PERFORM pg_temp.eq(pg_temp.err(format(
    $q$SELECT set_ad_spend_mapping(NULL, %L, 'CAMP2', NULL, NULL, 'products', NULL, '[{"product_id":"%s"}]'::jsonb)$q$, acct, ly)),
    '22023', 'un produit d''un autre marché est refusé');
  PERFORM pg_temp.eq(pg_temp.err(format(
    $q$SELECT set_ad_spend_mapping(NULL, %L, 'CAMP2', NULL, NULL, 'products', 'auto_orders',
         '[{"product_id":"%s"},{"product_id":"%s"}]'::jsonb)$q$, acct, a, a)),
    '22023', 'le même produit deux fois est refusé');
  PERFORM pg_temp.eq(pg_temp.err(format(
    $q$SELECT set_ad_spend_mapping(NULL, %L, 'CAMP2', NULL, NULL, 'products', NULL,
         '[{"product_id":"%s"},{"product_id":"%s"}]'::jsonb)$q$, acct, a, b)),
    '22023', 'plusieurs produits sans mode de répartition sont refusés');
  PERFORM pg_temp.eq(pg_temp.err(format(
    $q$SELECT set_ad_spend_mapping(NULL, %L, 'CAMP2', NULL, NULL, 'inherit', NULL, NULL)$q$, acct)),
    '22023', 'une campagne ne peut pas « hériter »');
  PERFORM pg_temp.eq(pg_temp.err(
    $q$SELECT set_ad_spend_mapping(NULL, 'nope-account', 'CAMP2', NULL, NULL, 'market_level', NULL, NULL)$q$),
    '22023', 'un compte pub inconnu est refusé');
END $$;

-- 4. History is immutable -----------------------------------------------------
DO $$
DECLARE
  acct TEXT := (SELECT v FROM fx WHERE k = 'acct');
  vid UUID := (SELECT id FROM ad_spend_mappings WHERE ad_account_id = acct AND superseded_at IS NULL AND external_adset_id IS NULL);
  old UUID := (SELECT id FROM ad_spend_mappings WHERE ad_account_id = acct AND superseded_at IS NOT NULL LIMIT 1);
BEGIN
  PERFORM pg_temp.eq(pg_temp.err(format('UPDATE ad_spend_mappings SET kind = %L WHERE id = %L', 'products', vid)),
                     'P0001', 'une version ne change pas de nature');
  PERFORM pg_temp.eq(pg_temp.err(format('DELETE FROM ad_spend_mappings WHERE id = %L', vid)),
                     'P0001', 'une version ne s''efface pas');
  PERFORM pg_temp.eq(pg_temp.err(format('UPDATE ad_spend_mappings SET superseded_at = now() WHERE id = %L', old)),
                     'P0001', 'une version remplacée ne se re-remplace pas');
  PERFORM pg_temp.eq(pg_temp.err(format(
                       'UPDATE ad_spend_mapping_lines SET share_pct = 50 WHERE mapping_id IN (SELECT id FROM ad_spend_mappings WHERE ad_account_id = %L)', acct)),
                     'P0001', 'une ligne ne change pas');
END $$;

-- 5. replace_meta_ad_spend ----------------------------------------------------
DO $$
DECLARE
  acct TEXT := (SELECT v FROM fx WHERE k = 'acct');
  tn UUID := (SELECT v FROM fx WHERE k = 'tn')::UUID;
  a UUID := (SELECT v FROM fx WHERE k = 'a')::UUID;
  b UUID := (SELECT v FROM fx WHERE k = 'b')::UUID;
  row_of JSONB;
  n INT;
BEGIN
  row_of := jsonb_build_object('market_id', tn, 'ad_account_id', acct, 'external_campaign_id', 'CAMP1',
                               'external_adset_id', 'SET1', 'currency_original', 'USD', 'fx_rate', 8.4,
                               'allocation_basis', 'single', 'allocation_share', 1);

  n := replace_meta_ad_spend(acct, DATE '2026-08-01', DATE '2026-08-02', ARRAY['CAMP1'], jsonb_build_array(
         row_of || jsonb_build_object('period_start', '2026-08-01', 'product_id', a, 'amount', 100, 'amount_original', 11.9048),
         row_of || jsonb_build_object('period_start', '2026-08-02', 'product_id', a, 'amount', 50, 'amount_original', 5.9524)));
  PERFORM pg_temp.eq(n, 2, 'deux jours écrits');

  -- replace only 2 Aug, now split in two
  n := replace_meta_ad_spend(acct, DATE '2026-08-02', DATE '2026-08-02', ARRAY['CAMP1'], jsonb_build_array(
         row_of || jsonb_build_object('period_start', '2026-08-02', 'product_id', a, 'amount', 20, 'allocation_share', 0.4, 'allocation_basis', 'manual'),
         row_of || jsonb_build_object('period_start', '2026-08-02', 'product_id', b, 'amount', 30, 'allocation_share', 0.6, 'allocation_basis', 'manual')));
  PERFORM pg_temp.eq((SELECT sum(amount) FROM ad_spend WHERE ad_account_id = acct AND period_start = '2026-08-02'), 50.000::NUMERIC,
                     'le 2 août est réécrit, réparti, même total');
  PERFORM pg_temp.eq((SELECT amount FROM ad_spend WHERE ad_account_id = acct AND period_start = '2026-08-01'), 100.000::NUMERIC,
                     'le 1er août, hors périmètre, n''a pas bougé');
  PERFORM pg_temp.eq((SELECT period_end FROM ad_spend WHERE ad_account_id = acct AND period_start = '2026-08-01'), DATE '2026-08-01',
                     'une ligne synchronisée couvre un seul jour');

  -- a row outside the scope refuses the whole batch
  PERFORM pg_temp.eq(pg_temp.err(format(
    'SELECT replace_meta_ad_spend(%L, %L, %L, ARRAY[%L], %L::jsonb)', acct, '2026-08-02', '2026-08-02', 'CAMP1',
    jsonb_build_array(row_of || jsonb_build_object('period_start', '2026-08-03', 'product_id', a, 'amount', 1)))),
    '22023', 'une ligne hors fenêtre fait refuser tout le lot');
  PERFORM pg_temp.eq((SELECT sum(amount) FROM ad_spend WHERE ad_account_id = acct), 150.000::NUMERIC,
                     'et rien n''a bougé');
  PERFORM pg_temp.eq(pg_temp.err(format(
    'SELECT replace_meta_ad_spend(%L, %L, %L, ARRAY[%L], %L::jsonb)', acct, '2026-08-02', '2026-08-02', 'CAMP1',
    jsonb_build_array(row_of || jsonb_build_object('period_start', '2026-08-02', 'external_campaign_id', 'CAMP7', 'amount', 1)))),
    '22023', 'une ligne d''une autre campagne fait refuser tout le lot');
END $$;

-- 6. order_counts_by_product_day ---------------------------------------------
DO $$
DECLARE
  tn UUID := (SELECT v FROM fx WHERE k = 'tn')::UUID;
  a UUID := (SELECT v FROM fx WHERE k = 'a')::UUID;
  b UUID := (SELECT v FROM fx WHERE k = 'b')::UUID;
  tag TEXT := (SELECT v FROM fx WHERE k = 'tag');
  v_store UUID;
  i INT := 0;
  at TIMESTAMPTZ;
  p UUID;
BEGIN
  SELECT id INTO v_store FROM storefronts WHERE market_id = tn LIMIT 1;
  IF v_store IS NULL THEN RAISE EXCEPTION 'Fixture incomplète : aucune boutique TN'; END IF;

  -- a: 2 orders on 10 Aug (Tunis), one of them at 23:30 UTC on the 9th
  -- b: 1 order on 10 Aug at 22:59 UTC (still 10 Aug in Tunis? no — 23:59 Tunis)
  FOR at, p IN VALUES
    (TIMESTAMPTZ '2026-08-09 23:30:00+00', a),
    (TIMESTAMPTZ '2026-08-10 12:00:00+00', a),
    (TIMESTAMPTZ '2026-08-10 22:59:00+00', b),
    (TIMESTAMPTZ '2026-08-10 23:01:00+00', b)
  LOOP
    i := i + 1;
    INSERT INTO orders (market_id, storefront_id, external_id, external_platform,
                        customer_name, customer_phone, product_name, product_id, quantity, unit_price, total_price,
                        status, created_at)
    VALUES (tn, v_store, 'SQLTEST-ADS-' || tag || '-' || i, 'manual',
            'Client ads', '2' || lpad((floor(random() * 10000000))::TEXT, 7, '0'),
            'SQLTEST ADS', p, 1, 50, 50, 'pending', at);
  END LOOP;

  PERFORM pg_temp.eq(
    (SELECT orders FROM order_counts_by_product_day(tn, '2026-08-10', '2026-08-10', 'Africa/Tunis', ARRAY[a, b]) WHERE product_id = a),
    2, '23:30 UTC le 9 compte le 10 à Tunis');
  PERFORM pg_temp.eq(
    (SELECT orders FROM order_counts_by_product_day(tn, '2026-08-10', '2026-08-10', 'Africa/Tunis', ARRAY[a, b]) WHERE product_id = b),
    1, '23:01 UTC le 10 est déjà le 11 à Tunis');
  PERFORM pg_temp.eq(
    (SELECT orders FROM order_counts_by_product_day(tn, '2026-08-11', '2026-08-11', 'Africa/Tunis', ARRAY[b]) WHERE product_id = b),
    1, 'et il compte bien le 11');
END $$;

\echo '✓ ad_spend_mapping_test'
