-- L'audience d'une campagne, comptée pour de vrai (2026-09-15).
--
-- Pourquoi cette fonction existe. La prévisualisation existante lit cinq clés
-- de filter_json et renvoie un nombre ; la maquette du composeur en propose
-- quatorze et simule le compte avec des taux en dur. Les deux mentent, chacune
-- à sa façon.
--
-- Mesure faite le jour de l'écriture, modèle « rachat » sur la Libye :
--   531 clients livrés sur 180 jours
--   → 295 dans la fenêtre de récence 60–120 jours
--   → 290 ont déjà un prospect ouvert
--   → il en reste 5.
-- La simulation annonçait environ 400. Les garde-fous ne sont pas un détail :
-- ils sont la différence entre appeler cinq clients et harceler deux cent
-- quatre-vingt-dix personnes qu'un agent rappelle déjà.
--
-- C'est pourquoi la ventilation des exclusions est renvoyée, pas seulement le
-- total : un manager qui voit « 5 » doit pouvoir lire pourquoi.
--
-- La même CTE `audience` sert ici et dans rpc_run_prospect_campaign (migration
-- suivante). Une seule définition de « qui est dans la campagne », pour que
-- l'aperçu et l'exécution ne puissent pas diverger.
--
-- SECURITY INVOKER : RLS sur `orders` et `leads` décide déjà ce que l'appelant
-- peut lire. Cette fonction ne fait que compter ce qu'il verrait de toute façon.

create or replace function public.preview_campaign_audience(
  p_market_id uuid,
  p_filter jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with params as (
  select
    coalesce(
      (select array_agg(x) from jsonb_array_elements_text(p_filter->'order_statuses') as x),
      array['delivered']
    )                                                        as order_statuses,
    (p_filter->>'date_from')::timestamptz                    as date_from,
    (p_filter->>'date_to')::timestamptz                      as date_to,
    -- Le composeur écrit product_ids ; les campagnes d'avant portent product_id.
    coalesce(
      (select array_agg(x::uuid) from jsonb_array_elements_text(p_filter->'product_ids') as x),
      case when p_filter->>'product_id' is not null
           then array[(p_filter->>'product_id')::uuid] end
    )                                                        as product_ids,
    coalesce(
      (select array_agg(x) from jsonb_array_elements_text(p_filter->'cities') as x),
      case when p_filter->>'city' is not null
           then array[p_filter->>'city'] end
    )                                                        as cities,
    (p_filter->'recency_days'->>'from')::int                 as recency_from,
    (p_filter->'recency_days'->>'to')::int                   as recency_to,
    (p_filter->>'basket_min')::numeric                       as basket_min,
    (p_filter->'order_count'->>'op')                         as count_op,
    (p_filter->'order_count'->>'n')::int                     as count_n,
    (p_filter->'returns'->>'mode')                           as returns_mode,
    (p_filter->'returns'->>'rate')::numeric                  as returns_rate,
    (select array_agg(x) from jsonb_array_elements_text(p_filter->'rejection_reasons') as x)
                                                             as rejection_reasons,
    (select array_agg(x::uuid) from jsonb_array_elements_text(p_filter->'agent_ids') as x)
                                                             as agent_ids,
    (p_filter->'guards'->>'not_ordered_days')::int           as guard_ordered_days,
    (p_filter->'guards'->>'not_in_campaign_days')::int       as guard_campaign_days,
    coalesce((p_filter->'guards'->>'not_lost_not_interested')::boolean, false)
                                                             as guard_lost_ni,
    coalesce((p_filter->'limit'->>'sort'), 'oldest')         as limit_sort,
    (p_filter->'limit'->>'n')::int                           as limit_n
),
-- Les commandes qui portent l'issue voulue, datées par la transition vers
-- cette issue et non par leur création : une commande livrée hier peut avoir
-- été passée il y a trois mois.
matched_orders as (
  select o.id, o.customer_phone, o.customer_name, o.customer_city,
         o.total_price, o.product_id, o.assigned_to, o.status,
         (select max(oh.created_at) from order_history oh
           where oh.order_id = o.id
             and oh.status_to::text = o.status::text
             and oh.status_to::text = any(p.order_statuses)) as outcome_at
  from orders o, params p
  where o.market_id = p_market_id
    and o.status::text = any(p.order_statuses)
    and (p.product_ids is null or o.product_id = any(p.product_ids))
    and (p.cities is null or o.customer_city = any(p.cities))
    and (p.basket_min is null or o.total_price >= p.basket_min)
    and (p.agent_ids is null or o.assigned_to = any(p.agent_ids))
    and (p.rejection_reasons is null
         or o.rejection_reason::text = any(p.rejection_reasons))
    and exists (
      select 1 from order_history oh
      where oh.order_id = o.id
        and oh.status_to::text = o.status::text
        and oh.status_to::text = any(p.order_statuses)
        and (p.date_from is null or oh.created_at >= p.date_from)
        and (p.date_to is null or oh.created_at <= p.date_to)
    )
),
-- Une campagne s'adresse à des personnes, pas à des commandes : un client qui
-- a acheté trois fois ne doit être appelé qu'une fois.
customers as (
  select m.customer_phone,
         min(m.customer_name)  as customer_name,
         min(m.customer_city)  as customer_city,
         max(m.outcome_at)     as last_outcome_at,
         count(*)::int         as orders_in_scope,
         max(m.total_price)    as best_basket,
         (array_agg(m.id order by m.outcome_at desc nulls last))[1] as source_order_id
  from matched_orders m
  where m.customer_phone is not null and m.customer_phone <> ''
  group by m.customer_phone
),
-- L'historique complet du client sur ce marché, pour les conditions qui
-- parlent de lui plutôt que d'une commande.
history as (
  select o.customer_phone,
         (count(*) filter (where o.status = 'delivered'))::int as delivered,
         (count(*) filter (where o.status = 'returned'))::int  as returned,
         count(*)::int                                       as total_orders,
         max(o.created_at)                                   as last_order_at
  from orders o
  where o.market_id = p_market_id and o.customer_phone is not null
  group by o.customer_phone
),
filtered as (
  select c.*, h.delivered, h.returned, h.total_orders, h.last_order_at
  from customers c
  join history h on h.customer_phone = c.customer_phone, params p
  where
    -- Récence : il y a combien de jours la dernière commande retenue ?
    (p.recency_from is null or
       extract(epoch from (now() - c.last_outcome_at)) / 86400
         between p.recency_from and p.recency_to)
    -- Nombre de commandes du client, toutes issues confondues.
    and (p.count_op is null or
         case p.count_op
           when 'gte' then h.total_orders >= p.count_n
           when 'eq'  then h.total_orders =  p.count_n
           when 'lte' then h.total_orders <= p.count_n
           else true
         end)
    -- Historique de retours.
    and (p.returns_mode is null or
         case p.returns_mode
           when 'none' then h.returned = 0
           when 'any'  then h.returned > 0
           when 'rateAtMost' then
             h.total_orders = 0 or
             (h.returned::numeric / h.total_orders) * 100 <= p.returns_rate
           else true
         end)
),
-- Les garde-fous, comptés séparément pour que l'écran puisse les nommer.
-- L'ordre est celui de la maquette : chaque client n'est exclu qu'une fois,
-- par la première raison qui s'applique.
judged as (
  select f.*,
    case
      when exists (
        select 1 from leads l
        where l.market_id = p_market_id
          and l.customer_phone = f.customer_phone
          and l.status not in ('won', 'lost', 'archived')
      ) then 'openLead'
      when p.guard_ordered_days is not null and exists (
        select 1 from orders o
        where o.market_id = p_market_id
          and o.customer_phone = f.customer_phone
          and o.created_at > now() - make_interval(days => p.guard_ordered_days)
      ) then 'recentlyOrdered'
      when p.guard_campaign_days is not null and exists (
        select 1 from leads l
        where l.market_id = p_market_id
          and l.customer_phone = f.customer_phone
          and l.campaign_id is not null
          and l.created_at > now() - make_interval(days => p.guard_campaign_days)
      ) then 'recentCampaign'
      when p.guard_lost_ni and exists (
        select 1 from leads l
        where l.market_id = p_market_id
          and l.customer_phone = f.customer_phone
          and l.status = 'lost'
          and l.lost_reason = 'not_interested'
      ) then 'lostNotInterested'
      else null
    end as excluded_by
  from filtered f, params p
),
kept as (
  select j.* from judged j, params p
  where j.excluded_by is null
  order by
    case when p.limit_sort = 'newest' then j.last_outcome_at end desc nulls last,
    case when p.limit_sort = 'basket' then j.best_basket end desc nulls last,
    case when p.limit_sort = 'oldest' then j.last_outcome_at end asc nulls last
  limit (select coalesce(limit_n, 100000) from params)
)
select jsonb_build_object(
  'matched', (select count(*) from judged),
  'excluded', jsonb_build_object(
    'openLead',          (select count(*) from judged where excluded_by = 'openLead'),
    'recentlyOrdered',   (select count(*) from judged where excluded_by = 'recentlyOrdered'),
    'recentCampaign',    (select count(*) from judged where excluded_by = 'recentCampaign'),
    'lostNotInterested', (select count(*) from judged where excluded_by = 'lostNotInterested')
  ),
  'net', (select count(*) from kept),
  -- De vraies personnes, pour que le manager reconnaisse qui il s'apprête à
  -- faire appeler. Le téléphone est tronqué : cet aperçu n'est pas un export.
  'sample', coalesce((
    select jsonb_agg(s) from (
      select jsonb_build_object(
        'name', k.customer_name,
        'phone', left(k.customer_phone, 4) || '****',
        'city', k.customer_city,
        'lastOrderDays', greatest(0, round(extract(epoch from (now() - k.last_outcome_at)) / 86400))::int,
        'delivered', k.delivered
      ) as s
      from kept k limit 4
    ) t
  ), '[]'::jsonb)
);
$$;

comment on function public.preview_campaign_audience(uuid, jsonb) is
  'Compte audience de campagne et ventile les exclusions. Meme definition que rpc_run_prospect_campaign. Voir plans/prospects-manager-console.md.';

grant execute on function public.preview_campaign_audience(uuid, jsonb) to authenticated;
