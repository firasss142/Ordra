-- order_delivery_cost (plans/products-redesign-v6.md, Phase 2).
--
-- CE QUE CE FICHIER PROUVE
--   1. Darb : la facture du colis LIVRÉ, sinon le devis de l'upload, sinon NULL — jamais
--      le tarif fixe de 10 د.ل, et un colis Darb échoué ne coûte rien.
--   2. Un colis renvoyé (deux expéditions Darb) donne UNE ligne, au montant de
--      l'expédition livrée — order_carrier_cost en donnait deux.
--   3. Les autres transporteurs (Tunisie) gardent leur tarif fixe, livraison et retour.
--   4. Une commande sans transporteur : NULL, retour 0.

\set ON_ERROR_STOP on
\i _helpers.sql

DO $fixture$
DECLARE
  v_ly     UUID := '00000000-0000-0000-0000-000000000002';
  v_tn     UUID := '00000000-0000-0000-0000-000000000001';
  v_tag    TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_darb   UUID := gen_random_uuid();
  v_navex  UUID := gen_random_uuid();
  v_ly_sf  UUID;
  v_tn_sf  UUID;
  v_o      UUID[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                           gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  i        INT;
BEGIN
  SELECT id INTO v_ly_sf FROM storefronts WHERE market_id = v_ly LIMIT 1;
  SELECT id INTO v_tn_sf FROM storefronts WHERE market_id = v_tn LIMIT 1;
  IF v_ly_sf IS NULL OR v_tn_sf IS NULL THEN RAISE EXCEPTION 'Fixture incomplète : boutiques LY/TN'; END IF;

  -- Darb's flat fields carry the old wrong values on purpose: the view must ignore them.
  INSERT INTO carriers (id, market_id, name, code, delivery_fee, return_fee, is_active)
  VALUES (v_darb,  v_ly, 'SQLTEST Darb '  || v_tag, 'darb_assabil', 10, 5, FALSE),
         (v_navex, v_tn, 'SQLTEST Navex ' || v_tag, 'navex',         6, 4, FALSE);

  FOR i IN 1..6 LOOP
    INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                        customer_name, customer_phone, product_name, quantity, unit_price, total_price,
                        status, carrier_id, delivery_cost_quoted)
    VALUES (v_o[i],
            CASE WHEN i = 5 THEN v_tn ELSE v_ly END,
            CASE WHEN i = 5 THEN v_tn_sf ELSE v_ly_sf END,
            'SQLTEST-ODC-' || v_tag || '-' || i, 'manual',
            'Client ' || i, '+21890000000' || i, 'Produit', 1, 249, 249,
            'delivered',
            CASE i WHEN 5 THEN v_navex WHEN 6 THEN NULL ELSE v_darb END,
            CASE i WHEN 1 THEN 25 WHEN 2 THEN 30 WHEN 3 THEN 22 ELSE NULL END);
  END LOOP;

  -- 1: invoiced. 2: re-sent — a cancelled first trip billed 20, the delivered one 35.
  -- 3: completed but not billed yet (the quote is used). 4: nothing known.
  INSERT INTO darb_shipments (darb_id, order_id, carrier_id, status_slug, billed_shipping_amount, completed_at, carrier_updated_at)
  VALUES ('sqltest-' || v_tag || '-1',  v_o[1], v_darb, 'completed', 30,   now() - interval '2 days', now() - interval '2 days'),
         ('sqltest-' || v_tag || '-2a', v_o[2], v_darb, 'cancelled', 20,   NULL,                      now() - interval '9 days'),
         ('sqltest-' || v_tag || '-2b', v_o[2], v_darb, 'completed', 35,   now() - interval '1 day',  now() - interval '1 day'),
         ('sqltest-' || v_tag || '-3',  v_o[3], v_darb, 'completed', NULL, now() - interval '1 day',  now() - interval '1 day');

  PERFORM set_config('sqltest.odc', array_to_string(v_o, ','), false);
END
$fixture$;

DO $assert$
DECLARE
  v_o UUID[] := string_to_array(current_setting('sqltest.odc'), ',')::UUID[];
BEGIN
  PERFORM pg_temp.eq((SELECT delivery_cost FROM order_delivery_cost WHERE order_id = v_o[1]), 30::numeric,
                     'Darb livré : la facture (30), pas le devis (25) ni le tarif fixe (10)');
  PERFORM pg_temp.eq((SELECT delivery_cost_source FROM order_delivery_cost WHERE order_id = v_o[1]), 'invoice',
                     'source : facture');
  PERFORM pg_temp.eq((SELECT count(*)::int FROM order_delivery_cost WHERE order_id = v_o[2]), 1,
                     'colis renvoyé : une seule ligne');
  PERFORM pg_temp.eq((SELECT delivery_cost FROM order_delivery_cost WHERE order_id = v_o[2]), 35::numeric,
                     'colis renvoyé : la facture de l''expédition livrée');
  PERFORM pg_temp.eq((SELECT delivery_cost FROM order_delivery_cost WHERE order_id = v_o[3]), 22::numeric,
                     'livré sans facture encore : le devis de l''upload');
  PERFORM pg_temp.eq((SELECT delivery_cost_source FROM order_delivery_cost WHERE order_id = v_o[3]), 'quote',
                     'source : devis');
  PERFORM pg_temp.ok((SELECT delivery_cost IS NULL AND delivery_cost_source IS NULL FROM order_delivery_cost WHERE order_id = v_o[4]),
                     'rien de connu : NULL, la moyenne du marché sera appliquée à la lecture');
  PERFORM pg_temp.ok((SELECT bool_and(return_cost = 0) FROM order_delivery_cost WHERE order_id = ANY (v_o[1:4])),
                     'un colis Darb échoué ne coûte rien (retour 0, pas 5)');
  PERFORM pg_temp.eq((SELECT delivery_cost FROM order_delivery_cost WHERE order_id = v_o[5]), 6::numeric,
                     'Tunisie : tarif fixe de livraison');
  PERFORM pg_temp.eq((SELECT return_cost FROM order_delivery_cost WHERE order_id = v_o[5]), 4::numeric,
                     'Tunisie : tarif fixe de retour');
  PERFORM pg_temp.ok((SELECT delivery_cost IS NULL AND return_cost = 0 FROM order_delivery_cost WHERE order_id = v_o[6]),
                     'sans transporteur : NULL, retour 0');
END
$assert$;
