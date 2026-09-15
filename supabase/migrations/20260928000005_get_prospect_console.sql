-- The manager console (« Prospects » → manager half, 2026-09-15).
-- One call for the four sections the screen shows. Four separate queries meant
-- four round trips, and the database is ~130 ms away.
--
-- SECURITY INVOKER: RLS on `leads` is the isolation, exactly as the worklist
-- route relies on. This function only shapes what the caller may already read.
create or replace function public.get_prospect_console(
  p_market_id uuid,
  p_tz text default 'Africa/Tripoli'
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with scope as (
  select l.* from leads l
  where l.market_id = p_market_id and l.status <> 'archived'
),
working as (
  select * from scope
  where status in ('new','assigned','attempt_1','attempt_2','attempt_3',
                   'callback_scheduled','qualified','won')
),
first_touch as (
  select l.id, l.created_at,
         (select min(h.created_at) from lead_history h
           where h.lead_id = l.id and h.status_to::text <> 'new') as touched_at
  from scope l
),
ttc as (
  select
    percentile_cont(0.5) within group (
      order by extract(epoch from (touched_at - created_at)) / 60
    ) filter (where touched_at is not null
                and created_at >= now() - interval '30 days') as median_now,
    percentile_cont(0.5) within group (
      order by extract(epoch from (touched_at - created_at)) / 60
    ) filter (where touched_at is not null
                and created_at >= now() - interval '60 days'
                and created_at <  now() - interval '30 days') as median_prev
  from first_touch
),
hot as (
  select w.created_at from working w
  where w.converted_order_id is null
    and w.source::text in ('whatsapp','facebook_comment','facebook_dm',
                           'instagram_dm','tiktok_comment')
    and w.callback_scheduled_at is null
    and w.status::text not like 'attempt_%'
    and w.created_at >= now() - make_interval(mins => coalesce(
          (select (s.value ->> 'value')::int from settings s
            where s.market_id = p_market_id
              and s.key = 'lead_hot_window_minutes'), 60))
),
kpis as (
  select
    (select count(*) from scope where created_at >= now() - interval '7 days') as new_7d,
    (select count(*) from scope where created_at >= now() - interval '14 days'
                                  and created_at <  now() - interval '7 days') as new_prev_7d,
    (select count(*) from hot) as hot_waiting,
    (select round(extract(epoch from (now() - min(created_at))) / 60)::int from hot) as oldest_hot_minutes,
    (select round(median_now::numeric, 1) from ttc) as median_first_contact_minutes,
    (select round(median_prev::numeric, 1) from ttc) as median_first_contact_prev,
    (select count(*) from scope s
      where s.converted_order_id is not null
        and s.updated_at >= now() - interval '30 days') as converted_30d,
    (select count(*) from scope s join orders o on o.id = s.converted_order_id
      where o.status = 'delivered' and s.updated_at >= now() - interval '30 days') as delivered_30d,
    (select coalesce(sum(o.total_price), 0) from scope s join orders o on o.id = s.converted_order_id
      where o.status = 'delivered' and s.updated_at >= now() - interval '30 days') as delivered_revenue_30d
),
campaigns as (
  select c.id, c.name, c.offer, c.created_at,
    count(l.id) as audience,
    count(*) filter (
      where l.status::text like 'attempt_%'
         or l.status in ('callback_scheduled','qualified','won','lost')
    ) as called,
    count(*) filter (where l.converted_order_id is not null) as converted,
    coalesce(sum(o.total_price) filter (where o.status = 'delivered'), 0) as revenue
  from prospect_campaigns c
  left join leads l on l.campaign_id = c.id and l.market_id = p_market_id
  left join orders o on o.id = l.converted_order_id
  where c.market_id = p_market_id
  group by c.id, c.name, c.offer, c.created_at
),
agents as (
  select u.id, u.full_name as name,
    (select count(*) from working w where w.assigned_to = u.id
       and w.converted_order_id is null) as open_leads,
    (select count(*) from working w where w.assigned_to = u.id
       and w.converted_order_id is null
       and w.callback_scheduled_at is null
       and w.status::text not like 'attempt_%'
       and w.source::text in ('whatsapp','facebook_comment','facebook_dm',
                              'instagram_dm','tiktok_comment')) as hot_waiting,
    (select count(*) from lead_history h where h.actor_id = u.id
       and h.created_at >= date_trunc('day', now() at time zone p_tz) at time zone p_tz) as calls_today,
    (select count(*) from lead_history h where h.actor_id = u.id and h.status_to = 'won'
       and h.created_at >= date_trunc('day', now() at time zone p_tz) at time zone p_tz) as converted_today
  from users u
  where u.market_id = p_market_id and u.role = 'agent' and u.is_active
)
select jsonb_build_object(
  'metrics', (select to_jsonb(k) from kpis k),
  'campaigns', coalesce((select jsonb_agg(to_jsonb(c) order by c.audience desc) from campaigns c), '[]'::jsonb),
  'agents', coalesce((select jsonb_agg(to_jsonb(a)) from agents a), '[]'::jsonb)
);
$$;

comment on function public.get_prospect_console(uuid, text) is
  'Manager console for Prospects: KPIs, campaign funnels and agent load in one call. SECURITY INVOKER — RLS on leads is the isolation.';
