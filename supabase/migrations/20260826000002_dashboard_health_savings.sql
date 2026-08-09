-- ============================================================
-- 20260826000002_dashboard_health_savings.sql
-- Adds `savings` to the dashboard rollup: net LYD earned by routing each order
-- to the cheaper carrier account.
--
-- Libya runs two Darb Assabil accounts that price the same destination 5-25 LYD
-- apart. Since 20260826000001 every dispatch snapshots what its routing choice
-- was worth onto orders.delivery_saving_lyd. This exposes the sum so the
-- dashboard can replace the "CA en attente" tile with a running savings counter.
--
-- Signature unchanged -> CREATE OR REPLACE, no DROP window. Everything below is
-- 20260823000005 verbatim plus the `savings` CTE, its payload key, and its entry
-- in the final cross join.
-- ============================================================

CREATE OR REPLACE FUNCTION get_dashboard_health(
  p_market_id   UUID,
  p_from        DATE,
  p_to          DATE,
  p_prev_from   DATE,
  p_prev_to     DATE,
  p_trend_from  DATE,
  p_trend_to    DATE,
  p_carrier_from DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
DECLARE
  v_caller_role   TEXT;
  v_caller_market UUID;
  v_scope_market  UUID;

  v_from      TIMESTAMPTZ := (p_from)::timestamp AT TIME ZONE 'UTC';
  v_to        TIMESTAMPTZ := (p_to + 1)::timestamp AT TIME ZONE 'UTC';
  v_prev_from TIMESTAMPTZ := (p_prev_from)::timestamp AT TIME ZONE 'UTC';
  v_prev_to   TIMESTAMPTZ := (p_prev_to + 1)::timestamp AT TIME ZONE 'UTC';
  v_win_from  TIMESTAMPTZ := LEAST((p_from)::timestamp AT TIME ZONE 'UTC',
                                   (p_prev_from)::timestamp AT TIME ZONE 'UTC');
  v_win_to    TIMESTAMPTZ := GREATEST((p_to + 1)::timestamp AT TIME ZONE 'UTC',
                                      (p_prev_to + 1)::timestamp AT TIME ZONE 'UTC');
  v_carrier_from TIMESTAMPTZ := (p_carrier_from)::timestamp AT TIME ZONE 'UTC';

  -- Same UTC day boundary the period bounds use, so "today" cannot drift a few
  -- hours away from the rest of the page.
  v_today_from TIMESTAMPTZ := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_7d_from    TIMESTAMPTZ := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
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
      c.delivery_fee, c.return_fee,
      (h.created_at >= v_from      AND h.created_at < v_to)      AS is_cur,
      (h.created_at >= v_prev_from AND h.created_at < v_prev_to) AS is_prev
    FROM order_history h
    JOIN orders    o  ON o.id = h.order_id
    LEFT JOIN products pr ON pr.id = o.product_id
    LEFT JOIN carriers c  ON c.id = o.carrier_id
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
        'confirmed','dispatch_scheduled','uploaded','scanned','dispatched','deposit',
        'in_transit','unverified','to_be_returned','received','delivered','returned'
      )) AS confirmed_cur,
      COUNT(*) FILTER (WHERE is_prev AND status IN (
        'confirmed','dispatch_scheduled','uploaded','scanned','dispatched','deposit',
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

  -- ---------- TODAY + TRAILING 7-DAY BASELINE ----------
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

  -- ---------- COMMITTED (unrealised) REVENUE ----------
  -- to_be_returned / received are excluded: those are heading to a return, not
  -- a sale, so counting them as committed revenue would overstate the pipeline.
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
  -- at dispatch into orders.delivery_saving_lyd (see 20260826000001):
  --     saving = cheapest account NOT used - account actually used
  -- Positive = routed cheaper, negative = the agent overrode the badge and
  -- overpaid, zero = a measured tie. Net, so overrides genuinely subtract.
  --
  -- NULL rows are NOT MEASURED and are excluded by the WHERE: non-Darb carriers,
  -- destinations never quoted for one account, and everything dispatched before
  -- the feature shipped. That last exclusion is the point - the counter answers
  -- "what has choosing the cheapest earned us SINCE we started choosing", so it
  -- must not absorb the -2,710 LYD of historical routing.
  --
  -- `total` deliberately ignores p_from/p_to and is all-time, exactly like
  -- `committed`: it is a lifetime counter. `period_*` carries the window figure.
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
      ON  o.created_at >= (d)::timestamp AT TIME ZONE 'UTC'
      AND o.created_at <  (d + interval '1 day')::timestamp AT TIME ZONE 'UTC'
      AND (v_scope_market IS NULL OR o.market_id = v_scope_market)
    GROUP BY d
  ),
  -- Event-based confirmations per day, joined onto the cohort rows above.
  daily_conf AS (
    SELECT (h.created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*) AS confirmed
    FROM order_history h
    WHERE (v_scope_market IS NULL OR h.market_id = v_scope_market)
      AND h.status_to = 'confirmed'
      AND h.created_at >= (p_trend_from)::timestamp AT TIME ZONE 'UTC'
      AND h.created_at <  (p_trend_to + 1)::timestamp AT TIME ZONE 'UTC'
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
  hist_carrier AS (
    SELECT h.status_to, h.order_id, o.carrier_id, c.name, c.delivery_fee, c.return_fee
    FROM order_history h
    JOIN orders   o ON o.id = h.order_id
    JOIN carriers c ON c.id = o.carrier_id
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

  -- Live carrier load. "In flight" and "stuck" are NOT dashboard inventions:
  -- the status list and the 3-day threshold are copied verbatim from
  -- api/in-delivery/summary, api/warehouse/carrier-tracking and
  -- api/orders/[id]/timeline. Two pages disagreeing on what "bloquee" means
  -- would be a bug, not a variation.
  --
  -- Positive status IN (...) rather than NOT IN so idx_orders_market_status
  -- range-scans instead of walking every order — same reasoning as `committed`.
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

  -- Retained but not rendered: the markets block was dropped from the page this
  -- round. Keeping the rollup costs one grouped pass over already-materialised
  -- CTEs and makes restoring the block a UI-only change.
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
        'confirmed', COALESCE(dc.confirmed, 0)) ORDER BY dl.day)
      FROM daily dl LEFT JOIN daily_conf dc ON dc.day = dl.day), '[]'::jsonb),
    'flow', jsonb_build_object('intake', fl.intake, 'confirmed', fl.confirmed),
    'queues', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'bucket', bucket, 'count', count,
        'oldestHours', ROUND(oldest_hours::numeric, 1),
        'medianHours', ROUND(median_hours::numeric, 1)) ORDER BY ord) FROM queues), '[]'::jsonb),
    -- Rows come from the UNION of the historical and the live carrier sets, not
    -- from carriers_agg alone. A carrier can hold stuck parcels while having no
    -- resolved delivery in the window (Dexpress today, any new carrier
    -- tomorrow); sourcing rows only from history would hide exactly the carrier
    -- someone needs to chase.
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
$fn$;

COMMENT ON FUNCTION get_dashboard_health(UUID, DATE, DATE, DATE, DATE, DATE, DATE, DATE) IS
  'Business health rollup for /dashboard in one round-trip. Money is event-based (revenue realised at delivery); the funnel is cohort-based (orders created in the period). today/trailing7 back the KPI tiles now that the period selector is gone; the baseline is the 7-day mean because the market restarted and a 30-day mean misreads a ramp. committed = revenue in flight, gross. savings = net LYD earned by routing to the cheaper carrier account, snapshotted per order at dispatch; total is all-time, periodTotal is the window.';

GRANT EXECUTE ON FUNCTION
  get_dashboard_health(UUID, DATE, DATE, DATE, DATE, DATE, DATE, DATE)
  TO authenticated;
