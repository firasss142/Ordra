-- Auto-resolve open agent_notifications when the underlying order has moved
-- out of the kind's source state. Called from the notifications cron each
-- tick. Returns the number of rows resolved.
--
-- Examples that auto-resolve here:
--   * Agent confirmed an order that had a 'callback_due' notification — order
--     status changed to 'confirmed', notification is no longer actionable.
--   * Agent moved an order from attempt_2 to attempt_3 — its old attempt_due
--     notification is stale.
--
-- Notifications stay unread when the order is still in the source state (e.g.
-- callback_scheduled with a past callback_scheduled_at and an unread
-- callback_due). Those still demand the agent's action.

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
      )
    returning an.id
  )
  select count(*)::integer into v_count from resolved;
  return v_count;
end;
$$;

grant execute on function public.resolve_stale_notifications() to authenticated, service_role;
