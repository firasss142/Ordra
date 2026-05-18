-- Replaces the Vercel-cron-based notifications check with a pg_cron schedule
-- that runs entirely inside Postgres. Vercel Hobby plan limits crons to once
-- per day, which is useless for "notify the agent the moment a callback time
-- elapses." pg_cron is already installed on the Supabase project and runs
-- inside the database, no HTTP roundtrip, no Vercel function quota.
--
-- The HTTP route at /api/cron/notifications-check still exists for manual
-- testing (e.g. `Invoke-WebRequest -Method POST ...`), but no scheduler points
-- at it anymore.

-- Single SQL function mirroring the HTTP route's logic. Callable directly
-- from pg_cron and from psql/MCP for manual runs.
create or replace function public.run_notifications_check()
returns json
language plpgsql
security definer
as $$
declare
  v_resolved integer;
  v_callback_inserted integer;
  v_attempt_inserted integer;
begin
  -- 0. Auto-resolve stale notifications (order moved out of source state)
  select public.resolve_stale_notifications() into v_resolved;

  -- 1. Callback-due: callback_scheduled orders where callback_scheduled_at <= now()
  with new_callbacks as (
    insert into agent_notifications (agent_id, order_id, kind, due_at)
    select assigned_to, id, 'callback_due', callback_scheduled_at
    from orders
    where status = 'callback_scheduled'
      and callback_scheduled_at <= now()
      and assigned_to is not null
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into v_callback_inserted from new_callbacks;

  -- 2. Attempt-due: attempt_1/2/3 orders where callback_scheduled_at <= now()
  with new_attempts as (
    insert into agent_notifications (agent_id, order_id, kind, due_at)
    select assigned_to, id, 'attempt_due', callback_scheduled_at
    from orders
    where status in ('attempt_1', 'attempt_2', 'attempt_3')
      and callback_scheduled_at <= now()
      and assigned_to is not null
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into v_attempt_inserted from new_attempts;

  return json_build_object(
    'resolved', v_resolved,
    'callback_notifications', v_callback_inserted,
    'attempt_notifications', v_attempt_inserted
  );
end;
$$;

grant execute on function public.run_notifications_check() to service_role;

-- Schedule it every minute via pg_cron. Idempotent: unschedule existing entry
-- with the same name first so re-running the migration doesn't pile up jobs.
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'notifications-check';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'notifications-check',
  '* * * * *',
  $sql$ select public.run_notifications_check(); $sql$
);
