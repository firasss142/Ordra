-- ============================================================
-- Archiving becomes a recorded, reversible act — and nothing more.
--
-- TWO timestamps, deliberately separate:
--
--   terminal_at  WHEN the order finished (delivered/returned/rejected/
--                cancelled/deleted). Stamped by a trigger, never by app code.
--                Drives the "30 days after it finished" rule, the weekly
--                cohorts, and "finished N days ago".
--
--   archived_at  WHEN somebody (or the rule) put it away. NULL means it is
--                still in the working Commandes list. This is a VISIBILITY
--                flag and nothing else: archived orders stay in every KPI,
--                every metric and every search.
--
-- Keeping them apart is the whole point. Before this, the archive was derived
-- from status alone, so "finished" and "put away" were the same event and
-- neither had a date — which is why the weekly cohorts were bucketing by order
-- creation and were wrong by a median of 1 to 7 days depending on outcome.
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS terminal_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.users(id);

COMMENT ON COLUMN public.orders.terminal_at IS
  'When the order reached its current terminal status. Written only by trg_orders_stamp_terminal — never by application code. NULL iff the order is still live.';
COMMENT ON COLUMN public.orders.archived_at IS
  'When the order was put away (manually or by the auto-archive rule). NULL = still shown in the default Commandes list. Visibility only: archived orders remain in all metrics and all searches.';
COMMENT ON COLUMN public.orders.archived_by IS
  'Who put it away. NULL when the auto-archive rule did it. order_history remains the authoritative audit trail.';

-- ---------- stamping ----------
CREATE OR REPLACE FUNCTION public.orders_stamp_terminal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_terminal CONSTANT public.order_status[] :=
    ARRAY['delivered','returned','rejected','cancelled','deleted']::public.order_status[];
  v_now BOOLEAN := NEW.status = ANY(v_terminal);
  v_was BOOLEAN := TG_OP = 'UPDATE' AND OLD.status = ANY(v_terminal);
BEGIN
  IF v_now AND NOT v_was THEN
    NEW.terminal_at := now();
  ELSIF v_was AND NOT v_now THEN
    -- The order came back to life (recover, reopen). It is no longer finished,
    -- so it cannot stay archived either — un-archiving is implicit and must be,
    -- otherwise a recovered order would be invisible in the list it belongs to.
    NEW.terminal_at := NULL;
    NEW.archived_at := NULL;
    NEW.archived_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Fires before trg_orders_updated_at (Postgres runs BEFORE triggers in name
-- order; 's' < 'u') and writes disjoint columns, so the two cannot conflict.
-- `UPDATE OF status` skips the body entirely on the ~90% of order updates that
-- do not touch status.
DROP TRIGGER IF EXISTS trg_orders_stamp_terminal ON public.orders;
CREATE TRIGGER trg_orders_stamp_terminal
  BEFORE INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_stamp_terminal();

-- ---------- backfill ----------
DO $backfill$
BEGIN
  -- trg_orders_updated_at sets updated_at = now() on ANY update. Left running,
  -- this backfill would touch every finished order and re-open the 7-day window
  -- in which agents may edit and reopen rejected orders. Sub-second at this row
  -- count, but it must be off while we write.
  ALTER TABLE public.orders DISABLE TRIGGER trg_orders_updated_at;

  WITH t AS (
    SELECT id, status, updated_at
    FROM public.orders
    WHERE status IN ('delivered','returned','rejected','cancelled','deleted')
      AND terminal_at IS NULL          -- idempotent: a re-run is a no-op
  ),
  last_event AS (
    -- The LATEST history row landing on the order's CURRENT status, not the
    -- earliest terminal row: orders that were archived, recovered and finished
    -- again would otherwise be stamped with a stale date.
    SELECT DISTINCT ON (t.id) t.id, h.created_at AS at
    FROM t
    JOIN public.order_history h ON h.order_id = t.id AND h.status_to = t.status
    ORDER BY t.id, h.created_at DESC
  )
  UPDATE public.orders o
     SET terminal_at = COALESCE(le.at, t.updated_at)
    FROM t LEFT JOIN last_event le ON le.id = t.id
   WHERE o.id = t.id;

  -- Any row that is no longer terminal must carry no stamp.
  UPDATE public.orders
     SET terminal_at = NULL, archived_at = NULL, archived_by = NULL
   WHERE terminal_at IS NOT NULL
     AND status NOT IN ('delivered','returned','rejected','cancelled','deleted');

  ALTER TABLE public.orders ENABLE TRIGGER trg_orders_updated_at;
END
$backfill$;

-- ---------- invariants ----------
-- Makes divergence structurally impossible: BEFORE triggers run ahead of
-- constraint evaluation, so these can only fire if someone disables the trigger.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_terminal_at_matches_status;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_terminal_at_matches_status
  CHECK ((status IN ('delivered','returned','rejected','cancelled','deleted'))
         = (terminal_at IS NOT NULL)) NOT VALID;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_terminal_at_matches_status;

-- An order that has not finished cannot be put away.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_archived_requires_terminal;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_archived_requires_terminal
  CHECK (archived_at IS NULL OR terminal_at IS NOT NULL) NOT VALID;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_archived_requires_terminal;

-- ---------- indexes ----------
-- The archive list: newest-archived first, keyset-paginated by (archived_at, id).
CREATE INDEX IF NOT EXISTS idx_orders_archived
  ON public.orders (market_id, archived_at DESC, id DESC)
  WHERE archived_at IS NOT NULL;

-- The eligibility scan the auto-archive rule runs, and the "ready to put away"
-- tab: finished, not yet put away, ordered by how long ago it finished.
CREATE INDEX IF NOT EXISTS idx_orders_terminal_unarchived
  ON public.orders (market_id, terminal_at)
  WHERE archived_at IS NULL AND terminal_at IS NOT NULL;
