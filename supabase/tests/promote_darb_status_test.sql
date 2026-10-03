-- promote_darb_status suit Darb jusqu'au bout (20261004100300, plans/products-redesign-v6.md Phase 3).
--
-- CE QUE CE FICHIER PROUVE
--   1. Un « cancelled » Darb APRÈS prise en charge n'est plus terminal : le colis revient
--      (returning) — avant prise en charge, il reste annulé.
--   2. Un « released » qui suit une annulation ou un retour = rendu au guichet retours →
--      to_be_returned (le banc peut le scanner). Sans annulation derrière, il reste
--      « sorti avec un livreur ».
--   3. Un colis qui revient et que Darb livre finalement → delivered.
--   4. L'historique n'est PAS touché : une commande déjà « cancelled » ne bouge pas
--      (c'est le rattrapage, soumis à l'essai à blanc, qui s'en charge).

\set ON_ERROR_STOP on
\i _helpers.sql

DO $fixture$
DECLARE
  v_ly   UUID := '00000000-0000-0000-0000-000000000002';
  v_tag  TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_darb UUID := gen_random_uuid();
  v_sf   UUID;
  v_o    UUID[] := ARRAY[]::UUID[];
  v_st   TEXT[] := ARRAY['out_for_delivery','uploaded','returning','out_for_delivery','at_carrier','returning','cancelled'];
  i      INT;
BEGIN
  SELECT id INTO v_sf FROM storefronts WHERE market_id = v_ly LIMIT 1;
  INSERT INTO carriers (id, market_id, name, code, delivery_fee, return_fee, is_active)
  VALUES (v_darb, v_ly, 'SQLTEST Darb promote ' || v_tag, 'darb_assabil', 0, 0, FALSE);
  FOR i IN 1..7 LOOP
    v_o := v_o || gen_random_uuid();
    INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform, customer_name, customer_phone,
                        product_name, quantity, unit_price, total_price, status, carrier_id)
    VALUES (v_o[i], v_ly, v_sf, 'SQLTEST-PDS-' || v_tag || '-' || i, 'manual', 'Client ' || i, '+2189300000' || i,
            'Produit', 1, 249, 249, v_st[i]::order_status, v_darb);
    INSERT INTO darb_shipments (darb_id, order_id, carrier_id, status_slug, cancel_count, carrier_updated_at)
    VALUES ('sqltest-pds-' || v_tag || '-' || i, v_o[i], v_darb, 'delayed', CASE WHEN i = 4 THEN 1 ELSE 0 END, now());
  END LOOP;
  -- 1 was grabbed by a courier; 2 never was.
  INSERT INTO darb_timeline_events (darb_id, order_id, event_id, type, occurred_at)
  VALUES ('sqltest-pds-' || v_tag || '-1', v_o[1], 'pds-ev-' || v_tag, 'assigned', now() - interval '1 day');
  PERFORM set_config('pds.o', array_to_string(v_o, ','), false);
END
$fixture$;

DO $assert$
DECLARE
  v_o UUID[] := string_to_array(current_setting('pds.o'), ',')::UUID[];
  st  TEXT;
BEGIN
  PERFORM promote_darb_status(v_o[1], 'cancelled');
  SELECT status INTO st FROM orders WHERE id = v_o[1];
  PERFORM pg_temp.eq(st, 'returning', 'annulé par Darb après prise en charge → le colis revient');

  PERFORM promote_darb_status(v_o[2], 'cancelled');
  SELECT status INTO st FROM orders WHERE id = v_o[2];
  PERFORM pg_temp.eq(st, 'cancelled', 'annulé avant prise en charge → annulé');

  PERFORM promote_darb_status(v_o[3], 'released');
  SELECT status INTO st FROM orders WHERE id = v_o[3];
  PERFORM pg_temp.eq(st, 'to_be_returned', 'released après un retour → rendu, à scanner au banc');

  PERFORM promote_darb_status(v_o[4], 'released');
  SELECT status INTO st FROM orders WHERE id = v_o[4];
  PERFORM pg_temp.eq(st, 'to_be_returned', 'released avec une annulation Darb derrière → rendu');

  PERFORM promote_darb_status(v_o[5], 'released');
  SELECT status INTO st FROM orders WHERE id = v_o[5];
  PERFORM pg_temp.eq(st, 'out_for_delivery', 'released sans annulation → sorti avec un livreur');

  PERFORM promote_darb_status(v_o[6], 'completed');
  SELECT status INTO st FROM orders WHERE id = v_o[6];
  PERFORM pg_temp.eq(st, 'delivered', 'revenait, finalement livré → livré');

  PERFORM promote_darb_status(v_o[7], 'completed');
  SELECT status INTO st FROM orders WHERE id = v_o[7];
  PERFORM pg_temp.eq(st, 'cancelled', 'l''historique « cancelled » ne bouge pas sans le rattrapage');

  PERFORM pg_temp.eq((SELECT note FROM order_history WHERE order_id = v_o[1] ORDER BY created_at DESC LIMIT 1),
                     'Darb Assabil carrier status: cancelled', 'la trace dit quel statut Darb a été lu');
END
$assert$;
