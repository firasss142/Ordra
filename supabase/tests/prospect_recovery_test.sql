-- Prospects → récupérer les ventes perdues (20261006100200…100400).
--
-- CE QUE CE FICHIER PROUVE
--   1. prospect_recovery_settings : défauts (Libye allumée, Tunisie éteinte),
--      fusion d'un réglage enveloppé { value } partiel.
--   2. campaign_audience_rows v2 : rejection_subreasons, product_windows (une
--      fenêtre par produit), 'returning' / 'to_be_returned', et
--      guards.no_order_after_outcome → 'recentlyOrdered' ; preview le compte.
--   3. Win-back : à l'entrée du chemin du retour, une seule fois par colis, à
--      l'agent de la commande s'il est actif, sinon au pool ; éteint par
--      ret.on = false et par l'ancien lead_winback_disabled.
--   4. prospects_daily_tick : disabled / not_hour / already_ran ; refus
--      rattrapables et anciens clients créés avec CHACUNE des règles d'exclusion ;
--      fermeture « a recommandé seul » et « injoignable » ; retour au pool, et le
--      prospect repris n'est pas rendu au même agent ; journal du jour.
--   5. Répartition : plafond du dossier, l'agent de la commande d'origine
--      d'abord, priorité des sources, agents hors rotation exclus, listes
--      WhatsApp API exclues du pool.
--   6. get_prospect_desk : les sources somment au hero, l'agent porte ses
--      livraisons, on_road / returned / called_today.
--
-- TOUT TOURNE DANS UNE TRANSACTION ANNULÉE À LA FIN. Le tick et la répartition
-- agissent sur tout le marché : pour mesurer, ce fichier neutralise les autres
-- agents (part à 0) et les autres prospects ouverts (archivés), ce qu'aucune
-- base locale partagée ne doit garder. Aucune contrainte différée n'est en jeu
-- ici (README, règle 2).

\set ON_ERROR_STOP on
BEGIN;
\i _helpers.sql

-- Une commande, son historique daté.
CREATE OR REPLACE FUNCTION pg_temp.mk_order(
  p_phone TEXT, p_product UUID, p_status TEXT, p_created TIMESTAMPTZ,
  p_agent UUID, p_sub TEXT DEFAULT NULL, p_hist_at TIMESTAMPTZ DEFAULT NULL, p_total NUMERIC DEFAULT 100
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  v_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                      customer_name, customer_phone, product_id, product_name, quantity, unit_price, total_price,
                      status, assigned_to, rejection_reason, rejection_subreason, created_at)
  VALUES (v_id, '00000000-0000-0000-0000-000000000002', current_setting('r.sf')::uuid,
          'SQLTEST-PR-' || v_id, 'manual', 'Client ' || p_phone, p_phone, p_product, 'SQLTEST PR', 1, p_total, p_total,
          p_status::order_status, p_agent,
          CASE WHEN p_sub IS NOT NULL THEN 'injoignable'::rejection_reason END, p_sub, p_created);
  IF p_hist_at IS NOT NULL THEN
    INSERT INTO order_history (order_id, status_from, status_to, actor_type, note, created_at)
    VALUES (v_id, 'pending', p_status::order_status, 'system', 'sqltest', p_hist_at);
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.set_rules(p JSONB) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO settings (market_id, key, value)
  VALUES ('00000000-0000-0000-0000-000000000002', 'prospect_recovery', jsonb_build_object('value', p))
  ON CONFLICT (market_id, key) DO UPDATE SET value = EXCLUDED.value;
$$;

\echo ''
\echo '── 0. Fixture ─────────────────────────────────────────────────────────'
DO $fixture$
DECLARE
  v_ly  UUID := '00000000-0000-0000-0000-000000000002';
  v_tag TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_base TEXT := lpad((floor(random() * 9000) + 1000)::TEXT, 4, '0');
  v_mm UUID := gen_random_uuid();
  v_a1 UUID := gen_random_uuid();
  v_a2 UUID := gen_random_uuid();
  v_a3 UUID := gen_random_uuid();  -- inactif
  v_a4 UUID := gen_random_uuid();  -- actif, part 0
  v_p  UUID := gen_random_uuid();
  v_p2 UUID := gen_random_uuid();
  v_sf UUID;
BEGIN
  SELECT id INTO v_sf FROM storefronts WHERE market_id = v_ly AND is_active ORDER BY created_at LIMIT 1;
  IF v_sf IS NULL THEN RAISE EXCEPTION 'Fixture incomplète : boutique LY manquante'; END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'sqltest.pr.' || u.k || '.' || v_tag || '@oms.local', 'x', now(), now(), now()
  FROM (VALUES (v_mm,'mm'),(v_a1,'a1'),(v_a2,'a2'),(v_a3,'a3'),(v_a4,'a4')) u(id,k);
  INSERT INTO public.users (id, email, full_name, role, market_id, is_active)
  VALUES (v_mm, 'sqltest.pr.mm.' || v_tag || '@oms.local', 'PR Manager ' || v_tag, 'market_manager', v_ly, TRUE),
         (v_a1, 'sqltest.pr.a1.' || v_tag || '@oms.local', 'PR A1 ' || v_tag, 'agent', v_ly, TRUE),
         (v_a2, 'sqltest.pr.a2.' || v_tag || '@oms.local', 'PR A2 ' || v_tag, 'agent', v_ly, TRUE),
         (v_a3, 'sqltest.pr.a3.' || v_tag || '@oms.local', 'PR A3 ' || v_tag, 'agent', v_ly, FALSE),
         (v_a4, 'sqltest.pr.a4.' || v_tag || '@oms.local', 'PR A4 ' || v_tag, 'agent', v_ly, TRUE);

  INSERT INTO products (id, market_id, name, unit_cogs, default_price)
  VALUES (v_p, v_ly, 'SQLTEST PR ' || v_tag, 10, 249), (v_p2, v_ly, 'SQLTEST PR2 ' || v_tag, 10, 199);

  -- Isoler la répartition : seuls a1 et a2 ont une part.
  INSERT INTO agent_distribution_shares (market_id, agent_id, share_pct)
  SELECT v_ly, u.id, 0 FROM users u WHERE u.market_id = v_ly AND u.role = 'agent'
  ON CONFLICT (market_id, agent_id) DO UPDATE SET share_pct = 0;
  UPDATE agent_distribution_shares SET share_pct = 50 WHERE market_id = v_ly AND agent_id IN (v_a1, v_a2);
  -- Et le pool : les prospects ouverts d'avant ne concourent pas.
  UPDATE leads SET status = 'archived' WHERE market_id = v_ly AND status NOT IN ('won', 'lost', 'archived');

  PERFORM set_config('r.tag', v_tag, TRUE);
  PERFORM set_config('r.ph', '09' || v_base, TRUE);  -- + 4 chiffres par client
  PERFORM set_config('r.mm', v_mm::TEXT, TRUE);
  PERFORM set_config('r.a1', v_a1::TEXT, TRUE);
  PERFORM set_config('r.a2', v_a2::TEXT, TRUE);
  PERFORM set_config('r.a3', v_a3::TEXT, TRUE);
  PERFORM set_config('r.a4', v_a4::TEXT, TRUE);
  PERFORM set_config('r.p', v_p::TEXT, TRUE);
  PERFORM set_config('r.p2', v_p2::TEXT, TRUE);
  PERFORM set_config('r.sf', v_sf::TEXT, TRUE);
END $fixture$;

\echo ''
\echo '── 1. Réglages ────────────────────────────────────────────────────────'
DO $t1$
DECLARE
  v JSONB;
BEGIN
  DELETE FROM settings WHERE key = 'prospect_recovery';
  v := _prospect_recovery_settings('00000000-0000-0000-0000-000000000002');
  PERFORM pg_temp.eq((v->>'enabled')::BOOLEAN, TRUE, 'Libye : allumée par défaut');
  PERFORM pg_temp.eq((v->'rej'->>'delay_days')::INT, 3, 'rej.delay_days = 3');
  PERFORM pg_temp.eq(jsonb_array_length(v->'rej'->'subreasons'), 6, 'six sous-motifs par défaut');
  PERFORM pg_temp.eq((v->'old'->>'after_days')::INT, 30, 'old.after_days = 30');
  PERFORM pg_temp.eq(v->'dist', '{"hour": 9, "file_cap": 15, "max_tries": 3, "release_days": 3}'::jsonb, 'dist par défaut');
  PERFORM pg_temp.eq((_prospect_recovery_settings('00000000-0000-0000-0000-000000000001')->>'enabled')::BOOLEAN, FALSE,
                     'Tunisie : éteinte par défaut');

  PERFORM pg_temp.set_rules('{"dist": {"file_cap": 4}, "ret": {"on": false}}');
  v := _prospect_recovery_settings('00000000-0000-0000-0000-000000000002');
  PERFORM pg_temp.eq((v->'dist'->>'file_cap')::INT, 4, 'enveloppé partiel : file_cap fusionné');
  PERFORM pg_temp.eq((v->'dist'->>'hour')::INT, 9, 'le reste de dist garde ses défauts');
  PERFORM pg_temp.eq((v->'ret'->>'on')::BOOLEAN, FALSE, 'ret.on lu');
  PERFORM pg_temp.eq((v->>'enabled')::BOOLEAN, TRUE, 'enabled absent → défaut du marché');

  UPDATE settings SET value = '{"enabled": false, "rej": {"delay_days": 5}}'::jsonb
   WHERE market_id = '00000000-0000-0000-0000-000000000002' AND key = 'prospect_recovery';
  v := _prospect_recovery_settings('00000000-0000-0000-0000-000000000002');
  PERFORM pg_temp.eq((v->>'enabled')::BOOLEAN, FALSE, 'nu : enabled = false lu');
  PERFORM pg_temp.eq((v->'rej'->>'delay_days')::INT, 5, 'nu : delay_days lu');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq((prospect_recovery_settings('00000000-0000-0000-0000-000000000002')->'rej'->>'delay_days')::INT, 5,
                     'le manager lit les règles de son marché');
  PERFORM set_config('request.jwt.claims', '', TRUE);
END $t1$;

\echo ''
\echo '── 2. Les commandes de la fixture ─────────────────────────────────────'
DO $orders$
DECLARE
  ph TEXT := current_setting('r.ph');
  p  UUID := current_setting('r.p')::uuid;
  p2 UUID := current_setting('r.p2')::uuid;
  a1 UUID := current_setting('r.a1')::uuid;
  a2 UUID := current_setting('r.a2')::uuid;
  v_id UUID;
BEGIN
  -- Refus. r1 ✓ · r2 sous-motif hors liste · r3 trop tôt · r4 trop vieux ·
  -- r5 a recommandé · r6 prospect ouvert · r7 à risque · r8/r9 même client ·
  -- r10 déjà un prospect sur cette commande.
  PERFORM set_config('r.r1',  pg_temp.mk_order(ph||'0001', p, 'rejected', now()-interval '9 days', a1, 'pas_de_reponse', now()-interval '5 days')::TEXT, TRUE);
  PERFORM set_config('r.r2',  pg_temp.mk_order(ph||'0002', p, 'rejected', now()-interval '9 days', a1, 'numero_invalide', now()-interval '5 days')::TEXT, TRUE);
  PERFORM set_config('r.r3',  pg_temp.mk_order(ph||'0003', p, 'rejected', now()-interval '2 days', a1, 'prix_eleve', now()-interval '1 day')::TEXT, TRUE);
  PERFORM set_config('r.r4',  pg_temp.mk_order(ph||'0004', p, 'rejected', now()-interval '20 days', a1, 'prix_eleve', now()-interval '15 days')::TEXT, TRUE);
  PERFORM set_config('r.r5',  pg_temp.mk_order(ph||'0005', p, 'rejected', now()-interval '9 days', a1, 'raccroche', now()-interval '5 days')::TEXT, TRUE);
  PERFORM pg_temp.mk_order(ph||'0005', p, 'pending', now()-interval '2 days', NULL);
  PERFORM set_config('r.r6',  pg_temp.mk_order(ph||'0006', p, 'rejected', now()-interval '9 days', a1, 'raccroche', now()-interval '5 days')::TEXT, TRUE);
  INSERT INTO leads (market_id, source, status, customer_name, customer_phone, created_at)
  VALUES ('00000000-0000-0000-0000-000000000002', 'manual_call', 'attempt_1', 'Ouvert', '+218 ' || substr(ph, 2) || '0006', now() - interval '20 days');
  PERFORM set_config('r.r7',  pg_temp.mk_order(ph||'0007', p, 'rejected', now()-interval '9 days', a1, 'prix_eleve', now()-interval '5 days')::TEXT, TRUE);
  UPDATE customers SET risk_class = 'risk'
   WHERE market_id = '00000000-0000-0000-0000-000000000002' AND phone_normalized = normalize_phone(ph||'0007');
  PERFORM set_config('r.r8',  pg_temp.mk_order(ph||'0008', p, 'rejected', now()-interval '10 days', a1, 'prix_eleve', now()-interval '6 days')::TEXT, TRUE);
  PERFORM set_config('r.r9',  pg_temp.mk_order(ph||'0008', p, 'rejected', now()-interval '10 days', a2, 'changement_avis', now()-interval '4 days')::TEXT, TRUE);
  -- Deux rejets font un client « risk » (customer_risk_class) : on isole ici la
  -- règle « un par client », pas celle du risque (r7 la couvre).
  UPDATE customers SET risk_class = 'none'
   WHERE market_id = '00000000-0000-0000-0000-000000000002' AND phone_normalized = normalize_phone(ph||'0008');
  PERFORM set_config('r.r10', pg_temp.mk_order(ph||'0010', p, 'rejected', now()-interval '9 days', a1, 'prix_eleve', now()-interval '5 days')::TEXT, TRUE);
  INSERT INTO leads (market_id, source, status, customer_name, customer_phone, source_order_id, lost_reason, created_at)
  VALUES ('00000000-0000-0000-0000-000000000002', 'campaign', 'lost', 'Déjà', ph||'0010',
          current_setting('r.r10')::uuid, 'not_interested', now() - interval '3 days');

  -- Livrés. d1 ✓ · d2 trop récent (p2) · d3 a recommandé · d4 re-achat il y a 60 j · d5 à risque
  PERFORM set_config('r.d1', pg_temp.mk_order(ph||'0101', p,  'delivered', now()-interval '40 days', a2, NULL, now()-interval '32 days', 249)::TEXT, TRUE);
  PERFORM set_config('r.d2', pg_temp.mk_order(ph||'0102', p2, 'delivered', now()-interval '25 days', a2, NULL, now()-interval '20 days', 199)::TEXT, TRUE);
  PERFORM set_config('r.d3', pg_temp.mk_order(ph||'0103', p,  'delivered', now()-interval '40 days', a2, NULL, now()-interval '32 days')::TEXT, TRUE);
  PERFORM pg_temp.mk_order(ph||'0103', p2, 'cancelled', now()-interval '10 days', NULL);
  PERFORM set_config('r.d4', pg_temp.mk_order(ph||'0104', p,  'delivered', now()-interval '40 days', a2, NULL, now()-interval '32 days')::TEXT, TRUE);
  INSERT INTO leads (market_id, source, status, customer_name, customer_phone, lost_reason, created_at)
  VALUES ('00000000-0000-0000-0000-000000000002', 'repeat_buyer', 'lost', 'Re-achat', ph||'0104', 'not_interested', now() - interval '60 days');
  PERFORM set_config('r.d5', pg_temp.mk_order(ph||'0105', p,  'delivered', now()-interval '40 days', a2, NULL, now()-interval '32 days')::TEXT, TRUE);
  UPDATE customers SET risk_class = 'risk'
   WHERE market_id = '00000000-0000-0000-0000-000000000002' AND phone_normalized = normalize_phone(ph||'0105');

  -- Colis sur le chemin du retour.
  PERFORM set_config('r.w1', pg_temp.mk_order(ph||'0201', p, 'out_for_delivery', now()-interval '6 days', a1, NULL, now()-interval '3 days')::TEXT, TRUE);
  PERFORM set_config('r.w2', pg_temp.mk_order(ph||'0202', p, 'out_for_delivery', now()-interval '6 days', current_setting('r.a3')::uuid, NULL, now()-interval '3 days')::TEXT, TRUE);
  PERFORM set_config('r.w3', pg_temp.mk_order(ph||'0203', p, 'out_for_delivery', now()-interval '6 days', a1, NULL, now()-interval '3 days')::TEXT, TRUE);
  PERFORM set_config('r.w4', pg_temp.mk_order(ph||'0204', p, 'out_for_delivery', now()-interval '6 days', a1, NULL, now()-interval '3 days')::TEXT, TRUE);
END $orders$;

\echo ''
\echo '── 3. campaign_audience_rows v2 ───────────────────────────────────────'
DO $t3$
DECLARE
  ph TEXT := current_setting('r.ph');
  f  JSONB;
  v_phones TEXT[];
  v_prev JSONB;
BEGIN
  -- rejection_subreasons
  f := jsonb_build_object('order_statuses', jsonb_build_array('rejected'),
                          'product_ids', jsonb_build_array(current_setting('r.p')),
                          'rejection_subreasons', jsonb_build_array('pas_de_reponse'));
  SELECT array_agg(customer_phone) INTO v_phones
    FROM campaign_audience_rows('00000000-0000-0000-0000-000000000002', f) WHERE excluded_by IS NULL;
  PERFORM pg_temp.ok(ph||'0001' = ANY (v_phones), 'rejection_subreasons : r1 (pas_de_reponse) retenu');
  PERFORM pg_temp.ok(NOT (ph||'0002' = ANY (v_phones)), 'rejection_subreasons : r2 (numero_invalide) écarté');
  PERFORM pg_temp.eq(cardinality(v_phones), 1, 'un seul client');

  -- product_windows : p dans [-40 j, -30 j], p2 dans [-10 j, maintenant]
  f := jsonb_build_object('order_statuses', jsonb_build_array('delivered'),
         'product_windows', jsonb_build_array(
           jsonb_build_object('product_id', current_setting('r.p'),  'from', now() - interval '40 days', 'to', now() - interval '30 days'),
           jsonb_build_object('product_id', current_setting('r.p2'), 'from', now() - interval '10 days', 'to', now())));
  SELECT array_agg(customer_phone) INTO v_phones
    FROM campaign_audience_rows('00000000-0000-0000-0000-000000000002', f) WHERE excluded_by IS NULL;
  PERFORM pg_temp.ok(ph||'0101' = ANY (v_phones), 'product_windows : d1 (p, livré il y a 32 j) dans sa fenêtre');
  PERFORM pg_temp.ok(NOT (ph||'0102' = ANY (v_phones)), 'product_windows : d2 (p2, livré il y a 20 j) hors de SA fenêtre');
  PERFORM pg_temp.ok((SELECT bool_and(customer_phone LIKE ph || '%') FROM campaign_audience_rows('00000000-0000-0000-0000-000000000002', f)),
                     'product_windows seul limite aux produits nommés');

  f := jsonb_set(f, '{product_windows,1,from}', to_jsonb(now() - interval '25 days'));
  SELECT array_agg(customer_phone) INTO v_phones
    FROM campaign_audience_rows('00000000-0000-0000-0000-000000000002', f) WHERE excluded_by IS NULL;
  PERFORM pg_temp.ok(ph||'0102' = ANY (v_phones), 'product_windows : d2 entre quand sa fenêtre s''élargit');

  -- p sans fenêtre → date_from / date_to ; p2 avec fenêtre
  f := jsonb_build_object('order_statuses', jsonb_build_array('delivered'),
         'product_ids', jsonb_build_array(current_setting('r.p')),
         'date_from', now() - interval '5 days',
         'product_windows', jsonb_build_array(
           jsonb_build_object('product_id', current_setting('r.p2'), 'from', now() - interval '25 days')));
  SELECT array_agg(customer_phone) INTO v_phones
    FROM campaign_audience_rows('00000000-0000-0000-0000-000000000002', f) WHERE excluded_by IS NULL;
  PERFORM pg_temp.ok(ph||'0102' = ANY (v_phones), 'p2 suit sa fenêtre');
  PERFORM pg_temp.ok(NOT (coalesce(ph||'0101' = ANY (v_phones), FALSE)), 'p sans fenêtre suit date_from (32 j > 5 j : écarté)');

  -- guards.no_order_after_outcome : d3 a recommandé après sa livraison
  f := jsonb_build_object('order_statuses', jsonb_build_array('delivered'),
                          'product_ids', jsonb_build_array(current_setting('r.p')),
                          'date_from', now() - interval '40 days');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM campaign_audience_rows('00000000-0000-0000-0000-000000000002', f)
                              WHERE customer_phone = ph||'0103' AND excluded_by IS NULL),
                     'sans la garde, d3 est retenu');
  f := f || '{"guards": {"no_order_after_outcome": true}}';
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM campaign_audience_rows('00000000-0000-0000-0000-000000000002', f)
                              WHERE customer_phone = ph||'0103' AND excluded_by = 'recentlyOrdered'),
                     'avec no_order_after_outcome, d3 → recentlyOrdered');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM campaign_audience_rows('00000000-0000-0000-0000-000000000002', f)
                              WHERE customer_phone = ph||'0101' AND excluded_by IS NULL),
                     'd1, qui n''a rien recommandé, reste');
  v_prev := preview_campaign_audience('00000000-0000-0000-0000-000000000002', f);
  PERFORM pg_temp.ok((v_prev->'excluded'->>'recentlyOrdered')::INT >= 1, 'preview compte recentlyOrdered');

  -- Les anciennes clés gardent leur sens
  f := jsonb_build_object('order_statuses', jsonb_build_array('rejected'),
                          'product_id', current_setting('r.p'),
                          'rejection_reasons', jsonb_build_array('injoignable'),
                          'guards', jsonb_build_object('not_ordered_days', 3));
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM campaign_audience_rows('00000000-0000-0000-0000-000000000002', f)
                              WHERE customer_phone = ph||'0005' AND excluded_by = 'recentlyOrdered'),
                     'product_id + rejection_reasons + not_ordered_days : inchangés');
END $t3$;

\echo ''
\echo '── 4. Win-back sur le chemin du retour ────────────────────────────────'
DO $t4$
DECLARE
  w1 UUID := current_setting('r.w1')::uuid;
  w2 UUID := current_setting('r.w2')::uuid;
  w3 UUID := current_setting('r.w3')::uuid;
  w4 UUID := current_setting('r.w4')::uuid;
  v_l leads;
BEGIN
  PERFORM pg_temp.set_rules('{}');
  UPDATE orders SET status = 'returning' WHERE id = w1;
  INSERT INTO order_history (order_id, status_from, status_to, actor_type, note) VALUES (w1, 'out_for_delivery', 'returning', 'system', 'sqltest');
  SELECT * INTO v_l FROM leads WHERE source_order_id = w1 AND source = 'winback';
  PERFORM pg_temp.ok(v_l.id IS NOT NULL, 'returning → un prospect win-back');
  PERFORM pg_temp.eq(v_l.assigned_to, current_setting('r.a1')::uuid, 'à l''agent de la commande');
  PERFORM pg_temp.eq(v_l.status::TEXT, 'assigned', 'statut assigned');
  PERFORM pg_temp.eq(v_l.product_interest_id, current_setting('r.p')::uuid, 'le produit de la commande');

  UPDATE orders SET status = 'to_be_returned' WHERE id = w1;
  INSERT INTO order_history (order_id, status_from, status_to, actor_type, note) VALUES (w1, 'returning', 'to_be_returned', 'system', 'sqltest');
  UPDATE orders SET status = 'returned' WHERE id = w1;
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM leads WHERE source_order_id = w1), 1, 'to_be_returned puis returned : toujours un seul');

  UPDATE orders SET status = 'to_be_returned' WHERE id = w2;
  SELECT * INTO v_l FROM leads WHERE source_order_id = w2 AND source = 'winback';
  PERFORM pg_temp.ok(v_l.id IS NOT NULL, 'to_be_returned d''abord → un prospect');
  PERFORM pg_temp.ok(v_l.assigned_to IS NULL, 'agent inactif → au pool');
  PERFORM pg_temp.eq(v_l.status::TEXT, 'new', 'statut new');

  PERFORM pg_temp.set_rules('{"ret": {"on": false}}');
  UPDATE orders SET status = 'returning' WHERE id = w3;
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM leads WHERE source_order_id = w3), 0, 'ret.on = false : rien');

  PERFORM pg_temp.set_rules('{}');
  INSERT INTO settings (market_id, key, value) VALUES ('00000000-0000-0000-0000-000000000002', 'lead_winback_disabled', '{"value": true}')
  ON CONFLICT (market_id, key) DO UPDATE SET value = EXCLUDED.value;
  UPDATE orders SET status = 'returning' WHERE id = w4;
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM leads WHERE source_order_id = w4), 0, 'lead_winback_disabled : rien');
  DELETE FROM settings WHERE market_id = '00000000-0000-0000-0000-000000000002' AND key = 'lead_winback_disabled';

  PERFORM pg_temp.set_rules('{"enabled": false}');
  UPDATE orders SET status = 'returning' WHERE id = current_setting('r.w3')::uuid;  -- déjà returning : no-op
  PERFORM pg_temp.set_rules('{}');
END $t4$;

\echo ''
\echo '── 5. Le tick ─────────────────────────────────────────────────────────'
DO $t5$
DECLARE
  ph TEXT := current_setting('r.ph');
  a1 UUID := current_setting('r.a1')::uuid;
  a2 UUID := current_setting('r.a2')::uuid;
  v_hour INT := extract(hour FROM now() AT TIME ZONE 'Africa/Tripoli')::INT;
  v_r JSONB;
  v_l leads;
  v_c1 UUID := gen_random_uuid();
  v_u1 UUID := gen_random_uuid();
  v_u2 UUID := gen_random_uuid();
  v_s1 UUID := gen_random_uuid();
  v_s2 UUID := gen_random_uuid();
BEGIN
  -- Leads à fermer / rendre.
  INSERT INTO leads (id, market_id, source, status, customer_name, customer_phone, assigned_to, created_at)
  VALUES (v_c1, '00000000-0000-0000-0000-000000000002', 'campaign', 'attempt_1', 'C1', ph||'0301', a1, now() - interval '5 days'),
         (v_u1, '00000000-0000-0000-0000-000000000002', 'campaign', 'attempt_3', 'U1', ph||'0302', a1, now() - interval '9 days'),
         (v_u2, '00000000-0000-0000-0000-000000000002', 'campaign', 'attempt_3', 'U2', ph||'0303', a1, now() - interval '9 days'),
         (v_s1, '00000000-0000-0000-0000-000000000002', 'campaign', 'assigned',  'S1', ph||'0304', a2, now() - interval '10 days'),
         (v_s2, '00000000-0000-0000-0000-000000000002', 'campaign', 'assigned',  'S2', ph||'0305', a2, now() - interval '10 days');
  PERFORM pg_temp.mk_order(ph||'0301', current_setting('r.p')::uuid, 'pending', now() - interval '1 day', NULL);
  INSERT INTO lead_history (lead_id, status_from, status_to, actor_id, actor_type, created_at)
  VALUES (v_u1, 'attempt_2', 'attempt_3', a1, 'agent', now() - interval '2 days'),
         (v_u2, 'attempt_2', 'attempt_3', a1, 'agent', now() - interval '1 hour'),
         (v_s1, 'new', 'assigned', NULL, 'system', now() - interval '5 days'),
         (v_s2, 'new', 'assigned', NULL, 'system', now() - interval '1 day');
  PERFORM set_config('r.s1', v_s1::TEXT, TRUE);

  -- Porte : éteint, pas l'heure, déjà passé.
  PERFORM pg_temp.set_rules('{"enabled": false}');
  PERFORM pg_temp.eq(prospects_daily_tick('00000000-0000-0000-0000-000000000002')->>'skipped_reason', 'disabled', 'éteint : rien');
  PERFORM pg_temp.set_rules(jsonb_build_object('dist', jsonb_build_object('hour', (v_hour + 1) % 24, 'file_cap', 50)));
  PERFORM pg_temp.eq(prospects_daily_tick('00000000-0000-0000-0000-000000000002')->>'skipped_reason', 'not_hour', 'pas l''heure : rien');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM leads WHERE source_order_id = current_setting('r.r1')::uuid), 'rien n''a été créé');

  -- L'heure réglée = maintenant : le tick passe.
  PERFORM pg_temp.set_rules(jsonb_build_object('dist', jsonb_build_object('hour', v_hour, 'file_cap', 50)));
  DELETE FROM prospect_tick_log WHERE market_id = '00000000-0000-0000-0000-000000000002';
  v_r := prospects_daily_tick('00000000-0000-0000-0000-000000000002');
  RAISE NOTICE '  tick : %', v_r;
  PERFORM pg_temp.ok(v_r->>'skipped_reason' IS NULL, 'à l''heure : le tick passe');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM prospect_tick_log WHERE market_id = '00000000-0000-0000-0000-000000000002'
                              AND ran_on = (now() AT TIME ZONE 'Africa/Tripoli')::date), 'journal du jour écrit');
  PERFORM pg_temp.eq(prospects_daily_tick('00000000-0000-0000-0000-000000000002')->>'skipped_reason', 'already_ran',
                     'deuxième passage du jour : rien');

  -- a. Refus
  SELECT * INTO v_l FROM leads WHERE source_order_id = current_setting('r.r1')::uuid;
  PERFORM pg_temp.eq(v_l.source::TEXT, 'rejected_order', 'r1 → prospect rejected_order');
  PERFORM pg_temp.eq(v_l.return_reason, 'pas_de_reponse', 'le sous-motif en raison');
  PERFORM pg_temp.eq(v_l.product_interest_id, current_setting('r.p')::uuid, 'le produit de la commande');
  PERFORM pg_temp.eq(v_l.assigned_to, a1, 'réparti à l''agent de la commande d''origine');
  PERFORM pg_temp.eq(v_l.status::TEXT, 'assigned', 'new → assigned à la répartition');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM leads WHERE source_order_id = current_setting('r.r2')::uuid), 'r2 : sous-motif hors liste');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM leads WHERE source_order_id = current_setting('r.r3')::uuid), 'r3 : rejeté hier, trop tôt');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM leads WHERE source_order_id = current_setting('r.r4')::uuid), 'r4 : rejeté il y a 15 j, trop tard');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM leads WHERE source_order_id = current_setting('r.r5')::uuid), 'r5 : a recommandé depuis');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM leads WHERE source_order_id = current_setting('r.r6')::uuid), 'r6 : un prospect ouvert (numéro écrit autrement)');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM leads WHERE source_order_id = current_setting('r.r7')::uuid), 'r7 : client à risque');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM leads WHERE source_order_id = current_setting('r.r10')::uuid), 1, 'r10 : déjà un prospect sur cette commande');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM leads WHERE customer_phone = ph||'0008' AND source = 'rejected_order'), 1, 'r8/r9 : un seul prospect par client');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM leads WHERE source_order_id = current_setting('r.r9')::uuid AND source = 'rejected_order'), 'et sur le rejet le plus récent');

  -- b. Anciens clients
  SELECT * INTO v_l FROM leads WHERE source_order_id = current_setting('r.d1')::uuid;
  PERFORM pg_temp.eq(v_l.source::TEXT, 'repeat_buyer', 'd1 → prospect repeat_buyer');
  PERFORM pg_temp.eq(v_l.product_interest_id, current_setting('r.p')::uuid, 'le produit reçu');
  PERFORM pg_temp.eq(v_l.assigned_to, a2, 'à l''agent qui avait la commande');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM leads WHERE source_order_id = current_setting('r.d2')::uuid), 'd2 : livré il y a 20 j, trop tôt');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM leads WHERE source_order_id = current_setting('r.d3')::uuid), 'd3 : a recommandé');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM leads WHERE customer_phone = ph||'0104'), 1, 'd4 : déjà relancé il y a 60 j');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM leads WHERE source_order_id = current_setting('r.d5')::uuid), 'd5 : client à risque');

  -- c. a recommandé seul
  SELECT * INTO v_l FROM leads WHERE id = v_c1;
  PERFORM pg_temp.eq(v_l.status::TEXT, 'lost', 'C1 fermé');
  PERFORM pg_temp.eq(v_l.lost_reason::TEXT, 'autre', 'motif autre');
  PERFORM pg_temp.eq(v_l.lost_note, 'a recommandé seul', '« a recommandé seul »');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM lead_history WHERE lead_id = v_c1 AND status_to = 'lost' AND actor_type = 'system'), 'historique système');

  -- d. injoignable
  PERFORM pg_temp.eq((SELECT lost_reason::TEXT FROM leads WHERE id = v_u1), 'unreachable', 'U1 : 3 tentatives, rien depuis 2 j → injoignable');
  PERFORM pg_temp.eq((SELECT status::TEXT FROM leads WHERE id = v_u2), 'attempt_3', 'U2 : dernière tentative il y a 1 h → reste');

  -- e. retour au pool
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM lead_history WHERE lead_id = v_s1 AND note LIKE 'Rendu au pool%'), 'S1 rendu au pool');
  PERFORM pg_temp.ok((SELECT assigned_to IS DISTINCT FROM a2 FROM leads WHERE id = v_s1), 'S1 n''est pas rendu à a2 dans la même passe');
  PERFORM pg_temp.eq((SELECT assigned_to FROM leads WHERE id = v_s2), a2, 'S2 touché hier → reste à a2');

  PERFORM pg_temp.ok((v_r->>'created_rej')::INT >= 2, 'compteur created_rej');
  PERFORM pg_temp.ok((v_r->>'created_old')::INT >= 1, 'compteur created_old');
  PERFORM pg_temp.ok((v_r->>'closed_reordered')::INT >= 1, 'compteur closed_reordered');
  PERFORM pg_temp.ok((v_r->>'closed_unreachable')::INT >= 1, 'compteur closed_unreachable');
  PERFORM pg_temp.ok((v_r->>'released')::INT >= 1, 'compteur released');
  PERFORM pg_temp.ok((v_r->>'assigned')::INT >= 3, 'compteur assigned');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM leads l WHERE l.assigned_to IN (current_setting('r.a3')::uuid, current_setting('r.a4')::uuid)),
                     'ni l''agent inactif ni l''agent sans part ne reçoivent rien');

  -- p_force passe même déjà passé, et à une autre heure.
  PERFORM pg_temp.set_rules(jsonb_build_object('dist', jsonb_build_object('hour', (v_hour + 3) % 24)));
  PERFORM pg_temp.ok(prospects_daily_tick('00000000-0000-0000-0000-000000000002', TRUE)->>'skipped_reason' IS NULL, 'p_force : passe');
END $t5$;

\echo ''
\echo '── 6. Répartition : plafond, agent d''origine, priorité ────────────────'
DO $t6$
DECLARE
  ph TEXT := current_setting('r.ph');
  p  UUID := current_setting('r.p')::uuid;
  a1 UUID := current_setting('r.a1')::uuid;
  a2 UUID := current_setting('r.a2')::uuid;
  v_ly UUID := '00000000-0000-0000-0000-000000000002';
  v_p1 UUID := gen_random_uuid();
  v_p2 UUID := gen_random_uuid();
  v_p3 UUID := gen_random_uuid();
  v_p4 UUID := gen_random_uuid();
  v_p5 UUID := gen_random_uuid();
  v_p6 UUID := gen_random_uuid();
  v_k0 UUID := gen_random_uuid();
  v_c  UUID := gen_random_uuid();
  v_r  JSONB;
BEGIN
  UPDATE leads SET status = 'archived' WHERE market_id = v_ly AND status NOT IN ('won', 'lost', 'archived');
  PERFORM pg_temp.set_rules('{"dist": {"file_cap": 2}}');

  INSERT INTO prospect_campaigns (id, market_id, name, filter_json, channel, wa_sender, wa_message)
  VALUES (v_c, v_ly, 'SQLTEST PR WA ' || current_setting('r.tag'), '{}', 'wa', 'api', 'Bonjour');

  -- a1 a déjà 1 prospect ouvert (place : 1) ; a2 aucun (place : 2).
  INSERT INTO leads (id, market_id, source, status, customer_name, customer_phone, assigned_to, created_at, source_order_id, campaign_id)
  VALUES (v_k0, v_ly, 'campaign',       'assigned', 'K0', ph||'0400', a1,   now() - interval '1 hour', NULL, NULL),
         -- La campagne la plus ancienne, puis les sources prioritaires plus récentes.
         (v_p4, v_ly, 'campaign',       'new', 'P4', ph||'0404', NULL, now() - interval '9 days', NULL, NULL),
         (v_p5, v_ly, 'campaign',       'new', 'P5', ph||'0405', NULL, now() - interval '8 days', NULL, NULL),
         (v_p3, v_ly, 'repeat_buyer',   'new', 'P3', ph||'0403', NULL, now() - interval '7 days',
            pg_temp.mk_order(ph||'0403', p, 'delivered', now() - interval '50 days', a1), NULL),
         (v_p2, v_ly, 'rejected_order', 'new', 'P2', ph||'0402', NULL, now() - interval '6 days',
            pg_temp.mk_order(ph||'0402', p, 'rejected', now() - interval '20 days', a1), NULL),
         (v_p1, v_ly, 'winback',        'new', 'P1', ph||'0401', NULL, now() - interval '1 day',
            pg_temp.mk_order(ph||'0401', p, 'returning', now() - interval '20 days', a1), NULL),
         (v_p6, v_ly, 'campaign',       'new', 'P6', ph||'0406', NULL, now() - interval '30 days', NULL, v_c);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);
  v_r := prospects_distribute_now(v_ly);
  PERFORM set_config('request.jwt.claims', '', TRUE);

  PERFORM pg_temp.eq((v_r->>'assigned')::INT, 3, 'trois places, trois prospects répartis');
  PERFORM pg_temp.eq((v_r->>'pool_left')::INT, 2, 'deux restent au pool (la liste WhatsApp API n''y compte pas)');
  PERFORM pg_temp.eq((SELECT assigned_to FROM leads WHERE id = v_p1), a1, 'P1 (retour) d''abord, à a1, l''agent de la commande');
  PERFORM pg_temp.eq((SELECT assigned_to FROM leads WHERE id = v_p2), a2, 'P2 (refus) : a1 plein → a2');
  PERFORM pg_temp.eq((SELECT assigned_to FROM leads WHERE id = v_p3), a2, 'P3 (ancien client) : a2');
  PERFORM pg_temp.ok((SELECT assigned_to IS NULL FROM leads WHERE id = v_p4), 'P4 (campagne, plus ancienne) attend : priorité aux sources');
  PERFORM pg_temp.ok((SELECT assigned_to IS NULL FROM leads WHERE id = v_p6), 'P6 (WhatsApp API) jamais réparti');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM leads WHERE assigned_to = a1 AND status NOT IN ('won','lost','archived')), 2, 'a1 au plafond (2)');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM leads WHERE assigned_to = a2 AND status NOT IN ('won','lost','archived')), 2, 'a2 au plafond (2)');
  PERFORM pg_temp.eq((SELECT status::TEXT FROM leads WHERE id = v_p1), 'assigned', 'new → assigned');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM lead_history WHERE lead_id = v_p1 AND actor_type = 'system'
                              AND actor_id IS NULL AND note = 'Assigned to agent' AND status_to = 'assigned'),
                     'historique : même convention que bulk_assign_leads');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM prospect_tick_log WHERE market_id = v_ly AND (result->>'forced') IS NULL),
                     '« Répartir maintenant » n''écrit pas le journal du tick');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq((prospects_distribute_now(v_ly)->>'assigned')::INT, 0, 'dossiers pleins : plus rien');
  PERFORM set_config('request.jwt.claims', '', TRUE);

  PERFORM set_config('r.p2l', v_p2::TEXT, TRUE);
END $t6$;

\echo ''
\echo '── 7. get_prospect_desk ───────────────────────────────────────────────'
DO $t7$
DECLARE
  ph TEXT := current_setting('r.ph');
  p  UUID := current_setting('r.p')::uuid;
  a1 UUID := current_setting('r.a1')::uuid;
  a2 UUID := current_setting('r.a2')::uuid;
  v_ly UUID := '00000000-0000-0000-0000-000000000002';
  v_month DATE := (now() AT TIME ZONE 'Africa/Tripoli')::date;
  b JSONB;
  d JSONB;
  v_o1 UUID; v_o2 UUID; v_o3 UUID;
  v_ag JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);
  b := get_prospect_desk(v_ly, v_month, 'Africa/Tripoli');

  -- k1 refus ramené et livré · k2 retour ramené, en route · k3 ancien client ramené, revenu
  v_o1 := pg_temp.mk_order(ph||'0501', p, 'delivered', now() - interval '1 hour', a1, NULL, now(), 249);
  v_o2 := pg_temp.mk_order(ph||'0502', p, 'in_transit', now() - interval '1 hour', a2, NULL, NULL, 199);
  v_o3 := pg_temp.mk_order(ph||'0503', p, 'returning', now() - interval '1 hour', a2, NULL, NULL, 199);
  INSERT INTO leads (market_id, source, status, customer_name, customer_phone, assigned_to, converted_order_id)
  VALUES (v_ly, 'rejected_order', 'won', 'K1', ph||'0501', a1, v_o1),
         (v_ly, 'winback',        'won', 'K2', ph||'0502', a2, v_o2),
         (v_ly, 'repeat_buyer',   'won', 'K3', ph||'0503', a2, v_o3);
  -- a2 appelle P2 aujourd'hui, deux fois : un seul prospect.
  INSERT INTO lead_history (lead_id, status_from, status_to, actor_id, actor_type)
  VALUES (current_setting('r.p2l')::uuid, 'assigned', 'attempt_1', a2, 'agent'),
         (current_setting('r.p2l')::uuid, 'attempt_1', 'callback_scheduled', a2, 'agent');

  d := get_prospect_desk(v_ly, v_month, 'Africa/Tripoli');
  PERFORM set_config('request.jwt.claims', '', TRUE);

  PERFORM pg_temp.eq(d->'month'->>'from', to_char(date_trunc('month', v_month), 'YYYY-MM-DD'), 'month.from = le 1er');
  PERFORM pg_temp.eq((d->'hero'->>'delivered')::INT - (b->'hero'->>'delivered')::INT, 1, 'hero.delivered +1');
  PERFORM pg_temp.eq((d->'hero'->>'revenue')::NUMERIC - (b->'hero'->>'revenue')::NUMERIC, 249::NUMERIC, 'hero.revenue +249 (total_price)');
  PERFORM pg_temp.eq((d->'hero'->>'converted')::INT - (b->'hero'->>'converted')::INT, 3, 'hero.converted +3');
  PERFORM pg_temp.eq((d->'hero'->>'on_road')::INT - (b->'hero'->>'on_road')::INT, 1, 'hero.on_road +1');
  PERFORM pg_temp.eq((d->'hero'->>'returned')::INT - (b->'hero'->>'returned')::INT, 1, 'hero.returned +1');

  PERFORM pg_temp.eq((SELECT sum((s->>'delivered')::INT)::INT FROM jsonb_array_elements(d->'sources') s),
                     (d->'hero'->>'delivered')::INT, 'Σ sources.delivered = hero.delivered');
  PERFORM pg_temp.eq((SELECT sum((s->>'revenue')::NUMERIC) FROM jsonb_array_elements(d->'sources') s),
                     (d->'hero'->>'revenue')::NUMERIC, 'Σ sources.revenue = hero.revenue');
  PERFORM pg_temp.eq((SELECT string_agg(s->>'key', ',') FROM jsonb_array_elements(d->'sources') s), 'rej,ret,old,camp', 'quatre sources, dans l''ordre');
  PERFORM pg_temp.eq((SELECT (s->>'delivered')::INT FROM jsonb_array_elements(d->'sources') s WHERE s->>'key' = 'rej')
                     - (SELECT (s->>'delivered')::INT FROM jsonb_array_elements(b->'sources') s WHERE s->>'key' = 'rej'), 1, 'rej.delivered +1');
  PERFORM pg_temp.eq((SELECT sum((s->>'created')::INT)::INT FROM jsonb_array_elements(d->'sources') s),
                     (SELECT count(*)::INT FROM leads WHERE market_id = v_ly
                        AND created_at >= date_trunc('month', now() AT TIME ZONE 'Africa/Tripoli') AT TIME ZONE 'Africa/Tripoli'),
                     'Σ sources.created = prospects créés dans le mois');
  PERFORM pg_temp.eq((SELECT sum((s->>'to_call')::INT + (s->>'in_progress')::INT + (s->>'won')::INT + (s->>'lost')::INT)::INT
                        FROM jsonb_array_elements(d->'sources') s),
                     (SELECT sum((s->>'created')::INT)::INT FROM jsonb_array_elements(d->'sources') s),
                     'chaque source : to_call + in_progress + won + lost = created');

  SELECT a INTO v_ag FROM jsonb_array_elements(d->'agents') a WHERE a->>'id' = a1::TEXT;
  PERFORM pg_temp.eq((v_ag->>'delivered_month')::INT, 1, 'a1 : 1 livrée');
  PERFORM pg_temp.eq((v_ag->>'revenue_month')::NUMERIC, 249::NUMERIC, 'a1 : 249');
  PERFORM pg_temp.eq((v_ag->>'file_open')::INT, 2, 'a1 : dossier de 2');
  PERFORM pg_temp.eq((v_ag->>'in_rotation')::BOOLEAN, TRUE, 'a1 en rotation');
  SELECT a INTO v_ag FROM jsonb_array_elements(d->'agents') a WHERE a->>'id' = a2::TEXT;
  PERFORM pg_temp.eq((v_ag->>'called_today')::INT, 1, 'a2 : 1 prospect appelé aujourd''hui (deux issues, un prospect)');
  PERFORM pg_temp.eq((v_ag->>'converted_month')::INT, 2, 'a2 : 2 ramenées ce mois');
  PERFORM pg_temp.eq((v_ag->>'late_callbacks')::INT, 0, 'a2 : aucun rappel en retard');
  SELECT a INTO v_ag FROM jsonb_array_elements(d->'agents') a WHERE a->>'id' = current_setting('r.a4');
  PERFORM pg_temp.eq((v_ag->>'in_rotation')::BOOLEAN, FALSE, 'a4 (part 0) hors rotation, mais listé');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'agents') a WHERE a->>'id' = current_setting('r.a3')),
                     'a3 (inactif) absent');
  PERFORM pg_temp.eq((d->'pool'->>'open')::INT, 2, 'pool : P4 et P5');
  PERFORM pg_temp.ok((d->'pool'->>'oldest_days')::INT >= 8, 'pool : le plus ancien a 8 jours');
  PERFORM pg_temp.eq((d->>'open_total')::INT, 7, 'open_total : K0, P1–P6');
  PERFORM pg_temp.ok(d->>'last_tick_at' IS NOT NULL, 'last_tick_at');
  PERFORM pg_temp.eq((d->'settings'->'dist'->>'file_cap')::INT, 2, 'settings fusionnés');
END $t7$;

ROLLBACK;
