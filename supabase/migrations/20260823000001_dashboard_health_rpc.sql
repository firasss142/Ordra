-- ============================================================
-- 20260823000001_dashboard_health_rpc.sql
-- Single-round-trip aggregation for the /dashboard business health monitor.
--
-- WHY: getDashboardSummary() issued ~45-55 Supabase round-trips across four
-- dependent waves per render and reduced every figure in JS. Worse, under the
-- order_history_select RLS policy each candidate row paid a per-row
-- EXISTS(SELECT 1 FROM orders ...) plus SECURITY DEFINER get_user_role() /
-- get_user_market_id() calls — migration 20260822000002 measured that subplan at
-- 281ms/13017 buffers vs 4.3ms/262 buffers bypassed, a 65x gap on the same
-- 265-row result, and recorded dashboard queries routinely running 0.5-4.2s.
--
-- This function does the same work in ONE round-trip. Being SECURITY DEFINER the
-- per-row RLS predicate never fires; market isolation is enforced once, in
-- function, by the same guard get_profitability_summary uses.
--
-- MEASURED on 6834 orders / 24849 order_history rows (all-markets scope, the
-- heaviest path):  Execution Time 76.3 ms, shared hit=12051.
-- Single-market scope is lighter. No new index was required — an EXPLAIN was run
-- before considering one, and the existing composite indexes already cover it:
--   idx_order_history_market_status_created (market_id, status_to, created_at)
--   orders (market_id, created_at)  [019_performance_indexes]
--   orders (market_id, status)      [001_initial_schema]
--
-- order_history and inventory_log are untouched (append-only preserved); this is
-- purely additive and reads nothing it does not already have RLS access to.
--
-- ------------------------------------------------------------
-- TWO TIME SEMANTICS, DELIBERATELY. The old dashboard mixed these silently,
-- which is how it ended up showing a period-scoped revenue next to a live queue
-- count with identical styling.
--
--   MONEY  is EVENT-based: revenue is realised on the day the delivered event
--          fires. Matches get_profitability_summary, the P&L page and ordinary
--          accounting. Do not change this — finance depends on it.
--
--   FUNNEL is COHORT-based: every count is over orders CREATED in the period,
--          measured by where they ended up. This is the only basis on which
--          lead-to-cash (delivered / leads) means anything — event-based would
--          divide this period's deliveries by a different period's leads, since
--          delivery lags creation by days.
--
-- The UI labels these differently ("réalisé" vs "cohorte"). They are not
-- expected to reconcile and must never be summed together.
-- ============================================================

CREATE OR REPLACE FUNCTION get_dashboard_health(
  p_market_id  UUID,
  p_from       DATE,
  p_to         DATE,
  p_prev_from  DATE,
  p_prev_to    DATE,
  p_trend_from DATE,
  p_trend_to   DATE
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

  -- Half-open [from, to+1) bounds interpreted as UTC, matching the JS path's
  -- `toDate + "T23:59:59.999Z"` without the millisecond fencepost.
  v_from      TIMESTAMPTZ := (p_from)::timestamp AT TIME ZONE 'UTC';
  v_to        TIMESTAMPTZ := (p_to + 1)::timestamp AT TIME ZONE 'UTC';
  v_prev_from TIMESTAMPTZ := (p_prev_from)::timestamp AT TIME ZONE 'UTC';
  v_prev_to   TIMESTAMPTZ := (p_prev_to + 1)::timestamp AT TIME ZONE 'UTC';
  v_win_from  TIMESTAMPTZ := LEAST((p_from)::timestamp AT TIME ZONE 'UTC',
                                   (p_prev_from)::timestamp AT TIME ZONE 'UTC');
  v_win_to    TIMESTAMPTZ := GREATEST((p_to + 1)::timestamp AT TIME ZONE 'UTC',
                                      (p_prev_to + 1)::timestamp AT TIME ZONE 'UTC');

  v_result JSONB;
BEGIN
  v_caller_role   := get_user_role();
  v_caller_market := get_user_market_id();

  -- Market isolation. Anyone but super_admin is pinned to their own market
  -- regardless of what they asked for; asking for someone else's market yields
  -- an empty object, which the caller maps to an all-zero dashboard.
  IF v_caller_role IS DISTINCT FROM 'super_admin' THEN
    IF p_market_id IS NOT NULL AND p_market_id IS DISTINCT FROM v_caller_market THEN
      RETURN '{}'::jsonb;
    END IF;
    v_scope_market := v_caller_market;
  ELSE
    v_scope_market := p_market_id;  -- NULL means all markets
  END IF;

  WITH
  -- ---------- EVENT-BASED SOURCE (money, products, carriers) ----------
  -- Market is filtered on order_history.market_id (denormalised by
  -- 20260819000001, NOT NULL since 20260822000001) so the predicate is an exact
  -- prefix match on idx_order_history_market_status_created and Postgres narrows
  -- history BEFORE joining orders. Filtering via orders.market_id would force the
  -- join to run for every candidate row.
  hist AS (
    SELECT
      h.status_to,
      h.order_id,
      o.market_id,
      o.total_price,
      o.quantity,
      o.product_id,
      o.carrier_id,
      pr.unit_cogs,
      pr.packing_cost,
      c.delivery_fee,
      c.return_fee,
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

  -- Ad spend, plus how many days of the period it actually covers. Coverage is
  -- what lets the UI decide between "Marge brute" and "Profit net" instead of
  -- silently reporting a cost-free margin. (Measured: 8 of 31 days covered on
  -- the June-July window — partial coverage is the norm, not the exception.)
  ad AS (
    SELECT
      COALESCE(SUM(a.amount), 0) AS amount,
      COALESCE((
        SELECT COUNT(DISTINCT d)::int
        FROM ad_spend a2
        CROSS JOIN LATERAL generate_series(
          GREATEST(a2.period_start, p_from),
          LEAST(a2.period_end, p_to),
          interval '1 day'
        ) AS d
        WHERE (v_scope_market IS NULL OR a2.market_id = v_scope_market)
          AND a2.is_active
          AND a2.period_start <= p_to
          AND a2.period_end   >= p_from
      ), 0) AS days_covered
    FROM ad_spend a
    WHERE (v_scope_market IS NULL OR a.market_id = v_scope_market)
      AND a.is_active
      AND a.period_start <= p_to
      AND a.period_end   >= p_from
  ),

  -- ---------- COHORT-BASED SOURCE (funnel) ----------
  -- Orders CREATED in each period, classified by where they ended up. An order
  -- counts as "confirmed" if it ever passed confirmation, which we read off its
  -- current status rather than re-scanning history.
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

  -- ---------- DAILY COHORT CHART ----------
  -- generate_series gap-fills so a day with no orders renders as a zero bar
  -- rather than vanishing and compressing the x-axis.
  daily AS (
    SELECT
      d::date AS day,
      COUNT(o.id) FILTER (WHERE o.status = 'delivered') AS delivered,
      COUNT(o.id) FILTER (WHERE o.status = 'returned')  AS returned,
      COUNT(o.id) FILTER (WHERE o.status = 'rejected')  AS rejected,
      COUNT(o.id) FILTER (WHERE o.status NOT IN
        ('delivered','returned','rejected','cancelled','deleted')) AS open,
      COALESCE(SUM(o.total_price) FILTER (WHERE o.status = 'delivered'), 0) AS revenue
    FROM generate_series(p_trend_from, p_trend_to, interval '1 day') d
    LEFT JOIN orders o
      ON  o.created_at >= (d)::timestamp AT TIME ZONE 'UTC'
      AND o.created_at <  (d + interval '1 day')::timestamp AT TIME ZONE 'UTC'
      AND (v_scope_market IS NULL OR o.market_id = v_scope_market)
    GROUP BY d
  ),

  -- ---------- LIVE QUEUES (no period — "maintenant") ----------
  -- Positive status IN (...) rather than the old NOT IN (terminal). A negated
  -- predicate cannot range-scan idx_orders_market_status, so the previous
  -- implementation read every non-terminal row to count it in JS.
  queues AS (
    SELECT
      b.bucket,
      b.ord,
      COUNT(o.id) AS count,
      MAX(EXTRACT(EPOCH FROM (now() - o.created_at)) / 3600.0) AS oldest_hours,
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (now() - o.created_at)) / 3600.0
      ) AS median_hours
    FROM (VALUES
      ('new', 1), ('assigned', 2), ('attempts', 3),
      ('callback', 4), ('confirmed', 5), ('uploaded', 6)
    ) AS b(bucket, ord)
    -- 'new' and 'assigned' are legacy enum values that predate the
    -- assignment-is-ownership model (2 live rows still carry 'new'). They are
    -- bucketed alongside 'pending' so no open order is silently dropped.
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

  -- ---------- FLOW BALANCE ----------
  -- Intake vs confirmations over the same period. If intake outruns
  -- confirmations the backlog is growing, which no static queue count reveals.
  flow AS (
    SELECT
      (SELECT COUNT(*) FROM cohort WHERE is_cur) AS intake,
      (SELECT COUNT(*) FROM hist WHERE status_to = 'confirmed' AND is_cur) AS confirmed
  ),

  -- ---------- CARRIER PERFORMANCE ----------
  delivered_orders AS (
    SELECT DISTINCT order_id FROM hist WHERE status_to = 'delivered' AND is_cur
  ),
  -- Transit start is the EARLIEST of dispatched/uploaded: Tunisia runs
  -- uploaded -> scanned -> dispatched, but Libya's Darb Assabil jumps straight
  -- from uploaded to a terminal status (see 20260817000001_promote_darb_status),
  -- so keying only on 'dispatched' would yield NULL for every Libyan order.
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
      c.id   AS carrier_id,
      c.name AS name,
      COUNT(*) FILTER (WHERE h.status_to = 'delivered') AS delivered,
      COUNT(*) FILTER (WHERE h.status_to = 'returned')  AS returned,
      COALESCE(SUM(h.delivery_fee) FILTER (WHERE h.status_to = 'delivered'), 0) AS delivery_cost,
      AVG(t.days) FILTER (WHERE h.status_to = 'delivered' AND t.days >= 0) AS avg_transit_days
    FROM hist h
    JOIN carriers c ON c.id = h.carrier_id
    LEFT JOIN transit t ON t.order_id = h.order_id
    WHERE h.is_cur AND h.status_to IN ('delivered','returned')
    GROUP BY c.id, c.name
  ),

  -- ---------- PRODUCT CONTRIBUTION (event-based, matches money) ----------
  products_agg AS (
    SELECT
      pr.id   AS product_id,
      pr.name AS name,
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
    GROUP BY pr.id, pr.name
    HAVING COUNT(*) FILTER (WHERE h.status_to = 'delivered') > 0
  ),

  -- ---------- PER-MARKET ROLLUP ----------
  -- One grouped pass. The old code called fetchFinancials() once PER MARKET, as
  -- the last serialised wave, even when only one market was in scope.
  markets_money AS (
    SELECT
      market_id,
      COALESCE(SUM(total_price)          FILTER (WHERE status_to = 'delivered' AND is_cur), 0) AS revenue,
      COALESCE(SUM(unit_cogs * quantity) FILTER (WHERE status_to = 'delivered' AND is_cur), 0) AS cogs,
      COALESCE(SUM(delivery_fee)         FILTER (WHERE status_to = 'delivered' AND is_cur), 0) AS delivery,
      COALESCE(SUM(return_fee)           FILTER (WHERE status_to = 'returned'  AND is_cur), 0) AS returns,
      COALESCE(SUM(packing_cost)         FILTER (WHERE status_to = 'confirmed' AND is_cur), 0) AS packing
    FROM hist GROUP BY market_id
  ),
  markets_funnel AS (
    SELECT
      market_id,
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
    'daily', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'day', to_char(day, 'YYYY-MM-DD'), 'delivered', delivered, 'returned', returned,
        'rejected', rejected, 'open', open, 'revenue', revenue) ORDER BY day) FROM daily), '[]'::jsonb),
    'flow', jsonb_build_object('intake', fl.intake, 'confirmed', fl.confirmed),
    'queues', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'bucket', bucket, 'count', count,
        'oldestHours', ROUND(oldest_hours::numeric, 1),
        'medianHours', ROUND(median_hours::numeric, 1)) ORDER BY ord) FROM queues), '[]'::jsonb),
    'carriers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'carrier_id', carrier_id, 'name', name, 'delivered', delivered, 'returned', returned,
        'avgTransitDays', ROUND(avg_transit_days::numeric, 2),
        'deliveryCost', delivery_cost) ORDER BY delivered DESC) FROM carriers_agg), '[]'::jsonb),
    'products', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'product_id', product_id, 'name', name, 'revenue', revenue, 'cogs', cogs,
        'delivery', delivery, 'packing', packing, 'delivered', delivered,
        'returned', returned, 'currentStock', current_stock)
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
  FROM money m, ad, funnel f, flow fl;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$fn$;

COMMENT ON FUNCTION get_dashboard_health(UUID, DATE, DATE, DATE, DATE, DATE, DATE) IS
  'Business health rollup for /dashboard in one round-trip. Money is event-based (revenue realised at delivery, matching get_profitability_summary); the funnel is cohort-based (orders created in the period, by outcome) so lead-to-cash is meaningful. The two are not expected to reconcile.';

GRANT EXECUTE ON FUNCTION
  get_dashboard_health(UUID, DATE, DATE, DATE, DATE, DATE, DATE)
  TO authenticated;
