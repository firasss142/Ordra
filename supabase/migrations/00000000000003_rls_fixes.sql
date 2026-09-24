-- ============================================================
-- 003_rls_fixes.sql
-- Fix critical and high-severity RLS issues found in audit.
--
-- Issues addressed:
--   CRITICAL-1  order_history_insert was WITH CHECK (true) — forge risk
--   CRITICAL-2  orders_insert unguarded branch allowed agent inserts
--   CRITICAL-3  inventory_log_insert allowed agent writes
--   HIGH-4      agents could read financial columns on products
--   HIGH-5      agents could read all settings (incl. financial keys)
--   HIGH-6      agents could read api_credentials on carriers
-- ============================================================

-- ============================================================
-- CRITICAL-1: Fix order_history_insert
-- Replace open WITH CHECK (true) with a check that the caller
-- has SELECT access to the referenced order (mirrors the SELECT
-- policy logic inline — no recursive RLS call needed).
-- ============================================================

DROP POLICY IF EXISTS "order_history_insert" ON order_history;

CREATE POLICY "order_history_insert"
  ON order_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_history.order_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND o.market_id = get_user_market_id())
          OR (get_user_role() = 'agent' AND o.assigned_to = auth.uid())
        )
    )
  );

-- ============================================================
-- CRITICAL-2: Fix orders_insert — remove unguarded branch
-- Only super_admin and market_manager may insert orders via
-- authenticated client. Service role (webhooks) bypasses RLS.
-- ============================================================

DROP POLICY IF EXISTS "orders_insert_system_mm_sa" ON orders;

CREATE POLICY "orders_insert_sa_mm"
  ON orders FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );

-- ============================================================
-- CRITICAL-3: Fix inventory_log_insert — restrict to SA + MM only
-- Inventory movements are system/manager operations only.
-- Agents never trigger deposit or returned transitions directly.
-- ============================================================

DROP POLICY IF EXISTS "inventory_log_insert" ON inventory_log;

CREATE POLICY "inventory_log_insert"
  ON inventory_log FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (
      get_user_role() = 'market_manager'
      AND EXISTS (
        SELECT 1 FROM products p
        WHERE p.id = inventory_log.product_id
          AND p.market_id = get_user_market_id()
      )
    )
  );

-- ============================================================
-- HIGH-4: Restrict financial columns on products from agents
-- Agents need: id, market_id, name, description, is_active,
--   initial_stock, current_stock, low_stock_threshold.
-- Agents must NOT see: unit_cost, packing_cost,
--   confirmation_processing_cost, cpl, damaged_return_count.
-- Implemented via column-level privileges on the authenticated role.
-- ============================================================

-- Revoke the sensitive financial columns from the authenticated role.
-- The service_role is unaffected (it bypasses column privileges too).
REVOKE SELECT (unit_cost, packing_cost, confirmation_processing_cost, cpl, damaged_return_count)
  ON products
  FROM authenticated;

-- Re-grant the same columns explicitly to the manager_role via a
-- Postgres role. Because Supabase uses a single `authenticated` JWT
-- role, column-level restriction is the only enforcement layer here.
-- Managers and SA access financial data via the admin client
-- (service_role) or a dedicated server-side route — never the
-- anon/authenticated client from the browser.
-- NOTE: If a dedicated `market_manager` database role is added later,
-- grant these columns to that role. For now this revoke applies to
-- all authenticated sessions, including managers. Financial reporting
-- must be done server-side via createAdminClient().

-- ============================================================
-- HIGH-5: Restrict settings read for agents
-- Agents should not read financial market settings.
-- Replace the broad select policy with a role-aware one.
-- Financial keys: delivery_fee, return_fee, packing_cost.
-- Non-financial keys agents may need: max_call_attempts,
--   assignment_algorithm (for display purposes).
-- Rather than filter by key name (fragile), restrict SELECT
-- entirely to SA and MM for authenticated clients. Agents
-- receive only what they need via server-side API routes.
-- ============================================================

DROP POLICY IF EXISTS "settings_select" ON settings;

CREATE POLICY "settings_select"
  ON settings FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );

-- ============================================================
-- HIGH-6: Restrict api_credentials on carriers from agents
-- Agents see carrier name, code, delivery_fee for display.
-- api_endpoint, api_credentials must not be readable by agents.
-- ============================================================

REVOKE SELECT (api_endpoint, api_credentials)
  ON carriers
  FROM authenticated;

-- Same note as products above: SA/MM access sensitive carrier
-- fields server-side via createAdminClient() only.
