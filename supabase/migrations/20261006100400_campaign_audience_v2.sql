-- ============================================================
-- 20261006100400_campaign_audience_v2.sql
--
-- « Nouvelle liste » (plans/prospects-recovery.md, round 3–4) — l'audience
-- d'une liste gagne trois clés de filter_json, sans changer le sens d'aucune
-- clé existante (les campagnes déjà lancées se recalculent à l'identique) :
--
--   rejection_subreasons : text[]  — orders.rejection_subreason ∈ liste
--                                    (les sous-motifs configurables ; la clé
--                                    rejection_reasons garde les GROUPES).
--   product_windows      : [{product_id, from, to}] — chaque produit peut porter
--                          ses propres dates : une commande de ce produit ne
--                          compte que si sa transition vers l'issue tombe dans
--                          SA fenêtre (from / to absents = ouverts). Un produit
--                          sans fenêtre garde date_from / date_to. Les produits
--                          nommés ici s'ajoutent à product_ids (s'il est absent,
--                          ce sont eux qui forment la liste des produits).
--   guards.no_order_after_outcome : boolean — exclut (excluded_by =
--                          'recentlyOrdered', le compteur que l'aperçu affiche
--                          déjà) le client qui a passé N'IMPORTE QUELLE commande
--                          sur le marché après sa dernière issue retenue
--                          (last_outcome_at). Le commutateur « Seulement ceux qui
--                          n'ont pas recommandé ».
--
-- order_statuses compare en texte : 'returning' et 'to_be_returned' marchent
-- déjà (testé dans supabase/tests/prospect_recovery_test.sql).
--
-- Et une colonne : prospect_campaigns.offer_product_ids — une liste peut
-- proposer UN OU PLUSIEURS produits. Additive ; les droits de table et la
-- politique d'insertion des managers la couvrent déjà.
-- ============================================================

ALTER TABLE public.prospect_campaigns
  ADD COLUMN IF NOT EXISTS offer_product_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.prospect_campaigns.offer_product_ids IS
  'Produits proposés par la liste (un ou plusieurs). Lu côté TypeScript pour montrer à l''agent quoi proposer.';

CREATE OR REPLACE FUNCTION public.campaign_audience_rows(p_market_id uuid, p_filter jsonb)
 RETURNS TABLE(customer_phone text, customer_name text, customer_city text, customer_address text, source_order_id uuid, last_outcome_at timestamp with time zone, best_basket numeric, delivered integer, returned integer, total_orders integer, excluded_by text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with windows as (
  -- Une fenêtre par produit ; la dernière l'emporte si un produit est nommé deux fois.
  select distinct on ((w->>'product_id')::uuid)
         (w->>'product_id')::uuid           as product_id,
         nullif(w->>'from', '')::timestamptz as w_from,
         nullif(w->>'to', '')::timestamptz   as w_to
  from jsonb_array_elements(
         case when jsonb_typeof(p_filter->'product_windows') = 'array'
              then p_filter->'product_windows' else '[]'::jsonb end
       ) with ordinality as t(w, n)
  where w->>'product_id' is not null
  order by (w->>'product_id')::uuid, n desc
),
params as (
  select
    coalesce(
      (select array_agg(x) from jsonb_array_elements_text(p_filter->'order_statuses') as x),
      array['delivered']
    )                                                        as order_statuses,
    (p_filter->>'date_from')::timestamptz                    as date_from,
    (p_filter->>'date_to')::timestamptz                      as date_to,
    -- Le composeur ecrit product_ids ; les campagnes d'avant portent product_id.
    -- Les produits a fenetre s'y ajoutent.
    (select case when base is null and win is null then null
                 else array(select distinct u from unnest(coalesce(base, '{}') || coalesce(win, '{}')) u)
            end
       from (select
               coalesce(
                 (select array_agg(x::uuid) from jsonb_array_elements_text(p_filter->'product_ids') as x),
                 case when p_filter->>'product_id' is not null
                      then array[(p_filter->>'product_id')::uuid] end
               ) as base,
               (select array_agg(product_id) from windows) as win
            ) s
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
    (select array_agg(x) from jsonb_array_elements_text(p_filter->'rejection_subreasons') as x)
                                                             as rejection_subreasons,
    (select array_agg(x::uuid) from jsonb_array_elements_text(p_filter->'agent_ids') as x)
                                                             as agent_ids,
    (p_filter->'guards'->>'not_ordered_days')::int           as guard_ordered_days,
    (p_filter->'guards'->>'not_in_campaign_days')::int       as guard_campaign_days,
    coalesce((p_filter->'guards'->>'not_lost_not_interested')::boolean, false)
                                                             as guard_lost_ni,
    coalesce((p_filter->'guards'->>'no_order_after_outcome')::boolean, false)
                                                             as guard_no_order_after,
    coalesce((p_filter->'limit'->>'sort'), 'oldest')         as limit_sort,
    (p_filter->'limit'->>'n')::int                           as limit_n
),
-- Les commandes qui portent l'issue voulue, datees par la transition vers
-- cette issue et non par leur creation : une commande livree hier peut avoir
-- ete passee il y a trois mois. Un produit a fenetre se date dans SA fenetre.
matched_orders as (
  select o.id, o.customer_phone, o.customer_name, o.customer_city, o.customer_address,
         o.total_price, o.product_id, o.assigned_to, o.status,
         (select max(oh.created_at) from order_history oh
           where oh.order_id = o.id
             and oh.status_to::text = o.status::text
             and oh.status_to::text = any(p.order_statuses)) as outcome_at
  from orders o
  cross join params p
  left join windows w on w.product_id = o.product_id
  where o.market_id = p_market_id
    and o.status::text = any(p.order_statuses)
    and (p.product_ids is null or o.product_id = any(p.product_ids))
    and (p.cities is null or o.customer_city = any(p.cities))
    and (p.basket_min is null or o.total_price >= p.basket_min)
    and (p.agent_ids is null or o.assigned_to = any(p.agent_ids))
    and (p.rejection_reasons is null
         or o.rejection_reason::text = any(p.rejection_reasons))
    and (p.rejection_subreasons is null
         or o.rejection_subreason = any(p.rejection_subreasons))
    and exists (
      select 1 from order_history oh
      where oh.order_id = o.id
        and oh.status_to::text = o.status::text
        and oh.status_to::text = any(p.order_statuses)
        and ((case when w.product_id is not null then w.w_from else p.date_from end) is null
             or oh.created_at >= (case when w.product_id is not null then w.w_from else p.date_from end))
        and ((case when w.product_id is not null then w.w_to else p.date_to end) is null
             or oh.created_at <= (case when w.product_id is not null then w.w_to else p.date_to end))
    )
),
-- Une campagne s'adresse a des personnes, pas a des commandes : un client qui
-- a achete trois fois ne doit etre appele qu'une fois.
grouped as (
  select m.customer_phone,
         min(m.customer_name)    as customer_name,
         min(m.customer_city)    as customer_city,
         min(m.customer_address) as customer_address,
         max(m.outcome_at)       as last_outcome_at,
         max(m.total_price)      as best_basket,
         (array_agg(m.id order by m.outcome_at desc nulls last))[1] as source_order_id
  from matched_orders m
  where m.customer_phone is not null and m.customer_phone <> ''
  group by m.customer_phone
),
-- L'historique complet du client sur ce marche, pour les conditions qui
-- parlent de lui plutot que d'une commande.
history as (
  select o.customer_phone,
         (count(*) filter (where o.status = 'delivered'))::int as delivered,
         (count(*) filter (where o.status = 'returned'))::int  as returned,
         count(*)::int                                         as total_orders
  from orders o
  where o.market_id = p_market_id and o.customer_phone is not null
  group by o.customer_phone
),
filtered as (
  select g.*, h.delivered, h.returned, h.total_orders
  from grouped g
  join history h on h.customer_phone = g.customer_phone, params p
  where
    -- Recence : il y a combien de jours la derniere commande retenue ?
    (p.recency_from is null or
       extract(epoch from (now() - g.last_outcome_at)) / 86400
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
-- Les garde-fous, evalues dans l'ordre de la maquette : chaque client n'est
-- ecarte qu'une fois, par la premiere raison qui s'applique.
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
      -- A recommande apres sa derniere issue retenue : meme compteur.
      when p.guard_no_order_after and f.last_outcome_at is not null and exists (
        select 1 from orders o
        where o.market_id = p_market_id
          and o.customer_phone = f.customer_phone
          and o.created_at > f.last_outcome_at
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
ranked as (
  select j.*,
         row_number() over (
           order by
             case when p.limit_sort = 'newest' then j.last_outcome_at end desc nulls last,
             case when p.limit_sort = 'basket' then j.best_basket end desc nulls last,
             case when p.limit_sort = 'oldest' then j.last_outcome_at end asc nulls last
         ) as rn
  from judged j, params p
  where j.excluded_by is null
)
-- Les exclus sont renvoyes eux aussi, avec leur motif : l'apercu les compte,
-- l'execution les ignore en filtrant sur excluded_by is null.
select customer_phone, customer_name, customer_city, customer_address,
       source_order_id, last_outcome_at, best_basket,
       delivered, returned, total_orders, excluded_by
from judged
where excluded_by is not null
union all
select r.customer_phone, r.customer_name, r.customer_city, r.customer_address,
       r.source_order_id, r.last_outcome_at, r.best_basket,
       r.delivered, r.returned, r.total_orders, null::text
from ranked r, params p
where r.rn <= coalesce(p.limit_n, 100000);
$function$;

-- INVOKER (sous RLS) : anon n'a rien à y faire.
REVOKE EXECUTE ON FUNCTION public.campaign_audience_rows(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.preview_campaign_audience(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_audience_rows(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_campaign_audience(uuid, jsonb) TO authenticated, service_role;
