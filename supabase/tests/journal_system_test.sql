-- Journaux — the new journal system (20261003160000 … 20261003160500).
--
-- CE QUE CE FICHIER PROUVE, sous de vrais JWT et le vrai rôle service
--   1. Le déclencheur d'audit nomme l'auteur : la session, l'auteur déclaré par
--      une route au rôle service (en-tête x-ordra-actor), « service » sinon.
--      Les secrets sont masqués ; une écriture qui ne touche que des colonnes
--      ignorées n'est pas un événement ; les tables « personnes seulement »
--      ignorent le système.
--   2. audit_events est en ajout seul.
--   3. journal_record : un agent ne peut écrire que les actions permises, et
--      anon ne peut rien appeler.
--   4. carrier_event_log replie les répétitions et se rattache à la commande.
--   5. journal_detect ouvre, chiffre, met en sourdine, puis ferme seul.
--   6. journal_reap_runs clôt un passage bloqué.
--   7. Les fonctions de lecture refusent tout autre rôle que super_admin.

\set ON_ERROR_STOP on
\i _helpers.sql

\echo ''
\echo '── fixture ────────────────────────────────────────────────────────────'

DO $fixture$
DECLARE
  v_ly  UUID := '00000000-0000-0000-0000-000000000002';
  v_sa  UUID := 'dddddddd-0000-4000-8000-0000000000a1';
  v_mm  UUID := 'dddddddd-0000-4000-8000-0000000000a2';
  v_ag  UUID := 'dddddddd-0000-4000-8000-0000000000a3';
  v_tag TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 10);
  v_sf  UUID;
  v_c   UUID;
  v_o   UUID;
BEGIN
  SELECT id INTO v_sf FROM storefronts WHERE market_id = v_ly ORDER BY created_at LIMIT 1;
  IF v_sf IS NULL THEN RAISE EXCEPTION 'Fixture incomplète : aucune boutique LY'; END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_sa, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest.jx.sa@oms.local', 'x', now(), now(), now()),
    (v_mm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest.jx.mm@oms.local', 'x', now(), now(), now()),
    (v_ag, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest.jx.ag@oms.local', 'x', now(), now(), now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.users (id, email, full_name, role, market_id, is_active)
  VALUES
    (v_sa, 'sqltest.jx.sa@oms.local', 'SQL Jx Admin',   'super_admin',    NULL, TRUE),
    (v_mm, 'sqltest.jx.mm@oms.local', 'SQL Jx Manager', 'market_manager', v_ly, TRUE),
    (v_ag, 'sqltest.jx.ag@oms.local', 'SQL Jx Agent',   'agent',          v_ly, TRUE)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, market_id = EXCLUDED.market_id;

  INSERT INTO carriers (market_id, name, code, is_active, delivery_fee)
  VALUES (v_ly, 'SQLTEST Jx ' || v_tag, 'navex', TRUE, 10)
  RETURNING id INTO v_c;

  INSERT INTO orders (market_id, storefront_id, external_id, external_platform, customer_name, customer_phone,
                      product_name, unit_price, total_price, status, carrier_id, tracking_number)
  VALUES (v_ly, v_sf, 'SQLTEST-JX-' || v_tag, 'sqltest', 'Client Test', '0910000000',
          'SQLTEST produit', 150, 150, 'in_transit', v_c, 'SQLTEST-TRK-' || v_tag)
  RETURNING id INTO v_o;

  PERFORM set_config('r.tag', v_tag, FALSE);
  PERFORM set_config('r.sa', v_sa::TEXT, FALSE);
  PERFORM set_config('r.mm', v_mm::TEXT, FALSE);
  PERFORM set_config('r.ag', v_ag::TEXT, FALSE);
  PERFORM set_config('r.c', v_c::TEXT, FALSE);
  PERFORM set_config('r.o', v_o::TEXT, FALSE);
END
$fixture$;

\echo ''
\echo '── 1. qui a écrit ─────────────────────────────────────────────────────'

-- a) a logged-in super_admin
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('r.sa'), 'role', 'authenticated')::TEXT, TRUE);
SET LOCAL ROLE authenticated;
UPDATE carriers SET delivery_fee = 12 WHERE id = current_setting('r.c')::UUID;
RESET ROLE;
COMMIT;

-- b) the service role, declaring the market manager
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
SELECT set_config('request.headers', json_build_object('x-ordra-actor', current_setting('r.mm'))::TEXT, TRUE);
SET LOCAL ROLE service_role;
UPDATE carriers SET is_active = FALSE WHERE id = current_setting('r.c')::UUID;
RESET ROLE;
COMMIT;

-- c) the service role, declaring nobody, writing a secret
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
SET LOCAL ROLE service_role;
UPDATE carriers SET api_credentials = '{"token":"sqltest-secret"}'::jsonb WHERE id = current_setting('r.c')::UUID;
RESET ROLE;
COMMIT;

-- d) the system, touching only an ignored column
UPDATE carriers SET updated_at = now() WHERE id = current_setting('r.c')::UUID;

-- e) the system inserting an order line (people-only table)
INSERT INTO order_items (order_id, product_name, unit_price, line_total, quantity)
VALUES (current_setting('r.o')::UUID, 'SQLTEST ligne', 150, 150, 1);

DO $a1$
DECLARE
  v_c TEXT := current_setting('r.c');
  r RECORD;
BEGIN
  SELECT * INTO r FROM audit_events WHERE entity_type = 'carriers' AND action = 'carriers.updated' AND entity_id = v_c AND changes ? 'delivery_fee';
  PERFORM pg_temp.eq(r.actor_id::TEXT, current_setting('r.sa'), 'session : l''auteur est le super_admin connecté');
  PERFORM pg_temp.eq(r.actor_role, 'super_admin', 'session : son rôle est gardé');
  PERFORM pg_temp.eq(r.changes -> 'delivery_fee', '[10, 12]'::jsonb, 'avant → après de la colonne modifiée');
  PERFORM pg_temp.eq(r.action, 'carriers.updated', 'action nommée table.verbe');
  PERFORM pg_temp.ok(NOT (r.changes ? 'updated_at'), 'updated_at n''est pas journalisé');

  SELECT * INTO r FROM audit_events WHERE entity_type = 'carriers' AND action = 'carriers.updated' AND entity_id = v_c AND changes ? 'is_active';
  PERFORM pg_temp.eq(r.actor_id::TEXT, current_setting('r.mm'), 'rôle service + en-tête : l''auteur déclaré');
  PERFORM pg_temp.eq(r.actor_kind, 'person', 'rôle service + en-tête : une personne');
  PERFORM pg_temp.eq(r.market_id::TEXT, '00000000-0000-0000-0000-000000000002', 'l''événement porte le marché de la ligne');

  SELECT * INTO r FROM audit_events WHERE entity_type = 'carriers' AND action = 'carriers.updated' AND entity_id = v_c AND changes ? 'api_credentials';
  PERFORM pg_temp.eq(r.actor_kind, 'service', 'rôle service sans en-tête : « service », pas un nom inventé');
  PERFORM pg_temp.ok(r.actor_id IS NULL, 'rôle service sans en-tête : aucun auteur');
  PERFORM pg_temp.eq(r.changes -> 'api_credentials' ->> 1, '••••', 'le secret est masqué');
  PERFORM pg_temp.ok(position('sqltest-secret' IN r.changes::TEXT) = 0, 'le secret n''apparaît nulle part');

  PERFORM pg_temp.eq((SELECT count(*) FROM audit_events WHERE entity_type = 'carriers' AND entity_id = v_c), 4::BIGINT,
                     'création + 3 modifications ; la mise à jour de updated_at seule n''est pas un événement');
  PERFORM pg_temp.eq((SELECT count(*) FROM audit_events WHERE entity_type = 'order_items'
                        AND order_id = current_setting('r.o')::UUID), 0::BIGINT,
                     'order_items : le système qui importe n''est pas journalisé');
END
$a1$;

\echo ''
\echo '── 2. ajout seul ──────────────────────────────────────────────────────'

SELECT pg_temp.eq(
  pg_temp.err($$UPDATE audit_events SET action = 'x' WHERE entity_id = '$$ || current_setting('r.c') || $$'$$),
  '42501', 'audit_events refuse UPDATE');
SELECT pg_temp.eq(
  pg_temp.err($$DELETE FROM audit_events WHERE entity_id = '$$ || current_setting('r.c') || $$'$$),
  '42501', 'audit_events refuse DELETE');

\echo ''
\echo '── 3. journal_record ──────────────────────────────────────────────────'

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_who TEXT, p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.' || p_who), 'role', 'authenticated')::TEXT, TRUE);
  SET LOCAL ROLE authenticated;
  v := pg_temp.err(p_sql);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', TRUE);
  RETURN v;
END $$;

BEGIN;
SELECT pg_temp.eq(pg_temp.as_user('ag',
  $$SELECT public.journal_record('export.orders', 'orders', NULL, 'sqltest-$$ || current_setting('r.tag') || $$', NULL, '{"rows": 12}')$$),
  'NO_ERROR', 'un agent peut journaliser son export');
SELECT pg_temp.eq(pg_temp.as_user('ag',
  $$SELECT public.journal_record('auth.login_failed', 'auth', NULL, 'x')$$),
  '42501', 'un agent ne peut pas écrire un échec de connexion');
-- Privilege checked, not called: on the local image (CLI 2.48.3) ANY
-- « permission denied for function » crashes the backend — archive_finished_orders
-- does it too. Production answers 42501.
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.journal_record(text,text,text,text,uuid,jsonb,uuid)', 'EXECUTE'),
  'anon ne peut pas appeler journal_record');
COMMIT;

SELECT pg_temp.eq((SELECT actor_id::TEXT FROM audit_events WHERE action = 'export.orders'
                     AND entity_label = 'sqltest-' || current_setting('r.tag')),
                  current_setting('r.ag'), 'l''export est attribué à la session, pas à un paramètre');

\echo ''
\echo '── 4. répétitions des transporteurs ───────────────────────────────────'

INSERT INTO carrier_event_log (carrier_code, source, tracking_number, carrier_status_raw, order_id, outcome, outcome_reason)
SELECT 'navex', 'poll', 'SQLTEST-TRK-' || current_setting('r.tag'), 'Etat SQLTEST', current_setting('r.o')::UUID,
       'ignored', 'unknown_navex_etat:SQLTEST'
  FROM generate_series(1, 3);
INSERT INTO carrier_event_log (carrier_code, source, tracking_number, carrier_status_raw, order_id, outcome, outcome_reason)
VALUES ('navex', 'manual', 'SQLTEST-TRK-' || current_setting('r.tag'), 'Autre', current_setting('r.o')::UUID, 'processed', NULL);

DO $a4$
DECLARE r RECORD;
BEGIN
  PERFORM pg_temp.eq((SELECT count(*) FROM carrier_event_log WHERE tracking_number = 'SQLTEST-TRK-' || current_setting('r.tag')),
                     2::BIGINT, 'trois lectures identiques = une ligne, un changement = une autre');
  SELECT * INTO r FROM carrier_event_log WHERE tracking_number = 'SQLTEST-TRK-' || current_setting('r.tag') AND outcome = 'ignored';
  PERFORM pg_temp.eq(r.repeat_count, 3, 'repeat_count compte les lectures');
  PERFORM pg_temp.ok(r.last_seen_at IS NOT NULL, 'last_seen_at est posé');
  PERFORM pg_temp.eq(r.carrier_id::TEXT, current_setting('r.c'), 'carrier_id vient de la commande');
  PERFORM pg_temp.eq(r.market_id::TEXT, '00000000-0000-0000-0000-000000000002', 'market_id vient de la commande');
END
$a4$;

\echo ''
\echo '── 5. détection ───────────────────────────────────────────────────────'

INSERT INTO app_errors (route, method, status, error_code, message, fingerprint)
SELECT '/api/sqltest/' || current_setting('r.tag'), 'PATCH', 500, '42501', 'permission denied',
       'sqltest:' || current_setting('r.tag')
  FROM generate_series(1, 3);

-- sign-in failures: grouped by ACCOUNT (hash), not by the masked label —
-- 3 on one account + 3 on another that masks the same is not « 6 on one ».
INSERT INTO audit_events (actor_kind, action, entity_type, entity_id, entity_label)
SELECT 'service', 'auth.login_failed', 'auth', 'sqltA' || current_setting('r.tag'), 'sq•••@sqltest.local' FROM generate_series(1, 3)
UNION ALL
SELECT 'service', 'auth.login_failed', 'auth', 'sqltB' || current_setting('r.tag'), 'sq•••@sqltest.local' FROM generate_series(1, 3)
UNION ALL
SELECT 'service', 'auth.login_failed', 'auth', 'sqltC' || current_setting('r.tag'), 'sx•••@sqltest.local' FROM generate_series(1, 5);

SELECT public.journal_detect();

DO $a5l$
BEGIN
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM journal_issues WHERE fingerprint LIKE 'login:sqlt_' || current_setting('r.tag')
                                   AND fingerprint IN ('login:sqltA' || current_setting('r.tag'), 'login:sqltB' || current_setting('r.tag'))),
                     'deux comptes au même libellé masqué ne s''additionnent pas');
  PERFORM pg_temp.eq((SELECT affected_count FROM journal_issues WHERE fingerprint = 'login:sqltC' || current_setting('r.tag')),
                     5, 'cinq échecs sur un même compte : un problème');
END
$a5l$;

DO $a5$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM journal_issues WHERE fingerprint = 'inactive:' || current_setting('r.c');
  PERFORM pg_temp.eq(r.status, 'open', 'compte désactivé avec un colis dehors : problème ouvert');
  PERFORM pg_temp.eq(r.affected_count, 1, 'il compte le colis');
  PERFORM pg_temp.eq(r.impact_amount, 150::NUMERIC, 'il chiffre sa valeur');
  PERFORM pg_temp.eq(r.impact_currency, 'LYD', 'dans la monnaie du marché');
  PERFORM pg_temp.ok(r.params ->> 'off_at' IS NOT NULL, 'il sait quand le compte a été coupé (journal d''audit)');

  SELECT * INTO r FROM journal_issues WHERE fingerprint = 'stuck:navex';
  PERFORM pg_temp.ok(r.params -> 'causes' @> '[{"reason":"unknown_navex_etat:SQLTEST"}]', 'statut inconnu : une cause du problème du transporteur');

  SELECT * INTO r FROM journal_issues WHERE fingerprint = 'server:sqltest:' || current_setting('r.tag');
  PERFORM pg_temp.eq(r.rule_key, 'server_error', 'trois erreurs serveur identiques : un problème');
  PERFORM pg_temp.eq(r.affected_count, 3, 'il compte les essais');
END
$a5$;

-- mute, then the detector keeps it muted
BEGIN;
SELECT pg_temp.eq(pg_temp.as_user('mm',
  $$SELECT public.journal_issue_mute((SELECT id FROM journal_issues WHERE fingerprint = 'server:sqltest:$$ || current_setting('r.tag') || $$'), 7)$$),
  '42501', 'un manager ne peut pas mettre en sourdine');
SELECT pg_temp.eq(pg_temp.as_user('sa',
  $$SELECT public.journal_issue_mute((SELECT id FROM journal_issues WHERE fingerprint = 'server:sqltest:$$ || current_setting('r.tag') || $$'), 7)$$),
  'NO_ERROR', 'le super_admin met en sourdine');
COMMIT;
SELECT public.journal_detect();
SELECT pg_temp.eq((SELECT status FROM journal_issues WHERE fingerprint = 'server:sqltest:' || current_setting('r.tag')),
                  'muted', 'la détection respecte la sourdine');

-- the causes go away → everything closes by itself
UPDATE carriers SET is_active = TRUE WHERE id = current_setting('r.c')::UUID;
UPDATE carrier_event_log SET last_seen_at = now() - interval '2 days', created_at = now() - interval '2 days'
 WHERE tracking_number = 'SQLTEST-TRK-' || current_setting('r.tag');
DELETE FROM app_errors WHERE fingerprint = 'sqltest:' || current_setting('r.tag');
SELECT public.journal_detect();

DO $a5b$
BEGIN
  PERFORM pg_temp.eq((SELECT status FROM journal_issues WHERE fingerprint = 'inactive:' || current_setting('r.c')),
                     'resolved', 'compte réactivé : le problème se ferme seul');
  PERFORM pg_temp.eq((SELECT status FROM journal_issues WHERE fingerprint = 'server:sqltest:' || current_setting('r.tag')),
                     'resolved', 'plus d''erreur : fermé, même en sourdine');
  PERFORM pg_temp.ok((SELECT resolved_at FROM journal_issues WHERE fingerprint = 'inactive:' || current_setting('r.c')) IS NOT NULL,
                     'resolved_at est posé');
END
$a5b$;

\echo ''
\echo '── 6. passages bloqués ────────────────────────────────────────────────'

INSERT INTO darb_sync_runs (trigger, carrier_id, status, started_at, notes)
VALUES ('cron', current_setting('r.c')::UUID, 'running', now() - interval '2 hours',
        jsonb_build_object('sqltest', current_setting('r.tag')));
SELECT public.journal_reap_runs();
SELECT pg_temp.eq((SELECT status FROM darb_sync_runs WHERE notes ->> 'sqltest' = current_setting('r.tag')),
                  'failed', 'un passage « en cours » depuis 2 h est clos en échec');

\echo ''
\echo '── 7. lecture réservée au super_admin ─────────────────────────────────'

BEGIN;
SELECT pg_temp.eq(pg_temp.as_user('mm', 'SELECT public.journal_overview()'), '42501', 'manager : pas d''Aperçu');
SELECT pg_temp.eq(pg_temp.as_user('ag', 'SELECT count(*) FROM public.journal_feed()'), '42501', 'agent : pas d''Historique');
SELECT pg_temp.eq(pg_temp.as_user('ag', $$SELECT public.journal_order_trace('$$ || current_setting('r.o') || $$')$$), '42501', 'agent : pas de trace');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.journal_counts()', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.journal_feed(timestamptz,text,integer,text,boolean,uuid)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.journal_overview()', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.journal_detect()', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.journal_purge()', 'EXECUTE'),
  'anon n''appelle aucune lecture ; personne n''appelle la détection ni la purge');
SELECT pg_temp.eq(pg_temp.as_user('sa', 'SELECT public.journal_overview()'), 'NO_ERROR', 'super_admin : Aperçu');
SELECT pg_temp.eq(pg_temp.as_user('ag', 'SELECT count(*) FROM audit_events'), 'NO_ERROR', 'agent : la table se lit…');
COMMIT;

CREATE OR REPLACE FUNCTION pg_temp.sa_value(p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.sa'), 'role', 'authenticated')::TEXT, TRUE);
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  RETURN v;
END $$;

BEGIN;
SELECT pg_temp.eq(pg_temp.sa_value(
  $$SELECT count(*)::TEXT FROM audit_events WHERE entity_id = '$$ || current_setting('r.c') || $$'$$), '5', 'super_admin lit audit_events (création, 3 modifications, réactivation)');
SELECT pg_temp.ok(pg_temp.sa_value(
  $$SELECT jsonb_path_exists(public.journal_order_trace('$$ || current_setting('r.o') || $$'), '$.events[*] ? (@.kind == "carrier.event")')::TEXT$$) = 'true',
  'la trace réunit les événements transporteur de la commande');
SELECT pg_temp.ok(pg_temp.sa_value(
  $$SELECT count(*)::TEXT FROM public.journal_feed(NULL, NULL, 50, 'team', FALSE, NULL) WHERE id LIKE 'ae:%' AND kind = 'carriers.updated'$$)::INT >= 1,
  'l''Historique « Équipe » montre la modification du transporteur');
SELECT pg_temp.ok(pg_temp.sa_value(
  $$SELECT count(*)::TEXT FROM public.journal_feed(NULL, NULL, 50, 'sec', FALSE, NULL) WHERE family <> 'sec'$$) = '0',
  'le filtre de puce ne laisse passer que sa famille');
SELECT pg_temp.ok(pg_temp.sa_value(
  $$SELECT count(*)::TEXT FROM public.journal_feed(NULL, NULL, 50, NULL, TRUE, NULL) WHERE severity IS NULL$$) = '0',
  '« Problèmes seulement » ne montre que des échecs et des alertes');
COMMIT;

SELECT pg_temp.eq(pg_temp.as_user('ag', 'SELECT 1 FROM audit_events LIMIT 1'), 'NO_ERROR', '…mais un agent n''y voit rien (RLS)');
DO $a7$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.ag'), 'role', 'authenticated')::TEXT, TRUE);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.eq((SELECT count(*) FROM audit_events), 0::BIGINT, 'agent : 0 ligne d''audit visible');
  PERFORM pg_temp.eq((SELECT count(*) FROM journal_issues), 0::BIGINT, 'agent : 0 problème visible');
  RESET ROLE;
END
$a7$;

\echo ''
\echo '── remise en état ─────────────────────────────────────────────────────'

DELETE FROM carrier_event_log WHERE tracking_number = 'SQLTEST-TRK-' || current_setting('r.tag');
DELETE FROM darb_sync_runs WHERE notes ->> 'sqltest' = current_setting('r.tag');
DELETE FROM journal_issues WHERE fingerprint IN ('inactive:' || current_setting('r.c'), 'server:sqltest:' || current_setting('r.tag'));
DELETE FROM journal_issues WHERE fingerprint LIKE 'login:sqlt_' || current_setting('r.tag');
-- audit_events, the order and the carrier stay: the first is append-only by
-- design, and the order is referenced by it.
