-- warehouse_agent can WRITE the two append-only ledgers (through the scan
-- RPCs) but could never READ them back.
--
-- WHY
--   20260421_warehouse_rls.sql assumed "products / inventory_log / order_history
--   existing policies already cover warehouse_agent for own-market reads". They
--   did not: inventory_log_select is super_admin + market_manager only, and
--   order_history_select has no warehouse_agent arm at all. Measured on the
--   Libyan agent after 7 scans, 4 returns and 2 counts in one session:
--     · /warehouse/history (the Journal) → 0 events
--     · /api/warehouse/stock → last_counted_at NULL on a product counted twice,
--       so the card says "never counted" next to an 87.5 % accuracy that the
--       SECURITY DEFINER accuracy RPC could still compute
--     · the dashboard "N products never counted" is wrong for the same reason
--   The role that produces the ledger was the only one that could not see it.
--
-- Own-market only, SELECT only. INSERT stays as it was; UPDATE/DELETE are
-- still refused by the append-only triggers regardless of role.

DROP POLICY IF EXISTS "inventory_log_select" ON public.inventory_log;
CREATE POLICY "inventory_log_select" ON public.inventory_log
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (
      get_user_role() IN ('market_manager', 'warehouse_agent')
      AND EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = inventory_log.product_id
          AND p.market_id = get_user_market_id()
      )
    )
  );

DROP POLICY IF EXISTS "order_history_select" ON public.order_history;
CREATE POLICY "order_history_select" ON public.order_history
  FOR SELECT TO authenticated
  USING (
    (SELECT get_user_role()) = 'super_admin'
    OR (
      (SELECT get_user_role()) IN ('market_manager', 'warehouse_agent')
      AND market_id = (SELECT get_user_market_id())
    )
    OR (
      (SELECT get_user_role()) = 'agent'
      AND EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = order_history.order_id
          AND o.assigned_to = (SELECT auth.uid())
      )
    )
  );
