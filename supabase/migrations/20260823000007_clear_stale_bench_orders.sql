-- Préparation — take the historical backlog off the bench, and start fresh.
--
-- WHY
--   The bench holds 410 orders at `uploaded` and NOT ONE of them arrived in the
--   last seven days. The newest reached the bench on 2026-08-16; 340 have been
--   there over sixty days, the oldest since 2026-05-21. It is not a queue, it
--   is the residue of a historical import: 327 of them carry no Darb id at all,
--   so they cannot even be scanned, and 14 already left for delivery.
--
--   A queue nobody can work is worse than an empty one. It makes every figure
--   on the screen describe the past — "plus ancien : 95 j", "en retard 407" —
--   and buries whatever real work arrives tomorrow.
--
-- WHAT THIS IS NOT
--   It is NOT archiving. `archived_at` means "finished and put away", and the
--   CHECK `orders_archived_requires_terminal` refuses it for a live order —
--   correctly, because these orders have not finished.
--
--   It is NOT a status change. Their status is what happened to them, and
--   tidying a list must never rewrite that. 53 are still `pending` at Darb and
--   14 are out for delivery; calling them cancelled would be a lie that lands
--   in the delivery-rate metrics.
--
--   It touches NO stock. Stock moves at `scanned`; nothing here was ever
--   scanned, so nothing was ever deducted, and nothing is given back.
--
-- WHAT IT IS
--   A recorded, reversible statement that an order is no longer the warehouse's
--   work. `bench_cleared_at` says when, `bench_cleared_by` says who, an
--   order_history row says it permanently even after a restore, and
--   `restore_bench_orders` puts any of them back.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS bench_cleared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bench_cleared_by UUID REFERENCES public.users(id);

COMMENT ON COLUMN public.orders.bench_cleared_at IS
  'When the order was taken off the preparation bench. Visibility only: status, stock and every metric are untouched. NULL = still warehouse work. Distinct from archived_at, which requires a terminal status.';
COMMENT ON COLUMN public.orders.bench_cleared_by IS
  'Who took it off the bench. NULL when a maintenance run did it; order_history carries the permanent record either way.';

-- ── Clear ───────────────────────────────────────────────────────────────────
--
-- Measured on the BENCH clock — the `uploaded` event — not on intake, which is
-- the same clock every age on Préparation uses. Only our-warehouse orders:
-- a parcel shipped from the carrier's own warehouse never reaches this bench,
-- so it was never waiting on a scan.

CREATE OR REPLACE FUNCTION public.clear_stale_bench_orders(
  p_market_id       UUID DEFAULT NULL,
  p_older_than_days INT  DEFAULT 7,
  p_actor_id        UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cleared INT;
BEGIN
  IF p_older_than_days IS NULL OR p_older_than_days < 1 THEN
    RAISE EXCEPTION 'p_older_than_days must be at least 1 — clearing today''s bench is never intended';
  END IF;

  WITH stale AS (
    SELECT o.id, o.market_id
    FROM orders o
    WHERE o.status = 'uploaded'
      AND o.archived_at IS NULL
      AND o.bench_cleared_at IS NULL
      AND (o.carrier_extra->>'fulfil_from_carrier_warehouse') IS DISTINCT FROM 'true'
      AND (p_market_id IS NULL OR o.market_id = p_market_id)
      AND COALESCE(
            (SELECT MAX(h.created_at) FROM order_history h
              WHERE h.order_id = o.id AND h.status_to::TEXT = 'uploaded'),
            o.created_at
          ) < now() - make_interval(days => p_older_than_days)
  ), upd AS (
    UPDATE orders o
       SET bench_cleared_at = now(),
           bench_cleared_by = p_actor_id
      FROM stale s
     WHERE o.id = s.id
    RETURNING o.id, o.market_id
  ), hist AS (
    -- Same status on both sides on purpose: nothing happened TO the order, we
    -- only stopped asking the warehouse for it. The note carries the reason,
    -- and order_history is append-only, so a later restore cannot erase it.
    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note, market_id)
    SELECT u.id, 'uploaded'::order_status, 'uploaded'::order_status,
           p_actor_id,
           CASE WHEN p_actor_id IS NULL THEN 'system' ELSE 'manager' END,
           format('Retirée de la file de préparation : sur le banc depuis plus de %s jours. Statut, stock et métriques inchangés.',
                  p_older_than_days),
           u.market_id
    FROM upd u
    RETURNING 1
  )
  SELECT COUNT(*)::INT INTO v_cleared FROM upd;

  RETURN json_build_object('cleared', COALESCE(v_cleared, 0), 'older_than_days', p_older_than_days);
END;
$$;

REVOKE ALL ON FUNCTION public.clear_stale_bench_orders(UUID, INT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_stale_bench_orders(UUID, INT, UUID) TO service_role;

COMMENT ON FUNCTION public.clear_stale_bench_orders(UUID, INT, UUID) IS
  'Takes our-warehouse `uploaded` orders off the preparation bench once they have sat there longer than p_older_than_days, measured from the uploaded event. Sets bench_cleared_at only — never status, never stock. Idempotent.';

-- ── Put one back ────────────────────────────────────────────────────────────
--
-- A bulk set-aside with no way back is a bulk delete wearing a softer word.

CREATE OR REPLACE FUNCTION public.restore_bench_orders(
  p_order_ids UUID[],
  p_actor_id  UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restored INT;
BEGIN
  WITH upd AS (
    UPDATE orders o
       SET bench_cleared_at = NULL,
           bench_cleared_by = NULL
     WHERE o.id = ANY(p_order_ids)
       AND o.bench_cleared_at IS NOT NULL
    RETURNING o.id, o.market_id, o.status
  ), hist AS (
    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note, market_id)
    SELECT u.id, u.status, u.status, p_actor_id,
           CASE WHEN p_actor_id IS NULL THEN 'system' ELSE 'manager' END,
           'Remise dans la file de préparation.', u.market_id
    FROM upd u
    RETURNING 1
  )
  SELECT COUNT(*)::INT INTO v_restored FROM upd;

  RETURN json_build_object('restored', COALESCE(v_restored, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.restore_bench_orders(UUID[], UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_bench_orders(UUID[], UUID) TO service_role;

-- ── The queue stops showing them ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_to_label_orders(
  p_market_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_cursor_created_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  customer_name TEXT,
  customer_phone TEXT,
  customer_city TEXT,
  customer_area TEXT,
  customer_address TEXT,
  product_id UUID,
  product_name TEXT,
  variant_label TEXT,
  quantity INTEGER,
  total_price NUMERIC,
  status TEXT,
  created_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ,
  tracking_number TEXT,
  carrier_sticker_ref TEXT,
  carrier_status_slug TEXT,
  branch_group TEXT,
  has_carrier_ref BOOLEAN,
  current_stock INTEGER,
  low_stock_threshold INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    o.id, o.customer_name, o.customer_phone, o.customer_city,
    o.carrier_extra->>'customer_area',
    o.customer_address,
    o.product_id, o.product_name, o.variant_label, o.quantity, o.total_price,
    o.status::TEXT, o.created_at,
    (SELECT MAX(h.created_at) FROM order_history h
      WHERE h.order_id = o.id AND h.status_to::TEXT = 'uploaded'),
    o.tracking_number,
    o.carrier_sticker_ref,
    o.carrier_status_slug,
    o.carrier_extra->>'darb_branch_group',
    (o.carrier_extra->>'darb_assabil_id') IS NOT NULL,
    p.current_stock, p.low_stock_threshold
  FROM orders o
  LEFT JOIN products p ON p.id = o.product_id
  WHERE o.status = 'uploaded'
    AND o.archived_at IS NULL
    AND o.bench_cleared_at IS NULL
    AND (o.carrier_extra->>'fulfil_from_carrier_warehouse') IS DISTINCT FROM 'true'
    AND (p_market_id IS NULL OR o.market_id = p_market_id)
    AND (
      p_cursor_created_at IS NULL
      OR (o.created_at, o.id) > (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY o.created_at ASC, o.id ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_to_label_orders(UUID, INTEGER, TIMESTAMPTZ, UUID) TO PUBLIC;

-- ── …and so do the counts that describe it ──────────────────────────────────
--
-- Every uploaded-based figure drops the cleared orders, because each one is a
-- statement about the rows on the screen. `set_aside` is added rather than the
-- orders simply vanishing: 410 orders leaving the bench without a trace on the
-- bench's own screen is exactly the silent behaviour this console avoids.

CREATE OR REPLACE FUNCTION public.get_warehouse_queue_stats(p_market_id UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH scoped AS (
    SELECT o.*,
           (o.carrier_extra->>'fulfil_from_carrier_warehouse') IS DISTINCT FROM 'true' AS ours,
           o.bench_cleared_at IS NULL AS on_bench,
           COALESCE(
             (SELECT MAX(h.created_at) FROM order_history h
               WHERE h.order_id = o.id AND h.status_to::TEXT = 'uploaded'),
             o.created_at
           ) AS bench_at
    FROM orders o
    WHERE o.archived_at IS NULL
      AND (p_market_id IS NULL OR o.market_id = p_market_id)
  )
  SELECT json_build_object(
    'to_prepare',
      COUNT(*) FILTER (WHERE status = 'uploaded' AND ours AND on_bench),
    'oldest_prepare_hours',
      COALESCE(
        MAX(EXTRACT(EPOCH FROM (now() - bench_at)) / 3600.0)
          FILTER (WHERE status = 'uploaded' AND ours AND on_bench),
        0
      )::INT,
    'late_prepare',
      COUNT(*) FILTER (
        WHERE status = 'uploaded' AND ours AND on_bench
          AND bench_at <  now() - INTERVAL '2 days'
          AND bench_at >= now() - INTERVAL '7 days'
      ),
    'never_scanned',
      COUNT(*) FILTER (WHERE status = 'uploaded' AND ours AND on_bench AND bench_at < now() - INTERVAL '7 days'),
    'confirmed_not_uploaded',
      COUNT(*) FILTER (WHERE status = 'confirmed'),
    'carrier_warehouse',
      COUNT(*) FILTER (WHERE status = 'uploaded' AND NOT ours),
    'returns_inbox',
      COUNT(*) FILTER (WHERE status = 'to_be_returned'),
    'to_hand_over',
      COUNT(*) FILTER (WHERE status = 'scanned'),
    'released_at_carrier',
      COUNT(*) FILTER (
        WHERE status = 'uploaded' AND ours AND on_bench
          AND carrier_status_slug IN ('released', 'completed', 'returning', 'returned')
      ),
    -- Taken off the bench, still at `uploaded`, still in every metric.
    'set_aside',
      COUNT(*) FILTER (WHERE status = 'uploaded' AND ours AND NOT on_bench)
  )
  FROM scoped;
$$;

GRANT EXECUTE ON FUNCTION public.get_warehouse_queue_stats(UUID) TO PUBLIC;

-- ── The one-off: start fresh from a week ago ─────────────────────────────────
--
-- A no-op on a fresh database, and idempotent on this one.
SELECT public.clear_stale_bench_orders(NULL, 7, NULL);
