-- ============================================================
-- 20260918010003_pg_cron_agent_commissions.sql
-- Schedule the commission accrual sweep.
--
-- WHY pg_cron and not Vercel: same reason as every other job here — the
-- Hobby plan rejects sub-daily entries in vercel.json (see
-- 20260909000005_pg_cron_darb_sync.sql).
--
-- WHY a direct SQL call and not an HTTP round-trip: accrue_agent_commissions()
-- is pure SQL over order_history + orders — nothing to fetch, no vendor, no
-- secret. Calling it in-database removes the pg_net hop and the 55 s timeout
-- that hides failures behind a "succeeded" cron row.
--
-- WHY :08 every 15 min: off the existing :00 / :03 / :05 / :07 / :10 / :15
-- offsets so a slow tick never shares a worker with a carrier poll. Delivered
-- events land via carrier sync at most every 10 min, so 15 min is fresh
-- enough for money that is paid weekly or monthly.
--
-- The same function is exposed to super_admin via POST /api/team/commissions/
-- accrue so a stalled schedule can always be run by hand (investor F5 lesson).
-- ============================================================

DO $$
DECLARE
  v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'agent-commissions-accrue-15min';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'agent-commissions-accrue-15min',
  '8-59/15 * * * *',
  $$SELECT accrue_agent_commissions(NULL);$$
);
