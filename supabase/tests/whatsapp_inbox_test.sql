-- WhatsApp — la boîte des orphelines (20260925140000_whatsapp_inbox.sql).
--
-- CE QUE CE FICHIER PROUVE, sous de vrais JWT
--   1. Le manager de son marché rattache une conversation à une commande :
--      la conversation pointe la commande, les messages sans ancre en héritent,
--      l'agent de la commande reçoit une notification.
--   2. Le manager de l'AUTRE marché est refusé ; l'agent est refusé ;
--      rattacher à une commande d'un autre marché est refusé.
--   3. whatsapp_orphan_unread_count : le manager compte son marché, l'agent 0.

\set ON_ERROR_STOP on
\i _helpers.sql

DO $fixture$
DECLARE
  v_tn   UUID := '00000000-0000-0000-0000-000000000001';
  v_ly   UUID := '00000000-0000-0000-0000-000000000002';
  v_mmtn UUID := 'aaaaaaaa-0000-4000-8000-0000000b0b01';
  v_mmly UUID := 'aaaaaaaa-0000-4000-8000-0000000b0b02';
  v_ag   UUID := 'aaaaaaaa-0000-4000-8000-0000000b0b03';
  v_tag  TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 7);
  v_store UUID;
  v_ord  UUID := gen_random_uuid();
  v_ordly UUID := gen_random_uuid();
  v_conv UUID := gen_random_uuid();
  v_conv2 UUID := gen_random_uuid();
  v_phone TEXT := '2169' || v_tag;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_mmtn, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest.inbox.mmtn@oms.local', 'x', now(), now(), now()),
    (v_mmly, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest.inbox.mmly@oms.local', 'x', now(), now(), now()),
    (v_ag,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest.inbox.ag@oms.local',   'x', now(), now(), now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.users (id, email, full_name, role, market_id, is_active)
  VALUES
    (v_mmtn, 'sqltest.inbox.mmtn@oms.local', 'Inbox MM TN', 'market_manager', v_tn, TRUE),
    (v_mmly, 'sqltest.inbox.mmly@oms.local', 'Inbox MM LY', 'market_manager', v_ly, TRUE),
    (v_ag,   'sqltest.inbox.ag@oms.local',   'Inbox Agent',  'agent',          v_tn, TRUE)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, market_id = EXCLUDED.market_id;

  SELECT id INTO v_store FROM storefronts WHERE market_id = v_tn LIMIT 1;
  IF v_store IS NULL THEN SELECT id INTO v_store FROM storefronts LIMIT 1; END IF;
  INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform, customer_name, customer_phone, product_name, quantity, unit_price, total_price, status, assigned_to)
  VALUES (v_ord, v_tn, v_store, 'SQLTEST-INBOX-' || v_tag, 'manual', 'Client Inbox', '9' || v_tag, 'SQLTEST', 1, 50, 50, 'pending', v_ag),
         (v_ordly, v_ly, v_store, 'SQLTEST-INBOX-LY-' || v_tag, 'manual', 'Client LY', '0916' || v_tag, 'SQLTEST', 1, 50, 50, 'pending', NULL);

  INSERT INTO whatsapp_conversations (id, market_id, phone_e164, unread_count, last_inbound_at, last_message_at)
  VALUES (v_conv, v_tn, v_phone, 2, now(), now()),
         (v_conv2, v_tn, '2165' || v_tag, 1, now(), now());
  INSERT INTO whatsapp_messages (market_id, conversation_id, direction, phone_e164, kind, body, status, actor_type)
  VALUES (v_tn, v_conv, 'in', v_phone, 'text', 'Bonjour', 'received', 'customer'),
         (v_tn, v_conv, 'in', v_phone, 'text', 'C''est pour ma commande', 'received', 'customer');

  PERFORM set_config('r.mmtn', v_mmtn::TEXT, FALSE);
  PERFORM set_config('r.mmly', v_mmly::TEXT, FALSE);
  PERFORM set_config('r.ag', v_ag::TEXT, FALSE);
  PERFORM set_config('r.ord', v_ord::TEXT, FALSE);
  PERFORM set_config('r.ordly', v_ordly::TEXT, FALSE);
  PERFORM set_config('r.conv', v_conv::TEXT, FALSE);
  PERFORM set_config('r.conv2', v_conv2::TEXT, FALSE);
END $fixture$;

\echo ''
\echo '── 1. le manager rattache ───────────────────────────────────────────'
DO $t1$
DECLARE
  v_conv UUID := current_setting('r.conv')::UUID;
  v_ord  UUID := current_setting('r.ord')::UUID;
  v_state TEXT;
  v_n INT;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mmtn'), 'role', 'authenticated')::TEXT, TRUE);
  SELECT whatsapp_claim_conversation(v_conv, v_ord, NULL) INTO v_n;
  PERFORM pg_temp.eq(v_n, 2, 'deux messages sans ancre rattachés');
  PERFORM pg_temp.eq((SELECT current_order_id FROM whatsapp_conversations WHERE id = v_conv), v_ord, 'la conversation pointe la commande');
  PERFORM pg_temp.eq((SELECT count(*)::int FROM whatsapp_messages WHERE conversation_id = v_conv AND order_id = v_ord), 2, 'les messages portent order_id');
  PERFORM pg_temp.eq((SELECT count(*)::int FROM agent_notifications WHERE order_id = v_ord AND kind = 'whatsapp_inbound' AND read_at IS NULL), 1, 'l''agent de la commande est notifié');
  -- Une seconde fois : pas de seconde notification.
  PERFORM whatsapp_claim_conversation(v_conv, v_ord, NULL);
  PERFORM pg_temp.eq((SELECT count(*)::int FROM agent_notifications WHERE order_id = v_ord AND kind = 'whatsapp_inbound' AND read_at IS NULL), 1, 'pas de doublon de notification');
  -- Les deux à la fois, ou aucun → 22023.
  v_state := pg_temp.err(format('SELECT whatsapp_claim_conversation(%L::UUID, NULL, NULL)', v_conv));
  PERFORM pg_temp.eq(v_state, '22023', 'sans cible → 22023');
  PERFORM set_config('request.jwt.claims', '', TRUE);
END $t1$;

\echo ''
\echo '── 2. les refus ─────────────────────────────────────────────────────'
DO $t2$
DECLARE
  v_conv2 UUID := current_setting('r.conv2')::UUID;
  v_ord   UUID := current_setting('r.ord')::UUID;
  v_ordly UUID := current_setting('r.ordly')::UUID;
  v_state TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mmly'), 'role', 'authenticated')::TEXT, TRUE);
  v_state := pg_temp.err(format('SELECT whatsapp_claim_conversation(%L::UUID, %L::UUID, NULL)', v_conv2, v_ord));
  PERFORM pg_temp.eq(v_state, '42501', 'le manager de l''autre marché est refusé');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.ag'), 'role', 'authenticated')::TEXT, TRUE);
  v_state := pg_temp.err(format('SELECT whatsapp_claim_conversation(%L::UUID, %L::UUID, NULL)', v_conv2, v_ord));
  PERFORM pg_temp.eq(v_state, '42501', 'un agent est refusé');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mmtn'), 'role', 'authenticated')::TEXT, TRUE);
  v_state := pg_temp.err(format('SELECT whatsapp_claim_conversation(%L::UUID, %L::UUID, NULL)', v_conv2, v_ordly));
  PERFORM pg_temp.eq(v_state, '42501', 'une commande de l''autre marché est refusée');
  PERFORM pg_temp.ok((SELECT current_order_id FROM whatsapp_conversations WHERE id = v_conv2) IS NULL, 'la conversation est restée orpheline');
  PERFORM set_config('request.jwt.claims', '', TRUE);
END $t2$;

\echo ''
\echo '── 3. le compteur ───────────────────────────────────────────────────'
DO $t3$
DECLARE v_n INT;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mmtn'), 'role', 'authenticated')::TEXT, TRUE);
  SELECT whatsapp_orphan_unread_count(NULL) INTO v_n;
  PERFORM pg_temp.ok(v_n >= 1, 'le manager TN compte au moins l''orpheline restante');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.ag'), 'role', 'authenticated')::TEXT, TRUE);
  SELECT whatsapp_orphan_unread_count(NULL) INTO v_n;
  PERFORM pg_temp.eq(v_n, 0, 'un agent compte 0');
  PERFORM set_config('request.jwt.claims', '', TRUE);
END $t3$;

\echo ''
\echo '✓ whatsapp_inbox_test.sql'
