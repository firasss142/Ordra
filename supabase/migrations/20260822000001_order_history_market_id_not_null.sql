-- ============================================================
-- 20260822000001_order_history_market_id_not_null.sql
--
-- Harden order_history.market_id, then index it for the read patterns the
-- dashboard actually uses.
--
-- WHY NOT NULL: the next migration rewrites order_history_select to authorize
-- market_manager by order_history.market_id instead of a correlated EXISTS
-- against orders. A NULL market_id under that policy would silently hide a row
-- from its own market manager — a correctness bug that reads as "data is
-- missing", not as an error. NOT NULL turns that failure mode into an insert
-- error at write time instead.
--
-- Safe to enforce: 20260819000001 backfilled every row in the same transaction
-- that added the column, and its BEFORE INSERT trigger
-- (set_order_history_market_id) derives market_id from orders on every write
-- path — 5 TypeScript .insert() sites and ~30 SQL RPCs, none of which pass it
-- explicitly. order_id is already NOT NULL with an FK to orders, so the trigger
-- always has a row to read. order_history is append-only (no UPDATE/DELETE
-- policy), so a populated value cannot later be nulled.
--
-- WHY THESE INDEXES: idx_order_history_market_status_created leads with
-- market_id, so it cannot serve a super_admin's cross-market view, which
-- filters on created_at (and sometimes status_to) with no market predicate.
-- Those queries were doing a full scan of that index — the measured cause of
-- statement timeouts on /dashboard.
-- ============================================================

-- Fail loudly rather than silently skipping rows if the assumption ever broke.
DO $$
DECLARE
  v_nulls BIGINT;
BEGIN
  SELECT count(*) INTO v_nulls FROM order_history WHERE market_id IS NULL;
  IF v_nulls > 0 THEN
    -- Recover what we can from orders before giving up.
    UPDATE order_history oh
    SET market_id = o.market_id
    FROM orders o
    WHERE o.id = oh.order_id AND oh.market_id IS NULL;

    SELECT count(*) INTO v_nulls FROM order_history WHERE market_id IS NULL;
    IF v_nulls > 0 THEN
      RAISE EXCEPTION
        'order_history has % row(s) with NULL market_id that cannot be derived from orders; resolve before enforcing NOT NULL',
        v_nulls;
    END IF;
  END IF;
END $$;

ALTER TABLE order_history ALTER COLUMN market_id SET NOT NULL;

-- Cross-market (super_admin) reads: status + date, no market predicate.
CREATE INDEX IF NOT EXISTS idx_order_history_status_created
  ON order_history (status_to, created_at);

-- Cross-market reads that filter on date alone (the dashboard's period
-- history spans every status).
CREATE INDEX IF NOT EXISTS idx_order_history_created_at
  ON order_history (created_at);
