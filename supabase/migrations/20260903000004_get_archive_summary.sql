-- ============================================================
-- The archive summary, computed in one snapshot.
--
-- Replaces a Node-side aggregation that fetched up to 20 000 rows and counted
-- them in JavaScript. Two consequences of that were visible on the page:
-- counts silently truncated past the cap, and `total` was computed over a
-- different set than the outcome tiles, so the percentages could not sum to
-- 100%. Here every figure comes from one CTE in one statement, so
-- total = sum(outcomes) by construction.
--
-- Dated by `terminal_at` — when the order FINISHED — not `created_at`. The
-- median gap is 1 day for rejections and 4 for deliveries, which was enough to
-- put roughly 40% of orders in the wrong ISO week.
--
-- `deleted` is excluded throughout: a manually deleted order is a junk or
-- duplicate record a manager removed, not a sale that was lost. Every other
-- terminal status counts.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_archive_summary(
  p_market_id        UUID,
  p_from_date        DATE,
  p_to_date          DATE,
  p_statuses         TEXT[] DEFAULT NULL,
  p_q                TEXT   DEFAULT NULL,
  p_rejection_reason TEXT   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_role   TEXT;
  v_market UUID;
  v_from   TIMESTAMPTZ;
  v_to     TIMESTAMPTZ;
  v_needle TEXT;
  v_result JSONB;
BEGIN
  v_role   := get_user_role();
  v_market := get_user_market_id();

  IF v_role IS DISTINCT FROM 'super_admin' AND v_market IS DISTINCT FROM p_market_id THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- UTC-pinned, upper bound exclusive — matches get_profitability_daily.
  v_from   := (p_from_date::text || ' 00:00:00+00')::timestamptz;
  v_to     := ((p_to_date + 1)::text || ' 00:00:00+00')::timestamptz;
  v_needle := NULLIF(btrim(COALESCE(p_q, '')), '');

  WITH base AS (
    SELECT
      o.id, o.status::text AS status, o.rejection_reason::text AS reason,
      o.customer_city, o.attempts_count, o.customer_phone_2,
      o.terminal_at, o.created_at, o.archived_at
    FROM orders o
    WHERE o.market_id = p_market_id
      AND o.terminal_at >= v_from
      AND o.terminal_at <  v_to
      AND o.status <> 'deleted'
      AND (p_statuses IS NULL OR o.status::text = ANY (p_statuses))
      AND (p_rejection_reason IS NULL OR o.rejection_reason::text = p_rejection_reason)
      AND (v_needle IS NULL
           OR o.customer_name  ILIKE '%' || v_needle || '%'
           OR o.customer_phone ILIKE '%' || v_needle || '%'
           OR o.external_id    ILIKE '%' || v_needle || '%'
           OR o.product_name   ILIKE '%' || v_needle || '%')
  ),
  outcomes AS (
    SELECT
      count(*) AS total,
      jsonb_build_object(
        'delivered', count(*) FILTER (WHERE status = 'delivered'),
        'returned',  count(*) FILTER (WHERE status = 'returned'),
        'rejected',  count(*) FILTER (WHERE status = 'rejected'),
        'cancelled', count(*) FILTER (WHERE status = 'cancelled')
      ) AS j,
      count(*) FILTER (WHERE status IN ('delivered','returned')) AS shipped
    FROM base
  ),
  reasons AS (
    SELECT COALESCE(jsonb_object_agg(r, n), '{}'::jsonb) AS j
    FROM (
      SELECT COALESCE(reason, 'non_renseigne') AS r, count(*) AS n
      FROM base WHERE status = 'rejected' GROUP BY 1
    ) x
  ),
  -- The win-back split. "Never called" is the finding that matters: an order
  -- marked unreachable with zero recorded attempts was not refused, it was
  -- never worked.
  winback AS (
    SELECT jsonb_build_object(
      'total',        count(*),
      'never_called', count(*) FILTER (WHERE COALESCE(attempts_count, 0) = 0),
      'partial',      count(*) FILTER (WHERE COALESCE(attempts_count, 0) BETWEEN 1 AND 2),
      'exhausted',    count(*) FILTER (WHERE COALESCE(attempts_count, 0) >= 3),
      'second_phone', count(*) FILTER (WHERE COALESCE(btrim(customer_phone_2), '') <> '')
    ) AS j
    FROM base WHERE status = 'rejected' AND reason = 'injoignable'
  ),
  cities AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'city', city, 'shipped', shipped, 'returned', ret
           ) ORDER BY ret DESC, shipped DESC), '[]'::jsonb) AS j
    FROM (
      SELECT COALESCE(NULLIF(btrim(customer_city), ''), '—') AS city,
             count(*) FILTER (WHERE status IN ('delivered','returned')) AS shipped,
             count(*) FILTER (WHERE status = 'returned') AS ret
      FROM base
      GROUP BY 1
      HAVING count(*) FILTER (WHERE status IN ('delivered','returned')) > 0
      ORDER BY 3 DESC, 2 DESC
      LIMIT 12
    ) x
  ),
  -- Median and p90 of "how long until it ended", per outcome. Median, not mean:
  -- the mean is dragged by a long tail and reported 2.7 days where the median
  -- is 1.
  speed AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'status', status, 'n', n,
             'median_days', round(med::numeric, 1),
             'p90_days', round(p90::numeric, 1),
             'same_day', same_day
           ) ORDER BY n DESC), '[]'::jsonb) AS j
    FROM (
      SELECT status, count(*) AS n,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (terminal_at - created_at)) / 86400) AS med,
        percentile_cont(0.9) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (terminal_at - created_at)) / 86400) AS p90,
        count(*) FILTER (WHERE terminal_at - created_at < INTERVAL '1 day') AS same_day
      FROM base GROUP BY 1
    ) x
  ),
  cohorts AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'week', wk, 'delivered', d, 'returned', r,
             'rejected', j, 'cancelled', c, 'total', d + r + j + c
           ) ORDER BY wk), '[]'::jsonb) AS j
    FROM (
      SELECT to_char(terminal_at AT TIME ZONE 'UTC', 'IYYY"-W"IW') AS wk,
             count(*) FILTER (WHERE status = 'delivered') AS d,
             count(*) FILTER (WHERE status = 'returned')  AS r,
             count(*) FILTER (WHERE status = 'rejected')  AS j,
             count(*) FILTER (WHERE status = 'cancelled') AS c
      FROM base GROUP BY 1
    ) k
  ),
  -- Where the finished orders currently sit. Purely informational: archiving
  -- changes none of the figures above.
  placement AS (
    SELECT jsonb_build_object(
      'archived', count(*) FILTER (WHERE archived_at IS NOT NULL),
      'in_list',  count(*) FILTER (WHERE archived_at IS NULL)
    ) AS j FROM base
  )
  SELECT jsonb_build_object(
    'total',       o.total,
    'shipped',     o.shipped,
    'outcomes',    o.j,
    'reasons',     rs.j,
    'winback',     wb.j,
    'cities',      ci.j,
    'speed',       sp.j,
    'cohorts',     ch.j,
    'placement',   pl.j
  )
  INTO v_result
  FROM outcomes o, reasons rs, winback wb, cities ci, speed sp, cohorts ch, placement pl;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_archive_summary(UUID, DATE, DATE, TEXT[], TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_archive_summary(UUID, DATE, DATE, TEXT[], TEXT, TEXT) TO authenticated;
