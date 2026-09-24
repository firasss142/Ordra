-- ============================================================
-- 20260819000001_order_history_market_id.sql
-- Denormalize orders.market_id onto order_history.market_id.
--
-- WHY: the investor daily rollup folds one market-day at a time and must
-- filter order_history by market. Without this column that means joining
-- orders on every read; with it the filter is a plain base-table predicate
-- backed by a composite (market_id, status_to, created_at) index.
--
-- NOTE: this is NOT the fix for the /api/profitability timeout. That was
-- solved upstream by 20260818000001_profitability_summary_rpc.sql via a
-- SECURITY DEFINER aggregate. This migration is purely additive and changes
-- no existing query path or policy.
--
-- WHY A TRIGGER: order_history is written from 5 TypeScript .insert() sites AND
-- ~30 SQL RPCs, none of which pass market_id. A BEFORE INSERT trigger is the
-- only place that covers every current and future write path with zero edits.
--
-- APPEND-ONLY COMPATIBILITY: market_id is an immutable derived attribute
-- (order_id -> orders.market_id never changes; market isolation forbids
-- re-homing an order). The trigger only fires on INSERT. No UPDATE/DELETE
-- policy is added. order_history stays append-only. The backfill is a one-time
-- correction of a newly added column, not mutation of business history.
--
-- Prerequisite for the investor portal, which needs since-inception reads.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Column
-- ------------------------------------------------------------
ALTER TABLE order_history
  ADD COLUMN IF NOT EXISTS market_id UUID REFERENCES markets(id);

-- ------------------------------------------------------------
-- 2. Backfill (runs in the same transaction as the column add, so no window
--    exists where rows have a NULL market_id)
-- ------------------------------------------------------------
UPDATE order_history oh
SET market_id = o.market_id
FROM orders o
WHERE o.id = oh.order_id
  AND oh.market_id IS NULL;

-- ------------------------------------------------------------
-- 3. BEFORE INSERT trigger — covers every write path
--    SECURITY DEFINER + pinned search_path so anon-context inserts can read
--    orders.market_id regardless of RLS.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_order_history_market_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.market_id IS NULL THEN
    SELECT market_id INTO NEW.market_id FROM orders WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_history_market_id ON order_history;
CREATE TRIGGER trg_order_history_market_id
  BEFORE INSERT ON order_history
  FOR EACH ROW EXECUTE FUNCTION set_order_history_market_id();

-- ------------------------------------------------------------
-- 4. Index supporting the P&L access pattern
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_order_history_market_status_created
  ON order_history (market_id, status_to, created_at);

-- ------------------------------------------------------------
-- 5. RLS is deliberately NOT modified.
--
-- An earlier draft of this migration rewrote order_history_select to match
-- managers on the new base column, because the per-row EXISTS was what made
-- /api/profitability time out. That problem is already solved upstream by
-- 20260818000001_profitability_summary_rpc.sql, which aggregates in a single
-- SECURITY DEFINER round-trip so the expensive predicate never fires and the
-- output stays byte-identical to the previous path.
--
-- Touching the policy now would add risk with no benefit: the investor rollup
-- runs under the service-role client (RLS off) and only needs the COLUMN to
-- filter on, not a policy change. Existing access rules are left exactly as
-- they are.
-- ------------------------------------------------------------
