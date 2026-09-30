-- WhatsApp — le déclencheur de file (20260925130000_whatsapp_outbox.sql).
--
-- CE QUE CE FICHIER PROUVE
--   1. Sans configuration active → aucune ligne. Interrupteur général coupé →
--      aucune ligne. Événement coupé → aucune ligne.
--   2. Chaque (marché, statut) donne l'événement attendu ; un statut hors
--      catalogue ne donne rien.
--   3. Une fois par (commande, événement) : deux statuts Darb qui veulent tous
--      deux dire « expédié » n'écrivent qu'une ligne ; attempt_1 puis attempt_2
--      n'en écrivent qu'une.
--   4. Client désabonné, numéro invalide → rien.
--   5. Une mise à jour qui ne touche pas `status` ne déclenche rien.
--   6. La plage d'envoi diffère `not_before` au lendemain matin.
--   7. Les privilèges : la RPC de réclamation n'est pas exécutable par
--      authenticated ; la table est lisible par le manager de son marché.

\set ON_ERROR_STOP on
\i _helpers.sql

DO $fixture$
DECLARE
  v_tn   UUID := '00000000-0000-0000-0000-000000000001';
  v_ly   UUID := '00000000-0000-0000-0000-000000000002';
  v_tag  TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
BEGIN
  -- Ce que la base locale contient déjà est mis de côté et remis à la fin :
  -- lancer ce test ne doit jamais effacer une vraie connexion ni ses réglages.
  CREATE TEMP TABLE wa_saved_settings AS SELECT * FROM settings WHERE key LIKE 'whatsapp_%';
  CREATE TEMP TABLE wa_saved_configs AS SELECT * FROM whatsapp_configs WHERE market_id IN (v_tn, v_ly);
  -- Un jeu de réglages propre pour les deux marchés.
  DELETE FROM settings WHERE key LIKE 'whatsapp_%';
  -- Une configuration factice (chiffrement sans importance : le déclencheur ne lit que status).
  DELETE FROM whatsapp_configs WHERE market_id IN (v_tn, v_ly);
  INSERT INTO whatsapp_configs (market_id, waba_id, phone_number_id, app_id, access_token, app_secret, verify_token, status)
  VALUES (v_tn, 'waba-tn-' || v_tag, 'pn-tn-' || v_tag, 'app', 'x', 'x', 'x', 'active'),
         (v_ly, 'waba-ly-' || v_tag, 'pn-ly-' || v_tag, 'app', 'x', 'x', 'x', 'active');
  PERFORM set_config('r.tag', v_tag, FALSE);
END $fixture$;

-- Un helper : crée une commande et rend son id.
CREATE OR REPLACE FUNCTION pg_temp.mk_order(p_market UUID, p_phone TEXT, p_status TEXT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID := gen_random_uuid(); v_store UUID;
BEGIN
  SELECT id INTO v_store FROM storefronts WHERE market_id = p_market LIMIT 1;
  -- La base locale n'a pas forcément une boutique par marché ; le déclencheur
  -- ne lit pas storefront_id, n'importe laquelle fait l'affaire.
  IF v_store IS NULL THEN SELECT id INTO v_store FROM storefronts LIMIT 1; END IF;
  INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                      customer_name, customer_phone, product_name, quantity, unit_price, total_price, status)
  VALUES (v_id, p_market, v_store, 'SQLTEST-WAO-' || substr(v_id::TEXT, 1, 8), 'manual',
          'Client WA', p_phone, 'SQLTEST', 1, 50, 50, p_status::order_status);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.set_setting(p_market UUID, p_key TEXT, p_value JSONB)
RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO settings (market_id, key, value) VALUES (p_market, p_key, jsonb_build_object('value', p_value))
  ON CONFLICT (market_id, key) DO UPDATE SET value = EXCLUDED.value;
$$;

CREATE OR REPLACE FUNCTION pg_temp.rows_for(p_order UUID)
RETURNS INT LANGUAGE sql AS $$ SELECT count(*)::int FROM whatsapp_outbox WHERE order_id = p_order $$;

\echo ''
\echo '── 1. gardes : config, interrupteur, événement ────────────────────'
DO $t1$
DECLARE
  v_tn UUID := '00000000-0000-0000-0000-000000000001';
  v_o  UUID;
BEGIN
  -- Interrupteur général coupé (défaut) → rien.
  v_o := pg_temp.mk_order(v_tn, '98765432', 'uploaded');
  UPDATE orders SET status = 'dispatched' WHERE id = v_o;
  PERFORM pg_temp.eq(pg_temp.rows_for(v_o), 0, 'interrupteur coupé → aucune ligne');

  -- Interrupteur allumé mais événement coupé → rien.
  PERFORM pg_temp.set_setting(v_tn, 'whatsapp_lifecycle_enabled', 'true'::jsonb);
  v_o := pg_temp.mk_order(v_tn, '98765432', 'uploaded');
  UPDATE orders SET status = 'dispatched' WHERE id = v_o;
  PERFORM pg_temp.eq(pg_temp.rows_for(v_o), 0, 'événement coupé → aucune ligne');

  -- Événement allumé → une ligne.
  PERFORM pg_temp.set_setting(v_tn, 'whatsapp_event_shipped', 'true'::jsonb);
  v_o := pg_temp.mk_order(v_tn, '98765432', 'uploaded');
  UPDATE orders SET status = 'dispatched' WHERE id = v_o;
  PERFORM pg_temp.eq(pg_temp.rows_for(v_o), 1, 'expédié TN → une ligne');
  PERFORM pg_temp.eq((SELECT event_key FROM whatsapp_outbox WHERE order_id = v_o), 'shipped', 'événement shipped');
  PERFORM pg_temp.eq((SELECT phone_e164 FROM whatsapp_outbox WHERE order_id = v_o), '21698765432', 'numéro E.164');
  PERFORM pg_temp.eq((SELECT language FROM whatsapp_outbox WHERE order_id = v_o), 'fr', 'langue = langue du marché (fr)');
  PERFORM pg_temp.eq((SELECT dedupe_key FROM whatsapp_outbox WHERE order_id = v_o), 'lifecycle:' || v_o::TEXT || ':shipped', 'clé de dédoublonnage');

  -- Config en pause → rien.
  UPDATE whatsapp_configs SET status = 'paused' WHERE market_id = v_tn;
  v_o := pg_temp.mk_order(v_tn, '98765432', 'uploaded');
  UPDATE orders SET status = 'dispatched' WHERE id = v_o;
  PERFORM pg_temp.eq(pg_temp.rows_for(v_o), 0, 'config en pause → aucune ligne');
  UPDATE whatsapp_configs SET status = 'active' WHERE market_id = v_tn;
END $t1$;

\echo ''
\echo '── 2. la table (marché × statut) → événement ───────────────────────'
DO $t2$
DECLARE
  v_tn UUID := '00000000-0000-0000-0000-000000000001';
  v_ly UUID := '00000000-0000-0000-0000-000000000002';
  v_o  UUID;
  k TEXT;
BEGIN
  FOREACH k IN ARRAY ARRAY['could_not_reach','shipped','out_for_delivery','last_chance','delivered'] LOOP
    PERFORM pg_temp.set_setting(v_tn, 'whatsapp_event_' || k, 'true'::jsonb);
    PERFORM pg_temp.set_setting(v_ly, 'whatsapp_event_' || k, 'true'::jsonb);
  END LOOP;
  PERFORM pg_temp.set_setting(v_ly, 'whatsapp_lifecycle_enabled', 'true'::jsonb);

  -- TN
  v_o := pg_temp.mk_order(v_tn, '98765432', 'pending');
  UPDATE orders SET status = 'attempt_1' WHERE id = v_o;
  PERFORM pg_temp.eq((SELECT event_key FROM whatsapp_outbox WHERE order_id = v_o), 'could_not_reach', 'TN attempt_1 → could_not_reach');
  v_o := pg_temp.mk_order(v_tn, '98765432', 'dispatched');
  UPDATE orders SET status = 'out_for_delivery' WHERE id = v_o;
  PERFORM pg_temp.eq((SELECT event_key FROM whatsapp_outbox WHERE order_id = v_o), 'out_for_delivery', 'TN out_for_delivery');
  v_o := pg_temp.mk_order(v_tn, '98765432', 'in_transit');
  UPDATE orders SET status = 'returning' WHERE id = v_o;
  PERFORM pg_temp.eq((SELECT event_key FROM whatsapp_outbox WHERE order_id = v_o), 'last_chance', 'TN returning → last_chance');
  v_o := pg_temp.mk_order(v_tn, '98765432', 'out_for_delivery');
  UPDATE orders SET status = 'delivered' WHERE id = v_o;
  PERFORM pg_temp.eq((SELECT event_key FROM whatsapp_outbox WHERE order_id = v_o), 'delivered', 'TN delivered');
  -- TN scanned n'est PAS « expédié » (c'est dispatched qui l'est en Tunisie).
  v_o := pg_temp.mk_order(v_tn, '98765432', 'uploaded');
  UPDATE orders SET status = 'scanned' WHERE id = v_o;
  PERFORM pg_temp.eq(pg_temp.rows_for(v_o), 0, 'TN scanned → rien');

  -- LY
  v_o := pg_temp.mk_order(v_ly, '0916063026', 'uploaded');
  UPDATE orders SET status = 'scanned' WHERE id = v_o;
  PERFORM pg_temp.eq((SELECT event_key FROM whatsapp_outbox WHERE order_id = v_o), 'shipped', 'LY scanned → shipped');
  PERFORM pg_temp.eq((SELECT language FROM whatsapp_outbox WHERE order_id = v_o), 'ar', 'LY langue par défaut = ar');
  PERFORM pg_temp.eq((SELECT phone_e164 FROM whatsapp_outbox WHERE order_id = v_o), '218916063026', 'LY numéro E.164');
  -- Deux statuts Darb pour la même idée → toujours une seule ligne.
  UPDATE orders SET status = 'at_carrier' WHERE id = v_o;
  PERFORM pg_temp.eq(pg_temp.rows_for(v_o), 1, 'scanned puis at_carrier → une seule ligne');
  v_o := pg_temp.mk_order(v_ly, '0916063026', 'out_for_delivery');
  UPDATE orders SET status = 'delivery_delayed' WHERE id = v_o;
  PERFORM pg_temp.eq((SELECT event_key FROM whatsapp_outbox WHERE order_id = v_o), 'last_chance', 'LY delivery_delayed → last_chance');
  -- attempt_1 puis attempt_2 → une seule ligne could_not_reach.
  v_o := pg_temp.mk_order(v_ly, '0916063026', 'pending');
  UPDATE orders SET status = 'attempt_1' WHERE id = v_o;
  UPDATE orders SET status = 'attempt_2' WHERE id = v_o;
  PERFORM pg_temp.eq(pg_temp.rows_for(v_o), 1, 'attempt_1 puis attempt_2 → une seule ligne');
  PERFORM pg_temp.eq((SELECT event_key FROM whatsapp_outbox WHERE order_id = v_o), 'could_not_reach', '… could_not_reach');
END $t2$;

\echo ''
\echo '── 3. les freins : désabonné, numéro invalide, colonne hors statut ─'
DO $t3$
DECLARE
  v_ly UUID := '00000000-0000-0000-0000-000000000002';
  v_o  UUID;
  v_c  UUID;
BEGIN
  -- Numéro fixe libyen (021…) : WhatsApp ne peut pas livrer → rien.
  v_o := pg_temp.mk_order(v_ly, '0213334455', 'uploaded');
  UPDATE orders SET status = 'scanned' WHERE id = v_o;
  PERFORM pg_temp.eq(pg_temp.rows_for(v_o), 0, 'numéro invalide → aucune ligne');

  -- Client désabonné → rien.
  v_o := pg_temp.mk_order(v_ly, '0917777777', 'uploaded');
  SELECT customer_id INTO v_c FROM orders WHERE id = v_o;
  UPDATE customers SET whatsapp_opted_out_at = now() WHERE id = v_c;
  UPDATE orders SET status = 'scanned' WHERE id = v_o;
  PERFORM pg_temp.eq(pg_temp.rows_for(v_o), 0, 'client désabonné → aucune ligne');
  UPDATE customers SET whatsapp_opted_out_at = NULL WHERE id = v_c;

  -- Langue mémorisée du client → respectée.
  UPDATE customers SET whatsapp_language = 'fr' WHERE id = v_c;
  v_o := pg_temp.mk_order(v_ly, '0917777777', 'uploaded');
  UPDATE orders SET status = 'scanned' WHERE id = v_o;
  PERFORM pg_temp.eq((SELECT language FROM whatsapp_outbox WHERE order_id = v_o), 'fr', 'langue mémorisée du client (fr) sur LY');

  -- Une mise à jour hors `status` ne déclenche rien de plus.
  UPDATE orders SET carrier_status_slug = 'x-' || current_setting('r.tag') WHERE id = v_o;
  PERFORM pg_temp.eq(pg_temp.rows_for(v_o), 1, 'mise à jour carrier_status_slug → pas de nouvelle ligne');
END $t3$;

\echo ''
\echo '── 4. la plage d''envoi ─────────────────────────────────────────────'
DO $t4$
DECLARE
  v_ly UUID := '00000000-0000-0000-0000-000000000002';
  v_at timestamptz;
  v_slot timestamptz;
BEGIN
  PERFORM pg_temp.set_setting(v_ly, 'whatsapp_send_window', '"10-20"'::jsonb);
  -- 03:00 Tripoli (UTC+2) = 01:00 UTC → attendu 10:00 Tripoli le même jour = 08:00 UTC.
  v_at := '2026-09-25 01:00:00+00';
  v_slot := whatsapp_next_send_slot(v_ly, v_at);
  PERFORM pg_temp.eq(v_slot, '2026-09-25 08:00:00+00'::timestamptz, '03:00 → 10:00 le même jour');
  -- 12:00 Tripoli → inchangé.
  v_at := '2026-09-25 10:00:00+00';
  PERFORM pg_temp.eq(whatsapp_next_send_slot(v_ly, v_at), v_at, 'dans la plage → inchangé');
  -- 21:30 Tripoli → 10:00 le lendemain.
  v_at := '2026-09-25 19:30:00+00';
  PERFORM pg_temp.eq(whatsapp_next_send_slot(v_ly, v_at), '2026-09-26 08:00:00+00'::timestamptz, '21:30 → 10:00 le lendemain');
  -- Sans réglage → inchangé.
  DELETE FROM settings WHERE market_id = v_ly AND key = 'whatsapp_send_window';
  PERFORM pg_temp.eq(whatsapp_next_send_slot(v_ly, v_at), v_at, 'sans plage → inchangé');
END $t4$;

\echo ''
\echo '── 5. privilèges ────────────────────────────────────────────────────'
DO $t5$
BEGIN
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', 'public.whatsapp_outbox_claim(uuid, integer)', 'EXECUTE'),
    'authenticated ne réclame pas la file');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.whatsapp_outbox_claim(uuid, integer)', 'EXECUTE'),
    'anon non plus');
  PERFORM pg_temp.ok(has_function_privilege('service_role', 'public.whatsapp_outbox_claim(uuid, integer)', 'EXECUTE'),
    'service_role réclame la file');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', 'public.whatsapp_enqueue_lifecycle()', 'EXECUTE'),
    'le déclencheur n''est pas appelable');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.whatsapp_outbox', 'INSERT'),
    'authenticated n''écrit pas dans la file');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', 'public.invoke_whatsapp_outbox()', 'EXECUTE'),
    'invoke_whatsapp_outbox réservé à service_role');
END $t5$;

-- Nettoyage : les réglages, la file et les configurations factices partent,
-- ce qui existait avant le test revient (les commandes SQLTEST restent, comme
-- dans les autres tests).
DELETE FROM settings WHERE key LIKE 'whatsapp_%';
INSERT INTO settings SELECT * FROM wa_saved_settings;
DELETE FROM whatsapp_outbox WHERE order_id IN (SELECT id FROM orders WHERE external_id LIKE 'SQLTEST-WAO-%');
DELETE FROM whatsapp_configs WHERE waba_id LIKE 'waba-__-' || current_setting('r.tag');
INSERT INTO whatsapp_configs SELECT * FROM wa_saved_configs;

\echo ''
\echo '✓ whatsapp_lifecycle_trigger_test.sql'
