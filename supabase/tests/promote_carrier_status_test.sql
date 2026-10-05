-- promote_carrier_status : le promoteur générique, rang-gardé, des transporteurs
-- tunisiens qui parlent le vocabulaire de Darb (X-Delivery d'abord).
-- Plan : plans/xdelivery-integration.md.
--
-- CE QUE CE FICHIER PROUVE
--   1. Un colis suit le cycle réel d'X-Delivery : scanné → deposit → out_for_delivery
--      ⇄ delivery_delayed → returning → to_be_returned, sans jamais être refusé comme recul.
--   2. Un statut sans cible (CREATED, PENDING) n'écrit que le slug : la commande ne bouge pas.
--   3. Un colis livré que le transporteur transforme en retour RESTE livré, et la réponse
--      le signale (`conflict`) — décision 7.
--   4. `returned` et `received` sont refusés : le stock ne revient que par le scan du banc.
--   5. Darb est refusé (il garde son propre promoteur) ; un code transporteur qui ne
--      correspond pas à la commande aussi.
--   6. Ni anon ni authenticated ne peuvent l'appeler : service_role seulement.
--   7. La trace d'historique porte la note de l'appelant (statut + motif).

\set ON_ERROR_STOP on
\i _helpers.sql

DO $fixture$
DECLARE
  v_tn   UUID := '00000000-0000-0000-0000-000000000001';
  v_ly   UUID := '00000000-0000-0000-0000-000000000002';
  v_tag  TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_xd   UUID := gen_random_uuid();
  v_nav  UUID := gen_random_uuid();
  v_darb UUID := gen_random_uuid();
  v_sf_tn UUID;
  v_sf_ly UUID;
  v_o    UUID[] := ARRAY[]::UUID[];
  v_st   TEXT[] := ARRAY['scanned','uploaded','delivered','in_transit','in_transit','in_transit'];
  i      INT;
BEGIN
  SELECT id INTO v_sf_tn FROM storefronts WHERE market_id = v_tn LIMIT 1;
  SELECT id INTO v_sf_ly FROM storefronts WHERE market_id = v_ly LIMIT 1;
  INSERT INTO carriers (id, market_id, name, code, delivery_fee, return_fee, is_active) VALUES
    (v_xd,   v_tn, 'SQLTEST X-Delivery ' || v_tag, 'xdelivery',    0, 0, FALSE),
    (v_nav,  v_tn, 'SQLTEST Navex '      || v_tag, 'navex',        0, 0, FALSE),
    (v_darb, v_ly, 'SQLTEST Darb '       || v_tag, 'darb_assabil', 0, 0, FALSE);
  -- 1..4 X-Delivery (TN), 5 Navex (TN), 6 Darb (LY)
  FOR i IN 1..6 LOOP
    v_o := v_o || gen_random_uuid();
    INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform, customer_name, customer_phone,
                        product_name, quantity, unit_price, total_price, status, carrier_id)
    VALUES (v_o[i],
            CASE WHEN i = 6 THEN v_ly ELSE v_tn END,
            CASE WHEN i = 6 THEN v_sf_ly ELSE v_sf_tn END,
            'SQLTEST-PCS-' || v_tag || '-' || i, 'manual', 'Client ' || i, '2000000' || i,
            'Produit', 1, 49, 49, v_st[i]::order_status,
            CASE WHEN i = 5 THEN v_nav WHEN i = 6 THEN v_darb ELSE v_xd END);
  END LOOP;
  PERFORM set_config('pcs.o', array_to_string(v_o, ','), false);
END
$fixture$;

DO $assert$
DECLARE
  v_o UUID[] := string_to_array(current_setting('pcs.o'), ',')::UUID[];
  r   JSON;
  st  TEXT;
  sl  TEXT;
BEGIN
  -- 1. Le cycle réel, pas à pas.
  r := promote_carrier_status(v_o[1], 'xdelivery', 'deposit', 'ARRIVED_AT_DEPOT', 'X-Delivery: ARRIVED_AT_DEPOT');
  PERFORM pg_temp.eq((r->>'status'), 'deposit', 'scanné → arrivé au dépôt = deposit (le rang autorise le saut de dispatched)');
  r := promote_carrier_status(v_o[1], 'xdelivery', 'out_for_delivery', 'OUT_FOR_DELIVERY', 'X-Delivery: OUT_FOR_DELIVERY');
  PERFORM pg_temp.eq((r->>'status'), 'out_for_delivery', 'deposit → en livraison');
  r := promote_carrier_status(v_o[1], 'xdelivery', 'delivery_delayed', 'RETURNED_AT_DEPOT', 'X-Delivery: RETURNED_AT_DEPOT — Client ne répond pas');
  PERFORM pg_temp.eq((r->>'status'), 'delivery_delayed', 'tentative ratée = retardé (l''agent doit appeler)');
  r := promote_carrier_status(v_o[1], 'xdelivery', 'out_for_delivery', 'OUT_FOR_DELIVERY', 'X-Delivery: OUT_FOR_DELIVERY');
  PERFORM pg_temp.eq((r->>'status'), 'out_for_delivery', 'retardé → ressorti : même rang, pas un recul');
  r := promote_carrier_status(v_o[1], 'xdelivery', 'returning', 'RETURNED_TO_DEPOT_CLIENT', 'X-Delivery: RETURNED_TO_DEPOT_CLIENT — Client a annulé la commande');
  PERFORM pg_temp.eq((r->>'status'), 'returning', 'refus définitif = le colis revient');
  r := promote_carrier_status(v_o[1], 'xdelivery', 'to_be_returned', 'PENDING_RETURNS', 'X-Delivery: PENDING_RETURNS');
  PERFORM pg_temp.eq((r->>'status'), 'to_be_returned', 'retour envoyé = le banc peut le scanner');
  r := promote_carrier_status(v_o[1], 'xdelivery', 'to_be_returned', 'RETURNED_TO_SENDER', 'X-Delivery: RETURNED_TO_SENDER');
  PERFORM pg_temp.eq((r->>'promoted')::BOOLEAN, FALSE, 'remis à l''expéditeur : déjà à retourner, rien ne bouge');
  SELECT carrier_status_slug INTO sl FROM orders WHERE id = v_o[1];
  PERFORM pg_temp.eq(sl, 'RETURNED_TO_SENDER', 'le slug suit quand même le transporteur');

  -- Un recul réel est refusé sans erreur.
  r := promote_carrier_status(v_o[1], 'xdelivery', 'out_for_delivery', 'OUT_FOR_DELIVERY', 'X-Delivery: OUT_FOR_DELIVERY');
  SELECT status INTO st FROM orders WHERE id = v_o[1];
  PERFORM pg_temp.eq(st, 'to_be_returned', 'un statut antérieur réémis ne recule pas la commande');

  -- 7. La trace.
  PERFORM pg_temp.eq(
    (SELECT note FROM order_history WHERE order_id = v_o[1] AND status_to = 'returning' ORDER BY created_at DESC LIMIT 1),
    'X-Delivery: RETURNED_TO_DEPOT_CLIENT — Client a annulé la commande', 'l''historique porte le statut et le motif');
  PERFORM pg_temp.eq(
    (SELECT actor_type FROM order_history WHERE order_id = v_o[1] AND status_to = 'returning' ORDER BY created_at DESC LIMIT 1)::TEXT,
    'system', 'acteur = système');

  -- 2. Sans cible : seul le slug change.
  r := promote_carrier_status(v_o[2], 'xdelivery', NULL, 'PENDING', NULL);
  SELECT status, carrier_status_slug INTO st, sl FROM orders WHERE id = v_o[2];
  PERFORM pg_temp.eq(st, 'uploaded', 'PENDING ne déplace pas la commande');
  PERFORM pg_temp.eq(sl, 'PENDING', 'PENDING est enregistré comme slug');

  -- 3. Livré puis retourné : reste livré, conflit signalé.
  r := promote_carrier_status(v_o[3], 'xdelivery', 'returning', 'RETURNED_TO_DEPOT_CLIENT', 'X-Delivery: RETURNED_TO_DEPOT_CLIENT');
  SELECT status INTO st FROM orders WHERE id = v_o[3];
  PERFORM pg_temp.eq(st, 'delivered', 'un livré retourné ensuite reste livré (décision 7)');
  PERFORM pg_temp.eq((r->>'conflict'), 'delivered_then_returned', 'la réponse signale le conflit');

  -- 4. Le stock ne revient que par le scan.
  PERFORM pg_temp.eq(pg_temp.err(format(
    $$SELECT promote_carrier_status(%L, 'xdelivery', 'returned', 'RETURNED_TO_SENDER', NULL)$$, v_o[4])),
    'P0001', 'returned est refusé : seul le scan du banc rend le stock');
  PERFORM pg_temp.eq(pg_temp.err(format(
    $$SELECT promote_carrier_status(%L, 'xdelivery', 'received', 'X', NULL)$$, v_o[4])),
    'P0001', 'received est refusé');

  -- 5. Mauvais transporteur.
  PERFORM pg_temp.eq(pg_temp.err(format(
    $$SELECT promote_carrier_status(%L, 'xdelivery', 'deposit', 'ARRIVED_AT_DEPOT', NULL)$$, v_o[5])),
    'P0001', 'une commande Navex ne passe pas sous le code xdelivery');
  PERFORM pg_temp.eq(pg_temp.err(format(
    $$SELECT promote_carrier_status(%L, 'darb_assabil', 'returning', 'returning', NULL)$$, v_o[6])),
    'P0001', 'Darb est refusé : il garde promote_darb_status');
  SELECT status INTO st FROM orders WHERE id = v_o[6];
  PERFORM pg_temp.eq(st, 'in_transit', 'la commande libyenne n''a pas bougé');

  -- 6. Privilèges.
  PERFORM pg_temp.ok(NOT has_function_privilege('anon',
    'promote_carrier_status(uuid, text, order_status, text, text, timestamptz)', 'EXECUTE'), 'anon ne peut pas l''appeler');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated',
    'promote_carrier_status(uuid, text, order_status, text, text, timestamptz)', 'EXECUTE'), 'authenticated ne peut pas l''appeler');
  PERFORM pg_temp.ok(has_function_privilege('service_role',
    'promote_carrier_status(uuid, text, order_status, text, text, timestamptz)', 'EXECUTE'), 'service_role peut l''appeler');

  -- Le journal accepte le nouveau code transporteur.
  PERFORM pg_temp.eq(pg_temp.err($$INSERT INTO carrier_event_log (carrier_code, source, tracking_number, outcome)
                                  VALUES ('xdelivery', 'webhook', 'SQLTEST', 'processed')$$),
    'NO_ERROR', 'carrier_event_log accepte xdelivery');
END
$assert$;
