-- Réglages — un réglage se lit pareil qu'il soit nu (`30`) ou enveloppé
-- (`{"value": 30}`) (20261003120000_settings_scalar_readers.sql).
--
-- POURQUOI. Les deux formes coexistent en production : la route
-- PATCH /api/settings/:id enveloppe (`{ value }`), les seeds et les anciennes
-- écritures sont nues. Le 2026-08-21, la Tunisie a enregistré
-- auto_archive_after_days et ses objectifs d'équipe depuis l'écran — enveloppés.
-- Depuis, `archive_finished_orders()` échoue CHAQUE nuit (22P02, « invalid input
-- syntax for type integer ») et n'archive plus rien, dans AUCUN des deux
-- marchés : l'exception interrompt la boucle. Les mêmes lectures
-- `(value #>> '{}')::numeric` sont dans get_team_live, get_team_performance et
-- get_agent_day_detail : la Libye y a encore des objectifs nus, et le premier
-- objectif enregistré depuis Réglages aurait cassé sa Salle de contrôle.
--
-- CE QUE CE FICHIER PROUVE
--   1. public.setting_scalar() rend la même valeur pour les deux formes, et
--      pour les anciennes enveloppes { type } / { amount } (comme storedScalar
--      côté route).
--   2. archive_finished_orders() archive dans les deux marchés, objectif
--      enveloppé en Tunisie et nu en Libye.
--   3. get_team_live, get_team_performance et get_agent_day_detail rendent
--      l'objectif enregistré, quelle que soit sa forme.
--   4. get_prospect_console ne tombe pas sur une fenêtre « chaude » enveloppée.
--   5. delivery_setting_int lit aussi une valeur nue (elle la remplaçait en
--      silence par la valeur par défaut).
--   6. leads_create_winback lit l'interrupteur par setting_scalar.

\set ON_ERROR_STOP on
\i _helpers.sql

\echo ''
\echo '── 1. setting_scalar ──────────────────────────────────────────────────'

DO $t1$
BEGIN
  PERFORM pg_temp.eq(public.setting_scalar('30'::jsonb), '30', 'nu : 30');
  PERFORM pg_temp.eq(public.setting_scalar('{"value": 30}'::jsonb), '30', 'enveloppé : {value: 30}');
  PERFORM pg_temp.eq(public.setting_scalar('{"value": "manual"}'::jsonb), 'manual', 'enveloppé texte');
  PERFORM pg_temp.eq(public.setting_scalar('"manual"'::jsonb), 'manual', 'texte nu');
  PERFORM pg_temp.eq(public.setting_scalar('{"type": "percentage"}'::jsonb), 'percentage', 'ancienne enveloppe { type }');
  PERFORM pg_temp.eq(public.setting_scalar('{"amount": 2}'::jsonb), '2', 'ancienne enveloppe { amount }');
  PERFORM pg_temp.eq(public.setting_scalar('true'::jsonb), 'true', 'booléen nu');
  PERFORM pg_temp.eq(public.setting_scalar('{"value": true}'::jsonb), 'true', 'booléen enveloppé');
  PERFORM pg_temp.ok(public.setting_scalar(NULL) IS NULL, 'NULL reste NULL');
  PERFORM pg_temp.ok(public.setting_scalar('{"value": null}'::jsonb) IS NULL, '{value: null} est NULL');
  PERFORM pg_temp.eq(public.setting_scalar('{"start": "09:00", "end": "18:00"}'::jsonb),
                     '{"end": "18:00", "start": "09:00"}', 'un vrai objet reste un objet');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.setting_scalar(jsonb)', 'EXECUTE'),
                     'anon n''exécute pas setting_scalar');
  PERFORM pg_temp.ok(has_function_privilege('authenticated', 'public.setting_scalar(jsonb)', 'EXECUTE'),
                     'authenticated exécute setting_scalar (get_prospect_console est INVOKER)');
END
$t1$;

\echo ''
\echo '── fixture ────────────────────────────────────────────────────────────'

DO $fixture$
DECLARE
  v_tn UUID := '00000000-0000-0000-0000-000000000001';
  v_ly UUID := '00000000-0000-0000-0000-000000000002';
  v_sa UUID := 'cccccccc-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  VALUES (v_sa, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'sqltest.scalar.sa@oms.local', 'x', now(), now(), now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.users (id, email, full_name, role, market_id, is_active)
  VALUES (v_sa, 'sqltest.scalar.sa@oms.local', 'SQL Scalar Admin', 'super_admin', NULL, TRUE)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, market_id = EXCLUDED.market_id;

  -- Put back at the end; a backup left by a failed run holds the values from
  -- before that run, so it is never overwritten.
  IF to_regclass('public._sqltest_scalar_backup') IS NULL THEN
    CREATE TABLE public._sqltest_scalar_backup AS
      SELECT * FROM settings
       WHERE key IN ('goal_daily_treated', 'goal_min_rate', 'goal_conf_per_hour',
                     'goal_team_weekly_conf', 'auto_archive_after_days',
                     'lead_hot_window_minutes', 'sqltest_scalar_int');
  END IF;
  DELETE FROM settings
   WHERE key IN ('goal_daily_treated', 'goal_min_rate', 'goal_conf_per_hour',
                 'goal_team_weekly_conf', 'auto_archive_after_days',
                 'lead_hot_window_minutes', 'sqltest_scalar_int');

  -- Tunisia as the screen writes it (wrapped), Libya as the seeds left it (bare).
  INSERT INTO settings (market_id, key, value) VALUES
    (v_tn, 'goal_daily_treated',      '{"value": 17}'),
    (v_tn, 'goal_min_rate',           '{"value": 41}'),
    (v_tn, 'goal_conf_per_hour',      '{"value": 4}'),
    (v_tn, 'goal_team_weekly_conf',   '{"value": 151}'),
    (v_tn, 'auto_archive_after_days', '{"value": 30}'),
    (v_tn, 'lead_hot_window_minutes', '{"value": 45}'),
    (v_tn, 'sqltest_scalar_int',      '{"value": 8}'),
    (v_ly, 'goal_daily_treated',      '23'),
    (v_ly, 'goal_min_rate',           '43'),
    (v_ly, 'goal_conf_per_hour',      '5'),
    (v_ly, 'goal_team_weekly_conf',   '153'),
    (v_ly, 'auto_archive_after_days', '30'),
    (v_ly, 'lead_hot_window_minutes', '50'),
    (v_ly, 'sqltest_scalar_int',      '7');

  PERFORM set_config('r.tn', v_tn::TEXT, FALSE);
  PERFORM set_config('r.ly', v_ly::TEXT, FALSE);
  PERFORM set_config('r.sa', v_sa::TEXT, FALSE);
END
$fixture$;

\echo ''
\echo '── 2. archive_finished_orders, les deux formes ────────────────────────'

-- Rolled back: the fixture orders and the archiving leave nothing behind.
BEGIN;
DO $t2$
DECLARE
  v_tn  UUID := current_setting('r.tn')::UUID;
  v_ly  UUID := current_setting('r.ly')::UUID;
  v_tag TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_o   UUID[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  v_m   UUID[] := ARRAY[v_tn, v_ly];
  v_store UUID;
  i INT;
BEGIN
  FOR i IN 1..2 LOOP
    SELECT id INTO v_store FROM storefronts WHERE market_id = v_m[i] LIMIT 1;
    INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                        customer_name, customer_phone, product_name, quantity, unit_price, total_price, status)
    VALUES (v_o[i], v_m[i], v_store, 'SQLTEST-ARCH-' || v_tag || '-' || i, 'manual',
            'Client archive', '2' || lpad((floor(random() * 10000000))::TEXT, 7, '0'),
            'SQLTEST ARCHIVE', 1, 50, 50, 'delivered');
    UPDATE orders SET terminal_at = now() - interval '40 days', archived_at = NULL WHERE id = v_o[i];
  END LOOP;

  BEGIN
    PERFORM public.archive_finished_orders();
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL: archive_finished_orders a levé % — %', SQLSTATE, SQLERRM;
  END;

  PERFORM pg_temp.ok((SELECT archived_at IS NOT NULL FROM orders WHERE id = v_o[1]),
                     'Tunisie (réglage enveloppé) : la commande de 40 jours est archivée');
  PERFORM pg_temp.ok((SELECT archived_at IS NOT NULL FROM orders WHERE id = v_o[2]),
                     'Libye (réglage nu) : la commande de 40 jours est archivée');
END
$t2$;
ROLLBACK;

\echo ''
\echo '── 3–5. sous le JWT du super_admin ────────────────────────────────────'

BEGIN;
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('r.sa'),
                                    'role', 'authenticated')::TEXT, TRUE);
SET LOCAL ROLE authenticated;

DO $t3$
DECLARE
  v_tn UUID := current_setting('r.tn')::UUID;
  v_ly UUID := current_setting('r.ly')::UUID;
  v_j  JSONB;
BEGIN
  BEGIN
    v_j := public.get_team_live(v_tn, 'Africa/Tunis');
    PERFORM set_config('r.live_tn', v_j #>> '{defaults,daily_treated}', FALSE);
    PERFORM set_config('r.live_tn_rate', v_j #>> '{defaults,min_rate}', FALSE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('r.live_tn', 'ERR ' || SQLSTATE, FALSE);
  END;
  BEGIN
    v_j := public.get_team_live(v_ly, 'Africa/Tripoli');
    PERFORM set_config('r.live_ly', v_j #>> '{defaults,daily_treated}', FALSE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('r.live_ly', 'ERR ' || SQLSTATE, FALSE);
  END;

  BEGIN
    v_j := public.get_team_performance(v_tn, current_date - 6, current_date, 'Africa/Tunis');
    PERFORM set_config('r.perf_tn', concat_ws('/', v_j #>> '{defaults,daily_treated}',
      v_j #>> '{defaults,conf_per_hour}', v_j #>> '{defaults,team_weekly_conf}'), FALSE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('r.perf_tn', 'ERR ' || SQLSTATE, FALSE);
  END;
  BEGIN
    v_j := public.get_team_performance(v_ly, current_date - 6, current_date, 'Africa/Tripoli');
    PERFORM set_config('r.perf_ly', concat_ws('/', v_j #>> '{defaults,daily_treated}',
      v_j #>> '{defaults,conf_per_hour}', v_j #>> '{defaults,team_weekly_conf}'), FALSE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('r.perf_ly', 'ERR ' || SQLSTATE, FALSE);
  END;

  BEGIN
    v_j := public.get_agent_day_detail(v_tn, current_setting('r.sa')::UUID, current_date, 'Africa/Tunis');
    PERFORM set_config('r.day_tn', concat_ws('/', v_j #>> '{targets,daily_treated}',
      v_j #>> '{targets,min_rate}', v_j #>> '{targets,conf_per_hour}'), FALSE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('r.day_tn', 'ERR ' || SQLSTATE, FALSE);
  END;

  BEGIN
    PERFORM public.get_prospect_console(v_tn, 'Africa/Tunis');
    PERFORM set_config('r.prospects_tn', 'NO_ERROR', FALSE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('r.prospects_tn', 'ERR ' || SQLSTATE, FALSE);
  END;

  PERFORM set_config('r.dsi_tn', public.delivery_setting_int(v_tn, 'sqltest_scalar_int', 0)::TEXT, FALSE);
  PERFORM set_config('r.dsi_ly', public.delivery_setting_int(v_ly, 'sqltest_scalar_int', 0)::TEXT, FALSE);
END
$t3$;

RESET ROLE;
COMMIT;

DO $assert$
BEGIN
  PERFORM pg_temp.eq(current_setting('r.live_tn'), '17', 'Salle de contrôle, Tunisie (enveloppé) : objectif du jour');
  PERFORM pg_temp.eq(current_setting('r.live_tn_rate'), '41', 'Salle de contrôle, Tunisie : taux minimum');
  PERFORM pg_temp.eq(current_setting('r.live_ly'), '23', 'Salle de contrôle, Libye (nu) : objectif du jour');
  PERFORM pg_temp.eq(current_setting('r.perf_tn'), '17/4/151', 'Performance, Tunisie (enveloppé)');
  PERFORM pg_temp.eq(current_setting('r.perf_ly'), '23/5/153', 'Performance, Libye (nu)');
  PERFORM pg_temp.eq(current_setting('r.day_tn'), '17/41/4', 'Journée d''un agent, Tunisie (enveloppé)');
  PERFORM pg_temp.eq(current_setting('r.prospects_tn'), 'NO_ERROR', 'Prospects, Tunisie : fenêtre chaude enveloppée');
  PERFORM pg_temp.eq(current_setting('r.dsi_tn'), '8', 'delivery_setting_int lit l''enveloppé');
  PERFORM pg_temp.eq(current_setting('r.dsi_ly'), '7', 'delivery_setting_int lit le nu (au lieu du défaut)');
  PERFORM pg_temp.ok(
    position('public.setting_scalar(' IN pg_get_functiondef('public.leads_create_winback'::regproc)) > 0,
    'leads_create_winback lit l''interrupteur par setting_scalar');
END
$assert$;

\echo ''
\echo '── remise en état ─────────────────────────────────────────────────────'

DO $restore$
BEGIN
  DELETE FROM settings
   WHERE key IN ('goal_daily_treated', 'goal_min_rate', 'goal_conf_per_hour',
                 'goal_team_weekly_conf', 'auto_archive_after_days',
                 'lead_hot_window_minutes', 'sqltest_scalar_int');
  INSERT INTO settings SELECT * FROM public._sqltest_scalar_backup;
  DROP TABLE public._sqltest_scalar_backup;
END
$restore$;
