-- Stock position + shipped demand for /dashboard/stock, in one round-trip.
--
-- WHY AN RPC AND NOT A CLIENT QUERY. Computing `committed` from PostgREST means
-- paging every in-flight order through the 1000-row cap — the same truncation
-- that once published "1000 au total" against 2578 real orders
-- (design-system.md §4.17 G). Under-reporting committed units on a stock page
-- causes an oversell. Separately, the per-row order_history RLS EXISTS subplan
-- was measured at 65x overhead in 20260822000002 and crosses statement_timeout
-- for a market_manager on any window wider than a week; SECURITY DEFINER
-- sidesteps it, with market isolation re-asserted in-function below.
--
-- WHY `committed` IS NOT A STATUS LIST. scan_order_out already deducts stock at
-- uploaded -> scanned. Subtracting every in-flight status from current_stock is
-- correct only while nobody scans (today: zero inventory_log rows with
-- reason='scanned'). Keyed on the ABSENCE of a scan row instead, the figure is
-- right both before and after the warehouse starts scanning, with no second
-- migration and no flag day.
--
-- WHY DEMAND IS EVENT-BASED. Filtering on orders.created_at systematically
-- depresses the right edge of the series — orders created recently that have
-- not shipped yet — and that edge is exactly what a reorder decision reads.
-- The first order_history status_to='uploaded' event is the honest basis.
-- MIN() because a failed upload falls back to `confirmed` and is retried, and
-- a retry is not a second unit of demand.
--
-- Raw sums, counts and timestamps only. Every ratio, date and verdict is
-- derived in lib/calculations/inventory-intelligence.ts, which is what keeps
-- them unit-testable without a database.

CREATE INDEX IF NOT EXISTS idx_inventory_log_order_id
  ON inventory_log (order_id) WHERE order_id IS NOT NULL;

-- Market scoping, split out so it can be asserted on its own. The leak it
-- guards is subtle: a non-super_admin whose own market_id is NULL would
-- otherwise fall through with scope_market = NULL, which every filter in
-- get_stock_position reads as "all markets".
CREATE OR REPLACE FUNCTION get_stock_position_scope(
  p_caller_role TEXT,
  p_caller_market UUID,
  p_market_id UUID,
  OUT allowed BOOLEAN,
  OUT scope_market UUID
)
LANGUAGE plpgsql IMMUTABLE
AS $scope$
BEGIN
  IF p_caller_role IS DISTINCT FROM 'super_admin' THEN
    IF p_caller_market IS NULL THEN
      allowed := false; scope_market := NULL; RETURN;
    END IF;
    IF p_market_id IS NOT NULL AND p_market_id IS DISTINCT FROM p_caller_market THEN
      allowed := false; scope_market := NULL; RETURN;
    END IF;
    allowed := true; scope_market := p_caller_market; RETURN;
  END IF;
  allowed := true; scope_market := p_market_id;
END;
$scope$;

REVOKE ALL ON FUNCTION get_stock_position_scope(TEXT, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION get_stock_position_scope(TEXT, UUID, UUID) TO authenticated;

DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM get_stock_position_scope('market_manager', NULL, NULL);
  IF r.allowed THEN RAISE EXCEPTION 'FAIL: marketless manager was allowed'; END IF;

  SELECT * INTO r FROM get_stock_position_scope('market_manager', '00000000-0000-0000-0000-000000000001',
                                                '00000000-0000-0000-0000-000000000002');
  IF r.allowed THEN RAISE EXCEPTION 'FAIL: manager reached another market'; END IF;

  SELECT * INTO r FROM get_stock_position_scope('market_manager', '00000000-0000-0000-0000-000000000001', NULL);
  IF NOT r.allowed OR r.scope_market <> '00000000-0000-0000-0000-000000000001'
    THEN RAISE EXCEPTION 'FAIL: manager not pinned to own market'; END IF;

  SELECT * INTO r FROM get_stock_position_scope('super_admin', NULL, NULL);
  IF NOT r.allowed OR r.scope_market IS NOT NULL
    THEN RAISE EXCEPTION 'FAIL: super_admin all-markets scope broken'; END IF;

  RAISE NOTICE 'get_stock_position_scope guards verified';
END $$;

CREATE OR REPLACE FUNCTION get_stock_position(
  p_market_id   UUID,
  p_from        DATE,   -- demand window start, inclusive
  p_to          DATE,   -- demand window end, inclusive
  p_bucket_days INT,    -- 1 or 7 — one demand_series point
  p_rate_from   DATE    -- return-rate window start, same end as p_to
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $fn$
DECLARE
  v_scope         RECORD;
  v_scope_market  UUID;

  v_from      TIMESTAMPTZ := (p_from)::timestamp AT TIME ZONE 'UTC';
  v_to        TIMESTAMPTZ := (p_to + 1)::timestamp AT TIME ZONE 'UTC';
  v_rate_from TIMESTAMPTZ := (p_rate_from)::timestamp AT TIME ZONE 'UTC';

  -- Ever left the shelf. 'dispatching' is dead in application code
  -- (20260506000000) but survives in the enum; listed defensively.
  v_left_shelf order_status[] := ARRAY[
    'uploaded','dispatching','scanned','dispatched','deposit','in_transit',
    'unverified','to_be_returned','received','delivered','returned'
  ]::order_status[];

  -- Promised, not yet delivered. Excludes to_be_returned (heading back, not
  -- out) and every terminal outcome.
  v_in_flight order_status[] := ARRAY[
    'uploaded','dispatching','scanned','dispatched','deposit','in_transit',
    'unverified','received'
  ]::order_status[];

  v_result JSONB;
BEGIN
  SELECT * INTO v_scope
    FROM get_stock_position_scope(get_user_role(), get_user_market_id(), p_market_id);
  IF NOT v_scope.allowed THEN
    RETURN '{}'::jsonb;
  END IF;
  v_scope_market := v_scope.scope_market;

  WITH
  prod AS (
    SELECT p.id, p.name, p.sku, p.image_url, p.market_id,
           p.current_stock, p.low_stock_threshold,
           p.unit_cogs, p.damaged_return_count,
           m.currency
    FROM products p
    LEFT JOIN markets m ON m.id = p.market_id
    WHERE p.deleted_at IS NULL
      AND p.is_active
      AND (v_scope_market IS NULL OR p.market_id = v_scope_market)
  ),

  -- Which products the carrier physically holds. For those rows current_stock
  -- is a local record of someone else's shelf, and the UI must say so.
  carrier_held AS (
    SELECT cpm.product_id, MIN(c.name) AS carrier_name
    FROM carrier_product_mappings cpm
    LEFT JOIN carriers c ON c.id = cpm.carrier_id
    WHERE cpm.is_active
    GROUP BY cpm.product_id
  ),

  first_upload AS (
    SELECT h.order_id, MIN(h.created_at) AS at
    FROM order_history h
    WHERE h.status_to = 'uploaded'
      AND (v_scope_market IS NULL OR h.market_id = v_scope_market)
    GROUP BY h.order_id
  ),
  scanned_orders AS (
    SELECT DISTINCT order_id
    FROM inventory_log
    WHERE reason = 'scanned' AND order_id IS NOT NULL
  ),

  ship AS (
    SELECT
      o.id AS order_id, o.product_id, COALESCE(o.quantity, 1) AS quantity, o.status,
      -- Orders whose status was set by a migration UPDATE carry no 'uploaded'
      -- history row. created_at is the honest fallback and the flag travels
      -- with it, so the API can mark the rate inferred rather than guess quietly.
      COALESCE(fu.at, o.created_at) AS shipped_at,
      (fu.at IS NULL)               AS shipped_at_inferred,
      (so.order_id IS NOT NULL)     AS has_scan_row
    FROM orders o
    LEFT JOIN first_upload   fu ON fu.order_id = o.id
    LEFT JOIN scanned_orders so ON so.order_id = o.id
    WHERE o.product_id IS NOT NULL
      AND o.status <> 'deleted'
      AND (v_scope_market IS NULL OR o.market_id = v_scope_market)
      AND (o.status = ANY(v_left_shelf) OR so.order_id IS NOT NULL)
  ),

  agg AS (
    SELECT
      s.product_id,
      COALESCE(SUM(s.quantity) FILTER (WHERE s.shipped_at >= v_from AND s.shipped_at < v_to), 0) AS demand_units,
      COUNT(*)                 FILTER (WHERE s.shipped_at >= v_from AND s.shipped_at < v_to)     AS demand_orders,
      COUNT(*)                 FILTER (WHERE s.shipped_at >= v_from AND s.shipped_at < v_to
                                         AND s.shipped_at_inferred)                             AS demand_orders_inferred,

      COALESCE(SUM(s.quantity) FILTER (WHERE s.status = ANY(v_in_flight) AND NOT s.has_scan_row), 0) AS committed_units,
      COUNT(*)                 FILTER (WHERE s.status = ANY(v_in_flight) AND NOT s.has_scan_row)     AS committed_orders,
      COALESCE(SUM(s.quantity) FILTER (WHERE s.status = ANY(v_in_flight) AND s.has_scan_row), 0)     AS committed_deducted_units,

      COALESCE(SUM(s.quantity) FILTER (WHERE s.status = 'to_be_returned'), 0) AS coming_back_units,

      COALESCE(SUM(s.quantity) FILTER (WHERE s.status = 'uploaded'), 0) AS awaiting_scan_units,
      COUNT(*)                 FILTER (WHERE s.status = 'uploaded')     AS awaiting_scan_orders,
      MIN(s.shipped_at)        FILTER (WHERE s.status = 'uploaded')     AS oldest_awaiting_scan_at,

      COALESCE(SUM(s.quantity), 0)                                                    AS shipped_units_all_time,
      COALESCE(SUM(s.quantity) FILTER (WHERE s.status IN ('returned','received')), 0) AS returned_to_shelf_units_all_time,
      COALESCE(SUM(s.quantity) FILTER (WHERE NOT s.has_scan_row), 0)                  AS unscanned_shipped_units,
      MIN(s.shipped_at) AS first_shipped_at,
      MAX(s.shipped_at) FILTER (WHERE s.status = 'delivered') AS last_sale_at
    FROM ship s
    GROUP BY s.product_id
  ),

  rate AS (
    SELECT o.product_id,
      COUNT(*)                 FILTER (WHERE h.status_to = 'delivered')     AS delivered_orders,
      COUNT(*)                 FILTER (WHERE h.status_to = 'returned')      AS returned_orders,
      COALESCE(SUM(COALESCE(o.quantity,1)) FILTER (WHERE h.status_to = 'delivered'), 0) AS delivered_units,
      COALESCE(SUM(COALESCE(o.quantity,1)) FILTER (WHERE h.status_to = 'returned'), 0)  AS returned_units
    FROM order_history h
    JOIN orders o ON o.id = h.order_id
    WHERE h.status_to IN ('delivered','returned')
      AND h.created_at >= v_rate_from AND h.created_at < v_to
      AND o.status <> 'deleted' AND o.product_id IS NOT NULL
      AND (v_scope_market IS NULL OR h.market_id = v_scope_market)
    GROUP BY o.product_id
  ),

  ledger AS (
    SELECT il.product_id,
      COALESCE(SUM(il.change), 0) AS ledger_sum_units,
      COUNT(*)                    AS ledger_rows,
      COUNT(*) FILTER (WHERE il.reason = 'scanned')                    AS scan_out_rows,
      MAX(il.created_at) FILTER (WHERE il.reason = 'manual_adjustment') AS last_counted_at,
      MAX(il.created_at)          AS last_movement_at
    FROM inventory_log il
    JOIN products p ON p.id = il.product_id
    WHERE (v_scope_market IS NULL OR p.market_id = v_scope_market)
    GROUP BY il.product_id
  ),

  -- Gap-filled by construction. get_profitability_daily records why: a series
  -- that skips empty buckets draws a line between non-adjacent dates and
  -- misstates the shape of the trend.
  buckets AS (
    SELECT p.id AS product_id, b.start_at,
           b.start_at + (p_bucket_days || ' days')::interval AS end_at
    FROM prod p
    CROSS JOIN generate_series(v_from, v_to - interval '1 second',
                               (p_bucket_days || ' days')::interval) AS b(start_at)
  ),
  series AS (
    SELECT b.product_id,
           to_char(b.start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
           COALESCE(SUM(s.quantity), 0) AS units,
           COUNT(s.order_id)            AS orders,
           MIN(b.start_at)              AS ord
    FROM buckets b
    LEFT JOIN ship s
      ON  s.product_id = b.product_id
      AND s.shipped_at >= b.start_at
      AND s.shipped_at <  b.end_at
    GROUP BY b.product_id, b.start_at
  )

  SELECT jsonb_build_object(
    'products', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'sku', p.sku, 'image_url', p.image_url,
        'market_id', p.market_id, 'currency', p.currency,
        'current_stock', p.current_stock,
        'low_stock_threshold', p.low_stock_threshold,
        'unit_cogs', p.unit_cogs,
        'damaged_return_count', p.damaged_return_count,
        'carrier_name', ch.carrier_name,

        'demand_units',           COALESCE(a.demand_units, 0),
        'demand_orders',          COALESCE(a.demand_orders, 0),
        'demand_orders_inferred', COALESCE(a.demand_orders_inferred, 0),
        'committed_units',          COALESCE(a.committed_units, 0),
        'committed_orders',         COALESCE(a.committed_orders, 0),
        'committed_deducted_units', COALESCE(a.committed_deducted_units, 0),
        'coming_back_units',      COALESCE(a.coming_back_units, 0),
        'awaiting_scan_units',    COALESCE(a.awaiting_scan_units, 0),
        'awaiting_scan_orders',   COALESCE(a.awaiting_scan_orders, 0),
        'oldest_awaiting_scan_at', a.oldest_awaiting_scan_at,
        'shipped_units_all_time',           COALESCE(a.shipped_units_all_time, 0),
        'returned_to_shelf_units_all_time', COALESCE(a.returned_to_shelf_units_all_time, 0),
        'unscanned_shipped_units',          COALESCE(a.unscanned_shipped_units, 0),
        'first_shipped_at', a.first_shipped_at,
        'last_sale_at',     a.last_sale_at,

        'delivered_units_rate_window',  COALESCE(r.delivered_units, 0),
        'returned_units_rate_window',   COALESCE(r.returned_units, 0),
        'delivered_orders_rate_window', COALESCE(r.delivered_orders, 0),
        'returned_orders_rate_window',  COALESCE(r.returned_orders, 0),

        'ledger_sum_units', COALESCE(l.ledger_sum_units, 0),
        'ledger_rows',      COALESCE(l.ledger_rows, 0),
        'last_counted_at',  l.last_counted_at,

        'demand_series', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('day', se.day, 'units', se.units, 'orders', se.orders)
                           ORDER BY se.ord)
          FROM series se WHERE se.product_id = p.id), '[]'::jsonb)
      ) ORDER BY p.name)
      FROM prod p
      LEFT JOIN agg          a  ON a.product_id  = p.id
      LEFT JOIN rate         r  ON r.product_id  = p.id
      LEFT JOIN ledger       l  ON l.product_id  = p.id
      LEFT JOIN carrier_held ch ON ch.product_id = p.id), '[]'::jsonb),

    'ledger_health', jsonb_build_object(
      'inventory_log_rows', COALESCE((SELECT SUM(ledger_rows)   FROM ledger), 0),
      'scan_out_rows',      COALESCE((SELECT SUM(scan_out_rows) FROM ledger), 0),
      'last_movement_at',   (SELECT MAX(last_movement_at) FROM ledger)
    )
  ) INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$fn$;

COMMENT ON FUNCTION get_stock_position(UUID, DATE, DATE, INT, DATE) IS
  'Stock position + shipped demand for /dashboard/stock in one round-trip. Demand is EVENT-based (first order_history status_to=''uploaded'', falling back to orders.created_at with a flag). `committed` counts in-flight units with NO inventory_log scan row, so it stays correct once the warehouse starts scanning. Raw sums only — every rate, date and verdict is derived in lib/calculations/inventory-intelligence.ts.';

REVOKE ALL ON FUNCTION get_stock_position(UUID, DATE, DATE, INT, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION get_stock_position(UUID, DATE, DATE, INT, DATE) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'get_stock_position(UUID, DATE, DATE, INT, DATE)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can execute get_stock_position';
  END IF;
  IF NOT has_function_privilege('authenticated', 'get_stock_position(UUID, DATE, DATE, INT, DATE)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated cannot execute get_stock_position';
  END IF;
  RAISE NOTICE 'get_stock_position ready';
END $$;
