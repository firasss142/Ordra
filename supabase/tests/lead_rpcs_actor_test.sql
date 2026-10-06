-- RPC de prospects — l'acteur est la session, pas ce que le client envoie
-- (20261006100000_lead_rpcs_bind_actor.sql, plans/prospects-recovery.md phase 1).
--
-- CE QUE CE FICHIER PROUVE
--   1. Privilèges : anon n'exécute aucune fonction SECURITY DEFINER du domaine ;
--      authenticated n'atteint ni le tick, ni la répartition interne, ni le garde.
--   2. Un agent tunisien ne répartit pas en Libye, n'assigne pas, ne convertit
--      pas le prospect d'une collègue, ne change pas son statut.
--   3. Un p_actor_id forgé est refusé, même par un manager légitime.
--   4. Le manager du marché assigne, l'historique porte SON id ; un plan qui
--      mêle un prospect ou un agent d'un autre marché est refusé.
--   5. Le super_admin répartit (bulk_assign_leads avec 'super_admin' plantait
--      sur le CHECK de lead_history).
--   6. L'agent convertit SON prospect qualifié ; l'historique dit 'agent'.
--   7. Sans session (service role, cron) : le comportement d'avant.
--   8. rpc_run_prospect_campaign, unassign_lead, prospects_distribute_now,
--      get_prospect_desk, prospect_recovery_settings : mêmes portes.

\set ON_ERROR_STOP on
\i _helpers.sql

\echo ''
\echo '── 0. Fixture ─────────────────────────────────────────────────────────'
DO $fixture$
DECLARE
  v_ly   UUID := '00000000-0000-0000-0000-000000000002';
  v_tn   UUID := '00000000-0000-0000-0000-000000000001';
  v_tag  TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_sa   UUID := gen_random_uuid();
  v_mm   UUID := gen_random_uuid();
  v_mmtn UUID := gen_random_uuid();
  v_a1   UUID := gen_random_uuid();
  v_a2   UUID := gen_random_uuid();
  v_atn  UUID := gen_random_uuid();
  v_wh   UUID := gen_random_uuid();
  v_l1   UUID := gen_random_uuid();
  v_l2   UUID := gen_random_uuid();
  v_l3   UUID := gen_random_uuid();
  v_l4   UUID := gen_random_uuid();
  v_ltn  UUID := gen_random_uuid();
  v_c    UUID := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'sqltest.lra.' || u.k || '.' || v_tag || '@oms.local', 'x', now(), now(), now()
  FROM (VALUES (v_sa,'sa'),(v_mm,'mm'),(v_mmtn,'mmtn'),(v_a1,'a1'),(v_a2,'a2'),(v_atn,'atn'),(v_wh,'wh')) u(id,k);
  INSERT INTO public.users (id, email, full_name, role, market_id, is_active)
  VALUES (v_sa,   'sqltest.lra.sa.'   || v_tag || '@oms.local', 'LRA Admin '   || v_tag, 'super_admin', NULL, TRUE),
         (v_mm,   'sqltest.lra.mm.'   || v_tag || '@oms.local', 'LRA Mgr LY '  || v_tag, 'market_manager', v_ly, TRUE),
         (v_mmtn, 'sqltest.lra.mmtn.' || v_tag || '@oms.local', 'LRA Mgr TN '  || v_tag, 'market_manager', v_tn, TRUE),
         (v_a1,   'sqltest.lra.a1.'   || v_tag || '@oms.local', 'LRA Agent1 '  || v_tag, 'agent', v_ly, TRUE),
         (v_a2,   'sqltest.lra.a2.'   || v_tag || '@oms.local', 'LRA Agent2 '  || v_tag, 'agent', v_ly, TRUE),
         (v_atn,  'sqltest.lra.atn.'  || v_tag || '@oms.local', 'LRA Agent TN '|| v_tag, 'agent', v_tn, TRUE),
         (v_wh,   'sqltest.lra.wh.'   || v_tag || '@oms.local', 'LRA Entrepot '|| v_tag, 'warehouse_agent', v_ly, TRUE);

  -- l1 qualifié chez a1 · l2 assigné à a2 · l3 et l4 non assignés · ltn en Tunisie
  INSERT INTO leads (id, market_id, source, status, customer_name, customer_phone, assigned_to)
  VALUES (v_l1, v_ly, 'manual_call', 'qualified', 'LRA 1', '0910000001', v_a1),
         (v_l2, v_ly, 'manual_call', 'assigned',  'LRA 2', '0910000002', v_a2),
         (v_l3, v_ly, 'manual_call', 'new',       'LRA 3', '0910000003', NULL),
         (v_l4, v_ly, 'manual_call', 'new',       'LRA 4', '0910000004', NULL),
         (v_ltn, v_tn, 'manual_call', 'new',      'LRA TN', '20000001', NULL);

  INSERT INTO prospect_campaigns (id, market_id, name, filter_json, created_by)
  VALUES (v_c, v_ly, 'SQLTEST LRA ' || v_tag, '{"order_statuses":["delivered"],"date_from":"2099-01-01"}', v_mm);

  PERFORM set_config('r.sa', v_sa::TEXT, FALSE);
  PERFORM set_config('r.mm', v_mm::TEXT, FALSE);
  PERFORM set_config('r.mmtn', v_mmtn::TEXT, FALSE);
  PERFORM set_config('r.a1', v_a1::TEXT, FALSE);
  PERFORM set_config('r.a2', v_a2::TEXT, FALSE);
  PERFORM set_config('r.atn', v_atn::TEXT, FALSE);
  PERFORM set_config('r.wh', v_wh::TEXT, FALSE);
  PERFORM set_config('r.l1', v_l1::TEXT, FALSE);
  PERFORM set_config('r.l2', v_l2::TEXT, FALSE);
  PERFORM set_config('r.l3', v_l3::TEXT, FALSE);
  PERFORM set_config('r.l4', v_l4::TEXT, FALSE);
  PERFORM set_config('r.ltn', v_ltn::TEXT, FALSE);
  PERFORM set_config('r.c', v_c::TEXT, FALSE);
END $fixture$;

\echo ''
\echo '── 1. Privilèges ──────────────────────────────────────────────────────'
DO $t1$
DECLARE
  f TEXT;
BEGIN
  -- Toute fonction SECURITY DEFINER de ce domaine est fermée à anon.
  FOR f IN
    SELECT p.oid::regprocedure::TEXT
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
       AND p.proname IN ('lead_rpc_guard', 'assign_lead', 'unassign_lead', 'bulk_assign_leads',
                         'convert_lead_to_order', 'rpc_run_prospect_campaign', 'rpc_transition_lead_status',
                         'transition_lead_status', '_prospect_recovery_settings', 'prospect_recovery_settings',
                         '_prospects_distribute', 'prospects_daily_tick', 'prospects_daily_tick_all',
                         'prospects_distribute_now', 'get_prospect_desk', 'leads_create_winback')
  LOOP
    PERFORM pg_temp.ok(NOT has_function_privilege('anon', f, 'EXECUTE'), 'anon n''exécute pas ' || f);
  END LOOP;

  FOREACH f IN ARRAY ARRAY[
    'public.lead_rpc_guard(uuid, uuid, uuid, boolean)',
    'public._prospect_recovery_settings(uuid)',
    'public._prospects_distribute(uuid, jsonb)',
    'public.prospects_daily_tick(uuid, boolean)',
    'public.prospects_daily_tick_all()',
    'public.transition_lead_status(uuid, lead_status, uuid, text, text, lead_lost_reason, text)'
  ] LOOP
    PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', f, 'EXECUTE'), 'authenticated n''exécute pas ' || f);
  END LOOP;

  FOREACH f IN ARRAY ARRAY[
    'public.assign_lead(uuid, uuid, uuid, text)',
    'public.unassign_lead(uuid, uuid)',
    'public.bulk_assign_leads(uuid, jsonb, uuid, text)',
    'public.convert_lead_to_order(uuid, uuid, uuid, text, text, integer, numeric, numeric, text, text, text, text, text)',
    'public.rpc_run_prospect_campaign(uuid, uuid, text)',
    'public.rpc_transition_lead_status(uuid, text, uuid, text, text, lead_lost_reason, text)',
    'public.prospect_recovery_settings(uuid)',
    'public.prospects_distribute_now(uuid)',
    'public.get_prospect_desk(uuid, date, text)',
    'public.campaign_audience_rows(uuid, jsonb)',
    'public.preview_campaign_audience(uuid, jsonb)'
  ] LOOP
    PERFORM pg_temp.ok(has_function_privilege('authenticated', f, 'EXECUTE'), 'authenticated exécute ' || f);
  END LOOP;
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.campaign_audience_rows(uuid, jsonb)', 'EXECUTE'), 'anon n''exécute pas campaign_audience_rows');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.prospect_tick_log', 'INSERT'), 'authenticated n''écrit pas prospect_tick_log');
  PERFORM pg_temp.ok(NOT has_table_privilege('anon', 'public.prospect_tick_log', 'SELECT'), 'anon ne lit pas prospect_tick_log');
END $t1$;

\echo ''
\echo '── 2. Un agent tunisien, un agent libyen, l''entrepôt ─────────────────'
DO $t2$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.atn'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format(
    'SELECT bulk_assign_leads(%L::uuid, %L::jsonb, %L::uuid, %L)',
    '00000000-0000-0000-0000-000000000002',
    json_build_array(json_build_object('lead_id', current_setting('r.l3'), 'agent_id', current_setting('r.a1'))),
    current_setting('r.atn'), 'manager')), '42501', 'agent TN : bulk_assign_leads en Libye refusé');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT assign_lead(%L::uuid, %L::uuid, %L::uuid)',
    current_setting('r.l3'), current_setting('r.a1'), current_setting('r.atn'))), '42501', 'agent TN : assign_lead refusé');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT bulk_assign_leads(%L::uuid, %L::jsonb, NULL)',
    '00000000-0000-0000-0000-000000000001',
    json_build_array(json_build_object('lead_id', current_setting('r.ltn'), 'agent_id', current_setting('r.atn'))))),
    '42501', 'agent TN : bulk_assign_leads dans SON marché aussi (réservé aux managers)');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.a1'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format(
    'SELECT convert_lead_to_order(%L::uuid, %L::uuid, NULL, %L, NULL, 1, 100, 100, %L, %L, NULL, NULL, NULL)',
    current_setting('r.l2'), current_setting('r.a1'), 'X', 'C', '0910000002')), '42501',
    'agent LY : convertir le prospect d''une collègue refusé');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT rpc_transition_lead_status(%L::uuid, %L, %L::uuid, %L)',
    current_setting('r.l2'), 'attempt_1', current_setting('r.a1'), 'agent')), '42501',
    'agent LY : changer le statut du prospect d''une collègue refusé');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT unassign_lead(%L::uuid, %L::uuid)',
    current_setting('r.l2'), current_setting('r.a1'))), '42501', 'agent LY : désassigner refusé');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT prospects_distribute_now(%L::uuid)',
    '00000000-0000-0000-0000-000000000002')), '42501', 'agent LY : « Répartir maintenant » refusé');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT get_prospect_desk(%L::uuid, %L::date, %L)',
    '00000000-0000-0000-0000-000000000002', '2026-10-01', 'Africa/Tripoli')), '42501', 'agent LY : bureau refusé');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT prospect_recovery_settings(%L::uuid)',
    '00000000-0000-0000-0000-000000000002')), '42501', 'agent LY : règles refusées');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.wh'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT rpc_transition_lead_status(%L::uuid, %L, NULL, %L)',
    current_setting('r.l2'), 'attempt_1', 'system')), '42501', 'entrepôt : changer un statut refusé');

  PERFORM set_config('request.jwt.claims', '', TRUE);
END $t2$;

\echo ''
\echo '── 3. Acteur forgé ────────────────────────────────────────────────────'
DO $t3$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format(
    'SELECT bulk_assign_leads(%L::uuid, %L::jsonb, %L::uuid, %L)',
    '00000000-0000-0000-0000-000000000002',
    json_build_array(json_build_object('lead_id', current_setting('r.l3'), 'agent_id', current_setting('r.a1'))),
    current_setting('r.a1'), 'manager')), '42501', 'manager LY avec p_actor_id d''un autre : refusé');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT rpc_run_prospect_campaign(%L::uuid, %L::uuid)',
    current_setting('r.c'), current_setting('r.sa'))), '42501', 'campagne avec un acteur forgé : refusée');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.a1'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT rpc_transition_lead_status(%L::uuid, %L, %L::uuid, %L)',
    current_setting('r.l1'), 'lost', current_setting('r.mm'), 'manager')), '42501',
    'agent qui signe au nom du manager : refusé');
  PERFORM set_config('request.jwt.claims', '', TRUE);
END $t3$;

\echo ''
\echo '── 4. Le manager du marché ────────────────────────────────────────────'
DO $t4$
DECLARE
  v_r JSON;
  v_h lead_history;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);
  v_r := bulk_assign_leads('00000000-0000-0000-0000-000000000002',
           jsonb_build_array(jsonb_build_object('lead_id', current_setting('r.l3'), 'agent_id', current_setting('r.a1'))),
           current_setting('r.mm')::uuid, 'manager');
  PERFORM pg_temp.eq((v_r->>'assigned')::INT, 1, 'manager LY répartit un prospect');
  SELECT * INTO v_h FROM lead_history WHERE lead_id = current_setting('r.l3')::uuid ORDER BY created_at DESC LIMIT 1;
  PERFORM pg_temp.eq(v_h.actor_id, current_setting('r.mm')::uuid, 'l''historique porte l''id du manager');
  PERFORM pg_temp.eq(v_h.actor_type, 'manager', 'type manager');

  -- p_actor_id NULL : l'acteur devient la session.
  v_r := assign_lead(current_setting('r.l3')::uuid, current_setting('r.a2')::uuid, NULL, 'system');
  SELECT * INTO v_h FROM lead_history WHERE lead_id = current_setting('r.l3')::uuid ORDER BY created_at DESC, id LIMIT 1;
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM lead_history WHERE lead_id = current_setting('r.l3')::uuid
                              AND actor_id = current_setting('r.mm')::uuid AND actor_type = 'manager'
                              AND note = 'Reassigned to agent'),
                     'assign_lead sans acteur : signé par la session, jamais « system »');

  PERFORM pg_temp.eq(pg_temp.err(format(
    'SELECT bulk_assign_leads(%L::uuid, %L::jsonb, NULL)',
    '00000000-0000-0000-0000-000000000002',
    json_build_array(json_build_object('lead_id', current_setting('r.ltn'), 'agent_id', current_setting('r.a1'))))),
    '42501', 'un prospect tunisien dans le plan : refusé');
  PERFORM pg_temp.eq(pg_temp.err(format(
    'SELECT bulk_assign_leads(%L::uuid, %L::jsonb, NULL)',
    '00000000-0000-0000-0000-000000000002',
    json_build_array(json_build_object('lead_id', current_setting('r.l4'), 'agent_id', current_setting('r.atn'))))),
    '42501', 'un agent tunisien dans le plan : refusé');
  PERFORM pg_temp.eq(pg_temp.err(format(
    'SELECT bulk_assign_leads(%L::uuid, %L::jsonb, NULL)',
    '00000000-0000-0000-0000-000000000001',
    json_build_array(json_build_object('lead_id', current_setting('r.ltn'), 'agent_id', current_setting('r.atn'))))),
    '42501', 'manager LY dans le marché tunisien : refusé');

  PERFORM pg_temp.eq(pg_temp.err(format('SELECT rpc_run_prospect_campaign(%L::uuid, NULL)', current_setting('r.c'))),
    'NO_ERROR', 'manager LY lance sa campagne');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT get_prospect_desk(%L::uuid, %L::date, %L)',
    '00000000-0000-0000-0000-000000000002', '2026-10-01', 'Africa/Tripoli')), 'NO_ERROR', 'manager LY lit son bureau');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mmtn'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT assign_lead(%L::uuid, %L::uuid, NULL)',
    current_setting('r.l4'), current_setting('r.a1'))), '42501', 'manager TN sur un prospect libyen : refusé');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT rpc_run_prospect_campaign(%L::uuid, NULL)', current_setting('r.c'))),
    '42501', 'manager TN sur une campagne libyenne : refusé');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT get_prospect_desk(%L::uuid, %L::date, %L)',
    '00000000-0000-0000-0000-000000000002', '2026-10-01', 'Africa/Tripoli')), '42501', 'manager TN : bureau libyen refusé');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT prospects_distribute_now(%L::uuid)',
    '00000000-0000-0000-0000-000000000002')), '42501', 'manager TN : répartir en Libye refusé');
  PERFORM set_config('request.jwt.claims', '', TRUE);
END $t4$;

\echo ''
\echo '── 5. Le super_admin ──────────────────────────────────────────────────'
DO $t5$
DECLARE
  v_r JSON;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.sa'), 'role', 'authenticated')::TEXT, TRUE);
  v_r := bulk_assign_leads('00000000-0000-0000-0000-000000000002',
           jsonb_build_array(jsonb_build_object('lead_id', current_setting('r.l4'), 'agent_id', current_setting('r.a2'))),
           current_setting('r.sa')::uuid, 'super_admin');
  PERFORM pg_temp.eq((v_r->>'assigned')::INT, 1, 'super_admin répartit avec p_actor_type = super_admin (plantait en 23514)');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM lead_history WHERE lead_id = current_setting('r.l4')::uuid
                              AND actor_id = current_setting('r.sa')::uuid AND actor_type = 'manager'),
                     'historique : super_admin écrit comme manager');
  PERFORM set_config('request.jwt.claims', '', TRUE);
END $t5$;

\echo ''
\echo '── 6. L''agent sur SON prospect ────────────────────────────────────────'
DO $t6$
DECLARE
  v_r   JSON;
  v_oid UUID;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.a2'), 'role', 'authenticated')::TEXT, TRUE);
  v_r := rpc_transition_lead_status(current_setting('r.l2')::uuid, 'attempt_1', current_setting('r.a2')::uuid, 'agent');
  PERFORM pg_temp.eq((SELECT status::TEXT FROM leads WHERE id = current_setting('r.l2')::uuid), 'attempt_1', 'a2 note une tentative sur son prospect');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.a1'), 'role', 'authenticated')::TEXT, TRUE);
  v_r := convert_lead_to_order(current_setting('r.l1')::uuid, current_setting('r.a1')::uuid, NULL, 'SQLTEST LRA', NULL,
                               1, 150, 150, 'LRA 1', '0910000001', NULL, NULL, NULL);
  v_oid := (v_r->>'order_id')::uuid;
  PERFORM pg_temp.ok(v_oid IS NOT NULL, 'a1 convertit son prospect qualifié');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM order_history WHERE order_id = v_oid AND actor_id = current_setting('r.a1')::uuid AND actor_type = 'agent'),
                     'la commande est signée par a1, type agent');
  PERFORM set_config('request.jwt.claims', '', TRUE);
END $t6$;

\echo ''
\echo '── 7. Sans session : service role / cron ──────────────────────────────'
DO $t7$
DECLARE
  v_r JSON;
BEGIN
  PERFORM set_config('request.jwt.claims', '', TRUE);
  v_r := assign_lead(current_setting('r.l4')::uuid, current_setting('r.a1')::uuid, NULL, 'system');
  PERFORM pg_temp.eq(v_r->>'assigned_to', current_setting('r.a1'), 'sans session, assign_lead marche comme avant');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM lead_history WHERE lead_id = current_setting('r.l4')::uuid
                              AND actor_id IS NULL AND actor_type = 'system'), 'et signe « system »');
  v_r := unassign_lead(current_setting('r.l4')::uuid, NULL);
  PERFORM pg_temp.ok((SELECT assigned_to IS NULL FROM leads WHERE id = current_setting('r.l4')::uuid), 'unassign_lead sans session');
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT prospects_distribute_now(%L::uuid)',
    '00000000-0000-0000-0000-000000000002')), '42501', 'prospects_distribute_now exige une session');
END $t7$;

\echo ''
\echo '── 8. Règles : set_prospect_recovery_settings (20261006100500) ────────'
DO $t8$
DECLARE
  v_ly UUID := '00000000-0000-0000-0000-000000000002';
  v_r  JSONB;
BEGIN
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.set_prospect_recovery_settings(uuid,jsonb)', 'EXECUTE'), 'anon n''écrit pas les règles');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.a1'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT set_prospect_recovery_settings(%L::uuid, %L::jsonb)', v_ly, '{"enabled":false}')),
                     '42501', 'un agent ne change pas les règles');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mmtn'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT set_prospect_recovery_settings(%L::uuid, %L::jsonb)', v_ly, '{"enabled":false}')),
                     '42501', 'le manager tunisien ne change pas les règles libyennes');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(pg_temp.err(format('SELECT set_prospect_recovery_settings(%L::uuid, %L::jsonb)', v_ly, '[1]')),
                     '22023', 'une valeur qui n''est pas un objet est refusée');
  v_r := set_prospect_recovery_settings(v_ly, '{"dist":{"file_cap":12}}'::jsonb);
  PERFORM pg_temp.eq((v_r->'dist'->>'file_cap')::int, 12, 'le manager libyen écrit : la valeur partielle est fusionnée');
  PERFORM pg_temp.eq((v_r->'dist'->>'hour')::int, 9, 'les autres réglages gardent leur défaut');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM settings_history WHERE market_id = v_ly AND key = 'prospect_recovery'
                              AND changed_by = current_setting('r.mm')::uuid), 'et l''historique dit qui');
  PERFORM set_config('request.jwt.claims', '', TRUE);
  DELETE FROM settings WHERE market_id = v_ly AND key = 'prospect_recovery';
END $t8$;
