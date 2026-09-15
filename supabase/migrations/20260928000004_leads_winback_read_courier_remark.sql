-- Prospects rebuild (2026-09-14), part 2c — the trigger, as finally shipped.
--
-- The first version read darb_timeline_events.description, which does not
-- exist, so every attempt to mark a parcel returned failed outright. The real
-- columns are `remarks` (the courier's own words, Arabic, free-form — the only
-- field that says WHY) and description_ar/_en (a generic template: every
-- delayed event reads "The order is delayed."). The agent needs the remark.
create or replace function public.leads_create_winback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_disabled boolean;
begin
  -- Only the moment of becoming returned, never a re-save of an already
  -- returned order, or one win-back would become many.
  if new.status is distinct from 'returned'::public.order_status
     or old.status is not distinct from new.status then
    return new;
  end if;

  -- A market can turn this off; absent the setting, it is on.
  select coalesce((s.value ->> 'value')::boolean, false)
    into v_disabled
    from public.settings s
   where s.market_id = new.market_id
     and s.key = 'lead_winback_disabled'
   limit 1;

  if coalesce(v_disabled, false) then
    return new;
  end if;

  -- Never a second prospect for the same parcel, however the status is reached.
  if exists (select 1 from public.leads l where l.source_order_id = new.id) then
    return new;
  end if;

  -- The last courier remark that actually says something. A blank remark is
  -- worth less than the event's own label, so fall back to that.
  select coalesce(nullif(btrim(e.remarks), ''), e.description_ar, e.description_en)
    into v_reason
    from public.darb_timeline_events e
   where e.order_id = new.id
     and coalesce(nullif(btrim(e.remarks), ''), e.description_ar, e.description_en) is not null
   order by e.occurred_at desc nulls last
   limit 1;

  insert into public.leads (
    market_id, source, source_order_id, status,
    customer_name, customer_phone, customer_city, customer_address,
    product_interest_id, assigned_to, return_reason, notes
  ) values (
    new.market_id, 'winback'::public.lead_source, new.id, 'assigned'::public.lead_status,
    new.customer_name, new.customer_phone, new.customer_city, new.customer_address,
    new.product_id, new.assigned_to, v_reason, null
  );

  return new;
end;
$$;

comment on function public.leads_create_winback() is
  'Creates one prospect for the confirming agent when a parcel is marked returned, carrying the carrier''s reason. Off per market via settings key lead_winback_disabled.';

-- A trigger function has no business being callable over PostgREST. Left as
-- granted, /rest/v1/rpc/leads_create_winback would let anon invoke a
-- SECURITY DEFINER function; the Supabase security advisor flags it.
revoke execute on function public.leads_create_winback() from public, anon, authenticated;

drop trigger if exists trg_orders_create_winback on public.orders;
create trigger trg_orders_create_winback
  after update on public.orders
  for each row
  execute function public.leads_create_winback();
