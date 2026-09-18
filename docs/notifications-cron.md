# Scheduled jobs (pg_cron) — and the notifications job in detail

Everything scheduled in Ordra runs inside Postgres via `pg_cron`, not from Vercel,
because Vercel's Hobby plan caps crons at once per day. **There are 12 active jobs**
(verified against the live database 2026-09-13):

| Job | Schedule | What it does |
|---|---|---|
| `notifications-check` | `* * * * *` | The agent bell — detailed below |
| `dispatch-scheduled-5min` | `*/5 * * * *` | Uploads `dispatch_scheduled` orders to the carrier |
| `carrier-polling-10min` | `*/10 * * * *` | Polls carriers for status changes |
| `darb-sync-10min` | `3-59/10 * * * *` | Darb Assabil shipment + timeline sync |
| `google-sheets-sync` | `*/15 * * * *` | Sheet-sourced order intake |
| `agent-commissions-accrue-15min` | `8-59/15 * * * *` | Accrues agent commissions |
| `investor-rollup-15min` | `4-59/15 * * * *` | Investor facts rollup (incremental) |
| `meta-ads-sync` | `7 * * * *` | Hourly Meta ad-spend pull |
| `auto-archive-finished-orders` | `0 3 * * *` | Archives terminal orders |
| `darb-rates-harvest-nightly` | `17 2 * * *` | Harvests Darb shipping rates |
| `delivery-zone-stats-nightly` | `17 2 * * *` | Recomputes per-zone delivery rates |
| `investor-rollup-nightly` | `41 2 * * *` | Full investor rollup |

The offset minutes (`3-59/10`, `8-59/15`, `4-59/15`, `:07`, `:17`, `:41`) are
deliberate: they keep the heavy jobs from all firing on the same tick. Keep that spread
when adding a job.

List them with `select jobid, schedule, jobname, active from cron.job order by jobname;`

---

## The notifications job

The agent notification bell relies on this per-minute job, which scans for elapsed
callbacks and stale notifications.

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
