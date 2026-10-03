-- carrier_parcel_outcome — ONE definition of what became of a parcel, shared by
-- Transporteurs (plans/transporteurs.md §3) and Produits v6 (§4 of its plan).
--
-- CE QUE CE FICHIER PROUVE
--   1. Chaque règle d'issue, dans l'ordre : livré (Ordra ou Darb « completed »,
--      Darb gagne sur un « cancelled » d'Ordra), échoué (retour, ou annulé puis
--      rendu, ou annulé après ramassage), en route (y compris un « released »
--      SEUL — Darb l'a renvoyé en livraison — et une commande remise en file),
--      annulé avant ramassage.
--   2. Une commande jamais envoyée n'est pas une ligne.
--   3. Le ramassage : événement Darb « assigned », ou à défaut le premier statut
--      « chez le transporteur » de l'historique (Tunisie, et Darb avant que la
--      chronologie Darb ne soit copiée, le 2026-08-17).
--   4. La dernière expédition Darb décide (une commande renvoyée a deux lignes).
--   5. Rendu / scanné au retour / reports / ville / motif / dernier mouvement.
--   6. « Chez le transporteur maintenant » : en route ET réellement chez lui.
--   7. La vue est security_invoker : un market_manager ne voit que son marché ;
--      anon ne lit rien.

\set ON_ERROR_STOP on
\i _helpers.sql

\echo ''
\echo '── fixture ────────────────────────────────────────────────────────────'

DO $fixture$
DECLARE
  v_tn  UUID := '00000000-0000-0000-0000-000000000001';
  v_ly  UUID := '00000000-0000-0000-0000-000000000002';
  v_sf_tn UUID := (SELECT id FROM storefronts WHERE market_id = '00000000-0000-0000-0000-000000000001' ORDER BY created_at LIMIT 1);
  v_sf_ly UUID := (SELECT id FROM storefronts WHERE market_id = '00000000-0000-0000-0000-000000000002' ORDER BY created_at LIMIT 1);
  v_darb  UUID := 'ca000000-0000-4000-8000-0000000000d1';
  v_navex UUID := 'ca000000-0000-4000-8000-0000000000e1';
  v_prod  UUID := 'ca000000-0000-4000-8000-0000000000f1';
  v_mm    UUID := 'ca000000-0000-4000-8000-0000000000a1';
  t0 TIMESTAMPTZ := '2026-09-01 08:00:00+00';
  o RECORD;
BEGIN
  PERFORM set_config('r.mm', v_mm::TEXT, FALSE);
  IF EXISTS (SELECT 1 FROM orders WHERE id = 'ca000000-0000-4000-8000-000000000016') THEN
    RAISE NOTICE '  fixture déjà là';
    RETURN;
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (v_mm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'sqltest.cpo.mm@oms.local', 'x', now(), now(), now()) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.users (id, email, full_name, role, market_id, is_active)
  VALUES (v_mm, 'sqltest.cpo.mm@oms.local', 'SQL CPO Manager LY', 'market_manager', v_ly, TRUE)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, market_id = EXCLUDED.market_id;

  INSERT INTO carriers (id, market_id, name, code, is_active) VALUES
    (v_darb,  v_ly, 'SQLTEST Darb', 'darb_assabil', TRUE),
    (v_navex, v_tn, 'SQLTEST Navex', 'navex', TRUE)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO products (id, market_id, name, current_stock) VALUES (v_prod, v_ly, 'SQLTEST CPO', 1)
  ON CONFLICT (id) DO NOTHING;

  -- n · market · carrier · status · city
  FOR o IN SELECT * FROM (VALUES
    ( 1, v_ly, v_darb,  'delivered'::order_status,        'X'),
    ( 2, v_ly, v_darb,  'cancelled'::order_status,        'X'),
    ( 3, v_ly, v_darb,  'cancelled'::order_status,        'X'),
    ( 4, v_ly, v_darb,  'cancelled'::order_status,        'X'),
    ( 5, v_ly, v_darb,  'cancelled'::order_status,        'X'),
    ( 6, v_ly, v_darb,  'out_for_delivery'::order_status, 'X'),
    ( 7, v_ly, v_darb,  'returning'::order_status,        'X'),
    ( 8, v_ly, v_darb,  'cancelled'::order_status,        'X'),
    ( 9, v_ly, v_darb,  'confirmed'::order_status,        'X'),
    (10, v_ly, v_darb,  'pending'::order_status,          'X'),
    (11, v_ly, v_darb,  'cancelled'::order_status,        'X'),
    (12, v_ly, v_darb,  'at_carrier'::order_status,       'X'),
    (13, v_ly, v_darb,  'uploaded'::order_status,         'X'),
    (14, v_tn, v_navex, 'delivered'::order_status,        'Sfax'),
    (15, v_tn, v_navex, 'to_be_returned'::order_status,   'Sousse'),
    (16, v_ly, v_darb,  'out_for_delivery'::order_status, 'X')
  ) AS t(n, mk, car, st, city)
  WHERE NOT EXISTS (SELECT 1 FROM orders WHERE id = ('ca000000-0000-4000-8000-0000000000' || lpad(t.n::TEXT, 2, '0'))::UUID)
  LOOP
    INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform, customer_name, customer_phone,
                        product_name, unit_price, total_price, status, carrier_id, customer_city, tracking_number, created_at)
    VALUES (('ca000000-0000-4000-8000-0000000000' || lpad(o.n::TEXT, 2, '0'))::UUID, o.mk,
            CASE WHEN o.mk = v_tn THEN v_sf_tn ELSE v_sf_ly END,
            'sqltest-cpo-' || o.n, 'manual', 'Client ' || o.n, '+2189100000' || lpad(o.n::TEXT, 2, '0'),
            'SQLTEST', 100, 100, o.st, o.car, o.city, 'TRK' || o.n, t0);
  END LOOP;

  -- history (append-only : only rows that happened)
  INSERT INTO order_history (order_id, status_from, status_to, actor_type, market_id, created_at)
  SELECT ('ca000000-0000-4000-8000-0000000000' || lpad(n::TEXT, 2, '0'))::UUID, sf::order_status, st::order_status, 'system',
         CASE WHEN n >= 14 THEN v_tn ELSE v_ly END, t0 + make_interval(hours => h)
  FROM (VALUES
    ( 1, 'confirmed', 'uploaded', 1), ( 1, 'out_for_delivery', 'delivered', 40),
    ( 2, 'confirmed', 'uploaded', 1), ( 2, 'out_for_delivery', 'cancelled', 50),
    ( 3, 'confirmed', 'uploaded', 1), ( 3, 'in_transit', 'cancelled', 60),
    ( 4, 'confirmed', 'uploaded', 1), ( 4, 'in_transit', 'cancelled', 60),
    ( 5, 'confirmed', 'uploaded', 1), ( 5, 'uploaded', 'cancelled', 30),
    ( 6, 'confirmed', 'uploaded', 1),
    ( 7, 'confirmed', 'uploaded', 1), ( 7, 'out_for_delivery', 'returning', 70),
    ( 8, 'confirmed', 'uploaded', 1), ( 8, 'in_transit', 'cancelled', 20),
    ( 9, 'confirmed', 'uploaded', 1), ( 9, 'received', 'confirmed', 90),
    -- 10 : never uploaded
    (11, 'confirmed', 'uploaded', 1), (11, 'scanned', 'at_carrier', 5), (11, 'in_transit', 'cancelled', 10),
    (12, 'confirmed', 'uploaded', 1), (12, 'scanned', 'at_carrier', 3),
    (13, 'confirmed', 'uploaded', 1),
    (14, 'confirmed', 'uploaded', 1), (14, 'scanned', 'dispatched', 4), (14, 'in_transit', 'delivered', 52),
    (15, 'confirmed', 'uploaded', 1), (15, 'scanned', 'dispatched', 6), (15, 'in_transit', 'to_be_returned', 80),
    (16, 'confirmed', 'uploaded', 1), (16, 'delivery_delayed', 'out_for_delivery', 90)
  ) AS h(n, sf, st, h)
  WHERE NOT EXISTS (SELECT 1 FROM order_history x WHERE x.order_id = ('ca000000-0000-4000-8000-0000000000' || lpad(h.n::TEXT, 2, '0'))::UUID);

  -- Darb mirror : latest shipment decides (carrier_updated_at)
  INSERT INTO darb_shipments (darb_id, carrier_id, order_id, status_slug, cancellation_cause, remark_class, to_city,
                              completed_at, carrier_created_at, carrier_updated_at, latest_event_at, cancel_count)
  SELECT 'sqltest-cpo-' || d.id, v_darb, ('ca000000-0000-4000-8000-0000000000' || lpad(d.n::TEXT, 2, '0'))::UUID,
         d.slug, d.cause, COALESCE(d.remark, 'none'), 'طرابلس',
         CASE WHEN d.slug = 'completed' THEN t0 + interval '45 hours' END,
         t0 + interval '2 hours', t0 + make_interval(hours => d.upd), t0 + make_interval(hours => d.upd), d.cc
  FROM (VALUES
    ('1',  1, 'completed', NULL, NULL, 40, NULL),
    ('2',  2, 'completed', NULL, NULL, 55, 1),
    ('3',  3, 'released',  'other', 'no_answer', 100, 1),
    ('4',  4, 'cancelled', '3-days-no-response', 'customer_cancelled', 61, 1),
    ('5',  5, 'cancelled', NULL, NULL, 30, 1),
    ('6',  6, 'released',  NULL, NULL, 50, NULL),
    ('7',  7, 'returning', NULL, 'refused', 70, NULL),
    ('8',  8, 'processing', NULL, NULL, 20, NULL),
    ('11a', 11, 'cancelled', NULL, NULL, 10, 1),
    ('11b', 11, 'completed', NULL, NULL, 30, NULL),
    ('12', 12, 'delayed', NULL, NULL, 26, NULL),
    ('16', 16, 'released', NULL, 'no_answer', 95, 1)
  ) AS d(id, n, slug, cause, remark, upd, cc)
  WHERE NOT EXISTS (SELECT 1 FROM darb_shipments x WHERE x.darb_id = 'sqltest-cpo-' || d.id);

  INSERT INTO darb_timeline_events (darb_id, order_id, event_id, type, occurred_at)
  SELECT 'sqltest-cpo-' || e.sid, ('ca000000-0000-4000-8000-0000000000' || lpad(e.n::TEXT, 2, '0'))::UUID,
         'sqltest-cpo-ev-' || e.sid || '-' || e.k, e.type, t0 + make_interval(hours => e.h)
  FROM (VALUES
    ('1', 1, 1, 'assigned', 3), ('1', 1, 2, 'completed', 40),
    ('2', 2, 1, 'assigned', 3), ('2', 2, 2, 'cancelled', 50), ('2', 2, 3, 'completed', 55),
    ('3', 3, 1, 'assigned', 4), ('3', 3, 2, 'delayed', 30), ('3', 3, 3, 'delayed', 40), ('3', 3, 4, 'cancelled', 60), ('3', 3, 5, 'released', 100),
    ('4', 4, 1, 'assigned', 4), ('4', 4, 2, 'cancelled', 61),
    ('6', 6, 1, 'assigned', 4), ('6', 6, 2, 'released', 50),
    ('7', 7, 1, 'assigned', 4), ('7', 7, 2, 'returning', 70),
    ('12', 12, 1, 'assigned', 3), ('12', 12, 2, 'delayed', 26),
    ('16', 16, 1, 'assigned', 3), ('16', 16, 2, 'cancelled', 40), ('16', 16, 3, 'returning', 45), ('16', 16, 4, 'released', 95)
  ) AS e(sid, n, k, type, h)
  WHERE NOT EXISTS (SELECT 1 FROM darb_timeline_events x WHERE x.event_id = 'sqltest-cpo-ev-' || e.sid || '-' || e.k);

  -- order 3 came back and was scanned in
  INSERT INTO inventory_log (product_id, change, reason, balance_after, order_id, created_at)
  SELECT v_prod, 1, 'returned', 1, 'ca000000-0000-4000-8000-000000000003', t0 + interval '120 hours'
   WHERE NOT EXISTS (SELECT 1 FROM inventory_log x WHERE x.order_id = 'ca000000-0000-4000-8000-000000000003');

  PERFORM set_config('r.mm', v_mm::TEXT, FALSE);
END
$fixture$;

\echo ''
\echo '── 1–4. issue de chaque colis ─────────────────────────────────────────'

DO $t1$
DECLARE
  f TEXT := 'ca000000-0000-4000-8000-0000000000';
  t0 TIMESTAMPTZ := '2026-09-01 08:00:00+00';
  r RECORD;
BEGIN
  PERFORM pg_temp.eq((SELECT outcome FROM carrier_parcel_outcome WHERE order_id = (f||'01')::UUID), 'delivered', '1 · livré dans Ordra');
  PERFORM pg_temp.eq((SELECT outcome FROM carrier_parcel_outcome WHERE order_id = (f||'02')::UUID), 'delivered', '2 · annulé dans Ordra mais livré chez Darb');
  PERFORM pg_temp.eq((SELECT outcome FROM carrier_parcel_outcome WHERE order_id = (f||'03')::UUID), 'failed', '3 · annulé puis rendu (released)');
  PERFORM pg_temp.eq((SELECT outcome FROM carrier_parcel_outcome WHERE order_id = (f||'04')::UUID), 'failed', '4 · annulé par Darb après ramassage');
  PERFORM pg_temp.eq((SELECT outcome FROM carrier_parcel_outcome WHERE order_id = (f||'05')::UUID), 'cancelled_before_pickup', '5 · annulé avant ramassage');
  PERFORM pg_temp.eq((SELECT outcome FROM carrier_parcel_outcome WHERE order_id = (f||'06')::UUID), 'in_flight', '6 · « released » seul = renvoyé en livraison, pas un échec');
  PERFORM pg_temp.eq((SELECT outcome FROM carrier_parcel_outcome WHERE order_id = (f||'07')::UUID), 'failed', '7 · en retour');
  PERFORM pg_temp.eq((SELECT outcome FROM carrier_parcel_outcome WHERE order_id = (f||'08')::UUID), 'in_flight', '8 · annulé dans Ordra, Darb le travaille encore');
  PERFORM pg_temp.eq((SELECT outcome FROM carrier_parcel_outcome WHERE order_id = (f||'09')::UUID), 'in_flight', '9 · remis en file après envoi');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM carrier_parcel_outcome WHERE order_id = (f||'10')::UUID), '10 · jamais envoyé : pas de ligne');
  PERFORM pg_temp.eq((SELECT outcome FROM carrier_parcel_outcome WHERE order_id = (f||'11')::UUID), 'delivered', '11 · deux expéditions : la plus récente (completed) décide');
  PERFORM pg_temp.eq((SELECT outcome FROM carrier_parcel_outcome WHERE order_id = (f||'14')::UUID), 'delivered', '14 · Tunisie livré');
  PERFORM pg_temp.eq((SELECT outcome FROM carrier_parcel_outcome WHERE order_id = (f||'15')::UUID), 'failed', '15 · Tunisie à retourner');
  PERFORM pg_temp.eq((SELECT outcome FROM carrier_parcel_outcome WHERE order_id = (f||'16')::UUID), 'failed',
                     '16 · « en livraison » dans Ordra mais annulé puis rendu chez Darb (released après une annulation)');

  PERFORM pg_temp.eq((SELECT uploaded_at FROM carrier_parcel_outcome WHERE order_id = (f||'01')::UUID), t0 + interval '1 hour', 'envoyé = premier « uploaded »');
  PERFORM pg_temp.eq((SELECT picked_at FROM carrier_parcel_outcome WHERE order_id = (f||'01')::UUID), t0 + interval '3 hours', 'ramassé = « assigned » Darb');
  PERFORM pg_temp.eq((SELECT picked_at FROM carrier_parcel_outcome WHERE order_id = (f||'11')::UUID), t0 + interval '5 hours', 'sans chronologie Darb : premier « at_carrier »');
  PERFORM pg_temp.eq((SELECT picked_at FROM carrier_parcel_outcome WHERE order_id = (f||'14')::UUID), t0 + interval '4 hours', 'Tunisie : premier « dispatched »');
  PERFORM pg_temp.ok((SELECT picked_at FROM carrier_parcel_outcome WHERE order_id = (f||'05')::UUID) IS NULL, '5 · jamais ramassé');

  PERFORM pg_temp.eq((SELECT outcome_at FROM carrier_parcel_outcome WHERE order_id = (f||'01')::UUID), t0 + interval '40 hours', 'livré le = premier « delivered »');
  PERFORM pg_temp.eq((SELECT outcome_at FROM carrier_parcel_outcome WHERE order_id = (f||'02')::UUID), t0 + interval '45 hours', 'livré chez Darb seulement : completed_at');
  PERFORM pg_temp.eq((SELECT outcome_at FROM carrier_parcel_outcome WHERE order_id = (f||'03')::UUID), t0 + interval '60 hours', 'échoué le = premier échec');
END
$t1$;

\echo ''
\echo '── 5–6. rendu, scanné, reports, ville, motif, chez le transporteur ────'

DO $t5$
DECLARE
  f TEXT := 'ca000000-0000-4000-8000-0000000000';
  t0 TIMESTAMPTZ := '2026-09-01 08:00:00+00';
BEGIN
  PERFORM pg_temp.eq((SELECT handed_back_at FROM carrier_parcel_outcome WHERE order_id = (f||'03')::UUID), t0 + interval '100 hours', '3 · rendu par Darb (released)');
  PERFORM pg_temp.ok((SELECT handed_back_at FROM carrier_parcel_outcome WHERE order_id = (f||'04')::UUID) IS NULL, '4 · pas encore rendu');
  PERFORM pg_temp.ok((SELECT handed_back_at FROM carrier_parcel_outcome WHERE order_id = (f||'06')::UUID) IS NULL, '6 · un « released » en route n''est pas un rendu');
  PERFORM pg_temp.eq((SELECT handed_back_at FROM carrier_parcel_outcome WHERE order_id = (f||'16')::UUID), t0 + interval '95 hours', '16 · rendu par Darb');
  PERFORM pg_temp.ok(NOT (SELECT open_at_carrier FROM carrier_parcel_outcome WHERE order_id = (f||'16')::UUID), '16 · plus chez Darb');
  PERFORM pg_temp.eq((SELECT handed_back_at FROM carrier_parcel_outcome WHERE order_id = (f||'15')::UUID), t0 + interval '80 hours', '15 · Tunisie : rendu = « to_be_returned »');
  PERFORM pg_temp.ok((SELECT scanned_back FROM carrier_parcel_outcome WHERE order_id = (f||'03')::UUID), '3 · scanné au retour');
  PERFORM pg_temp.ok(NOT (SELECT scanned_back FROM carrier_parcel_outcome WHERE order_id = (f||'15')::UUID), '15 · pas scanné');
  PERFORM pg_temp.eq((SELECT n_postponed FROM carrier_parcel_outcome WHERE order_id = (f||'03')::UUID), 2, '3 · reporté deux fois');
  PERFORM pg_temp.eq((SELECT remark_class FROM carrier_parcel_outcome WHERE order_id = (f||'03')::UUID), 'no_answer', '3 · motif du livreur');
  PERFORM pg_temp.eq((SELECT failure_cause FROM carrier_parcel_outcome WHERE order_id = (f||'04')::UUID), '3-days-no-response', '4 · cause d''annulation Darb');
  PERFORM pg_temp.eq((SELECT city FROM carrier_parcel_outcome WHERE order_id = (f||'03')::UUID), 'طرابلس', 'ville Darb = to_city');
  PERFORM pg_temp.eq((SELECT city FROM carrier_parcel_outcome WHERE order_id = (f||'14')::UUID), 'Sfax', 'ville Tunisie = customer_city');
  PERFORM pg_temp.eq((SELECT last_move_at FROM carrier_parcel_outcome WHERE order_id = (f||'12')::UUID), t0 + interval '26 hours', 'dernier mouvement Darb');

  PERFORM pg_temp.ok((SELECT open_at_carrier FROM carrier_parcel_outcome WHERE order_id = (f||'12')::UUID), '12 · chez Darb maintenant');
  PERFORM pg_temp.ok(NOT (SELECT open_at_carrier FROM carrier_parcel_outcome WHERE order_id = (f||'08')::UUID), '8 · annulé dans Ordra : la copie Darb est figée, pas « chez Darb »');
  PERFORM pg_temp.ok(NOT (SELECT open_at_carrier FROM carrier_parcel_outcome WHERE order_id = (f||'09')::UUID), '9 · remis en file : pas chez Darb');
  PERFORM pg_temp.ok(NOT (SELECT open_at_carrier FROM carrier_parcel_outcome WHERE order_id = (f||'13')::UUID), '13 · envoyé sans réservation Darb : pas chez Darb');
  PERFORM pg_temp.ok((SELECT open_at_carrier FROM carrier_parcel_outcome WHERE order_id = (f||'06')::UUID), '6 · renvoyé en livraison : chez Darb');
END
$t5$;

\echo ''
\echo '── 7. sécurité ────────────────────────────────────────────────────────'

DO $t7$
DECLARE
  n_tn INT; n_ly INT;
BEGIN
  PERFORM pg_temp.ok((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = 'public.carrier_parcel_outcome'::regclass),
                     'la vue est security_invoker');
  PERFORM pg_temp.ok(NOT has_table_privilege('anon', 'public.carrier_parcel_outcome', 'SELECT'), 'anon ne lit pas la vue');
  PERFORM pg_temp.ok(has_table_privilege('authenticated', 'public.carrier_parcel_outcome', 'SELECT'), 'authenticated lit la vue');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);
  SET LOCAL ROLE authenticated;
  SELECT count(*) FILTER (WHERE market_id = '00000000-0000-0000-0000-000000000001'),
         count(*) FILTER (WHERE market_id = '00000000-0000-0000-0000-000000000002')
    INTO n_tn, n_ly FROM carrier_parcel_outcome WHERE order_id::TEXT LIKE 'ca000000-%';
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', TRUE);
  PERFORM pg_temp.eq(n_tn, 0, 'le manager Libye ne voit aucun colis tunisien');
  PERFORM pg_temp.ok(n_ly >= 12, 'le manager Libye voit les colis libyens');
END
$t7$;

\echo ''
\echo '✓ carrier_parcel_outcome'
