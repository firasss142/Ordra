-- Per-option counts for the orders facet bar.
--
-- The bar named every filter but said nothing about what picking one would
-- yield, so narrowing a list meant guessing and backing out. Each option now
-- carries the number of orders it would return.
--
-- Faceting rule: a dimension's counts are computed with every OTHER filter
-- applied but NOT its own. Counting the status options while the status filter
-- is active would report the selection back to itself — every unselected status
-- would read 0, which is worse than no number at all.
--
-- One pass over the filtered set. Each row carries a boolean per dimension
-- saying whether it passes that dimension's filter, and each aggregate then
-- counts under the other four. Five separate scans would return the same
-- numbers for five times the work.
--
-- SECURITY INVOKER (the default) is deliberate: market isolation is enforced by
-- RLS on `orders`, and a definer function here would hand a market manager a
-- count of the other market's orders.

create or replace function get_order_facet_counts(
  p_market_id uuid default null,
  p_preset text default 'all',
  p_statuses text[] default null,
  p_agent_id text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_product_id uuid default null,
  p_city text default null,
  p_total_min numeric default null,
  p_total_max numeric default null,
  p_rejection_reason text default null,
  p_carrier_id uuid default null,
  p_include_deleted boolean default false,
  p_search_legs jsonb default null
)
returns jsonb
language sql
stable
as $$
with base as (
  select
    o.status::text                          as status,
    o.assigned_to,
    o.customer_city,
    o.product_id,
    o.carrier_id,
    -- Per-dimension membership. Each is "does this row pass THAT filter",
    -- evaluated independently so an aggregate can leave its own one out.
    (p_statuses is null or array_length(p_statuses, 1) is null
       or o.status::text = any(p_statuses))                       as m_status,
    (p_agent_id is null
       or (p_agent_id = 'unassigned' and o.assigned_to is null)
       or (p_agent_id <> 'unassigned' and o.assigned_to::text = p_agent_id)) as m_agent,
    (p_city is null or p_city = ''
       or o.customer_city ilike '%' || p_city || '%')             as m_city,
    (p_product_id is null or o.product_id = p_product_id)         as m_product,
    (p_carrier_id is null or o.carrier_id = p_carrier_id)         as m_carrier
  from orders o
  where
    (p_market_id is null or o.market_id = p_market_id)
    -- Working-list scope, mirroring /api/orders/list: archived orders drop out,
    -- and the soft-deleted slice is a deliberate toggle rather than a default.
    and o.archived_at is null
    and (
      case when coalesce(p_include_deleted, false)
        then o.status::text = 'deleted'
        else o.status::text <> 'deleted'
      end
    )
    -- Presets
    and (
      p_preset is null or p_preset = 'all'
      or (p_preset = 'unassigned' and o.status::text = 'pending' and o.assigned_to is null)
      or (p_preset = 'callbacks' and o.status::text = 'callback_scheduled'
          and o.callback_scheduled_at <= now())
      or (p_preset = 'today' and o.created_at >= date_trunc('day', now() at time zone 'UTC'))
      or (p_preset = 'in_delivery' and o.status::text = any(
            array['uploaded','dispatched','deposit','in_transit','to_be_returned']))
    )
    -- Dated by created_at with an inclusive upper bound, exactly as the list
    -- route bounds it. A different basis here would put a number on an option
    -- that the table cannot reproduce.
    and (p_date_from is null or o.created_at >= p_date_from::timestamptz)
    and (p_date_to is null or o.created_at < (p_date_to + 1)::timestamptz)
    and (p_total_min is null or o.total_price >= p_total_min)
    and (p_total_max is null or o.total_price <= p_total_max)
    and (p_rejection_reason is null or o.rejection_reason::text = p_rejection_reason)
    -- Search: terms AND, legs within a term OR — the contract parseSearch
    -- promises. Expressed as "no term fails to match", which keeps the SQL
    -- static; the parsing itself stays in lib/orders/search-query so the list
    -- and the facet counts cannot drift apart on what a query means.
    and (
      p_search_legs is null
      or not exists (
        select 1
        from jsonb_array_elements(p_search_legs) as term
        where not exists (
          select 1
          from jsonb_array_elements(term) as leg
          where coalesce(
            case leg->>'c'
              when 'customer_name'    then o.customer_name
              when 'customer_phone'   then o.customer_phone
              when 'customer_phone_2' then o.customer_phone_2
              when 'customer_city'    then o.customer_city
              when 'customer_address' then o.customer_address
              when 'product_name'     then o.product_name
              when 'external_id'      then o.external_id
              when 'tracking_number'  then o.tracking_number
            end, ''
          ) ilike '%' || (leg->>'v') || '%'
        )
      )
    )
)
select jsonb_build_object(
  'statuses', coalesce((
    select jsonb_object_agg(status, n)
    from (
      select status, count(*) as n
      from base
      where m_agent and m_city and m_product and m_carrier
      group by status
    ) s
  ), '{}'::jsonb),
  'agents', coalesce((
    select jsonb_object_agg(k, n)
    from (
      select coalesce(assigned_to::text, 'unassigned') as k, count(*) as n
      from base
      where m_status and m_city and m_product and m_carrier
      group by 1
    ) a
  ), '{}'::jsonb),
  'cities', coalesce((
    select jsonb_object_agg(customer_city, n)
    from (
      select customer_city, count(*) as n
      from base
      where m_status and m_agent and m_product and m_carrier
        and customer_city is not null and customer_city <> ''
      group by customer_city
    ) c
  ), '{}'::jsonb),
  'products', coalesce((
    select jsonb_object_agg(product_id::text, n)
    from (
      select product_id, count(*) as n
      from base
      where m_status and m_agent and m_city and m_carrier
        and product_id is not null
      group by product_id
    ) p
  ), '{}'::jsonb),
  'carriers', coalesce((
    select jsonb_object_agg(carrier_id::text, n)
    from (
      select carrier_id, count(*) as n
      from base
      where m_status and m_agent and m_city and m_product
        and carrier_id is not null
      group by carrier_id
    ) r
  ), '{}'::jsonb)
);
$$;

comment on function get_order_facet_counts is
  'Per-option counts for the orders facet bar. Each dimension is counted with '
  'every other filter applied but not its own, so an option reads as "what you '
  'would get if you picked this".';

grant execute on function get_order_facet_counts to authenticated;
