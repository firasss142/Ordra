-- Journaux — let the people who read the logs actually read them.
--
-- WHY. The Journaux routes (/api/admin/carrier-events, /api/admin/sync-runs,
-- /api/admin/logs/counts, /api/admin/audit) and the Darb control room read
-- with the session client, so RLS decides — and it decided « nothing »:
--
--   carrier_event_log       RLS on, no policy  → « Transporteurs » always empty, badge 0
--   darb_sync_runs          RLS on, no policy  → no Darb row in « Synchronisations »;
--                                                the control room's last sync blank
--   darb_rate_harvest_runs  RLS on, no policy  → no harvest row
--   user_audit_log          auth.jwt() ->> 'role' = 'super_admin', which is never
--                           true: the JWT role claim is 'authenticated' (no
--                           custom-claims hook) → no user event in « Modifications »
--
-- The route tests mock the client, so none of this showed. Proven under a real
-- JWT in supabase/tests/journal_read_policies_test.sql.
--
-- WHO READS WHAT. The super_admin reads the four tables. A market manager reads
-- the Darb sync runs of their own market's carriers, which the control room
-- shows them; raw carrier payloads (customer phones and addresses), the rate
-- harvest and the user journal stay the administrator's. Read only: no write
-- policy is added, writers keep using the service role.
--
-- `(SELECT get_user_role())`, never a bare call: a bare helper in a policy is
-- re-run per row (RLS InitPlan note).

CREATE POLICY "carrier_event_log_select_super_admin"
  ON public.carrier_event_log FOR SELECT
  TO authenticated
  USING ((SELECT public.get_user_role()) = 'super_admin');

CREATE POLICY "darb_sync_runs_select"
  ON public.darb_sync_runs FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR (
      (SELECT public.get_user_role()) = 'market_manager'
      AND EXISTS (
        SELECT 1 FROM public.carriers c
         WHERE c.id = darb_sync_runs.carrier_id
           AND c.market_id = (SELECT public.get_user_market_id())
      )
    )
  );

CREATE POLICY "darb_rate_harvest_runs_select_super_admin"
  ON public.darb_rate_harvest_runs FOR SELECT
  TO authenticated
  USING ((SELECT public.get_user_role()) = 'super_admin');

DROP POLICY IF EXISTS "audit_super_admin_read" ON public.user_audit_log;
CREATE POLICY "user_audit_log_select_super_admin"
  ON public.user_audit_log FOR SELECT
  TO authenticated
  USING ((SELECT public.get_user_role()) = 'super_admin');
