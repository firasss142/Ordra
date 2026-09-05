-- Date filters cut the day where the market does, not at UTC midnight.
--
-- orders.created_at is UTC. Libya trades at UTC+2, Tunisia at UTC+1, and every
-- daily figure in the OMS is read in the market's own day. Both RPCs below took
-- calendar dates and cast them at UTC midnight, so "4 September" started two
-- hours early in Tripoli and every order placed between 22:00 and midnight was
-- counted on the following day. Reconciling the Converty export for 4–5
-- September: 86 orders by local day, 88 by UTC day — two correct systems
-- disagreeing over where midnight is. The routes now draw the boundary in
-- lib/dates/market-day and the SQL follows the same rule.
--
-- Both functions change signature, so the old ones are dropped first: PostgREST
-- resolves RPCs by name and cannot pick between two overloads. p_tz defaults to
-- 'UTC', so a caller that predates this migration keeps its old behaviour.

-- ---------------------------------------------------------------------------
-- get_order_facet_counts: the window arrives as UTC instants (inclusive), and
-- the `today` preset is cut in the market's zone.
-- ---------------------------------------------------------------------------
drop function if exists public.get_order_facet_counts(
  uuid, text, text[], text, date, date, uuid, text, numeric, numeric, text, uuid, boolean, jsonb
);

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
    -- bounds it. Taking calendar dates here and casting them cut the day at UTC
    -- midnight — two hours early for Libya — so an option's count and the table
    -- it opened disagreed on every late-evening order.
    and (p_date_from is null or o.created_at >= p_date_from)
    and (p_date_to is null or o.created_at <= p_date_to)
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

comment on function public.get_order_facet_counts is
  'Per-option counts for the orders facet bar. Each dimension is counted with '
  'every other filter applied but not its own, so an option reads as "what you '
  'would get if you picked this". The date window is UTC instants already cut '
  'at the market''s day edges; p_tz names the market zone for the today preset.';

grant execute on function public.get_order_facet_counts to authenticated;

-- ---------------------------------------------------------------------------
-- get_dashboard_health: every "AT TIME ZONE 'UTC'" becomes the market zone.
-- p_from/p_to stay calendar dates — the caller already names them in the
-- market's day — and p_tz says where those days start and end. The trend chart
-- buckets by the same zone, so a day on the axis is the day the team lived.
-- Body otherwise identical to the live definition (savings, daily uploaded,
-- funnel-from-uploaded all included).
-- ---------------------------------------------------------------------------
drop function if exists public.get_dashboard_health(
  uuid, date, date, date, date, date, date, date
);

create or replace function public.get_dashboard_health(
  p_market_id uuid,
  p_from date,
  p_to date,
  p_prev_from date,
  p_prev_to date,
  p_trend_from date,
  p_trend_to date,
  p_carrier_from date,
  p_tz text default 'UTC'
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
DECLARE
  v_caller_role   TEXT;
  v_caller_market UUID;
  v_scope_market  UUID;

  v_from      TIMESTAMPTZ := (p_from)::timestamp AT TIME ZONE p_tz;
  v_to        TIMESTAMPTZ := (p_to + 1)::timestamp AT TIME ZONE p_tz;
  v_prev_from TIMESTAMPTZ := (p_prev_from)::timestamp AT TIME ZONE p_tz;
  v_prev_to   TIMESTAMPTZ := (p_prev_to + 1)::timestamp AT TIME ZONE p_tz;
  v_win_from  TIMESTAMPTZ := LEAST((p_from)::timestamp AT TIME ZONE p_tz,
                                   (p_prev_from)::timestamp AT TIME ZONE p_tz);
  v_win_to    TIMESTAMPTZ := GREATEST((p_to + 1)::timestamp AT TIME ZONE p_tz,
                                      (p_prev_to + 1)::timestamp AT TIME ZONE p_tz);
  v_carrier_from TIMESTAMPTZ := (p_carrier_from)::timestamp AT TIME ZONE p_tz;

  v_today_from TIMESTAMPTZ := date_trunc('day', now() AT TIME ZONE p_tz) AT TIME ZONE p_tz;
  v_7d_from    TIMESTAMPTZ := date_trunc('day', now() AT TIME ZONE p_tz) AT TIME ZONE p_tz
                              - interval '7 days';

  v_result JSONB;
BEGIN
  v_caller_role   := get_user_role();
  v_caller_market := get_user_market_id();

  IF v_caller_role IS DISTINCT FROM 'super_admin' THEN
    IF p_market_id IS NOT NULL AND p_market_id IS DISTINCT FROM v_caller_market THEN
      RETURN '{}'::jsonb;
    END IF;
    v_scope_market := v_caller_market;
  ELSE
    v_scope_market := p_market_id;
  END IF;

  WITH
  hist AS (
    SELECT
      h.status_to, h.order_id, o.market_id, o.total_price, o.quantity,
      o.product_id, o.carrier_id, pr.unit_cogs, pr.packing_cost,
      occ.effective_delivery_fee AS delivery_fee, occ.effective_return_fee AS return_fee,
      (h.created_at >= v_from      AND h.created_at < v_to)      AS is_cur,
      (h.created_at >= v_prev_from AND h.created_at < v_prev_to) AS is_prev
    FROM order_history h
    JOIN orders    o  ON o.id = h.order_id
    LEFT JOIN products pr ON pr.id = o.product_id
    LEFT JOIN order_carrier_cost occ ON occ.order_id = o.id
    WHERE (v_scope_market IS NULL OR h.market_id = v_scope_market)
      AND h.status_to IN ('delivered', 'returned', 'confirmed')
      AND h.created_at >= v_win_from
      AND h.created_at <  v_win_to
  ),
  money AS (
    SELECT
      COALESCE(SUM(total_price)          FILTER (WHERE status_to = 'delivered' AND is_cur),  0) AS rev_cur,
      COALESCE(SUM(total_price)          FILTER (WHERE status_to = 'delivered' AND is_prev), 0) AS rev_prev,
      COALESCE(SUM(unit_cogs * quantity) FILTER (WHERE status_to = 'delivered' AND is_cur  AND product_id IS NOT NULL), 0) AS cogs_cur,
      COALESCE(SUM(unit_cogs * quantity) FILTER (WHERE status_to = 'delivered' AND is_prev AND product_id IS NOT NULL), 0) AS cogs_prev,
      COALESCE(SUM(delivery_fee)         FILTER (WHERE status_to = 'delivered' AND is_cur  AND carrier_id IS NOT NULL), 0) AS del_cur,
      COALESCE(SUM(delivery_fee)         FILTER (WHERE status_to = 'delivered' AND is_prev AND carrier_id IS NOT NULL), 0) AS del_prev,
      COALESCE(SUM(return_fee)           FILTER (WHERE status_to = 'returned'  AND is_cur  AND carrier_id IS NOT NULL), 0) AS ret_cur,
      COALESCE(SUM(return_fee)           FILTER (WHERE status_to = 'returned'  AND is_prev AND carrier_id IS NOT NULL), 0) AS ret_prev,
      COALESCE(SUM(packing_cost)         FILTER (WHERE status_to = 'confirmed' AND is_cur  AND product_id IS NOT NULL), 0) AS pack_cur,
      COALESCE(SUM(packing_cost)         FILTER (WHERE status_to = 'confirmed' AND is_prev AND product_id IS NOT NULL), 0) AS pack_prev
    FROM hist
  ),
  ad AS (
    SELECT
      COALESCE(SUM(a.amount), 0) AS amount,
      COALESCE((
        SELECT COUNT(DISTINCT d)::int
        FROM ad_spend a2
        CROSS JOIN LATERAL generate_series(GREATEST(a2.period_start, p_from),
                                           LEAST(a2.period_end, p_to),
                                           interval '1 day') AS d
        WHERE (v_scope_market IS NULL OR a2.market_id = v_scope_market)
          AND a2.is_active AND a2.period_start <= p_to AND a2.period_end >= p_from
      ), 0) AS days_covered
    FROM ad_spend a
    WHERE (v_scope_market IS NULL OR a.market_id = v_scope_market)
      AND a.is_active AND a.period_start <= p_to AND a.period_end >= p_from
  ),
  cohort AS (
    SELECT
      o.market_id,
      (o.created_at >= v_from      AND o.created_at < v_to)      AS is_cur,
      (o.created_at >= v_prev_from AND o.created_at < v_prev_to) AS is_prev,
      o.status
    FROM orders o
    WHERE (v_scope_market IS NULL OR o.market_id = v_scope_market)
      AND o.created_at >= v_win_from
      AND o.created_at <  v_win_to
  ),
  funnel AS (
    SELECT
      COUNT(*) FILTER (WHERE is_cur)  AS leads_cur,
      COUNT(*) FILTER (WHERE is_prev) AS leads_prev,
      COUNT(*) FILTER (WHERE is_cur  AND status IN (
        'uploaded','scanned','dispatched','deposit',
        'in_transit','unverified','to_be_returned','received','delivered','returned'
      )) AS confirmed_cur,
      COUNT(*) FILTER (WHERE is_prev AND status IN (
        'uploaded','scanned','dispatched','deposit',
        'in_transit','unverified','to_be_returned','received','delivered','returned'
      )) AS confirmed_prev,
      COUNT(*) FILTER (WHERE is_cur  AND status = 'delivered') AS delivered_cur,
      COUNT(*) FILTER (WHERE is_prev AND status = 'delivered') AS delivered_prev,
      COUNT(*) FILTER (WHERE is_cur  AND status = 'returned')  AS returned_cur,
      COUNT(*) FILTER (WHERE is_prev AND status = 'returned')  AS returned_prev,
      COUNT(*) FILTER (WHERE is_cur  AND status = 'rejected')  AS rejected_cur,
      COUNT(*) FILTER (WHERE is_prev AND status = 'rejected')  AS rejected_prev
    FROM cohort
  ),

  today_orders AS (
    SELECT
      COUNT(*) FILTER (WHERE o.created_at >= v_today_from) AS received_today,
      COUNT(*) FILTER (WHERE o.created_at >= v_7d_from)    AS received_7d
    FROM orders o
    WHERE (v_scope_market IS NULL OR o.market_id = v_scope_market)
      AND o.created_at >= v_7d_from
  ),
  today_events AS (
    SELECT
      COUNT(*) FILTER (WHERE h.status_to = 'confirmed' AND h.created_at >= v_today_from) AS confirmed_today,
      COUNT(*) FILTER (WHERE h.status_to = 'delivered' AND h.created_at >= v_today_from) AS delivered_today,
      COUNT(*) FILTER (WHERE h.status_to = 'confirmed')                                  AS confirmed_7d
    FROM order_history h
    WHERE (v_scope_market IS NULL OR h.market_id = v_scope_market)
      AND h.status_to IN ('confirmed','delivered')
      AND h.created_at >= v_7d_from
  ),

  committed AS (
    SELECT
      COALESCE(SUM(o.total_price), 0) AS value,
      COUNT(*)                        AS count
    FROM orders o
    WHERE (v_scope_market IS NULL OR o.market_id = v_scope_market)
      AND o.status IN ('confirmed','dispatch_scheduled','uploaded','scanned',
                       'dispatched','deposit','in_transit','unverified')
  ),

  -- ---------- DELIVERY-ROUTING SAVINGS ----------
  -- What choosing the cheaper carrier account has earned. Snapshotted per order
  -- at dispatch into orders.delivery_saving_lyd:
  --     saving = cheapest account NOT used - account actually used
  -- Positive = routed cheaper, negative = the agent overrode the badge and
  -- overpaid, zero = a measured tie. Net, so overrides genuinely subtract.
  --
  -- NULL rows are NOT MEASURED and are excluded: non-Darb carriers, destinations
  -- never quoted for one account, and everything dispatched before the feature
  -- shipped. That exclusion is the point - the counter answers "what has choosing
  -- the cheapest earned us SINCE we started choosing".
  --
  -- `total` deliberately ignores p_from/p_to and is all-time, like `committed`.
  savings AS (
    SELECT
      COALESCE(SUM(o.delivery_saving_lyd), 0)                        AS total,
      COUNT(*)                                                       AS count,
      COUNT(*) FILTER (WHERE o.delivery_saving_lyd > 0)              AS wins,
      COUNT(*) FILTER (WHERE o.delivery_saving_lyd < 0)              AS losses,
      COALESCE(SUM(o.delivery_saving_lyd)
        FILTER (WHERE o.delivery_saving_at >= v_from
                  AND o.delivery_saving_at <  v_to), 0)              AS period_total,
      COUNT(*) FILTER (WHERE o.delivery_saving_at >= v_from
                         AND o.delivery_saving_at <  v_to)           AS period_count
    FROM orders o
    WHERE (v_scope_market IS NULL OR o.market_id = v_scope_market)
      AND o.delivery_saving_lyd IS NOT NULL
  ),

  daily AS (
    SELECT
      d::date AS day,
      COUNT(o.id) FILTER (WHERE o.status = 'delivered') AS delivered,
      COUNT(o.id) FILTER (WHERE o.status = 'returned')  AS returned,
      COUNT(o.id) FILTER (WHERE o.status = 'rejected')  AS rejected,
      COUNT(o.id) FILTER (WHERE o.status NOT IN
        ('delivered','returned','rejected','cancelled','deleted')) AS open,
      COUNT(o.id) AS intake,
      COALESCE(SUM(o.total_price) FILTER (WHERE o.status = 'delivered'), 0) AS revenue
    FROM generate_series(p_trend_from, p_trend_to, interval '1 day') d
    LEFT JOIN orders o
      ON  o.created_at >= (d)::timestamp AT TIME ZONE p_tz
      AND o.created_at <  (d + interval '1 day')::timestamp AT TIME ZONE p_tz
      AND (v_scope_market IS NULL OR o.market_id = v_scope_market)
    GROUP BY d
  ),
  daily_conf AS (
    SELECT (h.created_at AT TIME ZONE p_tz)::date AS day,
      COUNT(*) FILTER (WHERE h.status_to = 'confirmed') AS confirmed,
      COUNT(*) FILTER (WHERE h.status_to = 'uploaded')  AS uploaded
    FROM order_history h
    WHERE (v_scope_market IS NULL OR h.market_id = v_scope_market)
      AND h.status_to IN ('confirmed', 'uploaded')
      AND h.created_at >= (p_trend_from)::timestamp AT TIME ZONE p_tz
      AND h.created_at <  (p_trend_to + 1)::timestamp AT TIME ZONE p_tz
    GROUP BY 1
  ),

  queues AS (
    SELECT
      b.bucket, b.ord,
      COUNT(o.id) AS count,
      MAX(EXTRACT(EPOCH FROM (now() - o.created_at)) / 3600.0) AS oldest_hours,
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (now() - o.created_at)) / 3600.0) AS median_hours
    FROM (VALUES
      ('new', 1), ('assigned', 2), ('attempts', 3),
      ('callback', 4), ('confirmed', 5), ('uploaded', 6)
    ) AS b(bucket, ord)
    LEFT JOIN orders o
      ON (v_scope_market IS NULL OR o.market_id = v_scope_market)
     AND CASE b.bucket
           WHEN 'new'       THEN o.status IN ('pending','new','assigned') AND o.assigned_to IS NULL
           WHEN 'assigned'  THEN o.status IN ('pending','new','assigned') AND o.assigned_to IS NOT NULL
           WHEN 'attempts'  THEN o.status IN ('attempt_1','attempt_2','attempt_3')
           WHEN 'callback'  THEN o.status = 'callback_scheduled'
           WHEN 'confirmed' THEN o.status IN ('confirmed','dispatch_scheduled')
           WHEN 'uploaded'  THEN o.status IN ('uploaded','scanned')
         END
    GROUP BY b.bucket, b.ord
  ),
  flow AS (
    SELECT
      (SELECT COUNT(*) FROM cohort WHERE is_cur) AS intake,
      (SELECT COUNT(*) FROM hist WHERE status_to = 'confirmed' AND is_cur) AS confirmed
  ),

  -- ---------- CARRIERS over the wider p_carrier_from window ----------
  -- return_fee rides along so the app can charge failed deliveries against the
  -- successful ones. Cost model: a returned order costs return_fee ONLY, never
  -- delivery_fee + return_fee — the rule already set by docs/business-logic.md,
  -- lib/calculations/business-profitability.ts and markets_money below.
  hist_carrier AS (
    SELECT h.status_to, h.order_id, o.carrier_id, c.name,
           occ.effective_delivery_fee AS delivery_fee,
           occ.effective_return_fee   AS return_fee
    FROM order_history h
    JOIN orders   o ON o.id = h.order_id
    JOIN carriers c ON c.id = o.carrier_id
    JOIN order_carrier_cost occ ON occ.order_id = o.id
    WHERE (v_scope_market IS NULL OR h.market_id = v_scope_market)
      AND h.status_to IN ('delivered','returned')
      AND h.created_at >= v_carrier_from
      AND h.created_at <  v_to
  ),
  delivered_orders AS (
    SELECT DISTINCT order_id FROM hist_carrier WHERE status_to = 'delivered'
  ),
  transit AS (
    SELECT
      oh.order_id,
      EXTRACT(EPOCH FROM (
        MIN(oh.created_at) FILTER (WHERE oh.status_to = 'delivered')
        - MIN(oh.created_at) FILTER (WHERE oh.status_to IN ('dispatched','uploaded'))
      )) / 86400.0 AS days
    FROM order_history oh
    JOIN delivered_orders d ON d.order_id = oh.order_id
    WHERE oh.status_to IN ('dispatched','uploaded','delivered')
    GROUP BY oh.order_id
  ),
  carriers_agg AS (
    SELECT
      c.carrier_id, c.name,
      COUNT(*) FILTER (WHERE c.status_to = 'delivered') AS delivered,
      COUNT(*) FILTER (WHERE c.status_to = 'returned')  AS returned,
      COALESCE(SUM(c.delivery_fee) FILTER (WHERE c.status_to = 'delivered'), 0) AS delivery_cost,
      COALESCE(SUM(c.return_fee)   FILTER (WHERE c.status_to = 'returned'),  0) AS return_cost,
      AVG(t.days) FILTER (WHERE c.status_to = 'delivered' AND t.days >= 0) AS avg_transit_days
    FROM hist_carrier c
    LEFT JOIN transit t ON t.order_id = c.order_id
    GROUP BY c.carrier_id, c.name
  ),

  -- Live carrier load. The status list and the 3-day threshold are copied
  -- verbatim from api/in-delivery/summary, api/warehouse/carrier-tracking and
  -- api/orders/[id]/timeline. Two pages disagreeing on what "bloquee" means
  -- would be a bug, not a variation.
  --
  -- Positive status IN (...) rather than NOT IN so idx_orders_market_status
  -- range-scans instead of walking every order.
  --
  -- NOTE this is a LIVE count sitting in a function whose other carrier figures
  -- span 90 days. The UI must label it as such; the two are not comparable.
  carrier_live AS (
    SELECT
      o.carrier_id,
      COUNT(*) AS in_flight,
      COUNT(*) FILTER (WHERE o.updated_at < now() - INTERVAL '3 days') AS stuck
    FROM orders o
    WHERE (v_scope_market IS NULL OR o.market_id = v_scope_market)
      AND o.carrier_id IS NOT NULL
      AND o.status IN ('dispatched', 'deposit', 'in_transit', 'to_be_returned')
    GROUP BY o.carrier_id
  ),

  products_agg AS (
    SELECT
      pr.id AS product_id, pr.name, pr.image_url,
      COALESCE(SUM(h.total_price)            FILTER (WHERE h.status_to = 'delivered'), 0) AS revenue,
      COALESCE(SUM(h.unit_cogs * h.quantity) FILTER (WHERE h.status_to = 'delivered'), 0) AS cogs,
      COALESCE(SUM(h.delivery_fee)           FILTER (WHERE h.status_to = 'delivered'), 0) AS delivery,
      COALESCE(SUM(h.packing_cost)           FILTER (WHERE h.status_to = 'confirmed'), 0) AS packing,
      COUNT(*) FILTER (WHERE h.status_to = 'delivered') AS delivered,
      COUNT(*) FILTER (WHERE h.status_to = 'returned')  AS returned,
      MAX(pr.current_stock) AS current_stock
    FROM hist h
    JOIN products pr ON pr.id = h.product_id
    WHERE h.is_cur
    GROUP BY pr.id, pr.name, pr.image_url
    HAVING COUNT(*) FILTER (WHERE h.status_to = 'delivered') > 0
  ),

  markets_money AS (
    SELECT market_id,
      COALESCE(SUM(total_price)          FILTER (WHERE status_to = 'delivered' AND is_cur), 0) AS revenue,
      COALESCE(SUM(unit_cogs * quantity) FILTER (WHERE status_to = 'delivered' AND is_cur), 0) AS cogs,
      COALESCE(SUM(delivery_fee)         FILTER (WHERE status_to = 'delivered' AND is_cur), 0) AS delivery,
      COALESCE(SUM(return_fee)           FILTER (WHERE status_to = 'returned'  AND is_cur), 0) AS returns,
      COALESCE(SUM(packing_cost)         FILTER (WHERE status_to = 'confirmed' AND is_cur), 0) AS packing
    FROM hist GROUP BY market_id
  ),
  markets_funnel AS (
    SELECT market_id,
      COUNT(*) FILTER (WHERE is_cur) AS leads,
      COUNT(*) FILTER (WHERE is_cur AND status IN (
        'confirmed','dispatch_scheduled','uploaded','scanned','dispatched','deposit',
        'in_transit','unverified','to_be_returned','received','delivered','returned'
      )) AS confirmed,
      COUNT(*) FILTER (WHERE is_cur AND status = 'delivered') AS delivered,
      COUNT(*) FILTER (WHERE is_cur AND status = 'returned')  AS returned
    FROM cohort GROUP BY market_id
  )

  SELECT jsonb_build_object(
    'money', jsonb_build_object(
      'revenue',  jsonb_build_object('current', m.rev_cur,  'previous', m.rev_prev),
      'cogs',     jsonb_build_object('current', m.cogs_cur, 'previous', m.cogs_prev),
      'delivery', jsonb_build_object('current', m.del_cur,  'previous', m.del_prev),
      'returns',  jsonb_build_object('current', m.ret_cur,  'previous', m.ret_prev),
      'packing',  jsonb_build_object('current', m.pack_cur, 'previous', m.pack_prev),
      'adSpend',  jsonb_build_object('amount', ad.amount, 'daysCovered', ad.days_covered)
    ),
    'funnel', jsonb_build_object(
      'leads',     jsonb_build_object('current', f.leads_cur,     'previous', f.leads_prev),
      'confirmed', jsonb_build_object('current', f.confirmed_cur, 'previous', f.confirmed_prev),
      'delivered', jsonb_build_object('current', f.delivered_cur, 'previous', f.delivered_prev),
      'returned',  jsonb_build_object('current', f.returned_cur,  'previous', f.returned_prev),
      'rejected',  jsonb_build_object('current', f.rejected_cur,  'previous', f.rejected_prev)
    ),
    'today', jsonb_build_object(
      'received',  tord.received_today,
      'confirmed', tev.confirmed_today,
      'delivered', tev.delivered_today
    ),
    'trailing7', jsonb_build_object(
      'meanReceived',  ROUND(tord.received_7d / 7.0, 2),
      'meanConfirmed', ROUND(tev.confirmed_7d / 7.0, 2)
    ),
    'committed', jsonb_build_object('value', cm.value, 'count', cm.count),
    'savings', jsonb_build_object(
      'total', sv.total, 'count', sv.count,
      'wins', sv.wins, 'losses', sv.losses,
      'periodTotal', sv.period_total, 'periodCount', sv.period_count),
    'daily', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'day', to_char(dl.day, 'YYYY-MM-DD'), 'delivered', dl.delivered, 'returned', dl.returned,
        'rejected', dl.rejected, 'open', dl.open, 'intake', dl.intake, 'revenue', dl.revenue,
        'confirmed', COALESCE(dc.confirmed, 0),
        'uploaded', COALESCE(dc.uploaded, 0)) ORDER BY dl.day)
      FROM daily dl LEFT JOIN daily_conf dc ON dc.day = dl.day), '[]'::jsonb),
    'flow', jsonb_build_object('intake', fl.intake, 'confirmed', fl.confirmed),
    'queues', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'bucket', bucket, 'count', count,
        'oldestHours', ROUND(oldest_hours::numeric, 1),
        'medianHours', ROUND(median_hours::numeric, 1)) ORDER BY ord) FROM queues), '[]'::jsonb),
    -- Rows come from the UNION of the historical and the live carrier sets, not
    -- from carriers_agg alone. A carrier can hold stuck parcels while having no
    -- resolved delivery in the window; sourcing rows only from history would
    -- hide exactly the carrier someone needs to chase.
    'carriers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'carrier_id', u.carrier_id,
        'name',       COALESCE(a.name, c.name),
        'delivered',  COALESCE(a.delivered, 0),
        'returned',   COALESCE(a.returned, 0),
        'avgTransitDays', ROUND(a.avg_transit_days::numeric, 2),
        'deliveryCost',   COALESCE(a.delivery_cost, 0),
        'returnCost',     COALESCE(a.return_cost, 0),
        'inFlight',   COALESCE(l.in_flight, 0),
        'stuck',      COALESCE(l.stuck, 0))
        ORDER BY COALESCE(a.delivered, 0) DESC, COALESCE(l.in_flight, 0) DESC)
      FROM (SELECT carrier_id FROM carriers_agg
            UNION
            SELECT carrier_id FROM carrier_live) u
      LEFT JOIN carriers_agg a ON a.carrier_id = u.carrier_id
      LEFT JOIN carrier_live l ON l.carrier_id = u.carrier_id
      LEFT JOIN carriers     c ON c.id         = u.carrier_id), '[]'::jsonb),
    'products', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'product_id', product_id, 'name', name, 'imageUrl', image_url,
        'revenue', revenue, 'cogs', cogs, 'delivery', delivery, 'packing', packing,
        'delivered', delivered, 'returned', returned, 'currentStock', current_stock)
        ORDER BY revenue DESC) FROM products_agg), '[]'::jsonb),
    'markets', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'market_id', mk.id, 'name', mk.name, 'code', mk.code, 'currency', mk.currency,
        'revenue',  COALESCE(mm.revenue, 0),  'cogs',    COALESCE(mm.cogs, 0),
        'delivery', COALESCE(mm.delivery, 0), 'returns', COALESCE(mm.returns, 0),
        'packing',  COALESCE(mm.packing, 0),
        'leads',     COALESCE(mf.leads, 0),     'confirmed', COALESCE(mf.confirmed, 0),
        'delivered', COALESCE(mf.delivered, 0), 'returned',  COALESCE(mf.returned, 0))
        ORDER BY mk.name)
      FROM markets mk
      LEFT JOIN markets_money  mm ON mm.market_id = mk.id
      LEFT JOIN markets_funnel mf ON mf.market_id = mk.id), '[]'::jsonb),
    'availableMarkets', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'code', code, 'currency', COALESCE(currency, 'TND'))
        ORDER BY name) FROM markets), '[]'::jsonb)
  )
  INTO v_result
  FROM money m, ad, funnel f, flow fl, today_orders tord, today_events tev, committed cm, savings sv;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

grant execute on function public.get_dashboard_health to authenticated;
