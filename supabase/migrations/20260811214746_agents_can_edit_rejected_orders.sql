-- ============================================================
-- 20260829000005_agents_can_edit_rejected_orders.sql
-- Let agents actually edit a rejected order, which the UI has always offered.
--
-- WHY: `rejected` is in EDIT_WINDOWED_STATUSES (src/lib/order-permissions.ts:164),
-- so canEditOrder returns true for 7 days after rejection and the panel renders
-- every field as editable. But `rejected` was absent from orders_update's status
-- allow-list, so the UPDATE matched zero rows. PostgREST reports that as
-- { data: [], error: null } — not an error — so the route answered 200, the
-- panel flashed "saved", and the field snapped back to its old value. 844 live
-- rows sat in that window. The same gap let a line item land on a rejected
-- order while orders.total_price silently kept its old value.
--
-- 20260829000004 made both routes detect the zero-row result and fail loudly
-- (409 + rollback). This migration resolves it the other way for the case the
-- product actually wants: the edit should SUCCEED. The 409 now fires only for
-- statuses that are genuinely closed to agents.
--
-- The 7-day window is unchanged and still enforced in the application
-- (canEditOrder), not here — RLS grants the capability, the app decides when it
-- is still reasonable to use it.
--
-- BOTH USING and WITH CHECK need 'rejected'. WITH CHECK is evaluated against the
-- resulting row, and an edited rejected order is still rejected, so omitting it
-- there would reject every such update no matter what USING said.
--
-- On the widened WITH CHECK: this lets an agent set status='rejected' by direct
-- table UPDATE, skipping transition_order_status and its rejection_reason
-- requirement. That is not a new class of hole — the allow-list already permits
-- direct transitions into confirmed, uploaded and dispatch_scheduled, which are
-- further-reaching — and it is unreachable through the app, because the PATCH
-- route's editable-field list excludes `status` and all real transitions go
-- through the RPC. Closing that whole class properly means dropping direct
-- UPDATE from agents entirely and routing every write through
-- transition_order_status; that is a larger change and is not smuggled in here.
--
-- NON-GOALS: no table, column, index or function is touched. order_items RLS is
-- unchanged — it already had no status predicate, which is precisely why items
-- landed while the total did not.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "orders_update" ON orders;
CREATE POLICY "orders_update" ON orders FOR UPDATE TO authenticated
USING (
  (select get_user_role()) = 'super_admin'
  OR ((select get_user_role()) = 'market_manager' AND market_id = (select get_user_market_id()))
  OR (
    (select get_user_role()) = 'agent'
    AND assigned_to = (select auth.uid())
    AND status = ANY (ARRAY[
      'pending'::order_status, 'assigned'::order_status,
      'attempt_1'::order_status, 'attempt_2'::order_status, 'attempt_3'::order_status,
      'callback_scheduled'::order_status, 'confirmed'::order_status,
      'dispatch_scheduled'::order_status, 'uploaded'::order_status,
      'rejected'::order_status
    ])
  )
)
WITH CHECK (
  (select get_user_role()) = 'super_admin'
  OR ((select get_user_role()) = 'market_manager' AND market_id = (select get_user_market_id()))
  OR (
    (select get_user_role()) = 'agent'
    AND assigned_to = (select auth.uid())
    AND status = ANY (ARRAY[
      'pending'::order_status, 'assigned'::order_status,
      'attempt_1'::order_status, 'attempt_2'::order_status, 'attempt_3'::order_status,
      'callback_scheduled'::order_status, 'confirmed'::order_status,
      'dispatch_scheduled'::order_status, 'uploaded'::order_status,
      'rejected'::order_status
    ])
  )
);

COMMIT;
