-- Journaux v2 (20261006120000, 20261006120100).
--
-- CE QUE CE FICHIER PROUVE
--   1. server_error porte la CAUSE enregistrée et ignore les plantages navigateur.
--   2. browser_error s'ouvre sur N plantages OU sur U personnes.
--   3. external_failing compte les échecs d'un service extérieur, hors upload.
--   4. job_hanging voit un travail abandonné à répétition malgré des succès entre-temps.
--   5. Un seuil modifié dans journal_rule_settings change ce qui s'ouvre.
--   6. Une règle éteinte ferme son problème au passage suivant.
--   7. Le fil Historique rend la cause d'une erreur.
--   8. Seul le super_admin lit et modifie les seuils ; personne n'en crée ni n'en supprime.

\set ON_ERROR_STOP on
\i _helpers.sql

SELECT set_config('r.tag', substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 10), FALSE);

-- ── fixture ──────────────────────────────────────────────────────────────────
INSERT INTO app_errors (route, method, status, message, fingerprint, source, cause_kind, cause_code, cause_target, cause_detail)
SELECT '/api/v2test/' || current_setting('r.tag'), 'GET', 500, 'Internal server error',
       'v2srv:' || current_setting('r.tag'), 'server', 'db', '22P02', 'cities', 'invalid input syntax for type uuid: ""'
  FROM generate_series(1, 3);

-- 2 crashes of one page, by 2 people → opens on users (threshold 2), not on count (3)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES ('eeeeeeee-0000-4000-8000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest.v2.a@oms.local', 'x', now(), now(), now()),
       ('eeeeeeee-0000-4000-8000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest.v2.b@oms.local', 'x', now(), now(), now()),
       ('eeeeeeee-0000-4000-8000-0000000000b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest.v2.sa@oms.local', 'x', now(), now(), now()),
       ('eeeeeeee-0000-4000-8000-0000000000b4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest.v2.mm@oms.local', 'x', now(), now(), now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (id, email, full_name, role, market_id, is_active) VALUES
  ('eeeeeeee-0000-4000-8000-0000000000b1', 'sqltest.v2.a@oms.local', 'SQL V2 A', 'agent', '00000000-0000-0000-0000-000000000002', TRUE),
  ('eeeeeeee-0000-4000-8000-0000000000b2', 'sqltest.v2.b@oms.local', 'SQL V2 B', 'agent', '00000000-0000-0000-0000-000000000002', TRUE),
  ('eeeeeeee-0000-4000-8000-0000000000b3', 'sqltest.v2.sa@oms.local', 'SQL V2 SA', 'super_admin', NULL, TRUE),
  ('eeeeeeee-0000-4000-8000-0000000000b4', 'sqltest.v2.mm@oms.local', 'SQL V2 MM', 'market_manager', '00000000-0000-0000-0000-000000000002', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_errors (route, method, status, error_code, message, fingerprint, source, actor_id, cause_kind, cause_code, cause_target)
VALUES ('/orders', 'BROWSER', 0, 'TypeError:aaaaaa', 'x is undefined', 'v2brw:' || current_setting('r.tag'), 'browser',
        'eeeeeeee-0000-4000-8000-0000000000b1', 'code', 'TypeError', 'OrdersTable.tsx:120'),
       ('/orders', 'BROWSER', 0, 'TypeError:aaaaaa', 'x is undefined', 'v2brw:' || current_setting('r.tag'), 'browser',
        'eeeeeeee-0000-4000-8000-0000000000b2', 'code', 'TypeError', 'OrdersTable.tsx:120'),
       -- 3 browser rows under one SERVER-looking fingerprint must not open server_error
       ('/x', 'BROWSER', 0, NULL, 'y', 'v2mix:' || current_setting('r.tag'), 'browser', NULL, 'code', 'Error', NULL),
       ('/x', 'BROWSER', 0, NULL, 'y', 'v2mix:' || current_setting('r.tag'), 'browser', NULL, 'code', 'Error', NULL),
       ('/x', 'BROWSER', 0, NULL, 'y', 'v2mix:' || current_setting('r.tag'), 'browser', NULL, 'code', 'Error', NULL);

-- an outside service: 3 polls refused (401), 3 uploads refused (R6's, not R13's)
INSERT INTO integration_calls (system, operation, status, http_status, message)
SELECT 'v2sys' || current_setting('r.tag'), 'poll', 'refused', 401, 'Invalid token' FROM generate_series(1, 3)
UNION ALL
SELECT 'v2up' || current_setting('r.tag'), 'upload', 'refused', 422, 'bad phone' FROM generate_series(1, 3);

-- a job abandoned twice with a success in between
INSERT INTO job_runs (job, status, started_at, finished_at, error) VALUES
  ('poll-carriers', 'failed', now() - interval '2 days', now() - interval '2 days', 'abandonné : resté « en cours » plus de 30 min'),
  ('poll-carriers', 'succeeded', now() - interval '1 day 23 hours', now() - interval '1 day 23 hours', NULL),
  ('poll-carriers', 'failed', now() - interval '1 day', now() - interval '1 day', 'abandonné : resté « en cours » plus de 30 min');

UPDATE journal_rule_settings SET enabled = TRUE, params = '{"count": 3, "hours": 24}' WHERE rule_key = 'server_error';
UPDATE journal_rule_settings SET enabled = TRUE, params = '{"count": 3, "users": 2, "hours": 24}' WHERE rule_key = 'browser_error';
UPDATE journal_rule_settings SET enabled = TRUE, params = '{"count": 3, "minutes": 60}' WHERE rule_key = 'external_failing';
UPDATE journal_rule_settings SET enabled = TRUE, params = '{"count": 2, "days": 7}' WHERE rule_key = 'job_hanging';

SELECT public.journal_detect();

\echo '── 1–4 · the new rules ─────────────────────────────────────────────────'
DO $t1$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM journal_issues WHERE fingerprint = 'server:v2srv:' || current_setting('r.tag');
  PERFORM pg_temp.eq(r.status, 'open', 'server_error s''ouvre');
  PERFORM pg_temp.eq(r.params ->> 'cause_code', '22P02', 'il porte le code de la cause');
  PERFORM pg_temp.eq(r.params ->> 'cause_target', 'cities', 'et la table touchée');

  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM journal_issues WHERE fingerprint = 'server:v2mix:' || current_setting('r.tag')),
                     'des plantages navigateur n''ouvrent jamais server_error');

  SELECT * INTO r FROM journal_issues WHERE fingerprint = 'browser:v2brw:' || current_setting('r.tag');
  PERFORM pg_temp.eq(r.rule_key, 'browser_error', 'deux personnes, une même page : browser_error');
  PERFORM pg_temp.eq((r.params ->> 'users')::INT, 2, 'il compte les personnes');
  PERFORM pg_temp.eq(r.params ->> 'cause_target', 'OrdersTable.tsx:120', 'il dit le fichier et la ligne');

  SELECT * INTO r FROM journal_issues WHERE fingerprint = 'ext:v2sys' || current_setting('r.tag') || ':poll:401';
  PERFORM pg_temp.eq(r.rule_key, 'external_failing', 'trois polls refusés : external_failing');
  PERFORM pg_temp.eq((r.params ->> 'http_status')::INT, 401, 'avec le statut HTTP');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM journal_issues WHERE fingerprint LIKE 'ext:v2up' || current_setting('r.tag') || '%'),
                     'les uploads restent à upload_failing, jamais comptés deux fois');

  SELECT * INTO r FROM journal_issues WHERE fingerprint = 'hang:poll-carriers';
  PERFORM pg_temp.eq(r.rule_key, 'job_hanging', 'abandonné deux fois malgré un succès entre-temps : job_hanging');
  PERFORM pg_temp.ok((r.params ->> 'n')::INT >= 2, 'il compte les abandons');
END $t1$;

\echo '── 5 · a threshold is a setting ──────────────────────────────────────────'
UPDATE journal_rule_settings SET params = '{"count": 4, "minutes": 60}' WHERE rule_key = 'external_failing';
SELECT public.journal_detect();
DO $t5$
BEGIN
  PERFORM pg_temp.eq((SELECT status FROM journal_issues WHERE fingerprint = 'ext:v2sys' || current_setting('r.tag') || ':poll:401'),
                     'resolved', 'seuil relevé à 4 : trois échecs ne suffisent plus, le problème se ferme');
END $t5$;
UPDATE journal_rule_settings SET params = '{"count": 3, "minutes": 60}' WHERE rule_key = 'external_failing';

-- a bad value (text, zero) falls back to the default instead of breaking the detector
UPDATE journal_rule_settings SET params = '{"count": "trois", "minutes": 0}' WHERE rule_key = 'external_failing';
DO $t5b$
BEGIN
  PERFORM pg_temp.eq(public.journal_rule_num('external_failing', 'count', 3), 3::NUMERIC, 'un seuil illisible reprend la valeur par défaut');
  PERFORM pg_temp.eq(public.journal_rule_num('external_failing', 'minutes', 60), 60::NUMERIC, 'un seuil à zéro aussi');
END $t5b$;
UPDATE journal_rule_settings SET params = '{"count": 3, "minutes": 60}' WHERE rule_key = 'external_failing';

\echo '── 6 · a rule switched off closes its problem ────────────────────────────'
UPDATE journal_rule_settings SET enabled = FALSE WHERE rule_key = 'job_hanging';
SELECT public.journal_detect();
DO $t6$
BEGIN
  PERFORM pg_temp.eq((SELECT status FROM journal_issues WHERE fingerprint = 'hang:poll-carriers'),
                     'resolved', 'règle éteinte : son problème se ferme');
END $t6$;
UPDATE journal_rule_settings SET enabled = TRUE WHERE rule_key = 'job_hanging';

\echo '── 7 · the feed carries the cause ────────────────────────────────────────'
DO $t7$
DECLARE v_params JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-4000-8000-0000000000b3","role":"authenticated"}', TRUE);
  SET LOCAL ROLE authenticated;
  SELECT f.params INTO v_params FROM public.journal_feed(NULL, NULL, 200, 'sec', FALSE, NULL) f
   WHERE f.kind = 'app.error' AND f.params ->> 'route' = '/api/v2test/' || current_setting('r.tag') LIMIT 1;
  RESET ROLE;
  PERFORM pg_temp.eq(v_params ->> 'cause_code', '22P02', 'la ligne Historique rend le code de la cause');
  PERFORM pg_temp.eq(v_params ->> 'source', 'server', 'et sa source');
END $t7$;

\echo '── 8 · who may touch the thresholds ──────────────────────────────────────'
DO $t8$
DECLARE v_n INT;
BEGIN
  -- a market manager sees nothing and changes nothing
  PERFORM set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-4000-8000-0000000000b4","role":"authenticated"}', TRUE);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM journal_rule_settings;
  UPDATE journal_rule_settings SET enabled = FALSE WHERE rule_key = 'server_error';
  RESET ROLE;
  PERFORM pg_temp.eq(v_n, 0, 'un responsable de marché ne lit aucun seuil');
  PERFORM pg_temp.ok((SELECT enabled FROM journal_rule_settings WHERE rule_key = 'server_error'), 'ni ne peut en éteindre un');

  -- the super_admin edits enabled + params; never the key, never insert or delete
  PERFORM set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-4000-8000-0000000000b3","role":"authenticated"}', TRUE);
  SET LOCAL ROLE authenticated;
  UPDATE journal_rule_settings SET params = '{"count": 4, "hours": 24}' WHERE rule_key = 'server_error';
  RESET ROLE;
  PERFORM pg_temp.eq((SELECT (params ->> 'count')::INT FROM journal_rule_settings WHERE rule_key = 'server_error'), 4, 'le super_admin modifie un seuil');
  UPDATE journal_rule_settings SET params = '{"count": 3, "hours": 24}' WHERE rule_key = 'server_error';
END $t8$;

DO $t8b$
BEGIN
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.journal_rule_settings', 'INSERT'), 'personne ne crée de règle depuis l''écran');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.journal_rule_settings', 'DELETE'), 'ni n''en supprime');
  PERFORM pg_temp.ok(NOT has_column_privilege('authenticated', 'public.journal_rule_settings', 'rule_key', 'UPDATE'), 'ni ne renomme une règle');
  PERFORM pg_temp.ok(NOT has_table_privilege('anon', 'public.journal_rule_settings', 'SELECT'), 'anon ne lit rien');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.journal_rule_num(text, text, numeric)', 'EXECUTE'), 'anon n''appelle pas les seuils');
END $t8b$;

\echo '✓ journal_v2_test'
