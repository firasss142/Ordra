-- Darb au prix réel, partout (20261004100200).
--
-- CE QUE CE FICHIER PROUVE
--   1. order_carrier_cost : UNE ligne par commande (un colis renvoyé en donnait deux),
--      la facture Darb du colis livré, sinon la moyenne du marché — jamais 10 د.ل ;
--      un retour Darb à 0 (pas 5) ; la Tunisie garde ses tarifs fixes.
--   2. Le P&L global (get_profitability_summary / _daily) compte la facture et le retour à 0.
--   3. La vue ne montre plus les commandes d'un autre marché à un manager.

\set ON_ERROR_STOP on
\i _helpers.sql

DO $fixture$
DECLARE
  v_ly    UUID := '00000000-0000-0000-0000-000000000002';
  v_tn    UUID := '00000000-0000-0000-0000-000000000001';
  v_tag   TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_darb  UUID := gen_random_uuid();
  v_navex UUID := gen_random_uuid();
  v_ly_sf UUID;
  v_tn_sf UUID;
  v_o     UUID[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  -- A day nothing else lives in — a random day of the 1990s, different on every run
  -- (these tests write for real) — so the P&L sums only this fixture.
  v_at    TIMESTAMPTZ := ('1990-01-01'::date + (random() * 3600)::int)::timestamp + time '10:00';
  i       INT;
BEGIN
  SELECT id INTO v_ly_sf FROM storefronts WHERE market_id = v_ly LIMIT 1;
  SELECT id INTO v_tn_sf FROM storefronts WHERE market_id = v_tn LIMIT 1;

  INSERT INTO carriers (id, market_id, name, code, delivery_fee, return_fee, is_active)
  VALUES (v_darb, v_ly, 'SQLTEST Darb app ' || v_tag, 'darb_assabil', 10, 5, FALSE),
         (v_navex, v_tn, 'SQLTEST Navex app ' || v_tag, 'navex', 6, 4, FALSE);

  -- 1 Darb delivered, re-sent (two shipments), invoiced 30. 2 Darb delivered, nothing known.
  -- 3 Darb returned. 4 TN delivered. 5 TN returned.
  FOR i IN 1..5 LOOP
    INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform, customer_name, customer_phone,
                        product_name, quantity, unit_price, total_price, status, carrier_id, created_at)
    VALUES (v_o[i], CASE WHEN i <= 3 THEN v_ly ELSE v_tn END, CASE WHEN i <= 3 THEN v_ly_sf ELSE v_tn_sf END,
            'SQLTEST-APP-' || v_tag || '-' || i, 'manual', 'Client ' || i, '+2189200000' || i, 'Produit', 1, 249, 249,
            CASE WHEN i IN (3, 5) THEN 'returned' ELSE 'delivered' END::order_status,
            CASE WHEN i <= 3 THEN v_darb ELSE v_navex END, v_at);
    INSERT INTO order_history (order_id, market_id, status_from, status_to, actor_type, created_at)
    VALUES (v_o[i], CASE WHEN i <= 3 THEN v_ly ELSE v_tn END, 'out_for_delivery',
            CASE WHEN i IN (3, 5) THEN 'returned' ELSE 'delivered' END::order_status, 'system', v_at + interval '2 days');
  END LOOP;

  INSERT INTO darb_shipments (darb_id, order_id, carrier_id, status_slug, billed_shipping_amount, completed_at, carrier_updated_at)
  VALUES ('sqltest-app-' || v_tag || '-1a', v_o[1], v_darb, 'cancelled', 20, NULL, v_at),
         ('sqltest-app-' || v_tag || '-1b', v_o[1], v_darb, 'completed', 30, v_at + interval '2 days', v_at + interval '2 days'),
         ('sqltest-app-' || v_tag || '-3', v_o[3], v_darb, 'returned', 25, NULL, v_at + interval '2 days');

  PERFORM set_config('app.o', array_to_string(v_o, ','), false);
  PERFORM set_config('app.day', (v_at AT TIME ZONE 'UTC')::date::text, false);
END
$fixture$;

DO $assert$
DECLARE
  v_o  UUID[] := string_to_array(current_setting('app.o'), ',')::UUID[];
  v_ly UUID := '00000000-0000-0000-0000-000000000002';
  v_tn UUID := '00000000-0000-0000-0000-000000000001';
  v_d  DATE := current_setting('app.day')::date;
  s    RECORD;
  n    INT;
BEGIN
  PERFORM pg_temp.eq((SELECT count(*)::int FROM order_carrier_cost WHERE order_id = v_o[1]), 1,
                     'un colis renvoyé : une seule ligne');
  PERFORM pg_temp.eq((SELECT effective_delivery_fee FROM order_carrier_cost WHERE order_id = v_o[1]), 30::numeric,
                     'Darb livré : la facture, pas 10');
  PERFORM pg_temp.eq((SELECT cost_source FROM order_carrier_cost WHERE order_id = v_o[1]), 'billed', 'source : facture');
  PERFORM pg_temp.eq((SELECT effective_delivery_fee FROM order_carrier_cost WHERE order_id = v_o[2]),
                     market_avg_delivery_cost(v_ly), 'Darb sans facture ni devis : la moyenne du marché');
  PERFORM pg_temp.eq((SELECT cost_source FROM order_carrier_cost WHERE order_id = v_o[2]), 'average', 'source : moyenne');
  PERFORM pg_temp.eq((SELECT effective_return_fee FROM order_carrier_cost WHERE order_id = v_o[3]), 0::numeric,
                     'un retour Darb ne coûte rien (pas 5)');
  PERFORM pg_temp.eq((SELECT effective_delivery_fee FROM order_carrier_cost WHERE order_id = v_o[4]), 6::numeric,
                     'Tunisie : tarif fixe de livraison');
  PERFORM pg_temp.eq((SELECT effective_return_fee FROM order_carrier_cost WHERE order_id = v_o[5]), 4::numeric,
                     'Tunisie : tarif fixe de retour');

  -- P&L, in a window only the fixture lives in.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', 'aaaaaaaa-0000-4000-8000-000000000001', 'role', 'authenticated')::TEXT, TRUE);
  SELECT * INTO s FROM get_profitability_summary(v_ly, v_d::timestamptz, (v_d + 5)::timestamptz);
  PERFORM pg_temp.eq(s.delivered_count, 2::bigint, 'P&L Libye : deux livraisons');
  PERFORM pg_temp.eq(s.delivery_cost_cents,
                     (3000 + round(market_avg_delivery_cost(v_ly) * 100))::bigint,
                     'P&L Libye : facture 30 + moyenne, pas 2 × 10');
  PERFORM pg_temp.eq(s.return_cost_cents, 0::bigint, 'P&L Libye : le retour Darb à 0');
  SELECT * INTO s FROM get_profitability_summary(v_tn, v_d::timestamptz, (v_d + 5)::timestamptz);
  PERFORM pg_temp.eq(s.delivery_cost_cents, 600::bigint, 'P&L Tunisie : 6 par livraison');
  PERFORM pg_temp.eq(s.return_cost_cents, 400::bigint, 'P&L Tunisie : 4 par retour');
  PERFORM pg_temp.eq((SELECT sum(delivery_cost_cents) FROM get_profitability_daily(v_ly, v_d, v_d + 5))::bigint,
                     (3000 + round(market_avg_delivery_cost(v_ly) * 100))::bigint, 'P&L par jour : même total');
  PERFORM set_config('request.jwt.claims', '', TRUE);

  -- security_invoker: an authenticated Tunisian manager no longer reads Libyan rows.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', (SELECT id FROM users WHERE role = 'market_manager' AND market_id = v_tn AND deleted_at IS NULL LIMIT 1),
                      'role', 'authenticated')::TEXT, TRUE);
  SELECT count(*) INTO n FROM order_carrier_cost WHERE order_id = v_o[1];
  RESET ROLE;
  PERFORM pg_temp.eq(n, 0, 'un manager tunisien ne voit pas les coûts libyens');
END
$assert$;
