-- Voix du client — customer_feedback, feedback_topics, customer_feedback_events
-- (plans/voix-du-client.md, migrations 20261002120000…120200).
--
-- CE QUE CE FICHIER PROUVE
--   1. Privilèges : anon n'exécute aucune RPC et ne lit rien ; authenticated n'écrit jamais
--      les tables en direct — tout passe par les RPC.
--   2. Création : le MOMENT est déduit côté serveur du statut de la commande (le client ne
--      l'envoie pas), le client et le produit viennent de la commande, une réclamation
--      s'ouvre « open », les autres n'ont pas de statut.
--   3. Isolation : un agent n'écrit pas dans l'autre marché ; un manager de l'autre marché
--      ne lit rien ; un entrepôt ne crée rien ; le sujet doit être de la bonne catégorie.
--   4. Validation par le responsable : garder / ignorer, réservés aux managers du marché.
--   5. Cycle de la réclamation : prendre en charge → résolue → rouvrir, et rien pour un agent.
--   6. Le journal des événements est en écriture seule.
--   7. Annuler (5 s) : l'auteur seulement.
--   8. Les remarques du livreur deviennent des suggestions — une seule par colis, jamais pour
--      « لا يرد ».
--   9. L'import des notes « Autre » : les mots-clés, la date de l'historique, idempotent.
--  10. feedback_cube : ce qui est à valider ou ignoré ne compte pas.

\set ON_ERROR_STOP on
\i _helpers.sql

\echo ''
\echo '── 0. Fixture ─────────────────────────────────────────────────────────'
DO $fixture$
DECLARE
  v_ly    UUID := '00000000-0000-0000-0000-000000000002';
  v_tn    UUID := '00000000-0000-0000-0000-000000000001';
  v_tag   TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_a1    UUID := gen_random_uuid();
  v_a2    UUID := gen_random_uuid();
  v_mm    UUID := gen_random_uuid();
  v_mmtn  UUID := gen_random_uuid();
  v_wh    UUID := gen_random_uuid();
  v_sly   UUID;
  v_stn   UUID;
  v_p     UUID := gen_random_uuid();
  v_ptn   UUID := gen_random_uuid();
  v_o     UUID[] := ARRAY[]::UUID[];
  v_st    TEXT[] := ARRAY['pending','delivered','cancelled','out_for_delivery','rejected','rejected','cancelled'];
  v_trk   BOOLEAN[] := ARRAY[FALSE, TRUE, TRUE, TRUE, FALSE, FALSE, TRUE];
  v_otn   UUID := gen_random_uuid();
  i       INT;
BEGIN
  SELECT id INTO v_sly FROM storefronts WHERE market_id = v_ly LIMIT 1;
  SELECT id INTO v_stn FROM storefronts WHERE market_id = v_tn LIMIT 1;
  IF v_sly IS NULL OR v_stn IS NULL THEN RAISE EXCEPTION 'Fixture incomplète : boutique LY/TN manquante'; END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'sqltest.fb.' || u.k || '.' || v_tag || '@oms.local', 'x', now(), now(), now()
  FROM (VALUES (v_a1,'a1'),(v_a2,'a2'),(v_mm,'mm'),(v_mmtn,'mmtn'),(v_wh,'wh')) u(id,k);
  INSERT INTO public.users (id, email, full_name, role, market_id, is_active)
  VALUES (v_a1,   'sqltest.fb.a1.'   || v_tag || '@oms.local', 'FB Agent1 ' || v_tag, 'agent', v_ly, TRUE),
         (v_a2,   'sqltest.fb.a2.'   || v_tag || '@oms.local', 'FB Agent2 ' || v_tag, 'agent', v_ly, TRUE),
         (v_mm,   'sqltest.fb.mm.'   || v_tag || '@oms.local', 'FB Manager ' || v_tag, 'market_manager', v_ly, TRUE),
         (v_mmtn, 'sqltest.fb.mmtn.' || v_tag || '@oms.local', 'FB Manager TN ' || v_tag, 'market_manager', v_tn, TRUE),
         (v_wh,   'sqltest.fb.wh.'   || v_tag || '@oms.local', 'FB Entrepot ' || v_tag, 'warehouse_agent', v_ly, TRUE);

  INSERT INTO products (id, market_id, name, unit_cogs, default_price)
  VALUES (v_p, v_ly, 'SQLTEST FB ' || v_tag, 10, 100), (v_ptn, v_tn, 'SQLTEST FB TN ' || v_tag, 10, 100);

  -- o1 pending · o2 delivered · o3 cancelled après expédition · o4 en livraison
  -- o5/o6 rejetées « Autre » (import) · o7 annulée par Darb (remarque du livreur)
  FOR i IN 1..7 LOOP
    v_o := v_o || gen_random_uuid();
    INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                        customer_name, customer_phone, product_id, product_name, quantity, unit_price, total_price,
                        status, assigned_to, tracking_number)
    VALUES (v_o[i], v_ly, v_sly, 'SQLTEST-FB-' || v_tag || '-' || i, 'manual',
            'Client ' || i, '09' || lpad((floor(random() * 100000000))::TEXT, 8, '0'),
            v_p, 'SQLTEST FB', 1, 100, 100, v_st[i]::order_status, v_a1,
            CASE WHEN v_trk[i] THEN 'TRK' || v_tag || i END);
  END LOOP;
  INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                      customer_name, customer_phone, product_id, product_name, quantity, unit_price, total_price, status)
  VALUES (v_otn, v_tn, v_stn, 'SQLTEST-FB-TN-' || v_tag, 'manual', 'Client TN', '2' || lpad((floor(random() * 10000000))::TEXT, 7, '0'),
          v_ptn, 'SQLTEST FB TN', 1, 100, 100, 'pending');

  PERFORM set_config('r.a1', v_a1::TEXT, FALSE);
  PERFORM set_config('r.a2', v_a2::TEXT, FALSE);
  PERFORM set_config('r.mm', v_mm::TEXT, FALSE);
  PERFORM set_config('r.mmtn', v_mmtn::TEXT, FALSE);
  PERFORM set_config('r.wh', v_wh::TEXT, FALSE);
  PERFORM set_config('r.p', v_p::TEXT, FALSE);
  PERFORM set_config('r.otn', v_otn::TEXT, FALSE);
  FOR i IN 1..7 LOOP PERFORM set_config('r.o' || i, v_o[i]::TEXT, FALSE); END LOOP;
END $fixture$;

\echo ''
\echo '── 1. Privilèges ──────────────────────────────────────────────────────'
DO $t1$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.create_customer_feedback(text, text, uuid, uuid, uuid, uuid, text, uuid)',
    'public.keep_customer_feedback(uuid[])',
    'public.ignore_customer_feedback(uuid[])',
    'public.set_feedback_complaint_status(uuid, text)',
    'public.delete_customer_feedback(uuid)',
    'public.feedback_cube(uuid, date, date, text)'
  ] LOOP
    PERFORM pg_temp.ok(NOT has_function_privilege('anon', f, 'EXECUTE'), 'anon n''exécute pas ' || f);
    PERFORM pg_temp.ok(has_function_privilege('authenticated', f, 'EXECUTE'), 'authenticated exécute ' || f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'public.feedback_import_autre_notes()',
    'public.feedback_suggest_from_shipment(uuid)'
  ] LOOP
    PERFORM pg_temp.ok(NOT has_function_privilege('anon', f, 'EXECUTE'), 'anon n''exécute pas ' || f);
    PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', f, 'EXECUTE'), 'authenticated n''exécute pas ' || f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.customer_feedback','public.feedback_topics','public.customer_feedback_events'] LOOP
    PERFORM pg_temp.ok(NOT has_table_privilege('anon', f, 'SELECT'), 'anon ne lit pas ' || f);
    PERFORM pg_temp.ok(has_table_privilege('authenticated', f, 'SELECT'), 'authenticated lit ' || f || ' (sous RLS)');
    PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', f, 'INSERT'), 'authenticated n''insère pas dans ' || f);
    PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', f, 'UPDATE'), 'authenticated ne modifie pas ' || f);
    PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', f, 'DELETE'), 'authenticated ne supprime pas ' || f);
  END LOOP;
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM feedback_topics WHERE market_id = '00000000-0000-0000-0000-000000000002'), 16,
    'les 16 sujets du semis existent pour la Libye');
END $t1$;

\echo ''
\echo '── 2. Création — moment, client, produit, statut ──────────────────────'
DO $t2$
DECLARE
  v_id    UUID;
  v_r     customer_feedback;
  v_card  UUID := (SELECT id FROM feedback_topics WHERE market_id = '00000000-0000-0000-0000-000000000002' AND key = 'card');
  v_never UUID := (SELECT id FROM feedback_topics WHERE market_id = '00000000-0000-0000-0000-000000000002' AND key = 'never');
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.a1'), 'role', 'authenticated')::TEXT, TRUE);

  v_id := create_customer_feedback('objection', '  قال اريد الدفع بالبطاقة  ', v_card, current_setting('r.o1')::UUID);
  SELECT * INTO v_r FROM customer_feedback WHERE id = v_id;
  PERFORM pg_temp.eq(v_r.moment::TEXT, 'call', 'commande en attente → moment « call »');
  PERFORM pg_temp.eq(v_r.body, 'قال اريد الدفع بالبطاقة', 'les mots sont gardés, sans les espaces autour');
  PERFORM pg_temp.eq(v_r.customer_id, (SELECT customer_id FROM orders WHERE id = current_setting('r.o1')::UUID), 'le client vient de la commande');
  PERFORM pg_temp.ok(v_r.customer_id IS NOT NULL, 'la commande a bien un client lié');
  PERFORM pg_temp.eq(v_r.product_id, current_setting('r.p')::UUID, 'le produit vient de la commande');
  PERFORM pg_temp.eq(v_r.market_id, '00000000-0000-0000-0000-000000000002'::UUID, 'le marché vient de la commande');
  PERFORM pg_temp.ok(v_r.status IS NULL, 'une objection n''a pas de statut');
  PERFORM pg_temp.eq(v_r.created_by, current_setting('r.a1')::UUID, 'l''auteur est auth.uid()');
  PERFORM pg_temp.eq(v_r.source, 'agent', 'source agent par défaut');
  PERFORM pg_temp.ok(NOT v_r.needs_review, 'une saisie d''agent n''est pas à valider');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM customer_feedback_events WHERE feedback_id = v_id AND kind = 'created'), 1, 'un événement « created »');
  PERFORM set_config('r.f1', v_id::TEXT, FALSE);

  v_id := create_customer_feedback('reclamation', 'حاجزه وموصلتهاش الاوله', v_never, current_setting('r.o2')::UUID);
  SELECT * INTO v_r FROM customer_feedback WHERE id = v_id;
  PERFORM pg_temp.eq(v_r.moment::TEXT, 'after', 'commande livrée → moment « after »');
  PERFORM pg_temp.eq(v_r.status, 'open', 'une réclamation s''ouvre « open »');
  PERFORM set_config('r.f2', v_id::TEXT, FALSE);

  v_id := create_customer_feedback('objection', 'معنديش فلوس', NULL, current_setting('r.o3')::UUID);
  PERFORM pg_temp.eq((SELECT moment::TEXT FROM customer_feedback WHERE id = v_id), 'door', 'annulée après expédition → moment « door »');
  v_id := create_customer_feedback('suggestion', 'يبي حجم اكبر', NULL, current_setting('r.o4')::UUID);
  PERFORM pg_temp.eq((SELECT moment::TEXT FROM customer_feedback WHERE id = v_id), 'transit', 'en livraison → moment « transit »');
  v_id := create_customer_feedback('suggestion', 'أعجبته الخدمة');
  SELECT * INTO v_r FROM customer_feedback WHERE id = v_id;
  PERFORM pg_temp.eq(v_r.moment::TEXT, 'call', 'sans commande → moment « call »');
  PERFORM pg_temp.eq(v_r.market_id, '00000000-0000-0000-0000-000000000002'::UUID, 'sans commande → le marché de l''agent');
  PERFORM set_config('r.f5', v_id::TEXT, FALSE);

  PERFORM pg_temp.eq(pg_temp.err(format('SELECT create_customer_feedback(%L, %L, %L::UUID)', 'objection', 'x', v_never)), '22023',
    'un sujet d''une autre catégorie est refusé');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT create_customer_feedback(%L, %L)', 'objection', '   ')), '22023', 'des mots vides sont refusés');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT create_customer_feedback(%L, %L)', 'compliment', 'x')), '22023', 'une catégorie inconnue est refusée');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT create_customer_feedback(%L, %L, NULL, NULL, NULL, NULL, %L)', 'objection', 'x', 'courier')), '22023',
    'le client ne peut pas se dire « livreur »');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT create_customer_feedback(%L, %L, NULL, NULL, NULL, NULL, %L)', 'objection', 'x', 'import')), '22023',
    'ni « import »');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT create_customer_feedback(%L, %L, NULL, %L::UUID)', 'objection', 'x', current_setting('r.otn'))), '42501',
    'un agent libyen n''écrit pas sur une commande tunisienne');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.wh'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT create_customer_feedback(%L, %L)', 'objection', 'x')), '42501', 'un agent d''entrepôt ne crée rien');

  PERFORM set_config('request.jwt.claims', '', TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT create_customer_feedback(%L, %L)', 'objection', 'x')), '42501', 'sans session : refusé');
END $t2$;

\echo ''
\echo '── 3. Lecture sous RLS ────────────────────────────────────────────────'
DO $t3$
DECLARE
  v_n INT;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.a2'), 'role', 'authenticated')::TEXT, TRUE);
  SELECT count(*) INTO v_n FROM customer_feedback WHERE id = current_setting('r.f1')::UUID;
  PERFORM pg_temp.eq(v_n, 1, 'un collègue du même marché lit le retour');
  SELECT count(*) INTO v_n FROM customer_feedback_events WHERE feedback_id = current_setting('r.f1')::UUID;
  PERFORM pg_temp.eq(v_n, 1, 'et son journal');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mmtn'), 'role', 'authenticated')::TEXT, TRUE);
  SELECT count(*) INTO v_n FROM customer_feedback WHERE id = current_setting('r.f1')::UUID;
  PERFORM pg_temp.eq(v_n, 0, 'le manager tunisien ne lit pas un retour libyen');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.wh'), 'role', 'authenticated')::TEXT, TRUE);
  SELECT count(*) INTO v_n FROM customer_feedback WHERE id = current_setting('r.f1')::UUID;
  PERFORM pg_temp.eq(v_n, 0, 'l''entrepôt ne lit rien');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.a1'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format('UPDATE customer_feedback SET body = %L WHERE id = %L::UUID', 'x', current_setting('r.f1'))), '42501',
    'un agent ne modifie pas la table en direct');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', TRUE);
END $t3$;

\echo ''
\echo '── 4. Garder / ignorer ────────────────────────────────────────────────'
DO $t4$
DECLARE
  v_id  UUID := gen_random_uuid();
  v_id2 UUID := gen_random_uuid();
  v_r   customer_feedback;
BEGIN
  -- Deux suggestions à valider, comme l'import et le livreur les écrivent.
  INSERT INTO customer_feedback (id, market_id, category, moment, body, source, needs_review, order_id, product_id)
  VALUES (v_id,  '00000000-0000-0000-0000-000000000002', 'reclamation', 'door', 'مش نفس لي في نت', 'courier', TRUE, current_setting('r.o7')::UUID, current_setting('r.p')::UUID),
         (v_id2, '00000000-0000-0000-0000-000000000002', 'objection', 'call', 'قال سعره غالي', 'import', TRUE, current_setting('r.o6')::UUID, current_setting('r.p')::UUID);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.a1'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT keep_customer_feedback(ARRAY[%L::UUID])', v_id)), '42501', 'un agent ne valide pas');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mmtn'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(keep_customer_feedback(ARRAY[v_id]), 0, 'le manager tunisien ne valide rien en Libye');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(keep_customer_feedback(ARRAY[v_id]), 1, 'le manager libyen garde la suggestion');
  SELECT * INTO v_r FROM customer_feedback WHERE id = v_id;
  PERFORM pg_temp.ok(NOT v_r.needs_review, 'elle n''est plus à valider');
  PERFORM pg_temp.eq(v_r.status, 'open', 'une réclamation gardée s''ouvre');
  PERFORM pg_temp.eq(v_r.reviewed_by, current_setting('r.mm')::UUID, 'qui l''a gardée');
  PERFORM pg_temp.eq(keep_customer_feedback(ARRAY[v_id]), 0, 'garder deux fois ne fait rien');

  PERFORM pg_temp.eq(ignore_customer_feedback(ARRAY[v_id2]), 1, 'le manager ignore l''autre');
  PERFORM pg_temp.ok((SELECT deleted_at IS NOT NULL FROM customer_feedback WHERE id = v_id2), 'ignorée = supprimée en douceur');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM customer_feedback_events WHERE feedback_id = v_id2 AND kind = 'ignored'), 1, 'un événement « ignored »');
  PERFORM set_config('r.fk', v_id::TEXT, FALSE);
  PERFORM set_config('request.jwt.claims', '', TRUE);
END $t4$;

\echo ''
\echo '── 5. Cycle de la réclamation ─────────────────────────────────────────'
DO $t5$
DECLARE
  v_id UUID := current_setting('r.f2')::UUID;
  v_r  customer_feedback;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.a1'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT set_feedback_complaint_status(%L::UUID, %L)', v_id, 'resolved')), '42501', 'un agent ne résout pas');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM set_feedback_complaint_status(v_id, 'in_progress');
  SELECT * INTO v_r FROM customer_feedback WHERE id = v_id;
  PERFORM pg_temp.eq(v_r.status, 'in_progress', 'prise en charge');
  PERFORM pg_temp.eq(v_r.assigned_to, current_setting('r.mm')::UUID, 'le responsable devient celui qui la prend');

  PERFORM set_feedback_complaint_status(v_id, 'resolved');
  SELECT * INTO v_r FROM customer_feedback WHERE id = v_id;
  PERFORM pg_temp.eq(v_r.status, 'resolved', 'résolue');
  PERFORM pg_temp.ok(v_r.resolved_at IS NOT NULL AND v_r.resolved_by = current_setting('r.mm')::UUID, 'quand et par qui');

  PERFORM set_feedback_complaint_status(v_id, 'open');
  SELECT * INTO v_r FROM customer_feedback WHERE id = v_id;
  PERFORM pg_temp.eq(v_r.status, 'open', 'rouverte');
  PERFORM pg_temp.ok(v_r.resolved_at IS NULL AND v_r.resolved_by IS NULL, 'la résolution est effacée');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM customer_feedback_events WHERE feedback_id = v_id AND kind = 'status'), 3, 'trois événements « status »');

  PERFORM pg_temp.eq(pg_temp.err(format('SELECT set_feedback_complaint_status(%L::UUID, %L)', current_setting('r.f1'), 'resolved')), '22023',
    'une objection n''a pas de cycle');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT set_feedback_complaint_status(%L::UUID, %L)', v_id, 'done')), '22023', 'un statut inconnu est refusé');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mmtn'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT set_feedback_complaint_status(%L::UUID, %L)', v_id, 'resolved')), '42501',
    'le manager tunisien ne touche pas une réclamation libyenne');
  PERFORM set_config('request.jwt.claims', '', TRUE);

  -- La contrainte tient même en écriture directe.
  PERFORM pg_temp.eq(pg_temp.err(format(
    'INSERT INTO customer_feedback (market_id, category, moment, body, source) VALUES (%L, %L, %L, %L, %L)',
    '00000000-0000-0000-0000-000000000002', 'reclamation', 'call', 'x', 'agent')), '23514',
    'une réclamation validée sans statut viole la contrainte');
  PERFORM pg_temp.eq(pg_temp.err(format(
    'INSERT INTO customer_feedback (market_id, category, moment, body, source, status) VALUES (%L, %L, %L, %L, %L, %L)',
    '00000000-0000-0000-0000-000000000002', 'objection', 'call', 'x', 'agent', 'open')), '23514',
    'une objection avec un statut viole la contrainte');
END $t5$;

\echo ''
\echo '── 6. Journal en écriture seule ───────────────────────────────────────'
DO $t6$
BEGIN
  PERFORM pg_temp.eq(pg_temp.err(format('UPDATE customer_feedback_events SET kind = %L WHERE feedback_id = %L::UUID', 'edited', current_setting('r.f1'))), '42501',
    'UPDATE refusé sur le journal');
  PERFORM pg_temp.eq(pg_temp.err(format('DELETE FROM customer_feedback_events WHERE feedback_id = %L::UUID', current_setting('r.f1'))), '42501',
    'DELETE refusé sur le journal');
END $t6$;

\echo ''
\echo '── 7. Annuler — l''auteur seulement ───────────────────────────────────'
DO $t7$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.a2'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT delete_customer_feedback(%L::UUID)', current_setting('r.f5'))), '42501', 'un collègue n''annule pas');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.a1'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM delete_customer_feedback(current_setting('r.f5')::UUID);
  PERFORM pg_temp.ok((SELECT deleted_at IS NOT NULL FROM customer_feedback WHERE id = current_setting('r.f5')::UUID), 'l''auteur annule sa saisie');
  PERFORM set_config('request.jwt.claims', '', TRUE);

  UPDATE customer_feedback SET created_at = now() - interval '1 hour' WHERE id = current_setting('r.f1')::UUID;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.a1'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT delete_customer_feedback(%L::UUID)', current_setting('r.f1'))), '42501',
    'une heure après, l''auteur ne peut plus annuler');
  PERFORM set_config('request.jwt.claims', '', TRUE);
END $t7$;

\echo ''
\echo '── 8. Remarques du livreur → suggestions ──────────────────────────────'
DO $t8$
DECLARE
  v_s1 UUID := gen_random_uuid();
  v_s2 UUID := gen_random_uuid();
  v_r  customer_feedback;
  v_n  INT;
BEGIN
  INSERT INTO darb_shipments (id, darb_id, order_id, latest_remark, latest_remark_at, remark_class, remark_class_source)
  VALUES (v_s1, 'SQLTEST-' || v_s1, current_setting('r.o7')::UUID, '  قال مش نفس لي في نت ', now() - interval '3 days', 'wrong_item', 'latest_remark');
  SELECT * INTO v_r FROM customer_feedback WHERE courier_shipment_id = v_s1;
  PERFORM pg_temp.ok(v_r.id IS NOT NULL, 'un colis « pas conforme » crée une suggestion');
  PERFORM pg_temp.eq(v_r.source, 'courier', 'source livreur');
  PERFORM pg_temp.ok(v_r.needs_review, 'à valider par le responsable');
  PERFORM pg_temp.eq(v_r.category::TEXT, 'reclamation', 'wrong_item → réclamation');
  PERFORM pg_temp.eq((SELECT key FROM feedback_topics WHERE id = v_r.topic_id), 'nonconform', '… non conforme');
  PERFORM pg_temp.ok(v_r.status IS NULL, 'pas de statut tant qu''elle est à valider');
  PERFORM pg_temp.eq(v_r.moment::TEXT, 'door', 'annulée après expédition → à la porte');
  PERFORM pg_temp.eq(v_r.body, 'قال مش نفس لي في نت', 'les mots du livreur');
  PERFORM pg_temp.ok(abs(extract(epoch FROM v_r.created_at - (now() - interval '3 days'))) < 2, 'datée de la remarque');
  PERFORM pg_temp.ok(v_r.created_by IS NULL, 'aucun agent n''en est l''auteur');

  UPDATE darb_shipments SET remark_class = 'coordinated' WHERE id = v_s1;
  UPDATE darb_shipments SET remark_class = 'wrong_item' WHERE id = v_s1;
  SELECT count(*) INTO v_n FROM customer_feedback WHERE courier_shipment_id = v_s1;
  PERFORM pg_temp.eq(v_n, 1, 'une seule suggestion par colis, même si la classe revient');
  PERFORM pg_temp.eq(feedback_suggest_from_shipment(v_s1), FALSE, 'le rattrapage est idempotent');

  INSERT INTO darb_shipments (id, darb_id, order_id, latest_remark, latest_remark_at, remark_class, remark_class_source)
  VALUES (v_s2, 'SQLTEST-' || v_s2, current_setting('r.o4')::UUID, 'لا يرد', now(), 'no_answer', 'latest_remark');
  SELECT count(*) INTO v_n FROM customer_feedback WHERE courier_shipment_id = v_s2;
  PERFORM pg_temp.eq(v_n, 0, '« لا يرد » ne crée rien');
  UPDATE darb_shipments SET remark_class = 'no_cash', latest_remark = 'زبون قالي توا معنديش فلوس' WHERE id = v_s2;
  SELECT * INTO v_r FROM customer_feedback WHERE courier_shipment_id = v_s2;
  PERFORM pg_temp.eq((SELECT key FROM feedback_topics WHERE id = v_r.topic_id), 'nocash', 'no_cash → objection · pas de cash');
  PERFORM pg_temp.eq(v_r.moment::TEXT, 'transit', 'en livraison → en route');
END $t8$;

\echo ''
\echo '── 9. Import des notes « Autre » ──────────────────────────────────────'
DO $t9$
DECLARE
  v_n   INT;
  v_r   customer_feedback;
  v_at  TIMESTAMPTZ := now() - interval '20 days';
BEGIN
  UPDATE orders SET rejection_reason = 'autre', rejection_note = 'قال اريد الدفع بالبطاقة' WHERE id = current_setting('r.o5')::UUID;
  UPDATE orders SET rejection_reason = 'autre', rejection_note = 'لم أطلب شيئا' WHERE id = current_setting('r.o6')::UUID;
  INSERT INTO order_history (order_id, market_id, status_from, status_to, actor_id, actor_type, created_at)
  VALUES (current_setting('r.o5')::UUID, '00000000-0000-0000-0000-000000000002', 'pending', 'rejected', current_setting('r.a2')::UUID, 'agent', v_at),
         (current_setting('r.o6')::UUID, '00000000-0000-0000-0000-000000000002', 'pending', 'rejected', current_setting('r.a2')::UUID, 'agent', v_at);

  -- o6 a déjà une ligne import ignorée (section 4) : elle ne revient pas, et « لم أطلب » n'est pas un retour.
  v_n := feedback_import_autre_notes();
  SELECT * INTO v_r FROM customer_feedback WHERE order_id = current_setting('r.o5')::UUID AND source = 'import';
  PERFORM pg_temp.ok(v_r.id IS NOT NULL, '« بالبطاقة » est importée');
  PERFORM pg_temp.eq(v_r.category::TEXT, 'objection', '… en objection');
  PERFORM pg_temp.eq((SELECT key FROM feedback_topics WHERE id = v_r.topic_id), 'card', '… carte ou virement');
  PERFORM pg_temp.ok(v_r.needs_review, '… à valider');
  PERFORM pg_temp.eq(v_r.created_by, current_setting('r.a2')::UUID, '… l''auteur est l''agent qui a refusé');
  PERFORM pg_temp.ok(abs(extract(epoch FROM v_r.created_at - v_at)) < 1, '… datée par l''historique, pas par updated_at');
  PERFORM pg_temp.eq(v_r.moment::TEXT, 'call', '… pendant l''appel');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM customer_feedback WHERE order_id = current_setting('r.o6')::UUID AND source = 'import' AND deleted_at IS NULL), 0,
    '« لم أطلب » n''est pas importée');
  PERFORM pg_temp.eq(feedback_import_autre_notes(), 0, 'relancer l''import n''ajoute rien');
END $t9$;

\echo ''
\echo '── 10. feedback_cube ──────────────────────────────────────────────────'
DO $t10$
DECLARE
  v_n INT;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);
  SELECT coalesce(sum(n), 0)::INT INTO v_n FROM feedback_cube('00000000-0000-0000-0000-000000000002', current_date - 400, current_date + 1, 'Africa/Tripoli')
  WHERE product_id = current_setting('r.p')::UUID;
  -- f1 objection, f2 réclamation, o3 objection, o4 suggestion, fk gardée = 5 ; f5 annulée (sans produit de toute façon),
  -- l'ignorée, la courier v_s2 et l'import à valider ne comptent pas.
  PERFORM pg_temp.eq(v_n, 5, 'le cube compte ce qui est validé et vivant');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mmtn'), 'role', 'authenticated')::TEXT, TRUE);
  SELECT coalesce(sum(n), 0)::INT INTO v_n FROM feedback_cube('00000000-0000-0000-0000-000000000002', current_date - 400, current_date + 1, 'Africa/Tripoli');
  PERFORM pg_temp.eq(v_n, 0, 'le manager tunisien ne voit rien de la Libye dans le cube');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', TRUE);
END $t10$;

\echo ''
\echo '✓ customer_feedback_test.sql'
