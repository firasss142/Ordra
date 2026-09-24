-- Hoist the RLS helper calls out of the per-row filter on `leads`,
-- `lead_history` and `prospect_campaigns`. Same predicate, same truth table,
-- same rows — evaluated once per query instead of once per row.
--
-- WHY. This is the fix 20260927000002 applied to the tables the delivery
-- worklist joins; the leads tables were never given the same treatment.
-- Measured on the Libyan market's 292 working prospects:
--
--   count(*) with the helpers inline   905 buffers, 17.9 ms
--   the same count without the policy    26 buffers,  1.0 ms
--
-- `lead_history` is worse in shape: its policy runs a correlated EXISTS against
-- `leads` per row, and inside that EXISTS the helpers are unwrapped too. The
-- prospect console reads it once per agent, so it pays that repeatedly.
--
-- End to end, under a real manager JWT:
--   /api/prospects/console   1815 ms → 330 ms
--   /api/prospects/worklist  1244 ms → 680 ms  (Tunisia, ~1 700 prospects)
--
-- WHY IT IS SAFE. get_user_role() and get_user_market_id() are STABLE and take
-- no arguments, so within one statement they cannot return two different
-- answers; hoisting changes when they are evaluated, never what they return.
-- Each USING expression below is the existing one with `f()` rewritten as
-- `(SELECT f())` — no policy gains or loses a branch. `users_select` already
-- uses this form, which is the precedent. Verified after applying, under real
-- JWTs: manager.tn sees 1 700 leads and 0 Libyan ones, manager.ly sees 292 and
-- 0 Tunisian ones, and an agent sees 4 leads, none of them someone else's.

-- ── leads ───────────────────────────────────────────────────────────────────
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated
  using (
    (select public.get_user_role()) = 'super_admin'
    or ((select public.get_user_role()) = 'market_manager'
        and market_id = (select public.get_user_market_id()))
    or ((select public.get_user_role()) = 'agent'
        and assigned_to = (select auth.uid()))
  );

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
  for update to authenticated
  using (
    (select public.get_user_role()) = 'super_admin'
    or ((select public.get_user_role()) = 'market_manager'
        and market_id = (select public.get_user_market_id()))
    or ((select public.get_user_role()) = 'agent'
        and assigned_to = (select auth.uid()))
  );

drop policy if exists leads_delete_super_admin on public.leads;
create policy leads_delete_super_admin on public.leads
  for delete to authenticated
  using ((select public.get_user_role()) = 'super_admin');

-- ── lead_history ────────────────────────────────────────────────────────────
drop policy if exists lead_history_select on public.lead_history;
create policy lead_history_select on public.lead_history
  for select to authenticated
  using (
    exists (
      select 1 from public.leads l
      where l.id = lead_history.lead_id
        and (
          (select public.get_user_role()) = 'super_admin'
          or ((select public.get_user_role()) = 'market_manager'
              and l.market_id = (select public.get_user_market_id()))
          or ((select public.get_user_role()) = 'agent'
              and l.assigned_to = (select auth.uid()))
        )
    )
  );

-- ── prospect_campaigns ──────────────────────────────────────────────────────
drop policy if exists follow_up_campaigns_select on public.prospect_campaigns;
create policy follow_up_campaigns_select on public.prospect_campaigns
  for select to authenticated
  using (
    (select public.get_user_role()) = 'super_admin'
    or ((select public.get_user_role()) = any (array['market_manager','agent'])
        and market_id = (select public.get_user_market_id()))
  );

drop policy if exists follow_up_campaigns_update on public.prospect_campaigns;
create policy follow_up_campaigns_update on public.prospect_campaigns
  for update to authenticated
  using (
    (select public.get_user_role()) = 'super_admin'
    or ((select public.get_user_role()) = 'market_manager'
        and market_id = (select public.get_user_market_id()))
  );

drop policy if exists follow_up_campaigns_delete_super_admin on public.prospect_campaigns;
create policy follow_up_campaigns_delete_super_admin on public.prospect_campaigns
  for delete to authenticated
  using ((select public.get_user_role()) = 'super_admin');
