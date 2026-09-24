-- ============================================================
-- 20260925000004_order_items_lock_guard.sql
-- Extend the agent-presence guard to order_items.
--
-- WHY: 20260925000003 guarded `orders` only. But an order's line items are
-- edited through their own table, and the routes then recompute
-- orders.total_price in a SECOND PostgREST call. With the guard on `orders`
-- alone, a locked order produced exactly the split those routes exist to
-- prevent: the item write succeeded, the totals write was refused, and
-- order_items summed to one figure while orders.total_price kept another.
-- CLAUDE.md pins revenue to orders.total_price alone, so that divergence is
-- silent revenue corruption.
--
-- items/[itemId]/route.ts made it worse by discarding the error from its
-- recomputeTotal() update entirely — the split would not even have been logged.
--
-- A pre-flight check in the route would be TOCTOU-racy. Guarding the item write
-- itself means the first statement is refused and there is nothing to
-- compensate for.
--
-- Same seam as trg_orders_lock_guard: SECURITY INVOKER so current_user is the
-- REAL caller. In a DEFINER function current_user is the owner and the test
-- would never fire.
-- ============================================================

CREATE OR REPLACE FUNCTION public.order_items_assert_unlocked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_order_id uuid;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  PERFORM public.assert_order_unlocked(v_order_id, (select auth.uid()));
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.order_items_assert_unlocked() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_order_items_lock_guard ON public.order_items;
CREATE TRIGGER trg_order_items_lock_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.order_items_assert_unlocked();
