-- WhatsApp — les fondations (20260925100000_whatsapp_core.sql).
--
-- CE QUE CE FICHIER PROUVE
--   1. `whatsapp_e164` construit le même numéro que toWhatsAppE164() côté TS
--      (216 + 8 chiffres ; 218 + 9 chiffres commençant par 9 ; sinon NULL).
--   2. Le garde de `whatsapp_messages` : le contenu est immuable, le statut
--      n'avance que vers l'avant (ou vers `failed`), les horodatages ne
--      s'effacent jamais — parce que Meta livre ses webhooks dans le désordre.
--   3. Les privilèges : `authenticated` ne voit pas `whatsapp_configs`, ne
--      peut qu'écrire rien sur les trois autres ; `anon` ne voit rien ;
--      `set_customer_whatsapp_language` n'est pas exécutable sans session.
--   4. `set_customer_whatsapp_language` sous un VRAI JWT : l'agent assigné
--      passe, l'agent d'un autre client est refusé, le manager de l'autre
--      marché est refusé.

\set ON_ERROR_STOP on
\i _helpers.sql

\echo ''
\echo '── 1. whatsapp_e164 ─────────────────────────────────────────────────'
DO $t1$
BEGIN
  PERFORM pg_temp.eq(whatsapp_e164('98 765 432', 'tn'),      '21698765432',  'TN national → 216');
  PERFORM pg_temp.eq(whatsapp_e164('+216 98765432', 'tn'),   '21698765432',  'TN avec +216');
  PERFORM pg_temp.eq(whatsapp_e164('0021698765432', 'tn'),   '21698765432',  'TN avec 00216');
  PERFORM pg_temp.eq(whatsapp_e164('0916063026', 'ly'),      '218916063026', 'LY avec zéro national');
  PERFORM pg_temp.eq(whatsapp_e164('916063026', 'ly'),       '218916063026', 'LY sans zéro');
  PERFORM pg_temp.eq(whatsapp_e164('+218 91 606 3026', 'ly'),'218916063026', 'LY avec +218');
  PERFORM pg_temp.ok(whatsapp_e164('9876543', 'tn') IS NULL,      'TN trop court → NULL');
  PERFORM pg_temp.ok(whatsapp_e164('0213334455', 'ly') IS NULL,   'LY fixe (021) → NULL');
  PERFORM pg_temp.ok(whatsapp_e164('', 'tn') IS NULL,             'vide → NULL');
  PERFORM pg_temp.ok(whatsapp_e164(NULL, 'ly') IS NULL,           'NULL → NULL');
END $t1$;

\echo ''
\echo '── 2. le garde de whatsapp_messages ────────────────────────────────'
DO $t2$
DECLARE
  v_market UUID := '00000000-0000-0000-0000-000000000001';
  v_conv   UUID := gen_random_uuid();
  v_msg    UUID := gen_random_uuid();
  v_tag    TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_state  TEXT;
  r        RECORD;
BEGIN
  INSERT INTO whatsapp_conversations (id, market_id, phone_e164)
  VALUES (v_conv, v_market, '2169' || substr(v_tag, 1, 7));

  INSERT INTO whatsapp_messages (id, market_id, conversation_id, direction, phone_e164,
                                 kind, body, status, actor_type)
  VALUES (v_msg, v_market, v_conv, 'out', '2169' || substr(v_tag, 1, 7),
          'text', 'Bonjour', 'queued', 'agent');

  -- Le wamid s'apprend une fois.
  UPDATE whatsapp_messages SET wamid = 'wamid.' || v_tag, status = 'sent', sent_at = now() WHERE id = v_msg;
  SELECT status, wamid INTO r FROM whatsapp_messages WHERE id = v_msg;
  PERFORM pg_temp.eq(r.status, 'sent', 'queued → sent');

  -- `read` arrive AVANT `delivered` (désordre réel de Meta).
  UPDATE whatsapp_messages SET status = 'read', read_at = now() WHERE id = v_msg;
  UPDATE whatsapp_messages SET status = 'delivered', delivered_at = now() - interval '1 minute' WHERE id = v_msg;
  SELECT status, delivered_at, read_at INTO r FROM whatsapp_messages WHERE id = v_msg;
  PERFORM pg_temp.eq(r.status, 'read', 'un delivered tardif ne fait pas reculer read');
  PERFORM pg_temp.ok(r.delivered_at IS NOT NULL, '… mais delivered_at est rempli');
  PERFORM pg_temp.ok(r.read_at IS NOT NULL, 'read_at conservé');

  -- Un `sent` en retard est ignoré sans erreur (le lot webhook ne doit pas planter).
  UPDATE whatsapp_messages SET status = 'sent' WHERE id = v_msg;
  PERFORM pg_temp.eq((SELECT status FROM whatsapp_messages WHERE id = v_msg), 'read',
    'un sent tardif est ignoré silencieusement');

  -- On ne peut pas effacer un horodatage.
  UPDATE whatsapp_messages SET read_at = NULL WHERE id = v_msg;
  PERFORM pg_temp.ok((SELECT read_at FROM whatsapp_messages WHERE id = v_msg) IS NOT NULL,
    'read_at ne peut pas être effacé');

  -- Le contenu est immuable.
  v_state := pg_temp.err(format('UPDATE whatsapp_messages SET body = %L WHERE id = %L', 'Autre', v_msg));
  PERFORM pg_temp.eq(v_state, '42501', 'body immuable → 42501');
  v_state := pg_temp.err(format('UPDATE whatsapp_messages SET wamid = %L WHERE id = %L', 'wamid.autre', v_msg));
  PERFORM pg_temp.eq(v_state, '42501', 'wamid immuable une fois posé → 42501');
  v_state := pg_temp.err(format('UPDATE whatsapp_messages SET direction = %L WHERE id = %L', 'in', v_msg));
  PERFORM pg_temp.eq(v_state, '42501', 'direction immuable → 42501');

  -- `failed` s'applique toujours.
  UPDATE whatsapp_messages SET status = 'failed', failed_at = now(), error_code = 131026 WHERE id = v_msg;
  PERFORM pg_temp.eq((SELECT status FROM whatsapp_messages WHERE id = v_msg), 'failed', 'failed s''applique après read');

  -- Le rattachement (order_id / lead_id) reste modifiable : ce n'est pas du contenu.
  v_state := pg_temp.err(format('UPDATE whatsapp_messages SET order_id = NULL WHERE id = %L', v_msg));
  PERFORM pg_temp.eq(v_state, 'NO_ERROR', 'order_id reste modifiable (rattachement)');

  -- Deux lignes ne peuvent pas porter le même wamid.
  v_state := pg_temp.err(format(
    'INSERT INTO whatsapp_messages (market_id, conversation_id, direction, phone_e164, kind, status, actor_type, wamid)
     VALUES (%L, %L, %L, %L, %L, %L, %L, %L)',
    v_market, v_conv, 'in', '2169' || substr(v_tag, 1, 7), 'text', 'received', 'customer', 'wamid.' || v_tag));
  PERFORM pg_temp.eq(v_state, '23505', 'wamid unique → 23505 (idempotence webhook)');

  DELETE FROM whatsapp_messages WHERE conversation_id = v_conv;
  DELETE FROM whatsapp_conversations WHERE id = v_conv;
END $t2$;

\echo ''
\echo '── 3. privilèges ────────────────────────────────────────────────────'
DO $t3$
BEGIN
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.whatsapp_configs', 'SELECT'),
    'authenticated ne lit pas whatsapp_configs');
  PERFORM pg_temp.ok(NOT has_table_privilege('anon', 'public.whatsapp_configs', 'SELECT'),
    'anon ne lit pas whatsapp_configs');
  PERFORM pg_temp.ok(has_table_privilege('authenticated', 'public.whatsapp_templates', 'SELECT'),
    'authenticated lit whatsapp_templates (RLS filtre)');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.whatsapp_templates', 'INSERT'),
    'authenticated n''insère pas dans whatsapp_templates');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.whatsapp_messages', 'UPDATE'),
    'authenticated ne modifie pas whatsapp_messages');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.whatsapp_conversations', 'DELETE'),
    'authenticated ne supprime pas whatsapp_conversations');
  PERFORM pg_temp.ok(NOT has_table_privilege('anon', 'public.whatsapp_messages', 'SELECT'),
    'anon ne lit pas whatsapp_messages');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.set_customer_whatsapp_language(uuid, text)', 'EXECUTE'),
    'anon n''exécute pas set_customer_whatsapp_language');
  PERFORM pg_temp.ok(has_function_privilege('authenticated', 'public.set_customer_whatsapp_language(uuid, text)', 'EXECUTE'),
    'authenticated exécute set_customer_whatsapp_language (la garde est dedans)');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', 'public.whatsapp_messages_guard()', 'EXECUTE'),
    'le garde n''est pas appelable directement');
END $t3$;

\echo ''
\echo '── 4. set_customer_whatsapp_language sous un vrai JWT ──────────────'
DO $fixture$
DECLARE
  v_market UUID := '00000000-0000-0000-0000-000000000001';
  v_other  UUID := '00000000-0000-0000-0000-000000000002';
  v_ag     UUID := 'aaaaaaaa-0000-4000-8000-0000000a0a01'::UUID;
  v_ag2    UUID := 'aaaaaaaa-0000-4000-8000-0000000a0a02'::UUID;
  v_mmly   UUID := 'aaaaaaaa-0000-4000-8000-0000000a0a03'::UUID;
  v_tag    TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_cust   UUID := gen_random_uuid();
  v_ord    UUID := gen_random_uuid();
  v_store  UUID;
  v_phone  TEXT := '2' || lpad((floor(random() * 10000000))::TEXT, 7, '0');
BEGIN
  SELECT id INTO v_store FROM storefronts WHERE market_id = v_market LIMIT 1;
  IF v_store IS NULL THEN RAISE EXCEPTION 'Fixture incomplète : aucune boutique TN'; END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_ag,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest.wa.ag@oms.local',   'x', now(), now(), now()),
    (v_ag2,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest.wa.ag2@oms.local',  'x', now(), now(), now()),
    (v_mmly, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest.wa.mmly@oms.local', 'x', now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, email, full_name, role, market_id, is_active)
  VALUES
    (v_ag,   'sqltest.wa.ag@oms.local',   'SQL WA Agent',      'agent',          v_market, TRUE),
    (v_ag2,  'sqltest.wa.ag2@oms.local',  'SQL WA Agent 2',    'agent',          v_market, TRUE),
    (v_mmly, 'sqltest.wa.mmly@oms.local', 'SQL WA Manager LY', 'market_manager', v_other,  TRUE)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, market_id = EXCLUDED.market_id;

  -- La commande crée le client par déclencheur (orders_link_customer).
  INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                      customer_name, customer_phone, product_name, quantity, unit_price, total_price,
                      status, assigned_to)
  VALUES (v_ord, v_market, v_store, 'SQLTEST-WA-' || v_tag, 'manual',
          'Client WA', v_phone, 'SQLTEST WA', 1, 99, 99, 'pending', v_ag);

  SELECT customer_id INTO v_cust FROM orders WHERE id = v_ord;
  IF v_cust IS NULL THEN RAISE EXCEPTION 'orders_link_customer n''a pas posé customer_id'; END IF;

  PERFORM set_config('r.ag', v_ag::TEXT, FALSE);
  PERFORM set_config('r.ag2', v_ag2::TEXT, FALSE);
  PERFORM set_config('r.mmly', v_mmly::TEXT, FALSE);
  PERFORM set_config('r.cust', v_cust::TEXT, FALSE);
  PERFORM set_config('r.ord', v_ord::TEXT, FALSE);
END $fixture$;

DO $t4$
DECLARE
  v_cust  UUID := current_setting('r.cust')::UUID;
  v_state TEXT;
BEGIN
  -- L'agent assigné.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('r.ag'), 'role', 'authenticated')::TEXT, TRUE);
  v_state := pg_temp.err(format('SELECT set_customer_whatsapp_language(%L::UUID, %L)', v_cust, 'ar'));
  PERFORM pg_temp.eq(v_state, 'NO_ERROR', 'l''agent assigné pose la langue');
  PERFORM pg_temp.eq((SELECT whatsapp_language FROM customers WHERE id = v_cust), 'ar', 'la langue est enregistrée');

  -- Une langue hors ar/fr est refusée.
  v_state := pg_temp.err(format('SELECT set_customer_whatsapp_language(%L::UUID, %L)', v_cust, 'en'));
  PERFORM pg_temp.eq(v_state, '22023', 'en → 22023');

  -- Un autre agent du même marché, non assigné.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('r.ag2'), 'role', 'authenticated')::TEXT, TRUE);
  v_state := pg_temp.err(format('SELECT set_customer_whatsapp_language(%L::UUID, %L)', v_cust, 'fr'));
  PERFORM pg_temp.eq(v_state, '42501', 'un agent non assigné est refusé');

  -- Le manager de l'AUTRE marché.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('r.mmly'), 'role', 'authenticated')::TEXT, TRUE);
  v_state := pg_temp.err(format('SELECT set_customer_whatsapp_language(%L::UUID, %L)', v_cust, 'fr'));
  PERFORM pg_temp.eq(v_state, '42501', 'le manager de l''autre marché est refusé');
  PERFORM pg_temp.eq((SELECT whatsapp_language FROM customers WHERE id = v_cust), 'ar', 'la langue n''a pas bougé');

  PERFORM set_config('request.jwt.claims', '', TRUE);
END $t4$;

\echo ''
\echo '── 5. RLS de lecture sous JWT ───────────────────────────────────────'
DO $t5$
DECLARE
  v_market UUID := '00000000-0000-0000-0000-000000000001';
  v_ord    UUID := current_setting('r.ord')::UUID;
  v_conv   UUID := gen_random_uuid();
  v_tag    TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 7);
  v_n      INT;
BEGIN
  INSERT INTO whatsapp_conversations (id, market_id, phone_e164, current_order_id)
  VALUES (v_conv, v_market, '2169' || v_tag, v_ord);
  INSERT INTO whatsapp_messages (market_id, conversation_id, direction, phone_e164, kind, body, status, actor_type, order_id)
  VALUES (v_market, v_conv, 'in', '2169' || v_tag, 'text', 'Oui', 'received', 'customer', v_ord);

  -- L'agent assigné voit la conversation et le message.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('r.ag'), 'role', 'authenticated')::TEXT, TRUE);
  SELECT count(*) INTO v_n FROM whatsapp_conversations WHERE id = v_conv;
  PERFORM pg_temp.eq(v_n, 1, 'l''agent assigné voit la conversation');
  SELECT count(*) INTO v_n FROM whatsapp_messages WHERE conversation_id = v_conv;
  PERFORM pg_temp.eq(v_n, 1, 'l''agent assigné voit le message');

  -- L'autre agent ne voit rien.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('r.ag2'), 'role', 'authenticated')::TEXT, TRUE);
  SELECT count(*) INTO v_n FROM whatsapp_conversations WHERE id = v_conv;
  PERFORM pg_temp.eq(v_n, 0, 'un agent non assigné ne voit pas la conversation');
  SELECT count(*) INTO v_n FROM whatsapp_messages WHERE conversation_id = v_conv;
  PERFORM pg_temp.eq(v_n, 0, 'ni le message');

  -- Le manager libyen ne voit pas une conversation tunisienne.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('r.mmly'), 'role', 'authenticated')::TEXT, TRUE);
  SELECT count(*) INTO v_n FROM whatsapp_conversations WHERE id = v_conv;
  PERFORM pg_temp.eq(v_n, 0, 'le manager de l''autre marché ne voit pas la conversation');

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', TRUE);
  DELETE FROM whatsapp_messages WHERE conversation_id = v_conv;
  DELETE FROM whatsapp_conversations WHERE id = v_conv;
END $t5$;

\echo ''
\echo '✓ whatsapp_core_test.sql'
