-- Manifestes transporteur : la liste retour scannée jusqu'au bout, et la liste
-- d'enlèvement qu'on défait. Plan : plans/xdelivery-manifests.md.
--
-- CE QUE CE FICHIER PROUVE
--   1. Un scan sur la liste retour accepte LES DEUX codes (code-barres X-Delivery,
--      QR Ordra = id de commande), remet le stock UNE fois, et amène à
--      `to_be_returned` une commande que la synchro n'y avait pas encore mise.
--   2. Un colis hors liste est mis de côté (compté une fois) et rien ne bouge ;
--      une liste suivante qui le contient le résout.
--   3. Un colis qui n'est pas une commande Ordra est coché sans mouvement de stock.
--   4. Un colis livré est refusé (DELIVERED_CONFLICT) ; un code inconnu aussi, sans trace.
--   5. « Endommagé » APRÈS le scan : la correction s'ajoute au registre (−qty en bon
--      état, +qty en casse), une seule fois, et seulement tant que la liste est ouverte.
--   6. Clôturer rend les manquants ; ils restent scannables ensuite.
--   7. Qui : agent sans bâtiment, autre marché, acteur emprunté — refusés. RLS en
--      lecture seule par marché ; anon n'exécute rien.
--   8. `release_pickup_parcel` : scanné → uploadé, stock rendu comme un dé-scan, slug
--      CREATED ; idempotent ; service role seulement.
--   9. `unscan_order` accepte un colis X-Delivery jamais demandé (CREATED) et refuse un
--      colis sur une liste d'enlèvement (PENDING).
--
-- TESTÉ SOUS UN VRAI JWT : sans jeton `auth.uid()` est NULL et les gardes d'acteur
-- deviennent invisibles (note « RLS helpers search_path »).

\set ON_ERROR_STOP on
\i _helpers.sql

\echo ''
\echo '── fixture ────────────────────────────────────────────────────────────'

DO $fixture$
DECLARE
  v_tn    UUID := '00000000-0000-0000-0000-000000000001';
  v_ly    UUID := '00000000-0000-0000-0000-000000000002';
  v_mm    UUID := 'bbbbbbbb-0000-4000-8000-000000000001';
  v_wa    UUID := 'bbbbbbbb-0000-4000-8000-000000000002';
  v_none  UUID := 'bbbbbbbb-0000-4000-8000-000000000003';
  v_ly_wa UUID := 'bbbbbbbb-0000-4000-8000-000000000004';
  v_tag   TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_site  UUID;
  v_store UUID;
  v_xd    UUID := gen_random_uuid();
  v_prod  UUID := gen_random_uuid();
  v_m     UUID := gen_random_uuid();
  v_m2    UUID := gen_random_uuid();
  v_o     UUID[] := ARRAY[]::UUID[];
  -- 1 returning · 2 to_be_returned · 3 delivered · 4 to_be_returned (hors liste)
  -- 5 returning (manquant) · 6 scanned PENDING (release) · 7 scanned CREATED (dé-scan)
  -- 8 scanned PENDING (dé-scan refusé)
  v_st    TEXT[] := ARRAY['returning','to_be_returned','delivered','to_be_returned',
                          'returning','scanned','scanned','scanned'];
  v_slug  TEXT[] := ARRAY[NULL,'PENDING_RETURNS','DELIVERED','PENDING_RETURNS',
                          'RETURNED_TO_DEPOT_CLIENT','PENDING','CREATED','PENDING'];
  i INT;
BEGIN
  SELECT id INTO v_site  FROM warehouses  WHERE market_id = v_tn AND is_active ORDER BY code LIMIT 1;
  SELECT id INTO v_store FROM storefronts WHERE market_id = v_tn LIMIT 1;
  IF v_site IS NULL OR v_store IS NULL THEN
    RAISE EXCEPTION 'Fixture incomplète : entrepôt=%, boutique=%', v_site, v_store;
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'sqltest.cm.' || n || '@oms.local', 'x', now(), now(), now()
  FROM (VALUES (v_mm, 'mm'), (v_wa, 'wa'), (v_none, 'none'), (v_ly_wa, 'lywa')) t(u, n)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, email, full_name, role, market_id, warehouse_id, is_active)
  VALUES
    (v_mm,    'sqltest.cm.mm@oms.local',   'CM Manager',  'market_manager',  v_tn, NULL,   TRUE),
    (v_wa,    'sqltest.cm.wa@oms.local',   'CM Agent',    'warehouse_agent', v_tn, v_site, TRUE),
    (v_none,  'sqltest.cm.none@oms.local', 'CM Sans site','warehouse_agent', v_tn, NULL,   TRUE),
    (v_ly_wa, 'sqltest.cm.lywa@oms.local', 'CM Agent LY', 'warehouse_agent', v_ly, NULL,   TRUE)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, market_id = EXCLUDED.market_id,
                                 warehouse_id = EXCLUDED.warehouse_id;

  INSERT INTO carriers (id, market_id, name, code, delivery_fee, return_fee, is_active, warehouse_id)
  VALUES (v_xd, v_tn, 'SQLTEST CM X-Delivery ' || v_tag, 'xdelivery', 0, 0, FALSE, v_site);

  INSERT INTO products (id, market_id, name, sku, unit_cogs, default_price,
                        initial_stock, current_stock, is_active)
  VALUES (v_prod, v_tn, 'SQLTEST CM ' || v_tag, 'SQLTEST-CM-' || v_tag, 10, 99, 10, 10, TRUE);

  FOR i IN 1..8 LOOP
    v_o := v_o || gen_random_uuid();
    INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                        customer_name, customer_phone, product_name, product_id, quantity,
                        unit_price, total_price, status, carrier_id, warehouse_id,
                        tracking_number, carrier_status_slug)
    VALUES (v_o[i], v_tn, v_store, 'SQLTEST-CM-' || v_tag || '-' || i, 'manual',
            'Client ' || i, '2000010' || i, 'SQLTEST CM', v_prod, 1, 99, 99,
            v_st[i]::order_status, v_xd, v_site, 'CM' || v_tag || i, v_slug[i]);
  END LOOP;

  -- La liste retour du jour : 1, 2, 3, 5 et un colis Converty inconnu d'Ordra.
  INSERT INTO carrier_manifests (id, market_id, carrier_id, warehouse_id, kind, external_id,
                                 code, carrier_status)
  VALUES (v_m, v_tn, v_xd, v_site, 'return', 'ext-' || v_tag || '-1', 'SHEET' || v_tag, 'ACCEPTED');
  INSERT INTO carrier_manifest_parcels (manifest_id, order_id, barcode)
  VALUES (v_m, v_o[1], 'CM' || v_tag || '1'),
         (v_m, v_o[2], 'CM' || v_tag || '2'),
         (v_m, v_o[3], 'CM' || v_tag || '3'),
         (v_m, v_o[5], 'CM' || v_tag || '5'),
         (v_m, NULL,   'CONV' || v_tag);

  -- La liste du lendemain, qui contient le colis mis de côté (4).
  INSERT INTO carrier_manifests (id, market_id, carrier_id, warehouse_id, kind, external_id,
                                 code, carrier_status)
  VALUES (v_m2, v_tn, v_xd, v_site, 'return', 'ext-' || v_tag || '-2', 'SHEET2' || v_tag, 'ACCEPTED');
  INSERT INTO carrier_manifest_parcels (manifest_id, order_id, barcode)
  VALUES (v_m2, v_o[4], 'CM' || v_tag || '4');

  PERFORM set_config('c.tag', v_tag, FALSE);
  PERFORM set_config('c.mm', v_mm::TEXT, FALSE);
  PERFORM set_config('c.wa', v_wa::TEXT, FALSE);
  PERFORM set_config('c.none', v_none::TEXT, FALSE);
  PERFORM set_config('c.lywa', v_ly_wa::TEXT, FALSE);
  PERFORM set_config('c.prod', v_prod::TEXT, FALSE);
  PERFORM set_config('c.m', v_m::TEXT, FALSE);
  PERFORM set_config('c.m2', v_m2::TEXT, FALSE);
  PERFORM set_config('c.o', array_to_string(v_o, ','), FALSE);
END
$fixture$;

\echo ''
\echo '── 1–4. scanner la liste retour ───────────────────────────────────────'

DO $scan$
DECLARE
  v_tag TEXT := current_setting('c.tag');
  v_wa  UUID := current_setting('c.wa')::UUID;
  v_m   UUID := current_setting('c.m')::UUID;
  v_m2  UUID := current_setting('c.m2')::UUID;
  v_o   UUID[] := string_to_array(current_setting('c.o'), ',')::UUID[];
  v_p   UUID := current_setting('c.prod')::UUID;
  r     JSON;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_wa, 'role', 'authenticated')::TEXT, TRUE);

  -- 1. Le code-barres X-Delivery d'un colis encore « returning » : la liste fait foi.
  r := scan_manifest_return(v_m, '  CM' || v_tag || '1 ', v_wa);
  PERFORM pg_temp.eq(r->>'result', 'received', 'code-barres X-Delivery → reçu');
  PERFORM pg_temp.eq((SELECT status::TEXT FROM orders WHERE id = v_o[1]), 'returned',
    'returning → returned : la liste amène à to_be_returned, puis le scan habituel');
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 11, 'stock +1');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM order_history WHERE order_id = v_o[1]
                       AND status_from = 'returning' AND status_to = 'to_be_returned'), 1,
    'le passage par to_be_returned est tracé');

  -- Le QR Ordra (id de commande) coche la même liste.
  r := scan_manifest_return(v_m, v_o[2]::TEXT, v_wa);
  PERFORM pg_temp.eq(r->>'result', 'received', 'QR Ordra → reçu');
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 12, 'stock +1 encore');
  PERFORM pg_temp.eq((r->>'received')::INT, 2, 'la réponse compte les reçus');
  PERFORM pg_temp.eq((r->>'expected')::INT, 5, 'et la taille de la liste');

  -- Deux fois le même : rien ne bouge.
  r := scan_manifest_return(v_m, 'CM' || v_tag || '1', v_wa);
  PERFORM pg_temp.eq(r->>'result', 'already_received', 'déjà scanné');
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 12, 'pas de double stock');

  -- 2. Hors liste : de côté, compté une fois, rien ne bouge.
  r := scan_manifest_return(v_m, 'CM' || v_tag || '4', v_wa);
  PERFORM pg_temp.eq(r->>'result', 'not_on_manifest', 'hors liste → refusé');
  r := scan_manifest_return(v_m, v_o[4]::TEXT, v_wa);
  PERFORM pg_temp.eq((r->>'set_aside')::INT, 1, 'le même colis par son QR : toujours 1 de côté');
  PERFORM pg_temp.eq((SELECT status::TEXT FROM orders WHERE id = v_o[4]), 'to_be_returned',
    'le colis de côté n''a pas bougé');

  -- 3. Pas une commande Ordra : coché, sans stock.
  r := scan_manifest_return(v_m, 'CONV' || v_tag, v_wa);
  PERFORM pg_temp.eq(r->>'result', 'received_unlinked', 'colis Converty coché');
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 12, 'sans mouvement');

  -- 4. Livré : refusé, la ligne reste attendue. Code inconnu : refusé, pas de trace.
  PERFORM pg_temp.ok(pg_temp.err(format('SELECT scan_manifest_return(%L, %L, %L)', v_m, 'CM' || v_tag || '3', v_wa)) <> 'NO_ERROR',
    'un colis livré est refusé');
  PERFORM pg_temp.eq((SELECT state FROM carrier_manifest_parcels WHERE manifest_id = v_m AND order_id = v_o[3]),
    'expected', 'sa ligne reste attendue');
  r := scan_manifest_return(v_m, 'NOPE' || v_tag, v_wa);
  PERFORM pg_temp.eq(r->>'result', 'unknown_code', 'code inconnu');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM return_set_asides WHERE scanned_code = 'NOPE' || v_tag), 0,
    'un code illisible n''est pas mis de côté');

  -- 5. Endommagé après coup : −1 en bon état, +1 en casse, une seule fois.
  r := mark_manifest_return_damaged(
    (SELECT id FROM carrier_manifest_parcels WHERE manifest_id = v_m AND order_id = v_o[2]),
    v_wa, 'carrier_damage', NULL);
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 11, 'endommagé : le bon état est repris');
  PERFORM pg_temp.eq((SELECT damaged_return_count FROM products WHERE id = v_p), 1, 'et compté en casse');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM inventory_log WHERE order_id = v_o[2]
                       AND reason = 'returned' AND change = -1), 1, 'par une écriture de correction');
  PERFORM pg_temp.ok(pg_temp.err(format('SELECT mark_manifest_return_damaged(%L, %L, ''carrier_damage'', NULL)',
    (SELECT id FROM carrier_manifest_parcels WHERE manifest_id = v_m AND order_id = v_o[2]), v_wa)) <> 'NO_ERROR',
    'une deuxième fois : refusé');
  PERFORM pg_temp.ok(pg_temp.err(format('SELECT mark_manifest_return_damaged(%L, %L, ''other'', NULL)',
    (SELECT id FROM carrier_manifest_parcels WHERE manifest_id = v_m AND order_id = v_o[1]), v_wa)) <> 'NO_ERROR',
    '« autre » sans note : refusé');

  -- 6. Clôturer : les manquants (3 livré, 5 jamais arrivé).
  r := close_return_manifest(v_m, v_wa);
  PERFORM pg_temp.eq((r->>'missing_count')::INT, 2, 'deux manquants');
  PERFORM pg_temp.ok((SELECT closed_at IS NOT NULL FROM carrier_manifests WHERE id = v_m), 'la liste est close');
  r := close_return_manifest(v_m, v_wa);
  PERFORM pg_temp.eq((r->>'missing_count')::INT, 2, 'clôturer deux fois ne change rien');
  PERFORM pg_temp.ok(pg_temp.err(format('SELECT mark_manifest_return_damaged(%L, %L, ''carrier_damage'', NULL)',
    (SELECT id FROM carrier_manifest_parcels WHERE manifest_id = v_m AND order_id = v_o[1]), v_wa)) <> 'NO_ERROR',
    'liste close : plus de correction');
  r := scan_manifest_return(v_m, 'CM' || v_tag || '5', v_wa);
  PERFORM pg_temp.eq(r->>'result', 'received', 'un manquant arrivé plus tard se scanne encore');

  -- La liste du lendemain résout le colis mis de côté.
  r := scan_manifest_return(v_m2, 'CM' || v_tag || '4', v_wa);
  PERFORM pg_temp.eq(r->>'result', 'received', 'le colis de côté, sur la liste suivante');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM return_set_asides WHERE order_id = v_o[4] AND resolved_at IS NULL), 0,
    'n''est plus de côté');

  PERFORM set_config('request.jwt.claims', '', TRUE);
END
$scan$;

\echo ''
\echo '── 7. qui ─────────────────────────────────────────────────────────────'

DO $who$
DECLARE
  v_tag  TEXT := current_setting('c.tag');
  v_m    UUID := current_setting('c.m')::UUID;
  v_wa   UUID := current_setting('c.wa')::UUID;
  v_none UUID := current_setting('c.none')::UUID;
  v_lywa UUID := current_setting('c.lywa')::UUID;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_none, 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT scan_manifest_return(%L, %L, %L)', v_m, 'CM' || v_tag || '3', v_none)),
    '42501', 'un agent sans bâtiment ne scanne rien');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lywa, 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.ok(pg_temp.err(format('SELECT scan_manifest_return(%L, %L, %L)', v_m, 'CM' || v_tag || '3', v_lywa)) <> 'NO_ERROR',
    'un agent de l''autre marché non plus');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT scan_manifest_return(%L, %L, %L)', v_m, 'CM' || v_tag || '3', v_wa)),
    '42501', 'ni en empruntant l''identité d''un collègue');
  PERFORM set_config('request.jwt.claims', '', TRUE);

  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.scan_manifest_return(uuid,text,uuid)', 'EXECUTE'),
    'anon n''exécute pas scan_manifest_return');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.mark_manifest_return_damaged(uuid,uuid,return_reason,text)', 'EXECUTE'),
    'anon n''exécute pas mark_manifest_return_damaged');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.close_return_manifest(uuid,uuid)', 'EXECUTE'),
    'anon n''exécute pas close_return_manifest');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', 'public.release_pickup_parcel(uuid,uuid,text)', 'EXECUTE'),
    'release_pickup_parcel : pas pour authenticated');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', 'public._reverse_scan_stock(uuid,uuid,text,text)', 'EXECUTE'),
    'le cœur du dé-scan n''est appelable par personne');
END
$who$;

-- RLS en vrai rôle `authenticated` : l'agent voit sa liste, l'agent sans bâtiment rien.
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('c.wa'), 'role', 'authenticated')::TEXT, TRUE);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM carrier_manifests WHERE id = current_setting('c.m')::UUID), 1,
    'RLS : l''agent du bâtiment lit la liste');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM carrier_manifest_parcels WHERE manifest_id = current_setting('c.m')::UUID), 5,
    'RLS : et ses lignes');
  PERFORM pg_temp.eq(pg_temp.err('UPDATE carrier_manifest_parcels SET state = ''received'' WHERE true'), '42501',
    'RLS : aucune écriture directe');
END $$;
RESET ROLE;
COMMIT;

BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('c.none'), 'role', 'authenticated')::TEXT, TRUE);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM carrier_manifests WHERE id = current_setting('c.m')::UUID), 0,
    'RLS : sans bâtiment, l''agent ne lit rien');
END $$;
RESET ROLE;
COMMIT;

\echo ''
\echo '── 8–9. défaire une liste d''enlèvement, dé-scanner ────────────────────'

DO $pickup$
DECLARE
  v_mm UUID := current_setting('c.mm')::UUID;
  v_wa UUID := current_setting('c.wa')::UUID;
  v_o  UUID[] := string_to_array(current_setting('c.o'), ',')::UUID[];
  v_p  UUID := current_setting('c.prod')::UUID;
  v_before INT;
  r    JSON;
BEGIN
  SELECT current_stock INTO v_before FROM products WHERE id = v_p;

  -- Service role (pas de jeton), au nom du manager qui a appuyé.
  r := release_pickup_parcel(v_o[6], v_mm, 'Liste d''enlèvement supprimée');
  PERFORM pg_temp.eq((r->>'released')::BOOLEAN, TRUE, 'scanné → relâché');
  PERFORM pg_temp.eq((SELECT status::TEXT FROM orders WHERE id = v_o[6]), 'uploaded', 'retour à uploadée');
  PERFORM pg_temp.eq((SELECT carrier_status_slug FROM orders WHERE id = v_o[6]), 'CREATED', 'X-Delivery : en attente');
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), v_before + 1, 'stock rendu');
  PERFORM pg_temp.eq((SELECT reason FROM inventory_log WHERE order_id = v_o[6] ORDER BY created_at DESC LIMIT 1),
    'scan_reversal', 'même mouvement qu''un dé-scan');

  r := release_pickup_parcel(v_o[6], NULL, 'détecté sur le portail');
  PERFORM pg_temp.eq((r->>'released')::BOOLEAN, FALSE, 'deux fois : rien, sans erreur');
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), v_before + 1, 'pas de double stock');

  -- Système (acteur NULL) : l'historique dit « system ».
  r := release_pickup_parcel(v_o[8], NULL, 'Retiré de la liste sur le portail X-Delivery');
  PERFORM pg_temp.eq((SELECT actor_type FROM order_history WHERE order_id = v_o[8] ORDER BY created_at DESC LIMIT 1),
    'system', 'détecté chez le transporteur → acteur système');

  -- 9. Dé-scan par l'agent : CREATED passe, PENDING (sur une liste) est refusé.
  UPDATE orders SET status = 'scanned', carrier_status_slug = 'PENDING' WHERE id = v_o[8];
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_wa, 'role', 'authenticated')::TEXT, TRUE);
  PERFORM unscan_order(v_o[7], v_wa, 'test');
  PERFORM pg_temp.eq((SELECT status::TEXT FROM orders WHERE id = v_o[7]), 'uploaded',
    'X-Delivery jamais demandé (CREATED) : dé-scan possible');
  PERFORM pg_temp.ok(pg_temp.err(format('SELECT unscan_order(%L, %L, ''test'')', v_o[8], v_wa)) <> 'NO_ERROR',
    'sur une liste d''enlèvement (PENDING) : refusé');
  PERFORM set_config('request.jwt.claims', '', TRUE);
END
$pickup$;

\echo ''
\echo '✓ carrier_manifests_test'
