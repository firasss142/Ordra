-- Journaux — what a logged-in reader can actually see
-- (20261003140000_journal_read_policies.sql).
--
-- WHY. The Journaux routes read with the session client, so RLS decides.
-- Three log tables had RLS switched on and NO policy at all, and one had a
-- policy that can never be true:
--
--   carrier_event_log       no policy   → « Transporteurs » always empty, badge 0
--   darb_sync_runs          no policy   → no Darb row in « Synchronisations »,
--                                         and the Darb control room's last sync blank
--   darb_rate_harvest_runs  no policy   → no harvest row either
--   user_audit_log          auth.jwt() ->> 'role' = 'super_admin'
--                                       → that claim is always 'authenticated'
--                                         (no custom-claims hook), so no user
--                                         event ever reached « Modifications »
--
-- CE QUE CE FICHIER PROUVE, sous un vrai JWT
--   1. Le super_admin lit les quatre tables.
--   2. Un market_manager lit les synchronisations Darb de SES transporteurs, et
--      rien d'autre : ni les données brutes des transporteurs, ni les récoltes
--      de tarifs, ni le journal des utilisateurs, ni la synchro de l'autre marché.
--   3. Un agent ne lit rien.

\set ON_ERROR_STOP on
\i _helpers.sql

\echo ''
\echo '── fixture ────────────────────────────────────────────────────────────'

DO $fixture$
DECLARE
  v_tn UUID := '00000000-0000-0000-0000-000000000001';
  v_ly UUID := '00000000-0000-0000-0000-000000000002';
  v_sa UUID := 'dddddddd-0000-4000-8000-000000000001';
  v_mm UUID := 'dddddddd-0000-4000-8000-000000000002';
  v_ag UUID := 'dddddddd-0000-4000-8000-000000000003';
  v_tag TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 10);
  v_c_ly UUID;
  v_c_tn UUID;
BEGIN
  SELECT id INTO v_c_ly FROM carriers WHERE market_id = v_ly ORDER BY created_at LIMIT 1;
  SELECT id INTO v_c_tn FROM carriers WHERE market_id = v_tn ORDER BY created_at LIMIT 1;
  IF v_c_ly IS NULL OR v_c_tn IS NULL THEN
    RAISE EXCEPTION 'Fixture incomplète : transporteur LY=%, TN=%', v_c_ly, v_c_tn;
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  VALUES
    (v_sa, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sqltest.journal.sa@oms.local', 'x', now(), now(), now()),
    (v_mm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sqltest.journal.mm@oms.local', 'x', now(), now(), now()),
    (v_ag, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sqltest.journal.ag@oms.local', 'x', now(), now(), now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.users (id, email, full_name, role, market_id, is_active)
  VALUES
    (v_sa, 'sqltest.journal.sa@oms.local', 'SQL Journal Admin',   'super_admin',    NULL, TRUE),
    (v_mm, 'sqltest.journal.mm@oms.local', 'SQL Journal Manager', 'market_manager', v_ly, TRUE),
    (v_ag, 'sqltest.journal.ag@oms.local', 'SQL Journal Agent',   'agent',          v_ly, TRUE)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, market_id = EXCLUDED.market_id;

  -- One row per table, tagged so the counts below see only this run's rows.
  INSERT INTO carrier_event_log (carrier_code, source, tracking_number, outcome, outcome_reason)
  VALUES ('navex', 'poll', 'SQLTEST-' || v_tag, 'error', 'sqltest ' || v_tag);
  INSERT INTO darb_sync_runs (trigger, carrier_id, status, notes)
  VALUES ('cron', v_c_ly, 'succeeded', jsonb_build_object('sqltest', v_tag)),
         ('cron', v_c_tn, 'succeeded', jsonb_build_object('sqltest', v_tag));
  INSERT INTO darb_rate_harvest_runs (trigger, status, notes)
  VALUES ('cron', 'completed', 'sqltest ' || v_tag);
  INSERT INTO user_audit_log (actor_id, target_id, event_type, meta)
  VALUES (v_sa, v_ag, 'sqltest', jsonb_build_object('tag', v_tag));

  PERFORM set_config('r.tag', v_tag, FALSE);
  PERFORM set_config('r.sa', v_sa::TEXT, FALSE);
  PERFORM set_config('r.mm', v_mm::TEXT, FALSE);
  PERFORM set_config('r.ag', v_ag::TEXT, FALSE);
  PERFORM set_config('r.c_ly', v_c_ly::TEXT, FALSE);
  PERFORM set_config('r.c_tn', v_c_tn::TEXT, FALSE);
END
$fixture$;

-- Counts this run's rows, as whoever is in r.who, into r.<who>.<table>.
CREATE OR REPLACE FUNCTION pg_temp.count_as(p_who TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', current_setting('r.' || p_who), 'role', 'authenticated')::TEXT, TRUE);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('r.' || p_who || '.cel',
    (SELECT count(*) FROM public.carrier_event_log WHERE outcome_reason = 'sqltest ' || current_setting('r.tag'))::TEXT, FALSE);
  PERFORM set_config('r.' || p_who || '.dsr_ly',
    (SELECT count(*) FROM public.darb_sync_runs WHERE notes ->> 'sqltest' = current_setting('r.tag')
        AND carrier_id = current_setting('r.c_ly')::UUID)::TEXT, FALSE);
  PERFORM set_config('r.' || p_who || '.dsr_tn',
    (SELECT count(*) FROM public.darb_sync_runs WHERE notes ->> 'sqltest' = current_setting('r.tag')
        AND carrier_id = current_setting('r.c_tn')::UUID)::TEXT, FALSE);
  PERFORM set_config('r.' || p_who || '.drh',
    (SELECT count(*) FROM public.darb_rate_harvest_runs WHERE notes = 'sqltest ' || current_setting('r.tag'))::TEXT, FALSE);
  PERFORM set_config('r.' || p_who || '.ual',
    (SELECT count(*) FROM public.user_audit_log WHERE meta ->> 'tag' = current_setting('r.tag'))::TEXT, FALSE);
  RESET ROLE;
END $$;

\echo ''
\echo '── lectures sous JWT ──────────────────────────────────────────────────'

BEGIN; SELECT pg_temp.count_as('sa'); COMMIT;
BEGIN; SELECT pg_temp.count_as('mm'); COMMIT;
BEGIN; SELECT pg_temp.count_as('ag'); COMMIT;

DO $assert$
BEGIN
  PERFORM pg_temp.eq(current_setting('r.sa.cel'), '1', 'super_admin lit les événements transporteur');
  PERFORM pg_temp.eq(current_setting('r.sa.dsr_ly') || '/' || current_setting('r.sa.dsr_tn'), '1/1', 'super_admin lit les synchros Darb des deux marchés');
  PERFORM pg_temp.eq(current_setting('r.sa.drh'), '1', 'super_admin lit les récoltes de tarifs');
  PERFORM pg_temp.eq(current_setting('r.sa.ual'), '1', 'super_admin lit le journal des utilisateurs');

  PERFORM pg_temp.eq(current_setting('r.mm.dsr_ly'), '1', 'manager libyen : synchro Darb de son marché');
  PERFORM pg_temp.eq(current_setting('r.mm.dsr_tn'), '0', 'manager libyen : pas la synchro de l''autre marché');
  PERFORM pg_temp.eq(current_setting('r.mm.cel'), '0', 'manager : pas les données brutes des transporteurs');
  PERFORM pg_temp.eq(current_setting('r.mm.drh'), '0', 'manager : pas les récoltes de tarifs');
  PERFORM pg_temp.eq(current_setting('r.mm.ual'), '0', 'manager : pas le journal des utilisateurs');

  PERFORM pg_temp.eq(current_setting('r.ag.cel') || current_setting('r.ag.dsr_ly') || current_setting('r.ag.drh') || current_setting('r.ag.ual'),
                     '0000', 'agent : rien');
END
$assert$;

\echo ''
\echo '── remise en état ─────────────────────────────────────────────────────'

-- Log rows have no append-only trigger on these four tables; the fixture rows go.
DELETE FROM carrier_event_log WHERE outcome_reason = 'sqltest ' || current_setting('r.tag');
DELETE FROM darb_sync_runs WHERE notes ->> 'sqltest' = current_setting('r.tag');
DELETE FROM darb_rate_harvest_runs WHERE notes = 'sqltest ' || current_setting('r.tag');
DELETE FROM user_audit_log WHERE meta ->> 'tag' = current_setting('r.tag');
