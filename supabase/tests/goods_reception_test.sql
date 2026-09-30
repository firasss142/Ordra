-- La réception de marchandises : ce que la validation garantit.
--
-- CE QUE CE FICHIER PROUVE
--   1. Valider écrit UNE ligne de registre par ligne reçue, avec le bon motif,
--      le bon bâtiment, et le total marché juste.
--   2. Valider CRÉE la ligne de site. C'est le piège central : le trigger de
--      ventilation fait un UPDATE, jamais un upsert, donc sans création
--      préalable une réception sur un (produit, site) jamais compté bougerait
--      le total marché et manquerait le bâtiment EN SILENCE.
--   3. Les abîmées n'entrent pas en stock et ne touchent pas
--      damaged_return_count.
--   4. Une réception validée est définitive : ni UPDATE ni DELETE, et pas de
--      double validation.
--   5. `p_adopt_costs` est le seul chemin vers unit_cogs. Sans lui, le coût est
--      enregistré et unit_cogs ne bouge pas d'un millième.
--   6. L'acteur est la session, et un agent d'entrepôt ne valide pas.
--   7. Contre-passer rend le stock et refuse si les unités sont déjà parties.
--   8. Les RPC ne sont pas exécutables par `anon`.
--
-- TESTÉ SOUS UN VRAI JWT. `auth.uid()` est NULL sans jeton et la garde
-- d'acteur devient invisible — le piège des notes « RLS helpers search_path »
-- et « RPC actor id not bound to session ».
--
-- PAS DE ROLLBACK : les invariants de stock sont des CONSTRAINT TRIGGERS
-- DEFERRABLE INITIALLY DEFERRED et ne s'évaluent qu'au COMMIT (voir
-- _helpers.sql).

\set ON_ERROR_STOP on
\i _helpers.sql

\echo ''
\echo '── fixture ────────────────────────────────────────────────────────────'

DO $fixture$
DECLARE
  v_market UUID := '00000000-0000-0000-0000-000000000001';  -- Tunisie
  v_other  UUID := '00000000-0000-0000-0000-000000000002';  -- Libye
  v_sa     UUID := 'bbbbbbbb-0000-4000-8000-000000000001';
  v_mm     UUID := 'bbbbbbbb-0000-4000-8000-000000000002';
  v_wh     UUID := 'bbbbbbbb-0000-4000-8000-000000000003';
  v_tag    TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_p1     UUID := gen_random_uuid();   -- jamais compté sur le site
  v_p2     UUID := gen_random_uuid();   -- déjà une ligne de site
  v_site   UUID;
BEGIN
  SELECT id INTO v_site FROM warehouses WHERE market_id = v_market AND is_active
   ORDER BY code LIMIT 1;
  IF v_site IS NULL THEN RAISE EXCEPTION 'Fixture : pas d''entrepôt tunisien'; END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  VALUES
    (v_sa, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'rectest.sa@oms.local', 'x', now(), now(), now()),
    (v_mm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'rectest.mm@oms.local', 'x', now(), now(), now()),
    (v_wh, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'rectest.wh@oms.local', 'x', now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, email, full_name, role, market_id, is_active, warehouse_id)
  VALUES
    (v_sa, 'rectest.sa@oms.local', 'Rec Test SA', 'super_admin',     NULL,     TRUE, NULL),
    (v_mm, 'rectest.mm@oms.local', 'Rec Test MM', 'market_manager',  v_market, TRUE, NULL),
    (v_wh, 'rectest.wh@oms.local', 'Rec Test WH', 'warehouse_agent', v_market, TRUE, v_site)
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role, market_id = EXCLUDED.market_id,
        warehouse_id = EXCLUDED.warehouse_id;

  -- p1 : 100 en stock, COGS 10.000, AUCUNE ligne de site.
  INSERT INTO products (id, market_id, name, sku, unit_cogs, default_price,
                        current_stock, initial_stock, low_stock_threshold, is_active)
  VALUES (v_p1, v_market, 'RECTEST P1 ' || v_tag, 'rectest-p1-' || v_tag,
          10.000, 50, 100, 100, 5, TRUE);

  -- p2 : 40 en stock dont 40 ventilés sur le site (comme après un comptage).
  INSERT INTO products (id, market_id, name, sku, unit_cogs, default_price,
                        current_stock, initial_stock, low_stock_threshold, is_active)
  VALUES (v_p2, v_market, 'RECTEST P2 ' || v_tag, 'rectest-p2-' || v_tag,
          20.000, 80, 40, 40, 5, TRUE);

  INSERT INTO product_site_stock (product_id, variant_id, warehouse_id,
                                 current_stock, last_counted_at)
  VALUES (v_p2, NULL, v_site, 40, now());

  PERFORM set_config('r.market', v_market::TEXT, FALSE);
  PERFORM set_config('r.other',  v_other::TEXT,  FALSE);
  PERFORM set_config('r.sa',     v_sa::TEXT,     FALSE);
  PERFORM set_config('r.mm',     v_mm::TEXT,     FALSE);
  PERFORM set_config('r.wh',     v_wh::TEXT,     FALSE);
  PERFORM set_config('r.p1',     v_p1::TEXT,     FALSE);
  PERFORM set_config('r.p2',     v_p2::TEXT,     FALSE);
  PERFORM set_config('r.site',   v_site::TEXT,   FALSE);
  PERFORM set_config('r.tag',    v_tag,          FALSE);

  RAISE NOTICE '  fixture: p1=% (100, pas de site) p2=% (40, site 40) site=%',
    v_p1, v_p2, v_site;
END
$fixture$;

\echo ''
\echo '── 1. la référence se génère par marché et par année ─────────────────'

DO $t1$
DECLARE
  v_ref TEXT;
BEGIN
  v_ref := next_reception_reference(current_setting('r.market')::UUID);
  PERFORM pg_temp.ok(v_ref ~ ('^REC-[A-Z]{2}-' || to_char(CURRENT_DATE,'YYYY') || '-\d{4}$'),
    'la référence a la forme REC-XX-AAAA-NNNN (' || v_ref || ')');
END
$t1$;

\echo ''
\echo '── 2. un agent d''entrepôt ne valide pas ──────────────────────────────'

DO $t2$
DECLARE
  v_rec   UUID := gen_random_uuid();
  v_state TEXT;
BEGIN
  INSERT INTO receptions (id, market_id, warehouse_id, reference, supplier_name,
                          status, created_by)
  VALUES (v_rec, current_setting('r.market')::UUID, current_setting('r.site')::UUID,
          'RECTEST-' || current_setting('r.tag') || '-A', 'Fournisseur Test',
          'submitted', current_setting('r.wh')::UUID);

  INSERT INTO reception_lines (reception_id, product_id, expected_qty, received_qty, unit_cost)
  VALUES (v_rec, current_setting('r.p1')::UUID, 10, 10, 12.000);

  -- La session EST l'agent d'entrepôt, et il signe en son propre nom.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('r.wh'), 'role', 'authenticated')::TEXT, TRUE);

  v_state := pg_temp.err(format('SELECT post_reception(%L::UUID, %L::UUID, FALSE)',
                                v_rec, current_setting('r.wh')));
  PERFORM pg_temp.eq(v_state, '42501', 'un warehouse_agent ne peut pas valider');
  PERFORM pg_temp.eq((SELECT status FROM receptions WHERE id = v_rec), 'submitted',
    'la réception est restée à valider');
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = current_setting('r.p1')::UUID),
    100, 'le stock de p1 n''a pas bougé');

  -- Et le manager ne peut pas valider au nom de l'agent.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);
  v_state := pg_temp.err(format('SELECT post_reception(%L::UUID, %L::UUID, FALSE)',
                                v_rec, current_setting('r.wh')));
  PERFORM pg_temp.eq(v_state, '42501', 'valider au nom d''un autre est refusé');

  PERFORM set_config('request.jwt.claims', '', TRUE);
  PERFORM set_config('r.recA', v_rec::TEXT, FALSE);
END
$t2$;

\echo ''
\echo '── 3. valider : registre, total marché, ET la ligne de site créée ────'

DO $t3$
DECLARE
  v_rec     UUID := current_setting('r.recA')::UUID;
  v_p1      UUID := current_setting('r.p1')::UUID;
  v_site    UUID := current_setting('r.site')::UUID;
  v_out     json;
  v_rows    INTEGER;
BEGIN
  -- La ligne de site n'existe pas encore : c'est tout l'intérêt du test.
  PERFORM pg_temp.eq(
    (SELECT count(*)::INTEGER FROM product_site_stock
      WHERE product_id = v_p1 AND warehouse_id = v_site AND variant_id IS NULL),
    0, 'avant validation, p1 n''a aucune ligne de site');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);

  v_out := post_reception(v_rec, current_setting('r.mm')::UUID, FALSE);

  PERFORM pg_temp.eq((v_out->>'units')::INTEGER, 10, 'la RPC rend 10 unités');
  PERFORM pg_temp.eq((v_out->>'lines')::INTEGER, 1, 'une ligne validée');
  PERFORM pg_temp.eq((v_out->>'value')::NUMERIC, 120.000, 'valeur reçue = 10 × 12,000');
  PERFORM pg_temp.eq((SELECT status FROM receptions WHERE id = v_rec), 'posted',
    'la réception est validée');

  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p1), 110,
    'le total marché de p1 passe de 100 à 110');

  -- LE POINT CENTRAL.
  PERFORM pg_temp.eq(
    (SELECT current_stock FROM product_site_stock
      WHERE product_id = v_p1 AND warehouse_id = v_site AND variant_id IS NULL),
    10, 'la ligne de site a été CRÉÉE et porte les 10 unités reçues');

  SELECT count(*)::INTEGER INTO v_rows FROM inventory_log
   WHERE reception_id = v_rec AND reason = 'reception';
  PERFORM pg_temp.eq(v_rows, 1, 'exactement une ligne de registre, motif reception');

  PERFORM pg_temp.eq(
    (SELECT warehouse_id FROM inventory_log WHERE reception_id = v_rec LIMIT 1),
    v_site, 'la ligne de registre porte le bâtiment');
  PERFORM pg_temp.eq(
    (SELECT balance_after FROM inventory_log WHERE reception_id = v_rec LIMIT 1),
    110, 'balance_after est le total MARCHÉ');

  -- Sans p_adopt_costs, le coût catalogue ne bouge pas.
  PERFORM pg_temp.eq((SELECT unit_cogs FROM products WHERE id = v_p1), 10.000,
    'unit_cogs est intact : le coût est enregistré, pas propagé');
  PERFORM pg_temp.eq((v_out->>'costs_adopted')::INTEGER, 0, 'aucun coût adopté');

  PERFORM set_config('request.jwt.claims', '', TRUE);
END
$t3$;

\echo ''
\echo '── 4. une réception validée est définitive ───────────────────────────'

DO $t4$
DECLARE
  v_rec   UUID := current_setting('r.recA')::UUID;
  v_state TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);

  v_state := pg_temp.err(format('SELECT post_reception(%L::UUID, %L::UUID, FALSE)',
                                v_rec, current_setting('r.mm')));
  PERFORM pg_temp.ok(v_state <> 'NO_ERROR', 'une deuxième validation est refusée');
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = current_setting('r.p1')::UUID),
    110, 'le stock n''a pas été crédité deux fois');

  v_state := pg_temp.err(format(
    'UPDATE receptions SET supplier_name = ''triche'' WHERE id = %L::UUID', v_rec));
  PERFORM pg_temp.eq(v_state, '42501', 'modifier une réception validée est refusé');

  v_state := pg_temp.err(format('DELETE FROM receptions WHERE id = %L::UUID', v_rec));
  PERFORM pg_temp.eq(v_state, '42501', 'supprimer une réception validée est refusé');

  v_state := pg_temp.err(format(
    'UPDATE reception_lines SET received_qty = 999 WHERE reception_id = %L::UUID', v_rec));
  PERFORM pg_temp.eq(v_state, '42501', 'modifier la ligne d''une réception validée est refusé');

  PERFORM set_config('request.jwt.claims', '', TRUE);
END
$t4$;

\echo ''
\echo '── 5. abîmé n''entre pas en stock, et n''est pas un retour cassé ──────'

DO $t5$
DECLARE
  v_rec  UUID := gen_random_uuid();
  v_p2   UUID := current_setting('r.p2')::UUID;
  v_site UUID := current_setting('r.site')::UUID;
  v_out  json;
BEGIN
  INSERT INTO receptions (id, market_id, warehouse_id, reference, status, created_by)
  VALUES (v_rec, current_setting('r.market')::UUID, v_site,
          'RECTEST-' || current_setting('r.tag') || '-B', 'draft',
          current_setting('r.mm')::UUID);

  -- 20 reçues, 3 arrivées cassées.
  INSERT INTO reception_lines (reception_id, product_id, expected_qty, received_qty,
                               damaged_qty, unit_cost)
  VALUES (v_rec, v_p2, 25, 20, 3, 22.000);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);

  v_out := post_reception(v_rec, current_setting('r.mm')::UUID, FALSE);

  PERFORM pg_temp.eq((v_out->>'units')::INTEGER, 20, 'seules les 20 vendables entrent');
  PERFORM pg_temp.eq((v_out->>'damaged')::INTEGER, 3, 'les 3 abîmées sont rapportées');
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p2), 60,
    'le stock passe de 40 à 60, pas à 63');
  PERFORM pg_temp.eq((SELECT damaged_return_count FROM products WHERE id = v_p2), 0,
    'damaged_return_count reste à 0 : ce n''est pas un retour client');
  PERFORM pg_temp.eq(
    (SELECT current_stock FROM product_site_stock
      WHERE product_id = v_p2 AND warehouse_id = v_site AND variant_id IS NULL),
    60, 'la ligne de site existante a été incrémentée de 20');
  PERFORM pg_temp.eq((v_out->>'value')::NUMERIC, 440.000,
    'la valeur reçue exclut les abîmées (20 × 22,000)');

  PERFORM set_config('request.jwt.claims', '', TRUE);
  PERFORM set_config('r.recB', v_rec::TEXT, FALSE);
END
$t5$;

\echo ''
\echo '── 6. p_adopt_costs recalcule unit_cogs en moyenne pondérée ──────────'

DO $t6$
DECLARE
  v_rec UUID := gen_random_uuid();
  v_p1  UUID := current_setting('r.p1')::UUID;
  v_out json;
BEGIN
  -- p1 : 110 unités à 10,000. On reçoit 40 à 20,000.
  -- Attendu : (110×10 + 40×20) / 150 = 1900/150 = 12,667.
  INSERT INTO receptions (id, market_id, warehouse_id, reference, status, created_by)
  VALUES (v_rec, current_setting('r.market')::UUID, current_setting('r.site')::UUID,
          'RECTEST-' || current_setting('r.tag') || '-C', 'submitted',
          current_setting('r.mm')::UUID);

  INSERT INTO reception_lines (reception_id, product_id, received_qty, unit_cost)
  VALUES (v_rec, v_p1, 40, 20.000);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);

  v_out := post_reception(v_rec, current_setting('r.mm')::UUID, TRUE);

  PERFORM pg_temp.eq((v_out->>'costs_adopted')::INTEGER, 1, 'un coût adopté');
  PERFORM pg_temp.eq((SELECT unit_cogs FROM products WHERE id = v_p1), 12.667,
    'unit_cogs = (110×10 + 40×20) / 150 = 12,667');
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p1), 150,
    'et le stock suit');

  PERFORM set_config('request.jwt.claims', '', TRUE);
END
$t6$;

\echo ''
\echo '── 7. contre-passer rend le stock, et refuse si les unités sont parties'

DO $t7$
DECLARE
  v_recB  UUID := current_setting('r.recB')::UUID;
  v_p2    UUID := current_setting('r.p2')::UUID;
  v_site  UUID := current_setting('r.site')::UUID;
  v_state TEXT;
  v_out   json;
BEGIN
  -- Un manager ne contre-passe pas.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);
  v_state := pg_temp.err(format('SELECT reverse_reception(%L::UUID, %L::UUID, NULL)',
                                v_recB, current_setting('r.mm')));
  PERFORM pg_temp.eq(v_state, '42501', 'un market_manager ne contre-passe pas');

  -- Les unités sont parties : le refus doit précéder toute écriture.
  UPDATE products SET current_stock = 5 WHERE id = v_p2;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('r.sa'), 'role', 'authenticated')::TEXT, TRUE);
  v_state := pg_temp.err(format('SELECT reverse_reception(%L::UUID, %L::UUID, NULL)',
                                v_recB, current_setting('r.sa')));
  PERFORM pg_temp.ok(v_state <> 'NO_ERROR',
    'contre-passer est refusé quand le stock est déjà sous les unités reçues');
  PERFORM pg_temp.eq((SELECT status FROM receptions WHERE id = v_recB), 'posted',
    'la réception est restée validée');
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p2), 5,
    'aucune écriture partielle');

  -- On remet le stock et on contre-passe pour de vrai.
  UPDATE products SET current_stock = 60 WHERE id = v_p2;
  v_out := reverse_reception(v_recB, current_setting('r.sa')::UUID, NULL);

  PERFORM pg_temp.eq((v_out->>'units')::INTEGER, 20, 'la contre-passation rend 20 unités');
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p2), 40,
    'le stock revient à 40');
  PERFORM pg_temp.eq((SELECT status FROM receptions WHERE id = v_recB), 'reversed',
    'la réception d''origine est contre-passée');
  PERFORM pg_temp.eq(
    (SELECT count(*)::INTEGER FROM inventory_log
      WHERE reason = 'reception_reversal'
        AND reception_id = (v_out->>'reversal_reception_id')::UUID),
    1, 'une ligne de registre reception_reversal');
  PERFORM pg_temp.eq(
    (SELECT change FROM inventory_log
      WHERE reception_id = (v_out->>'reversal_reception_id')::UUID LIMIT 1),
    -20, 'et son change est négatif');
  PERFORM pg_temp.eq(
    (SELECT current_stock FROM product_site_stock
      WHERE product_id = v_p2 AND warehouse_id = v_site AND variant_id IS NULL),
    40, 'la ligne de site est redescendue à 40');

  PERFORM set_config('request.jwt.claims', '', TRUE);
END
$t7$;

\echo ''
\echo '── 8. aucune RPC de réception n''est exécutable par anon ──────────────'

DO $t8$
DECLARE
  v_bad TEXT := '';
  v_fn  RECORD;
BEGIN
  FOR v_fn IN
    SELECT p.proname,
           has_function_privilege('anon', p.oid, 'EXECUTE')   AS anon_ok,
           has_function_privilege('public', p.oid, 'EXECUTE') AS pub_ok
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('post_reception', 'reverse_reception', 'next_reception_reference')
  LOOP
    IF v_fn.anon_ok OR v_fn.pub_ok THEN
      v_bad := v_bad || v_fn.proname || ' ';
    END IF;
  END LOOP;

  PERFORM pg_temp.eq(v_bad, '', 'aucune RPC de réception ouverte à anon/PUBLIC');

  PERFORM pg_temp.eq(has_table_privilege('anon', 'public.receptions', 'SELECT'), FALSE,
    'anon ne lit pas receptions');
  PERFORM pg_temp.eq(has_table_privilege('anon', 'public.reception_payments', 'SELECT'), FALSE,
    'anon ne lit pas les paiements');
END
$t8$;

\echo ''
\echo '── 9. le motif reception est au vocabulaire du registre ──────────────'

DO $t9$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.inventory_log'::regclass AND conname = 'inventory_log_reason_check';

  PERFORM pg_temp.ok(v_def LIKE '%reception%', 'reception est dans la contrainte');
  PERFORM pg_temp.ok(v_def LIKE '%reception_reversal%',
    'reception_reversal est dans la contrainte');
  -- Et les dix motifs d'origine sont toujours là.
  PERFORM pg_temp.ok(v_def LIKE '%initial_stock%' AND v_def LIKE '%stock_count%'
                     AND v_def LIKE '%manual_delete_reversal%' AND v_def LIKE '%deposit%',
    'les motifs d''origine sont préservés');
END
$t9$;

\echo ''
\echo '✓ goods_reception_test.sql'
