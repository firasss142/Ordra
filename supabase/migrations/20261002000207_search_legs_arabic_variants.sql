-- Search: spelling variants (Arabic letters, Latin accents) in the facet counts.
--
-- The same customer is written more than one way. On the Libyan orders
-- (2026-10-01) 278 names carry a hamza alef, 349 a ta marbuta, 231 an alef
-- maqsura, and 22 customers exist under both spellings. `ilike '%احمد%'` found
-- 237 orders where the customer had 298; فاطمة found 18 of 34. In Tunisia 22
-- names and 535 addresses carry an accent; `ilike '%hela%'` misses « Hèla ».
--
-- lib/orders/search-query now turns such a term into a regex in which each
-- letter group matches any of its members (`[اأإآ]حمد`, `h[eéèêë]l[aàâäá]`).
-- The orders list sends it to PostgREST as `imatch`; this function receives the
-- same term as a leg `{c, v, op: "imatch"}` and must read it the same way, or a
-- facet option's count would disagree with the rows the search returns.
--
-- A leg without `op` is matched exactly as before (ILIKE '%v%'), so this can be
-- applied ahead of the code that sends `op`. Measured: the regex uses the same
-- trigram indexes — 2.7 ms over Libya for `[اأإآ]حمد`, 4.9 ms over Tunisia for
-- `h[eéèêë]l[aàâäá]`.
--
-- CREATE OR REPLACE with the identical signature: the ACL is kept (a DROP would
-- reset it). Body = the live definition read with pg_get_functiondef on
-- 2026-10-01, changed only in the search block.

create or replace function public.get_order_facet_counts(
  p_market_id uuid default null,
  p_preset text default 'all',
  p_statuses text[] default null,
  p_agent_id text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_product_id uuid default null,
  p_city text default null,
  p_total_min numeric default null,
  p_total_max numeric default null,
  p_rejection_reason text default null,
  p_carrier_id uuid default null,
  p_include_deleted boolean default false,
  p_search_legs jsonb default null,
  p_tz text default 'UTC'
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
    and o.archived_at is null
    and (
      case when coalesce(p_include_deleted, false)
        then o.status::text = 'deleted'
        else o.status::text <> 'deleted'
      end
    )
    -- Presets. `today` is the market's calendar day (p_tz), the same boundary
    -- /api/orders/list draws, so the badge and the table count the same rows.
    and (
      p_preset is null or p_preset = 'all'
      or (p_preset = 'unassigned' and o.status::text = 'pending' and o.assigned_to is null)
      or (p_preset = 'callbacks' and o.status::text = 'callback_scheduled'
          and o.callback_scheduled_at <= now())
      or (p_preset = 'today'
          and o.created_at >= date_trunc('day', now() at time zone p_tz) at time zone p_tz)
      or (p_preset = 'in_delivery' and o.status::text = any(
            array['uploaded','dispatched','deposit','in_transit','to_be_returned']))
    )
    -- The window arrives as UTC instants already cut at the market's day edges
    -- (lib/dates/market-day), inclusive on both ends exactly as the list route
    -- bounds it.
    and (p_date_from is null or o.created_at >= p_date_from)
    and (p_date_to is null or o.created_at <= p_date_to)
    and (p_total_min is null or o.total_price >= p_total_min)
    and (p_total_max is null or o.total_price <= p_total_max)
    and (p_rejection_reason is null or o.rejection_reason::text = p_rejection_reason)
    -- Search: terms AND, legs within a term OR. A leg is ILIKE '%v%', or the
    -- case-insensitive regex v when op = 'imatch' (an Arabic term).
    and (
      p_search_legs is null
      or not exists (
        select 1
        from jsonb_array_elements(p_search_legs) as term
        where not exists (
          select 1
          from jsonb_array_elements(term) as leg
          cross join lateral (
            select coalesce(
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
            ) as val
          ) f
          where case when leg->>'op' = 'imatch'
                  then f.val ~* (leg->>'v')
                  else f.val ilike '%' || (leg->>'v') || '%'
                end
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
