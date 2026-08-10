-- Scheduled deliveries never notified anyone.
--
-- `agent_notifications.kind` allowed only 'callback_due' and 'attempt_due', and
-- `run_notifications_check()` only ever read `callback_scheduled_at`. So when a
-- delivery scheduled for Tuesday 10:00 came due, nothing told the agent. The
-- gap was invisible because the `dispatch-scheduled-5min` cron auto-uploads the
-- rows flagged `scheduled_dispatch_auto` — but that flag is optional, and a
-- manual scheduled delivery had no automation AND no signal. It simply sat
-- there until somebody happened to scroll past it.
--
-- This adds the third kind and teaches both cron functions about it.

-- ── 1. Widen the kind constraint ─────────────────────────────────────────
alter table agent_notifications
  drop constraint if exists agent_notifications_kind_check;

alter table agent_notifications
  add constraint agent_notifications_kind_check
  check (kind in ('callback_due', 'attempt_due', 'dispatch_due'));

-- ── 2. Resolve dispatch_due once the order leaves dispatch_scheduled ──────
-- Same contract as the other two kinds: a notification stops being actionable
-- the moment the order is no longer in the state that produced it.
create or replace function public.resolve_stale_notifications()
returns integer
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  with resolved as (
    update agent_notifications an
    set read_at = now()
    from orders o
    where an.order_id = o.id
      and an.read_at is null
      and (
        (an.kind = 'callback_due' and o.status <> 'callback_scheduled')
        or
        (an.kind = 'attempt_due' and o.status not in ('attempt_1', 'attempt_2', 'attempt_3'))
        or
        (an.kind = 'dispatch_due' and o.status <> 'dispatch_scheduled')
      )
    returning an.id
  )
  select count(*)::integer into v_count from resolved;
  return v_count;
end;
$$;

grant execute on function public.resolve_stale_notifications() to authenticated, service_role;

-- ── 3. Emit dispatch_due when a scheduled delivery comes due ─────────────
-- The unique partial index on (order_id, kind) where read_at is null keeps the
-- every-minute tick idempotent, exactly as it does for the other two kinds.
create or replace function public.run_notifications_check()
returns json
language plpgsql
security definer
as $$
declare
  v_resolved integer;
  v_callback_inserted integer;
  v_attempt_inserted integer;
  v_dispatch_inserted integer;
begin
  select public.resolve_stale_notifications() into v_resolved;

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

  with new_dispatches as (
    insert into agent_notifications (agent_id, order_id, kind, due_at)
    select assigned_to, id, 'dispatch_due', scheduled_dispatch_at
    from orders
    where status = 'dispatch_scheduled'
      and scheduled_dispatch_at is not null
      and scheduled_dispatch_at <= now()
      and assigned_to is not null
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into v_dispatch_inserted from new_dispatches;

  return json_build_object(
    'resolved', v_resolved,
    'callback_notifications', v_callback_inserted,
    'attempt_notifications', v_attempt_inserted,
    'dispatch_notifications', v_dispatch_inserted
  );
end;
$$;

grant execute on function public.run_notifications_check() to authenticated, service_role;
