-- ============================================================
-- 20260924000002_orders_broadcast.sql
-- The Orders page hears about changes through Broadcast, not postgres_changes.
--
-- WHY: the Orders list subscribed to `postgres_changes` on `orders`. For every
-- WAL row, Realtime's poller evaluates the table's RLS policy once per
-- subscriber (realtime.apply_rls → list_changes). Production Realtime logs of
-- 2026-09-09 show that poll being cancelled by Postgres ("canceling statement
-- due to user request" inside realtime.apply_rls, 3×/day), the stream stopping
-- and restarting 5-9×/day, and the darb sync's ~117k order updates/day feeding
-- it. Managers refreshed the page to see status changes; new orders appeared
-- only after a reload.
--
-- WHAT: an AFTER trigger on `orders` publishes a slim message
--   { op, id, market_id, status, assigned_to, archived_at, updated_at }
-- on the private topic `orders:market:<market_id>` through realtime.send().
-- Authorisation happens once at channel join, through the SELECT policy on
-- realtime.messages below, instead of once per change per subscriber.
--
-- Two triggers, because one cannot reference OLD on INSERT nor NEW on DELETE.
-- The UPDATE trigger fires only when a column the list shows actually changed.
-- Never compare updated_at or carrier_status_*: promote_darb_status
-- (20260922000021) rewrites carrier_status_slug, carrier_status_synced_at and
-- tracking_number on every poll and bumps updated_at through
-- trg_orders_updated_at — that is the ~117k/day fan-out this WHEN clause exists
-- to keep off the socket.
--
-- SECURITY DEFINER on the trigger function is mandatory, not a convenience:
-- realtime.send() inserts into realtime.messages as the invoking role, that
-- table has RLS with no INSERT policy for `authenticated`, so a write made
-- through a user session (PATCH, transition_order_status) would have its
-- broadcast dropped as a warning while cron/service-role writes would work.
-- The body is wrapped so a Realtime hiccup can never fail an order write.
--
-- NON-GOALS: no column, index or existing policy is touched. Nothing is
-- dropped except the two triggers this file recreates. order_history and
-- inventory_log remain append-only and unreferenced. The nine other
-- postgres_changes subscribers keep working unchanged.
-- ============================================================

CREATE OR REPLACE FUNCTION public.orders_broadcast_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row     public.orders;
  v_market  uuid;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_market := COALESCE(NEW.market_id, OLD.market_id);
  IF v_market IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    PERFORM realtime.send(
      jsonb_build_object(
        'op',          TG_OP,
        'id',          v_row.id,
        'market_id',   v_market,
        'status',      v_row.status::text,
        'assigned_to', v_row.assigned_to,
        'archived_at', v_row.archived_at,
        'updated_at',  v_row.updated_at
      ),
      'order_changed',
      'orders:market:' || v_market::text,
      true
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'orders_broadcast_change: % (order %)', SQLERRM, v_row.id;
  END;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.orders_broadcast_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_orders_broadcast_ins_del ON public.orders;
CREATE TRIGGER trg_orders_broadcast_ins_del
  AFTER INSERT OR DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_broadcast_change();

DROP TRIGGER IF EXISTS trg_orders_broadcast_upd ON public.orders;
CREATE TRIGGER trg_orders_broadcast_upd
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (
    OLD.status                     IS DISTINCT FROM NEW.status
    OR OLD.assigned_to             IS DISTINCT FROM NEW.assigned_to
    OR OLD.archived_at             IS DISTINCT FROM NEW.archived_at
    OR OLD.carrier_id              IS DISTINCT FROM NEW.carrier_id
    OR OLD.tracking_number         IS DISTINCT FROM NEW.tracking_number
    OR OLD.customer_name           IS DISTINCT FROM NEW.customer_name
    OR OLD.customer_phone          IS DISTINCT FROM NEW.customer_phone
    OR OLD.customer_city           IS DISTINCT FROM NEW.customer_city
    OR OLD.product_id              IS DISTINCT FROM NEW.product_id
    OR OLD.quantity                IS DISTINCT FROM NEW.quantity
    OR OLD.total_price             IS DISTINCT FROM NEW.total_price
    OR OLD.callback_scheduled_at   IS DISTINCT FROM NEW.callback_scheduled_at
    OR OLD.attempts_count          IS DISTINCT FROM NEW.attempts_count
    OR OLD.rejection_reason        IS DISTINCT FROM NEW.rejection_reason
    OR OLD.carrier_barcode_deleted_at IS DISTINCT FROM NEW.carrier_barcode_deleted_at
  )
  EXECUTE FUNCTION public.orders_broadcast_change();

-- Who may join `orders:market:<uuid>`. Evaluated at join and token refresh,
-- not per message. Wrapped in (select …) so the users lookup runs once.
DROP POLICY IF EXISTS orders_broadcast_read ON realtime.messages;
CREATE POLICY orders_broadcast_read ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.topic() LIKE 'orders:market:%'
    AND (
      (select public.get_user_role()) = 'super_admin'
      OR (
        (select public.get_user_role()) IN ('market_manager', 'warehouse_agent')
        AND realtime.topic() = 'orders:market:' || (select public.get_user_market_id())::text
      )
    )
  );
