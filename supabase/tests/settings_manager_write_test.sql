-- Réglages — un market_manager règle le quotidien de SON marché
-- (20261002150000_settings_manager_daily_rules.sql).
--
-- CE QUE CE FICHIER PROUVE
--   1. Un manager écrit une règle du quotidien (ici « طرد متوقف » /
--      carrier_stall_days) de son marché, par l'upsert même de la route
--      PATCH /api/settings/:id. Avant la migration, la seule politique
--      d'écriture était `settings_write_super_admin` : la route répondait 500
--      à tout enregistrement d'un manager, en production comme en local.
--   2. Il n'écrit PAS un réglage d'argent (packing_cost) : la liste blanche de
--      la route est aussi celle de la base, pour qu'un appel PostgREST direct
--      ne la contourne pas.
--   3. Il n'écrit pas la règle de l'AUTRE marché, et ne déplace pas une ligne
--      de son marché vers l'autre.
--   4. Il ne supprime rien.
--   5. Un agent n'écrit rien ; le super_admin écrit toujours tout.
--
-- TESTÉ SOUS UN VRAI JWT (SET LOCAL ROLE authenticated), jamais en
-- propriétaire : en propriétaire RLS est contourné et tout serait vert.

\set ON_ERROR_STOP on
\i _helpers.sql

\echo ''
\echo '── fixture ────────────────────────────────────────────────────────────'

DO $fixture$
DECLARE
  v_tn UUID := '00000000-0000-0000-0000-000000000001';
  v_ly UUID := '00000000-0000-0000-0000-000000000002';
  v_sa UUID := 'bbbbbbbb-0000-4000-8000-000000000001';
  v_mm UUID := 'bbbbbbbb-0000-4000-8000-000000000002';
  v_ag UUID := 'bbbbbbbb-0000-4000-8000-000000000003';
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  VALUES
    (v_sa, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sqltest.settings.sa@oms.local', 'x', now(), now(), now()),
    (v_mm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sqltest.settings.mm@oms.local', 'x', now(), now(), now()),
    (v_ag, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sqltest.settings.ag@oms.local', 'x', now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, email, full_name, role, market_id, is_active)
  VALUES
    (v_sa, 'sqltest.settings.sa@oms.local', 'SQL Settings Admin',   'super_admin',    NULL, TRUE),
    (v_mm, 'sqltest.settings.mm@oms.local', 'SQL Settings Manager', 'market_manager', v_tn, TRUE),
    (v_ag, 'sqltest.settings.ag@oms.local', 'SQL Settings Agent',   'agent',          v_tn, TRUE)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, market_id = EXCLUDED.market_id;

  -- What this test touches, to put back at the end: the dev server reads the
  -- same local base. A backup left by a run that failed midway holds the
  -- values from before that run, so it is kept, never overwritten.
  IF to_regclass('public._sqltest_settings_backup') IS NULL THEN
    CREATE TABLE public._sqltest_settings_backup AS
      SELECT * FROM settings
       WHERE key IN ('carrier_stall_days', 'packing_cost', 'goal_daily_treated');
  END IF;

  -- A Tunisian row the manager will try to move to Libya.
  INSERT INTO settings (market_id, key, value) VALUES (v_tn, 'goal_daily_treated', '{"value": 40}')
  ON CONFLICT (market_id, key) DO NOTHING;

  PERFORM set_config('r.tn', v_tn::TEXT, FALSE);
  PERFORM set_config('r.ly', v_ly::TEXT, FALSE);
  PERFORM set_config('r.sa', v_sa::TEXT, FALSE);
  PERFORM set_config('r.mm', v_mm::TEXT, FALSE);
  PERFORM set_config('r.ag', v_ag::TEXT, FALSE);
END
$fixture$;

\echo ''
\echo '── 1–4. sous le JWT du manager tunisien ──────────────────────────────'

BEGIN;
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('r.mm'),
                                    'role', 'authenticated')::TEXT, TRUE);
SET LOCAL ROLE authenticated;

DO $mm$
DECLARE
  v_tn UUID := current_setting('r.tn')::UUID;
  v_ly UUID := current_setting('r.ly')::UUID;
  v_n  INTEGER;
BEGIN
  -- 1. The route's own statement: an upsert on (market_id, key).
  BEGIN
    INSERT INTO public.settings (market_id, key, value)
    VALUES (v_tn, 'carrier_stall_days', '{"value": 9}')
    ON CONFLICT (market_id, key) DO UPDATE SET value = EXCLUDED.value;
    PERFORM set_config('r.own_daily', 'NO_ERROR', FALSE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('r.own_daily', SQLSTATE, FALSE);
  END;

  -- 2. Money is the administrator's.
  BEGIN
    INSERT INTO public.settings (market_id, key, value)
    VALUES (v_tn, 'packing_cost', '{"value": 99}')
    ON CONFLICT (market_id, key) DO UPDATE SET value = EXCLUDED.value;
    PERFORM set_config('r.own_money', 'NO_ERROR', FALSE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('r.own_money', SQLSTATE, FALSE);
  END;

  -- 3a. The other market's rule.
  BEGIN
    INSERT INTO public.settings (market_id, key, value)
    VALUES (v_ly, 'carrier_stall_days', '{"value": 9}')
    ON CONFLICT (market_id, key) DO UPDATE SET value = EXCLUDED.value;
    PERFORM set_config('r.other_market', 'NO_ERROR', FALSE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('r.other_market', SQLSTATE, FALSE);
  END;

  -- 3b. Moving an own row across the border.
  BEGIN
    UPDATE public.settings SET market_id = v_ly
     WHERE market_id = v_tn AND key = 'goal_daily_treated';
    PERFORM set_config('r.move', 'NO_ERROR', FALSE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('r.move', SQLSTATE, FALSE);
  END;

  -- 3c. Renaming an own daily row into a money key.
  BEGIN
    UPDATE public.settings SET key = 'packing_cost_x'
     WHERE market_id = v_tn AND key = 'goal_daily_treated';
    PERFORM set_config('r.rename', 'NO_ERROR', FALSE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('r.rename', SQLSTATE, FALSE);
  END;

  -- 4. No delete, not even of a daily rule.
  DELETE FROM public.settings WHERE market_id = v_tn AND key = 'goal_daily_treated';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('r.deleted', v_n::TEXT, FALSE);
END
$mm$;

RESET ROLE;
COMMIT;

DO $t1$
DECLARE v_tn UUID := current_setting('r.tn')::UUID;
BEGIN
  PERFORM pg_temp.eq(current_setting('r.own_daily'), 'NO_ERROR',
    'le manager enregistre carrier_stall_days de son marché');
  PERFORM pg_temp.eq(
    (SELECT value FROM settings WHERE market_id = v_tn AND key = 'carrier_stall_days'),
    '{"value": 9}'::JSONB, 'la valeur est bien écrite');
  PERFORM pg_temp.eq(current_setting('r.own_money'), '42501',
    'le manager n''écrit pas packing_cost');
  PERFORM pg_temp.ok(
    (SELECT value FROM settings WHERE market_id = v_tn AND key = 'packing_cost')
      IS DISTINCT FROM '{"value": 99}'::JSONB,
    'packing_cost n''a pas bougé');
  PERFORM pg_temp.eq(current_setting('r.other_market'), '42501',
    'le manager n''écrit pas la règle de l''autre marché');
  PERFORM pg_temp.eq(current_setting('r.move'), '42501',
    'le manager ne déplace pas une ligne vers l''autre marché');
  PERFORM pg_temp.eq(current_setting('r.rename'), '42501',
    'le manager ne renomme pas une règle en clé interdite');
  PERFORM pg_temp.eq(current_setting('r.deleted'), '0',
    'le manager ne supprime aucune ligne');
END
$t1$;

\echo ''
\echo '── 5. un agent n''écrit rien, le super_admin écrit tout ──────────────'

BEGIN;
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('r.ag'),
                                    'role', 'authenticated')::TEXT, TRUE);
SET LOCAL ROLE authenticated;
DO $ag$
BEGIN
  INSERT INTO public.settings (market_id, key, value)
  VALUES (current_setting('r.tn')::UUID, 'carrier_stall_days', '{"value": 11}')
  ON CONFLICT (market_id, key) DO UPDATE SET value = EXCLUDED.value;
  PERFORM set_config('r.agent', 'NO_ERROR', FALSE);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('r.agent', SQLSTATE, FALSE);
END
$ag$;
RESET ROLE;
COMMIT;

BEGIN;
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('r.sa'),
                                    'role', 'authenticated')::TEXT, TRUE);
SET LOCAL ROLE authenticated;
DO $sa$
BEGIN
  INSERT INTO public.settings (market_id, key, value)
  VALUES (current_setting('r.ly')::UUID, 'packing_cost', '{"value": 3}')
  ON CONFLICT (market_id, key) DO UPDATE SET value = EXCLUDED.value;
  PERFORM set_config('r.admin', 'NO_ERROR', FALSE);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('r.admin', SQLSTATE, FALSE);
END
$sa$;
RESET ROLE;
COMMIT;

DO $t5$
BEGIN
  PERFORM pg_temp.eq(current_setting('r.agent'), '42501', 'un agent n''écrit aucun réglage');
  PERFORM pg_temp.eq(current_setting('r.admin'), 'NO_ERROR', 'le super_admin écrit packing_cost');
END
$t5$;

\echo ''
\echo '── remise en état ─────────────────────────────────────────────────────'

DO $restore$
BEGIN
  DELETE FROM settings WHERE key IN ('carrier_stall_days', 'packing_cost', 'goal_daily_treated', 'packing_cost_x');
  INSERT INTO settings SELECT * FROM public._sqltest_settings_backup;
  DROP TABLE public._sqltest_settings_backup;
END
$restore$;
