-- get_product_cohort (plans/products-redesign-v6.md §4) — avec carrier_parcel_outcome,
-- la vue partagée avec la page Transporteurs.
--
-- CE QUE CE FICHIER PROUVE
--   1. La cohorte : une commande compte pour chaque produit qu'elle contient, avec sa part
--      au prix des lignes.
--   2. Le sort d'un colis suit Darb quand Ordra dit « annulée » : livrée par Darb → livrée ;
--      rendue par le guichet retours (released APRÈS annulation) → échouée ; annulée par
--      Darb après prise en charge → échouée ; annulée avant prise en charge → annulée avant
--      envoi. Et `released` SEUL (sorti avec un livreur) reste en route.
--   3. Le coût : la facture Darb du colis livré.
--   4. La pub d'une ligne de plusieurs jours est répartie jour par jour.
--   5. La fiche produit reçoit les livraisons par jour et les noms des agents.
--   6. Garde de marché et privilèges : un manager d'un autre marché reçoit {} ; anon ne peut
--      pas appeler la fonction ; le helper interne n'est pas exposé.

\set ON_ERROR_STOP on
\i _helpers.sql

DO $fixture$
DECLARE
  v_ly    UUID := '00000000-0000-0000-0000-000000000002';
  v_tn    UUID := '00000000-0000-0000-0000-000000000001';
  v_tag   TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_ag    UUID := gen_random_uuid();
  v_mm    UUID := gen_random_uuid();
  v_darb  UUID := gen_random_uuid();
  v_p1    UUID := gen_random_uuid();
  v_p2    UUID := gen_random_uuid();
  v_sf    UUID;
  v_day   TIMESTAMPTZ := ((now() AT TIME ZONE 'Africa/Tripoli')::date - 1 + time '10:00') AT TIME ZONE 'Africa/Tripoli';
  v_o     UUID[] := ARRAY[]::UUID[];
  -- statut Ordra, slug Darb, prise en charge, facture, produit (1 = P1, 2 = P2, 3 = mixte)
  v_st    TEXT[] := ARRAY['delivered','cancelled','cancelled','cancelled','cancelled','out_for_delivery','rejected','delivered','pending'];
  v_slug  TEXT[] := ARRAY['completed','completed','released','cancelled','cancelled','released',NULL,'completed',NULL];
  v_pick  BOOLEAN[] := ARRAY[TRUE,TRUE,TRUE,TRUE,FALSE,TRUE,FALSE,TRUE,FALSE];
  v_bill  NUMERIC[] := ARRAY[30,20,NULL,NULL,NULL,NULL,NULL,40,NULL];
  v_prod  INT[] := ARRAY[1,1,1,1,1,1,1,3,2];
  i       INT;
BEGIN
  SELECT id INTO v_sf FROM storefronts WHERE market_id = v_ly LIMIT 1;
  IF v_sf IS NULL THEN RAISE EXCEPTION 'Fixture incomplète : aucune boutique LY'; END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (v_ag, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest.coh.ag.' || v_tag || '@oms.local', 'x', now(), now(), now()),
         (v_mm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest.coh.mm.' || v_tag || '@oms.local', 'x', now(), now(), now());
  INSERT INTO public.users (id, email, full_name, role, market_id, is_active)
  VALUES (v_ag, 'sqltest.coh.ag.' || v_tag || '@oms.local', 'Agent Coh ' || v_tag, 'agent', v_ly, TRUE),
         (v_mm, 'sqltest.coh.mm.' || v_tag || '@oms.local', 'Manager TN ' || v_tag, 'market_manager', v_tn, TRUE);

  INSERT INTO carriers (id, market_id, name, code, delivery_fee, return_fee, is_active)
  VALUES (v_darb, v_ly, 'SQLTEST Darb coh ' || v_tag, 'darb_assabil', 10, 5, FALSE);

  INSERT INTO products (id, market_id, name, unit_cogs, packing_cost)
  VALUES (v_p1, v_ly, 'SQLTEST P1 ' || v_tag, 40, 0.5),
         (v_p2, v_ly, 'SQLTEST P2 ' || v_tag, 20, 0);

  FOR i IN 1..9 LOOP
    v_o := v_o || gen_random_uuid();
    INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                        customer_name, customer_phone, product_id, product_name, quantity, unit_price, total_price,
                        status, carrier_id, assigned_to, rejection_reason, created_at)
    VALUES (v_o[i], v_ly, v_sf, 'SQLTEST-COH-' || v_tag || '-' || i, 'manual',
            'Client ' || i, '+21891000000' || i,
            CASE v_prod[i] WHEN 2 THEN v_p2 ELSE v_p1 END, 'Produit',
            1, CASE WHEN v_prod[i] = 3 THEN 200 ELSE 249 END, CASE WHEN v_prod[i] = 3 THEN 200 ELSE 249 END,
            v_st[i]::order_status,
            CASE WHEN v_slug[i] IS NOT NULL THEN v_darb END,
            v_ag,
            CASE WHEN v_st[i] = 'rejected' THEN 'commande_invalide'::rejection_reason END,
            v_day);

    IF v_slug[i] IS NOT NULL THEN
      INSERT INTO order_history (order_id, market_id, status_from, status_to, actor_type, created_at)
      VALUES (v_o[i], v_ly, 'confirmed', 'uploaded', 'agent', v_day + interval '1 hour');
      INSERT INTO darb_shipments (darb_id, order_id, carrier_id, status_slug, billed_shipping_amount, completed_at, carrier_updated_at,
                                  cancellation_cause)
      VALUES ('sqltest-coh-' || v_tag || '-' || i, v_o[i], v_darb, v_slug[i], v_bill[i],
              CASE WHEN v_slug[i] = 'completed' THEN v_day + interval '20 hours' END, v_day + interval '20 hours',
              CASE WHEN v_slug[i] IN ('cancelled', 'released') THEN 'other' END);
      IF v_pick[i] THEN
        INSERT INTO darb_timeline_events (darb_id, order_id, event_id, type, occurred_at)
        VALUES ('sqltest-coh-' || v_tag || '-' || i, v_o[i], 'ev-' || v_tag || '-' || i, 'assigned', v_day + interval '3 hours');
      END IF;
    END IF;
    IF v_st[i] = 'delivered' THEN
      INSERT INTO order_history (order_id, market_id, status_from, status_to, actor_type, created_at)
      VALUES (v_o[i], v_ly, 'out_for_delivery', 'delivered', 'system', v_day + interval '20 hours');
    END IF;
  END LOOP;

  -- Deux tentatives d'appel sur la commande 1.
  INSERT INTO order_history (order_id, market_id, status_from, status_to, actor_type, created_at)
  VALUES (v_o[1], v_ly, 'pending', 'attempt_1', 'agent', v_day + interval '10 minutes'),
         (v_o[1], v_ly, 'attempt_1', 'attempt_2', 'agent', v_day + interval '20 minutes');

  -- Commande mixte : P1 150, P2 50 → parts 0,75 / 0,25.
  INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, line_total)
  VALUES (v_o[8], v_p1, 'P1', 1, 150, 150),
         (v_o[8], v_p2, 'P2', 1, 50, 50);

  -- 100 de pub sur deux jours : 50 hier, 50 aujourd'hui.
  INSERT INTO ad_spend (market_id, product_id, amount, period_start, period_end, is_active)
  VALUES (v_ly, v_p1, 100, (now() AT TIME ZONE 'Africa/Tripoli')::date - 1, (now() AT TIME ZONE 'Africa/Tripoli')::date, TRUE);

  PERFORM set_config('coh.o', array_to_string(v_o, ','), false);
  PERFORM set_config('coh.p1', v_p1::text, false);
  PERFORM set_config('coh.p2', v_p2::text, false);
  PERFORM set_config('coh.ag', v_ag::text, false);
  PERFORM set_config('coh.mm', v_mm::text, false);
END
$fixture$;

DO $assert$
DECLARE
  v_o     UUID[] := string_to_array(current_setting('coh.o'), ',')::UUID[];
  v_p1    UUID := current_setting('coh.p1')::UUID;
  v_p2    UUID := current_setting('coh.p2')::UUID;
  v_ly    UUID := '00000000-0000-0000-0000-000000000002';
  v_today DATE := (now() AT TIME ZONE 'Africa/Tripoli')::date;
  r       JSONB;
  s       JSONB;
  m       JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', 'aaaaaaaa-0000-4000-8000-000000000001', 'role', 'authenticated')::TEXT, TRUE);
  r := get_product_cohort(v_ly, v_today - 1, v_today, 'Africa/Tripoli');
  s := get_product_cohort(v_ly, v_today - 1, v_today, 'Africa/Tripoli', v_p1);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('coh.mm'), 'role', 'authenticated')::TEXT, TRUE);
  m := get_product_cohort(v_ly, v_today - 1, v_today, 'Africa/Tripoli');
  PERFORM set_config('request.jwt.claims', '', TRUE);

  -- 1. cohorte
  PERFORM pg_temp.eq((SELECT count(*)::int FROM jsonb_array_elements(r -> 'lines') e WHERE (e ->> 'product_id')::uuid = v_p1), 8,
                     'P1 : 8 commandes (la mixte comprise)');
  PERFORM pg_temp.eq((SELECT count(*)::int FROM jsonb_array_elements(r -> 'lines') e WHERE (e ->> 'product_id')::uuid = v_p2), 2,
                     'P2 : 2 commandes (la mixte compte +1 pour lui aussi)');
  PERFORM pg_temp.eq((SELECT (e ->> 'share')::numeric FROM jsonb_array_elements(r -> 'lines') e
                      WHERE (e ->> 'order_id')::uuid = v_o[8] AND (e ->> 'product_id')::uuid = v_p1), 0.75,
                     'commande mixte : P1 porte 75 % au prix des lignes');

  -- 2. le sort des colis
  PERFORM pg_temp.eq((SELECT e ->> 'outcome' FROM jsonb_array_elements(r -> 'lines') e WHERE (e ->> 'order_id')::uuid = v_o[2]), 'delivered',
                     'annulée dans Ordra, livrée par Darb → livrée');
  PERFORM pg_temp.eq((SELECT e ->> 'outcome' FROM jsonb_array_elements(r -> 'lines') e WHERE (e ->> 'order_id')::uuid = v_o[3]), 'failed',
                     'annulée puis rendue au guichet retours (released) → échouée');
  PERFORM pg_temp.eq((SELECT e ->> 'outcome' FROM jsonb_array_elements(r -> 'lines') e WHERE (e ->> 'order_id')::uuid = v_o[4]), 'failed',
                     'annulée par Darb après prise en charge → échouée');
  PERFORM pg_temp.eq((SELECT e ->> 'outcome' FROM jsonb_array_elements(r -> 'lines') e WHERE (e ->> 'order_id')::uuid = v_o[5]), 'cancelled_before_pickup',
                     'annulée avant prise en charge → annulée avant envoi');
  PERFORM pg_temp.eq((SELECT e ->> 'outcome' FROM jsonb_array_elements(r -> 'lines') e WHERE (e ->> 'order_id')::uuid = v_o[6]), 'in_flight',
                     'released SANS annulation = sorti avec un livreur → en route');
  PERFORM pg_temp.ok((SELECT e -> 'outcome' = 'null'::jsonb FROM jsonb_array_elements(r -> 'lines') e WHERE (e ->> 'order_id')::uuid = v_o[7]),
                     'jamais uploadée → pas de sort de colis');
  PERFORM pg_temp.eq((SELECT e ->> 'failure_cause' FROM jsonb_array_elements(r -> 'lines') e WHERE (e ->> 'order_id')::uuid = v_o[4]), 'other',
                     'la cause d''échec Darb est transmise');

  -- 3. coût et tentatives
  PERFORM pg_temp.eq((SELECT (e ->> 'delivery_cost')::numeric FROM jsonb_array_elements(r -> 'lines') e WHERE (e ->> 'order_id')::uuid = v_o[1]), 30::numeric,
                     'la facture Darb du colis livré');
  PERFORM pg_temp.eq((SELECT (e ->> 'attempts')::int FROM jsonb_array_elements(r -> 'lines') e WHERE (e ->> 'order_id')::uuid = v_o[1]), 2,
                     'deux tentatives d''appel');
  PERFORM pg_temp.ok((SELECT (e ->> 'confirmed')::boolean FROM jsonb_array_elements(r -> 'lines') e WHERE (e ->> 'order_id')::uuid = v_o[1]),
                     'une commande uploadée a été confirmée');

  -- 4. pub
  PERFORM pg_temp.eq((SELECT sum((e ->> 'amount')::numeric) FROM jsonb_array_elements(r -> 'ads') e WHERE (e ->> 'product_id')::uuid = v_p1), 100::numeric,
                     'pub de P1 : 100 sur la fenêtre');
  PERFORM pg_temp.eq((SELECT count(*)::int FROM jsonb_array_elements(r -> 'ads') e WHERE (e ->> 'product_id')::uuid = v_p1), 2,
                     'une ligne de deux jours devient deux jours de 50');

  -- 5. fiche produit
  PERFORM pg_temp.eq((SELECT count(*)::int FROM jsonb_array_elements(s -> 'lines') e), 8,
                     'fiche : seules les lignes de P1');
  PERFORM pg_temp.eq((SELECT sum((e ->> 'n')::int)::int FROM jsonb_array_elements(s -> 'delivered_days') e), 3,
                     'fiche : 3 livraisons dans la fenêtre (1, 2 et la mixte)');
  PERFORM pg_temp.ok((SELECT bool_or(e ->> 'full_name' LIKE 'Agent Coh %') FROM jsonb_array_elements(s -> 'users') e),
                     'fiche : le nom de l''agent');

  -- 6. garde et privilèges
  PERFORM pg_temp.eq(m, '{}'::jsonb, 'un manager tunisien ne lit pas la Libye');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'get_product_cohort(uuid, date, date, text, uuid)', 'EXECUTE'),
                     'anon ne peut pas l''appeler');
  PERFORM pg_temp.ok(has_function_privilege('authenticated', 'get_product_cohort(uuid, date, date, text, uuid)', 'EXECUTE'),
                     'authenticated peut');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', 'product_order_lines(uuid, timestamptz, timestamptz, uuid)', 'EXECUTE'),
                     'le helper interne n''est pas exposé');
END
$assert$;
