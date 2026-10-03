-- Transporteurs — get_carrier_scorecard + get_carrier_scorecard_parcels
-- (plans/transporteurs.md §4). Both read carrier_parcel_outcome.
--
-- CE QUE CE FICHIER PROUVE (à « maintenant » figé = 2026-09-20 12:00 UTC, 7 jours)
--   1. carriers.accent_color : couleur validée par défaut, et refus d'une valeur
--      qui n'est pas un hexadécimal.
--   2. La période : envoyés (sans les annulés avant ramassage), livrés, échoués,
--      en route ; la période d'avant ; ramassés vite ; 1er passage ; médiane et
--      « livrés en moins de 3 j ».
--   3. Maintenant : chez le transporteur, pas ramassés, tranches d'âge, en retard,
--      bloqués.
--   4. Retours : échoués, rendus, scannés, encore chez le transporteur, âge des
--      non scannés, délai médian de remise.
--   5. Les 13 semaines, les motifs, les villes.
--   6. Transporteur inactif avec des colis ouverts = ligne « dormant » ; un
--      transporteur actif qui n'a jamais rien porté n'est pas une carte.
--   7. Garde : un manager ne lit que son marché, un agent rien, anon n'exécute
--      pas ; la liste des colis suit la même garde.

\set ON_ERROR_STOP on
\i _helpers.sql

\echo ''
\echo '── fixture ────────────────────────────────────────────────────────────'

DO $fixture$
DECLARE
  v_tn UUID := '00000000-0000-0000-0000-000000000001';
  v_ly UUID := '00000000-0000-0000-0000-000000000002';
  v_sf_ly UUID := (SELECT id FROM storefronts WHERE market_id = '00000000-0000-0000-0000-000000000002' ORDER BY created_at LIMIT 1);
  v_sf_tn UUID := (SELECT id FROM storefronts WHERE market_id = '00000000-0000-0000-0000-000000000001' ORDER BY created_at LIMIT 1);
  v_a   UUID := 'cb000000-0000-4000-8000-0000000000a0';  -- Darb, active
  v_b   UUID := 'cb000000-0000-4000-8000-0000000000b0';  -- Navex, active
  v_d   UUID := 'cb000000-0000-4000-8000-0000000000d0';  -- inactive, open parcel
  v_e   UUID := 'cb000000-0000-4000-8000-0000000000e0';  -- active, never carried anything
  v_sa  UUID := 'cb000000-0000-4000-8000-0000000000f1';
  v_mm  UUID := 'cb000000-0000-4000-8000-0000000000f2';
  v_ag  UUID := 'cb000000-0000-4000-8000-0000000000f3';
  v_prod UUID := 'cb000000-0000-4000-8000-0000000000f9';
  o RECORD;
BEGIN
  PERFORM set_config('r.sa', v_sa::TEXT, FALSE);
  PERFORM set_config('r.mm', v_mm::TEXT, FALSE);
  PERFORM set_config('r.ag', v_ag::TEXT, FALSE);
  IF EXISTS (SELECT 1 FROM orders WHERE id = 'cb000000-0000-4000-8000-000000000001') THEN
    RAISE NOTICE '  fixture déjà là';
    RETURN;
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email, 'x', now(), now(), now()
  FROM (VALUES (v_sa, 'sqltest.sc.sa@oms.local'), (v_mm, 'sqltest.sc.mm@oms.local'), (v_ag, 'sqltest.sc.ag@oms.local')) u(id, email)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.users (id, email, full_name, role, market_id, is_active) VALUES
    (v_sa, 'sqltest.sc.sa@oms.local', 'SQL SC Admin', 'super_admin', NULL, TRUE),
    (v_mm, 'sqltest.sc.mm@oms.local', 'SQL SC Manager LY', 'market_manager', v_ly, TRUE),
    (v_ag, 'sqltest.sc.ag@oms.local', 'SQL SC Agent LY', 'agent', v_ly, TRUE)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, market_id = EXCLUDED.market_id;

  INSERT INTO carriers (id, market_id, name, code, is_active) VALUES
    (v_a, v_ly, 'SQLTEST SC Darb', 'darb_assabil', TRUE),
    (v_b, v_tn, 'SQLTEST SC Navex', 'navex', TRUE),
    (v_d, v_ly, 'SQLTEST SC Dormant', 'dexpress', FALSE),
    (v_e, v_ly, 'SQLTEST SC Empty', 'cosmos', TRUE)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO products (id, market_id, name, current_stock) VALUES (v_prod, v_ly, 'SQLTEST SC', 1) ON CONFLICT (id) DO NOTHING;

  -- n · carrier · status · city · uploaded
  FOR o IN SELECT * FROM (VALUES
    ( 1, v_a, 'delivered',        'طرابلس', '2026-09-14 08:00'),
    ( 2, v_a, 'delivered',        'طرابلس', '2026-09-14 08:00'),
    ( 3, v_a, 'cancelled',        'طرابلس', '2026-09-15 08:00'),
    ( 4, v_a, 'cancelled',        'بنغازي', '2026-09-15 08:00'),
    ( 5, v_a, 'out_for_delivery', 'طرابلس', '2026-09-16 08:00'),
    ( 6, v_a, 'uploaded',         'طرابلس', '2026-09-17 08:00'),
    ( 7, v_a, 'cancelled',        'طرابلس', '2026-09-18 08:00'),
    (11, v_a, 'delivered',        'طرابلس', '2026-09-08 08:00'),
    (12, v_a, 'cancelled',        'طرابلس', '2026-09-08 08:00'),
    (21, v_a, 'in_transit',       'طرابلس', '2026-08-20 08:00'),
    (31, v_a, 'cancelled',        'طرابلس', '2026-08-20 08:00'),
    (32, v_a, 'cancelled',        'طرابلس', '2026-07-28 08:00'),
    (33, v_a, 'cancelled',        'طرابلس', '2026-09-05 08:00'),
    (41, v_b, 'delivered',        'Sfax',   '2026-09-15 08:00'),
    (51, v_d, 'uploaded',         'X',      '2026-05-20 08:00')
  ) AS t(n, car, st, city, up)
  LOOP
    INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform, customer_name, customer_phone,
                        product_name, unit_price, total_price, status, carrier_id, customer_city, tracking_number, created_at)
    VALUES (('cb000000-0000-4000-8000-0000000000' || lpad(o.n::TEXT, 2, '0'))::UUID,
            CASE WHEN o.car = v_b THEN v_tn ELSE v_ly END, CASE WHEN o.car = v_b THEN v_sf_tn ELSE v_sf_ly END,
            'sqltest-sc-' || o.n, 'manual', 'Client ' || o.n, '+2189200000' || lpad(o.n::TEXT, 2, '0'),
            'SQLTEST', 100, 100, o.st::order_status, o.car, o.city, 'SC' || o.n, o.up::TIMESTAMPTZ - interval '1 hour');
    INSERT INTO order_history (order_id, status_from, status_to, actor_type, market_id, created_at)
    VALUES (('cb000000-0000-4000-8000-0000000000' || lpad(o.n::TEXT, 2, '0'))::UUID, 'confirmed', 'uploaded', 'system',
            CASE WHEN o.car = v_b THEN v_tn ELSE v_ly END, (o.up || '+00')::TIMESTAMPTZ);
  END LOOP;

  INSERT INTO order_history (order_id, status_from, status_to, actor_type, market_id, created_at)
  SELECT ('cb000000-0000-4000-8000-0000000000' || lpad(n::TEXT, 2, '0'))::UUID, sf::order_status, st::order_status, 'system',
         CASE WHEN n = 41 THEN v_tn ELSE v_ly END, (at || '+00')::TIMESTAMPTZ
  FROM (VALUES
    ( 1, 'out_for_delivery', 'delivered', '2026-09-15 10:00'),
    ( 2, 'out_for_delivery', 'delivered', '2026-09-19 08:00'),
    ( 3, 'in_transit', 'cancelled', '2026-09-16 08:00'),
    ( 4, 'in_transit', 'cancelled', '2026-09-18 08:00'),
    ( 7, 'uploaded', 'cancelled', '2026-09-18 10:00'),
    (11, 'out_for_delivery', 'delivered', '2026-09-09 08:00'),
    (12, 'in_transit', 'cancelled', '2026-09-10 08:00'),
    (31, 'in_transit', 'cancelled', '2026-08-24 08:00'),
    (32, 'in_transit', 'cancelled', '2026-07-30 08:00'),
    (33, 'in_transit', 'cancelled', '2026-09-08 08:00'),
    (41, 'scanned', 'dispatched', '2026-09-15 20:00'),
    (41, 'in_transit', 'delivered', '2026-09-17 08:00')
  ) AS h(n, sf, st, at);

  INSERT INTO darb_shipments (darb_id, carrier_id, order_id, status_slug, remark_class, to_city, cancel_count,
                              completed_at, carrier_created_at, carrier_updated_at, latest_event_at, last_synced_at)
  SELECT 'sqltest-sc-' || d.n, v_a, ('cb000000-0000-4000-8000-0000000000' || lpad(d.n::TEXT, 2, '0'))::UUID,
         d.slug, d.remark, d.city, d.cc,
         CASE WHEN d.slug = 'completed' THEN (d.mv || '+00')::TIMESTAMPTZ END,
         (SELECT min(h.created_at) FROM order_history h
           WHERE h.order_id = ('cb000000-0000-4000-8000-0000000000' || lpad(d.n::TEXT, 2, '0'))::UUID AND h.status_to = 'uploaded'),
         (d.mv || '+00')::TIMESTAMPTZ, (d.mv || '+00')::TIMESTAMPTZ,
         '2026-09-20 11:52+00'
  FROM (VALUES
    ( 1, 'completed', 'none',               'طرابلس', NULL, '2026-09-15 10:00'),
    ( 2, 'completed', 'none',               'طرابلس', NULL, '2026-09-19 08:00'),
    ( 3, 'released',  'no_answer',          'طرابلس', 1,    '2026-09-17 00:00'),
    ( 4, 'cancelled', 'wrong_item',         'بنغازي', 1,    '2026-09-18 08:00'),
    ( 5, 'delayed',   'none',               'طرابلس', NULL, '2026-09-19 12:00'),
    ( 6, 'pending',   'none',               'طرابلس', NULL, '2026-09-17 08:00'),
    ( 7, 'cancelled', 'none',               'طرابلس', 1,    '2026-09-18 10:00'),
    (11, 'completed', 'none',               'طرابلس', NULL, '2026-09-09 08:00'),
    (12, 'cancelled', 'no_answer',          'طرابلس', 1,    '2026-09-10 08:00'),
    (21, 'processing','none',               'طرابلس', NULL, '2026-09-01 12:00'),
    (31, 'released',  'customer_cancelled', 'طرابلس', 1,    '2026-08-25 12:00'),
    (32, 'released',  'none',               'طرابلس', 1,    '2026-08-01 12:00'),
    (33, 'released',  'none',               'طرابلس', 1,    '2026-09-10 12:00')
  ) AS d(n, slug, remark, city, cc, mv);

  INSERT INTO darb_timeline_events (darb_id, order_id, event_id, type, occurred_at)
  SELECT 'sqltest-sc-' || e.n, ('cb000000-0000-4000-8000-0000000000' || lpad(e.n::TEXT, 2, '0'))::UUID,
         'sqltest-sc-ev-' || e.n || '-' || e.k, e.type, (e.at || '+00')::TIMESTAMPTZ
  FROM (VALUES
    ( 1, 1, 'assigned', '2026-09-14 10:00'),
    ( 2, 1, 'assigned', '2026-09-15 08:00'), ( 2, 2, 'delayed', '2026-09-16 08:00'), ( 2, 3, 'delayed', '2026-09-17 08:00'),
    ( 3, 1, 'assigned', '2026-09-15 12:00'), ( 3, 2, 'cancelled', '2026-09-16 00:00'), ( 3, 3, 'released', '2026-09-17 00:00'),
    ( 4, 1, 'assigned', '2026-09-15 20:00'), ( 4, 2, 'cancelled', '2026-09-18 08:00'),
    ( 5, 1, 'assigned', '2026-09-16 10:00'), ( 5, 2, 'delayed', '2026-09-19 12:00'),
    (11, 1, 'assigned', '2026-09-08 10:00'),
    (12, 1, 'assigned', '2026-09-08 10:00'), (12, 2, 'cancelled', '2026-09-10 08:00'),
    (21, 1, 'assigned', '2026-08-20 10:00'),
    (31, 1, 'assigned', '2026-08-20 10:00'), (31, 2, 'cancelled', '2026-08-24 08:00'), (31, 3, 'released', '2026-08-25 12:00'),
    (32, 1, 'assigned', '2026-07-28 10:00'), (32, 2, 'cancelled', '2026-07-30 08:00'), (32, 3, 'released', '2026-08-01 12:00'),
    (33, 1, 'assigned', '2026-09-05 10:00'), (33, 2, 'cancelled', '2026-09-08 08:00'), (33, 3, 'released', '2026-09-10 12:00')
  ) AS e(n, k, type, at);

  -- 33 came back and was scanned in
  INSERT INTO inventory_log (product_id, change, reason, balance_after, order_id, created_at)
  VALUES (v_prod, 1, 'returned', 1, 'cb000000-0000-4000-8000-000000000033', '2026-09-11 09:00+00');
END
$fixture$;

UPDATE darb_shipments s SET carrier_created_at = h.up
  FROM (SELECT order_id, min(created_at) AS up FROM order_history WHERE status_to = 'uploaded' GROUP BY 1) h
 WHERE s.darb_id LIKE 'sqltest-sc-%' AND h.order_id = s.order_id AND s.carrier_created_at IS DISTINCT FROM h.up;

\echo ''
\echo '── 1. couleur du compte ───────────────────────────────────────────────'

DO $t1$
BEGIN
  PERFORM pg_temp.eq((SELECT accent_color FROM carriers WHERE code = 'darb_assabil' AND warehouse_id = (SELECT id FROM warehouses WHERE code = 'benghazi' LIMIT 1) LIMIT 1),
                     '#C24E17', 'compte Darb de Benghazi : orange');
  PERFORM pg_temp.eq((SELECT accent_color FROM carriers WHERE code = 'darb_assabil' AND warehouse_id = (SELECT id FROM warehouses WHERE code = 'tripoli' LIMIT 1) LIMIT 1),
                     '#1F5FBF', 'compte Darb de Tripoli : bleu');
  PERFORM pg_temp.eq(pg_temp.err($q$UPDATE carriers SET accent_color = 'blue' WHERE id = 'cb000000-0000-4000-8000-0000000000a0'$q$),
                     '23514', 'une couleur doit être un #RRGGBB');
END
$t1$;

\echo ''
\echo '── 2–6. le relevé, à 2026-09-20 12:00 sur 7 jours ─────────────────────'

DO $t2$
DECLARE
  v_now TIMESTAMPTZ := '2026-09-20 12:00+00';
  j JSONB; a JSONB; b JSONB; wk JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.sa'), 'role', 'authenticated')::TEXT, TRUE);
  j := get_carrier_scorecard('00000000-0000-0000-0000-000000000002', 7, v_now);
  PERFORM set_config('request.jwt.claims', '', TRUE);

  PERFORM pg_temp.eq((j #>> '{settings,target_pct}')::INT,
                     delivery_setting_int('00000000-0000-0000-0000-000000000002', 'carrier_delivery_target_pct', 60), 'objectif = réglage (60 par défaut)');
  PERFORM pg_temp.eq((j #>> '{settings,late_days}')::INT,
                     delivery_setting_int('00000000-0000-0000-0000-000000000002', 'carrier_late_days', 3), 'en retard = réglage (3 j par défaut)');
  PERFORM pg_temp.eq((j #>> '{settings,stuck_days}')::INT,
                     delivery_setting_int('00000000-0000-0000-0000-000000000002', 'carrier_stall_days', 5), 'bloqué = carrier_stall_days (5 j par défaut)');

  SELECT c INTO a FROM jsonb_array_elements(j -> 'carriers') c WHERE c ->> 'id' = 'cb000000-0000-4000-8000-0000000000a0';
  PERFORM pg_temp.ok(a IS NOT NULL, 'le compte Darb actif est une carte');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j -> 'carriers') c WHERE c ->> 'id' = 'cb000000-0000-4000-8000-0000000000e0'),
                     'un transporteur qui n''a jamais rien porté n''est pas une carte');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j -> 'carriers') c WHERE c ->> 'id' = 'cb000000-0000-4000-8000-0000000000d0'),
                     'un transporteur inactif n''est pas une carte');
  PERFORM pg_temp.ok(a ? 'accent_color', 'la carte porte la couleur du compte');
  PERFORM pg_temp.eq((a ->> 'has_reasons')::BOOLEAN, TRUE, 'Darb donne des motifs');

  PERFORM pg_temp.eq((a #>> '{period,sent}')::INT, 6, 'envoyés = 6 (l''annulé avant ramassage ne compte pas)');
  PERFORM pg_temp.eq((a #>> '{period,delivered}')::INT, 2, 'livrés 2');
  PERFORM pg_temp.eq((a #>> '{period,failed}')::INT, 2, 'échoués 2');
  PERFORM pg_temp.eq((a #>> '{period,in_flight}')::INT, 2, 'en route 2');
  PERFORM pg_temp.eq((a #>> '{period,prev_delivered}')::INT, 1, 'période d''avant : 1 livré');
  PERFORM pg_temp.eq((a #>> '{period,prev_failed}')::INT, 1, 'période d''avant : 1 échoué');
  PERFORM pg_temp.eq((a #>> '{period,picked}')::INT, 5, 'ramassés 5');
  PERFORM pg_temp.eq((a #>> '{period,picked_fast}')::INT, 3, 'ramassés en moins de 6 h : 3');
  PERFORM pg_temp.eq((a #>> '{period,first_attempt}')::INT, 1, 'livrés sans report : 1');
  PERFORM pg_temp.eq((a #>> '{period,median_days}')::NUMERIC, 2.5, 'médiane ramassage → livré 2,5 j');
  PERFORM pg_temp.eq((a #>> '{period,fast3}')::INT, 1, 'livrés en moins de 3 j : 1');

  PERFORM pg_temp.eq((a #>> '{open,total}')::INT, 3, 'chez Darb maintenant : 3');
  PERFORM pg_temp.eq((a #>> '{open,not_picked}')::INT, 1, 'pas encore ramassé : 1');
  PERFORM pg_temp.eq((a #>> '{open,b0_2}')::INT, 0, '0 à 2 j : 0');
  PERFORM pg_temp.eq((a #>> '{open,b3_4}')::INT, 1, '3 à 4 j : 1');
  PERFORM pg_temp.eq((a #>> '{open,b5_9}')::INT, 0, '5 à 9 j : 0');
  PERFORM pg_temp.eq((a #>> '{open,b10p}')::INT, 1, '10 j et + : 1');
  PERFORM pg_temp.eq((a #>> '{open,late}')::INT, 3, 'en retard : 3 (dont le pas ramassé depuis 3 j)');
  PERFORM pg_temp.eq((a #>> '{open,stuck}')::INT, 1, 'bloqué (5 j sans mouvement) : 1');

  PERFORM pg_temp.eq((a #>> '{returns,failed}')::INT, 6, 'retours : 6 échecs après ramassage sur 90 j');
  PERFORM pg_temp.eq((a #>> '{returns,handed_back}')::INT, 4, 'rendus par Darb : 4');
  PERFORM pg_temp.eq((a #>> '{returns,scanned}')::INT, 1, 'scannés : 1');
  PERFORM pg_temp.eq((a #>> '{returns,out}')::INT, 2, 'encore chez Darb : 2');
  PERFORM pg_temp.eq((a #>> '{returns,out_late}')::INT, 1, 'encore chez Darb depuis 7 j + : 1');
  PERFORM pg_temp.eq((a #>> '{returns,age_lt7}')::INT, 1, 'à scanner depuis moins de 7 j : 1');
  PERFORM pg_temp.eq((a #>> '{returns,age_7_30}')::INT, 1, 'à scanner depuis 7 à 30 j : 1');
  PERFORM pg_temp.eq((a #>> '{returns,age_30p}')::INT, 1, 'à scanner depuis plus de 30 j : 1');
  PERFORM pg_temp.eq((a #>> '{returns,within7}')::INT, 4, 'rendus en 7 j ou moins : 4');
  PERFORM pg_temp.eq((a #>> '{returns,median_days}')::NUMERIC, 1.7, 'délai médian de remise 1,7 j');

  PERFORM pg_temp.eq(jsonb_array_length(a -> 'weeks'), 13, '13 semaines');
  SELECT w INTO wk FROM jsonb_array_elements(a -> 'weeks') w WHERE w ->> 'week' = '2026-09-14';
  PERFORM pg_temp.eq(((wk ->> 'delivered')::INT, (wk ->> 'failed')::INT, (wk ->> 'in_flight')::INT)::TEXT, '(2,2,2)', 'semaine du 14 sept. : 2 livrés, 2 échoués, 2 en route');
  PERFORM pg_temp.eq(a -> 'weeks' -> 12 ->> 'week', '2026-09-14', 'la dernière semaine est celle de « maintenant »');

  PERFORM pg_temp.eq((SELECT (r ->> 'n')::INT FROM jsonb_array_elements(a -> 'reasons') r WHERE r ->> 'class' = 'no_answer'), 2, 'motif « injoignable » : 2');
  PERFORM pg_temp.eq((SELECT (r ->> 'n')::INT FROM jsonb_array_elements(a -> 'reasons') r WHERE r ->> 'class' = 'none'), 2, 'sans motif : 2');
  PERFORM pg_temp.eq((SELECT (c ->> 'failed')::INT FROM jsonb_array_elements(a -> 'cities') c WHERE c ->> 'city' = 'بنغازي'), 1, 'ville : un échec à Benghazi');

  PERFORM pg_temp.eq((SELECT (d ->> 'open')::INT FROM jsonb_array_elements(j -> 'dormant') d WHERE d ->> 'id' = 'cb000000-0000-4000-8000-0000000000d0'),
                     1, 'transporteur inactif avec un colis ouvert = ligne dormante');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.sa'), 'role', 'authenticated')::TEXT, TRUE);
  j := get_carrier_scorecard('00000000-0000-0000-0000-000000000001', 7, v_now);
  PERFORM set_config('request.jwt.claims', '', TRUE);
  SELECT c INTO b FROM jsonb_array_elements(j -> 'carriers') c WHERE c ->> 'id' = 'cb000000-0000-4000-8000-0000000000b0';
  PERFORM pg_temp.eq((b #>> '{period,delivered}')::INT, 1, 'Tunisie : 1 livré');
  PERFORM pg_temp.eq((b ->> 'has_reasons')::BOOLEAN, FALSE, 'Navex ne donne pas de motifs');
  PERFORM pg_temp.ok((b #>> '{period,first_attempt}') IS NULL, 'Navex : 1er passage inconnu');
  PERFORM pg_temp.eq((b #>> '{period,picked_fast}')::INT, 1, 'Navex : déposé en moins de 24 h');
END
$t2$;

\echo ''
\echo '── 7. garde ───────────────────────────────────────────────────────────'

DO $t7$
DECLARE
  v_now TIMESTAMPTZ := '2026-09-20 12:00+00';
  j JSONB; n INT;
BEGIN
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.get_carrier_scorecard(uuid,integer,timestamptz)', 'EXECUTE'), 'anon n''exécute pas le relevé');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.get_carrier_scorecard_parcels(uuid,uuid,text,timestamptz)', 'EXECUTE'), 'anon n''exécute pas la liste');
  PERFORM pg_temp.ok(has_function_privilege('authenticated', 'public.get_carrier_scorecard(uuid,integer,timestamptz)', 'EXECUTE'), 'authenticated exécute le relevé');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);
  j := get_carrier_scorecard('00000000-0000-0000-0000-000000000002', 7, v_now);
  PERFORM pg_temp.ok(jsonb_array_length(j -> 'carriers') > 0, 'le manager Libye lit la Libye');
  j := get_carrier_scorecard('00000000-0000-0000-0000-000000000001', 7, v_now);
  PERFORM pg_temp.eq(j, '{}'::JSONB, 'le manager Libye ne lit pas la Tunisie');
  SELECT count(*) INTO n FROM get_carrier_scorecard_parcels('00000000-0000-0000-0000-000000000002', 'cb000000-0000-4000-8000-0000000000a0', 'late', v_now);
  PERFORM pg_temp.eq(n, 3, 'liste : 3 colis en retard');
  SELECT count(*) INTO n FROM get_carrier_scorecard_parcels('00000000-0000-0000-0000-000000000002', 'cb000000-0000-4000-8000-0000000000a0', 'returns', v_now);
  PERFORM pg_temp.eq(n, 3, 'liste : 3 retours à scanner');
  SELECT count(*) INTO n FROM get_carrier_scorecard_parcels('00000000-0000-0000-0000-000000000002', 'cb000000-0000-4000-8000-0000000000d0', 'dormant', v_now);
  PERFORM pg_temp.eq(n, 1, 'liste : 1 colis resté ouvert chez le dormant');
  SELECT count(*) INTO n FROM get_carrier_scorecard_parcels('00000000-0000-0000-0000-000000000001', 'cb000000-0000-4000-8000-0000000000b0', 'late', v_now);
  PERFORM pg_temp.eq(n, 0, 'liste : rien d''un autre marché');
  SELECT count(*) INTO n FROM get_carrier_scorecard_parcels('00000000-0000-0000-0000-000000000002', 'cb000000-0000-4000-8000-0000000000b0', 'late', v_now);
  PERFORM pg_temp.eq(n, 0, 'liste : un transporteur d''un autre marché ne passe pas par le sien');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.ag'), 'role', 'authenticated')::TEXT, TRUE);
  j := get_carrier_scorecard('00000000-0000-0000-0000-000000000002', 7, v_now);
  PERFORM pg_temp.eq(j, '{}'::JSONB, 'un agent ne lit rien');
  SELECT count(*) INTO n FROM get_carrier_scorecard_parcels('00000000-0000-0000-0000-000000000002', 'cb000000-0000-4000-8000-0000000000a0', 'late', v_now);
  PERFORM pg_temp.eq(n, 0, 'un agent ne liste rien');
  PERFORM set_config('request.jwt.claims', '', TRUE);
END
$t7$;

\echo ''
\echo '✓ carrier_scorecard'
