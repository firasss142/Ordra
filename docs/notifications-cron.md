# Notifications cron (pg_cron)

The agent notification bell relies on a per-minute job that scans for elapsed
callbacks and stale notifications. Because Vercel's Hobby plan caps crons at
once per day, we run the job inside Postgres via `pg_cron` instead of from
Vercel.

## What runs and where

- **Schedule**: pg_cron job `notifications-check`, expression `* * * * *`
  (every minute).
- **Body**: `select public.run_notifications_check();`
- **Defined in**: `supabase/migrations/20260624000003_pg_cron_notifications.sql`

`run_notifications_check()` does three things per tick:
1. Auto-resolves notifications whose underlying order has left the source
   state (`resolve_stale_notifications()`).
2. Inserts `callback_due` rows for `callback_scheduled` orders past their
   `callback_scheduled_at`.
3. Inserts `attempt_due` rows for `attempt_1/2/3` orders past their
   `callback_scheduled_at`.

A unique partial index on `(order_id, kind) WHERE read_at IS NULL` prevents
duplicate unread notifications for the same order/kind.

The HTTP route `POST /api/cron/notifications-check` still exists for manual
testing. No scheduler points at it. Use it like:

```powershell
Invoke-WebRequest -Method POST `
  -Uri "http://localhost:3000/api/cron/notifications-check" `
  -Headers @{ "x-cron-secret" = $env:CRON_SECRET }
```

## Ownership caveat — read this before rotating database users

`cron.schedule(...)` records the **calling role** as the job owner. When the
job fires, pg_cron runs it as that owner. The job was created from an MCP
session that authenticates as `postgres` (the project's superuser), so it
currently runs with full privileges and bypasses RLS — correct for a system
job that needs to read every market's orders and write every agent's
notifications.

**If that role is ever dropped or has its login revoked, the cron silently
stops firing.** pg_cron does not raise an alert; the job just stops appearing
in `cron.job_run_details`. Symptoms from the app side: callback notifications
never arrive, but no error anywhere.

If you ever need to re-own the job (e.g. moving from a personal MCP login to
a dedicated system role):

```sql
-- 1. Inspect current owner
select jobid, jobname, username, schedule, active
from cron.job
where jobname = 'notifications-check';

-- 2. Unschedule, then re-create as the desired role
do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'notifications-check';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;

-- (run this block as the role you want to own the job)
select cron.schedule(
  'notifications-check',
  '* * * * *',
  $sql$ select public.run_notifications_check(); $sql$
);
```

If you re-create the job as a less-privileged role, make sure that role has
`execute` on `run_notifications_check()` and the function is marked
`security definer` (it is, in the migration). The function itself runs with
the privileges of *its* owner (`postgres`), so the calling role only needs
execute permission.

## Health check

```sql
-- Last 10 runs
select jobid, start_time, end_time, status, return_message
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'notifications-check')
order by start_time desc
limit 10;
```

A healthy job shows one `succeeded` row per minute with a sub-100ms duration.
If `start_time` gaps are larger than one minute, pg_cron itself may be lagging
(possible during heavy DB load) — not a correctness issue, just a latency
one. The unique partial index prevents duplicates if a tick is skipped.

## Why not Vercel cron

Vercel Hobby allows crons no more frequent than `0 0 * * *` (once per day).
A daily check is useless for "notify the agent the moment a callback time
elapses." pg_cron runs in-database, costs nothing extra on Supabase, and is
already enabled on this project (pg_cron 1.6.4).
