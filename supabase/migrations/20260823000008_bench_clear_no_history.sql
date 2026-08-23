-- order_history is a log of status TRANSITIONS, not a scratchpad for notes.
--
-- WHAT WENT WRONG
--   clear_stale_bench_orders wrote one row per cleared order with
--   status_from = status_to = 'uploaded', reasoning that a bulk set-aside
--   deserves a permanent audit trail. Two readers took that shape at face
--   value and were immediately wrong:
--
--     * get_daily_funnel counts order_history rows with status_to = 'uploaded'
--       per day. Today's dashboard read 414 orders uploaded instead of 3.
--     * the bench clock is MAX(created_at) WHERE status_to = 'uploaded', so
--       every cleared order's age reset to zero — and a restored order could
--       never be cleared again, because its own clock now said it had just
--       arrived. Verified by restoring one order and watching the re-run skip
--       it.
--
-- THE FIX
--   The stamp is the record. `bench_cleared_at` says when, `bench_cleared_by`
--   says who, and report/bench-cleared-2026-08-23.json lists all 410 outside
--   the database entirely. Nothing that is not a status change belongs in
--   order_history — do not put it back.
--
-- The two DELETEs remove only the rows those two functions wrote, and are a
-- no-op on any database that never ran the first version.

DELETE FROM public.order_history
WHERE status_from = 'uploaded'
  AND status_to = 'uploaded'
  AND note LIKE 'Retirée de la file de préparation :%';

DELETE FROM public.order_history
WHERE status_from = status_to
  AND note = 'Remise dans la file de préparation.';

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
    SELECT o.id
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
    RETURNING o.id
  )
  SELECT COUNT(*)::INT INTO v_cleared FROM upd;

  RETURN json_build_object('cleared', COALESCE(v_cleared, 0), 'older_than_days', p_older_than_days);
END;
$$;

REVOKE ALL ON FUNCTION public.clear_stale_bench_orders(UUID, INT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_stale_bench_orders(UUID, INT, UUID) TO service_role;

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
    RETURNING o.id
  )
  SELECT COUNT(*)::INT INTO v_restored FROM upd;

  RETURN json_build_object('restored', COALESCE(v_restored, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.restore_bench_orders(UUID[], UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_bench_orders(UUID[], UUID) TO service_role;

-- Re-run: the one order restored while proving the undo works goes back.
SELECT public.clear_stale_bench_orders(NULL, 7, NULL);
