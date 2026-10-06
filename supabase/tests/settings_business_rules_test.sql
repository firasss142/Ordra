-- Réglages v2 — business rules (20261006120200).
--
-- CE QUE CE FICHIER PROUVE, sous de vrais JWT
--   1. Un responsable écrit les règles Prospects de SON marché, jamais de l'autre.
--   2. Il n'écrit jamais la majoration carte (de l'argent : super_admin seul).
--   3. merge_orders() lit le taux du marché au lieu de 1.1.
--   4. La console Prospects lit la fenêtre « chaude » même enveloppée {"value": n}.

\set ON_ERROR_STOP on
\i _helpers.sql

DO $fixture$
DECLARE
  v_tn UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES ('cccccccc-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'sqltest.rules.mm@oms.local', 'x', now(), now(), now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.users (id, email, full_name, role, market_id, is_active)
  VALUES ('cccccccc-0000-4000-8000-0000000000c1', 'sqltest.rules.mm@oms.local', 'SQL Rules Manager', 'market_manager', v_tn, TRUE)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, market_id = EXCLUDED.market_id;

  IF to_regclass('public._sqltest_rules_backup') IS NULL THEN
    CREATE TABLE public._sqltest_rules_backup AS
      SELECT * FROM settings WHERE key IN ('max_lead_attempts', 'lead_hot_window_minutes', 'card_surcharge_pct');
  END IF;
  DELETE FROM settings WHERE key IN ('max_lead_attempts', 'lead_hot_window_minutes', 'card_surcharge_pct');
END $fixture$;

\echo '── 1–2 · what a manager may write ──────────────────────────────────────'
DO $t1$
DECLARE
  v_tn UUID := '00000000-0000-0000-0000-000000000001';
  v_ly UUID := '00000000-0000-0000-0000-000000000002';
  v_e  TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-0000000000c1","role":"authenticated"}', TRUE);
  SET LOCAL ROLE authenticated;
  v_e := pg_temp.err(format($q$INSERT INTO public.settings (market_id, key, value) VALUES (%L, 'max_lead_attempts', '{"value": 4}')$q$, v_tn));
  PERFORM pg_temp.eq(v_e, 'NO_ERROR', 'un responsable fixe le nombre d''appels d''un prospect');
  v_e := pg_temp.err(format($q$INSERT INTO public.settings (market_id, key, value) VALUES (%L, 'lead_hot_window_minutes', '{"value": 90}')$q$, v_tn));
  PERFORM pg_temp.eq(v_e, 'NO_ERROR', 'et la fenêtre « chaude »');
  v_e := pg_temp.err(format($q$INSERT INTO public.settings (market_id, key, value) VALUES (%L, 'max_lead_attempts', '{"value": 4}')$q$, v_ly));
  PERFORM pg_temp.eq(v_e, '42501', 'jamais pour l''autre marché');
  v_e := pg_temp.err(format($q$INSERT INTO public.settings (market_id, key, value) VALUES (%L, 'card_surcharge_pct', '{"value": 5}')$q$, v_tn));
  PERFORM pg_temp.eq(v_e, '42501', 'jamais la majoration carte');
  RESET ROLE;
END $t1$;

\echo '── 3 · merge_orders reads the rate ─────────────────────────────────────'
DO $t3$
BEGIN
  PERFORM pg_temp.ok(position('card_surcharge_pct' IN pg_get_functiondef(
                       (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                         WHERE n.nspname = 'public' AND p.proname = 'merge_orders'))) > 0,
                     'merge_orders lit card_surcharge_pct');
  PERFORM pg_temp.ok(position('* 1.1' IN pg_get_functiondef(
                       (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                         WHERE n.nspname = 'public' AND p.proname = 'merge_orders'))) = 0,
                     'et plus aucun 1.1 écrit en dur');
  -- the expression itself, with and without a row
  PERFORM pg_temp.eq((1 + COALESCE((SELECT public.setting_scalar(s.value)::NUMERIC FROM public.settings s
                       WHERE s.market_id = '00000000-0000-0000-0000-000000000001' AND s.key = 'card_surcharge_pct'), 10) / 100),
                     1.10::NUMERIC, 'sans réglage : 10 %');
  INSERT INTO settings (market_id, key, value) VALUES ('00000000-0000-0000-0000-000000000001', 'card_surcharge_pct', '{"value": 7}');
  PERFORM pg_temp.eq((1 + COALESCE((SELECT public.setting_scalar(s.value)::NUMERIC FROM public.settings s
                       WHERE s.market_id = '00000000-0000-0000-0000-000000000001' AND s.key = 'card_surcharge_pct'), 10) / 100),
                     1.07::NUMERIC, 'réglé à 7 : 7 %');
END $t3$;

\echo '── 4 · the prospect console survives the wrapped value ─────────────────'
DO $t4$
DECLARE v_e TEXT;
BEGIN
  v_e := pg_temp.err($q$SELECT public.get_prospect_console('00000000-0000-0000-0000-000000000001', 'Africa/Tunis')$q$);
  PERFORM pg_temp.eq(v_e, 'NO_ERROR', 'fenêtre enregistrée {"value": 90} : la console répond');
END $t4$;

\echo '── remise en état ─────────────────────────────────────────────────────'
DELETE FROM settings WHERE key IN ('max_lead_attempts', 'lead_hot_window_minutes', 'card_surcharge_pct');
INSERT INTO settings SELECT * FROM public._sqltest_rules_backup;
DROP TABLE public._sqltest_rules_backup;

\echo '✓ settings_business_rules_test'
