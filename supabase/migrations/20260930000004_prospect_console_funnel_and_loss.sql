-- L'entonnoir et les motifs de perte, ajoutés à get_prospect_console
-- (2026-09-15).
--
-- La console manager pose deux questions que la version mince ne répondait
-- pas : où le stock se bloque (l'entonnoir) et pourquoi il part (les motifs).
-- Les deux arrivent dans le même appel plutôt que dans des requêtes séparées :
-- la base est à ~130 ms et la page n'affiche rien tant que tout n'est pas là.
--
-- Le reste du payload ne bouge pas, donc la console déjà déployée continue de
-- fonctionner sans changement — ses tests passent tels quels.
--
-- Nouvelles mesures dans `metrics` : pool, pool_campaigns, pool_oldest_days,
-- never_called, total, late_callbacks, lost_30d, calls_today, reached_today,
-- oldest_hot_agent. Nouveaux blocs : `funnel` et `loss`. Les campagnes
-- portent leur `channel` et leur `pool`, les agents leurs rappels en retard,
-- ceux qu'ils ont joints et la minute de leur dernier geste.
--
-- SECURITY INVOKER : RLS décide déjà ce que l'appelant peut lire.

-- (définition appliquée, récupérée depuis la base)
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
hot_window as (
  select coalesce(
    (select value::int from settings
      where market_id = p_market_id and key = 'lead_hot_window_minutes'
      limit 1), 60) as minutes
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
    ) filter (where touched_at is not null and created_at > now() - interval '30 days') as median_30,
    percentile_cont(0.5) within group (
      order by extract(epoch from (touched_at - created_at)) / 60
    ) filter (where touched_at is not null
                and created_at > now() - interval '60 days'
                and created_at <= now() - interval '30 days') as median_prev
  from first_touch
),
hot as (
  select s.* from scope s, hot_window w
  where s.source::text in ('whatsapp','facebook_comment','facebook_dm','instagram_dm','tiktok_comment')
    and s.callback_scheduled_at is null
    and s.status::text not like 'attempt_%'
    and s.status not in ('won','lost')
    and s.created_at > now() - make_interval(mins => w.minutes)
),
converted as (
  select s.id, s.converted_order_id, o.status as order_status, o.total_price
  from scope s join orders o on o.id = s.converted_order_id
  where s.converted_order_id is not null and s.updated_at > now() - interval '30 days'
),
agents as (
  select u.id, u.full_name from users u
  where u.market_id = p_market_id and u.role = 'agent' and u.is_active
),
today as (
  select h.actor_id, h.lead_id, h.status_to
  from lead_history h
  where h.created_at >= date_trunc('day', now() at time zone p_tz) at time zone p_tz
),
-- L'entonnoir : où s'arrête le stock. Chaque étage compte les prospects qui
-- l'ont atteint, pas ceux qui y sont restés.
funnel as (
  select
    (select count(*) from scope)                                               as created,
    (select count(*) from scope where assigned_to is null)                     as pool,
    (select count(*) from scope where assigned_to is not null)                 as assigned,
    (select count(*) from scope
      where status::text like 'attempt_%'
         or status in ('callback_scheduled','qualified','won','lost'))         as called,
    (select count(*) from scope
      where status in ('callback_scheduled','qualified','won'))                as reached,
    (select count(*) from scope where status = 'won')                          as conv,
    (select count(*) from converted where order_status = 'delivered')          as deliv
),
loss as (
  select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) as by_reason
  from (
    select lost_reason::text as reason, count(*)::int as n
    from scope where status = 'lost' and lost_reason is not null
    group by 1
  ) t
)
select jsonb_build_object(
  'metrics', jsonb_build_object(
    'new_7d',    (select count(*) from scope where created_at > now() - interval '7 days'),
    'new_prev_7d', (select count(*) from scope
                     where created_at > now() - interval '14 days'
                       and created_at <= now() - interval '7 days'),
    'hot_waiting', (select count(*) from hot),
    'oldest_hot_minutes', (select round(extract(epoch from (now() - min(created_at))) / 60)::int from hot),
    'median_first_contact_minutes', (select round(median_30)::int from ttc),
    'median_first_contact_prev',    (select round(median_prev)::int from ttc),
    'converted_30d', (select count(*) from converted),
    'delivered_30d', (select count(*) from converted where order_status = 'delivered'),
    'delivered_revenue_30d', (select coalesce(sum(total_price), 0) from converted where order_status = 'delivered'),
    'pool',       (select pool from funnel),
    'pool_campaigns', (select count(distinct campaign_id) from scope
                        where assigned_to is null and campaign_id is not null),
    'pool_oldest_days', (select round(extract(epoch from (now() - min(created_at))) / 86400)::int
                          from scope where assigned_to is null),
    'never_called', (select count(*) from working
                      where status in ('new','assigned')),
    'total',      (select count(*) from scope),
    'late_callbacks', (select count(*) from scope
                        where status = 'callback_scheduled'
                          and callback_scheduled_at < now()),
    'lost_30d',   (select count(*) from scope
                    where status = 'lost' and updated_at > now() - interval '30 days'),
    'calls_today',    (select count(*) from today where status_to::text like 'attempt_%'),
    'reached_today',  (select count(*) from today where status_to in ('callback_scheduled','qualified','won')),
    'oldest_hot_agent', (select u.full_name from hot h
                          left join users u on u.id = h.assigned_to
                          order by h.created_at limit 1)
  ),
  'funnel', (select to_jsonb(f) from funnel f),
  'loss',   (select by_reason from loss),
  'campaigns', coalesce((
    select jsonb_agg(c order by c->>'audience' desc) from (
      select jsonb_build_object(
        'id', pc.id, 'name', pc.name, 'offer', pc.offer,
        'channel', pc.channel, 'created_at', pc.created_at,
        'audience',  (select count(*) from scope s where s.campaign_id = pc.id),
        'pool',      (select count(*) from scope s where s.campaign_id = pc.id and s.assigned_to is null),
        'called',    (select count(*) from scope s where s.campaign_id = pc.id
                        and (s.status::text like 'attempt_%' or s.status in ('callback_scheduled','qualified','won','lost'))),
        'converted', (select count(*) from scope s where s.campaign_id = pc.id and s.status = 'won'),
        'revenue',   (select coalesce(sum(o.total_price), 0) from scope s
                        join orders o on o.id = s.converted_order_id
                       where s.campaign_id = pc.id and o.status = 'delivered')
      ) as c
      from prospect_campaigns pc
      where pc.market_id = p_market_id
    ) t
  ), '[]'::jsonb),
  'agents', coalesce((
    select jsonb_agg(a order by a->>'hot_waiting' desc) from (
      select jsonb_build_object(
        'id', ag.id, 'name', ag.full_name,
        'open_leads',  (select count(*) from working w where w.assigned_to = ag.id and w.status <> 'won'),
        'hot_waiting', (select count(*) from hot h where h.assigned_to = ag.id),
        'late_callbacks', (select count(*) from scope s
                            where s.assigned_to = ag.id and s.status = 'callback_scheduled'
                              and s.callback_scheduled_at < now()),
        'calls_today',     (select count(*) from today t where t.actor_id = ag.id and t.status_to::text like 'attempt_%'),
        'reached_today',   (select count(*) from today t where t.actor_id = ag.id
                             and t.status_to in ('callback_scheduled','qualified','won')),
        'converted_today', (select count(*) from today t where t.actor_id = ag.id and t.status_to = 'won'),
        'last_touch_minutes', (select round(extract(epoch from (now() - max(t.created_at))) / 60)::int
                                 from lead_history t where t.actor_id = ag.id)
      ) as a
      from agents ag
    ) t
  ), '[]'::jsonb)
);
$$;

grant execute on function public.get_prospect_console(uuid, text) to authenticated;
