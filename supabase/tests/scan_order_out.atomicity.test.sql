-- pgTAP atomicity tests for scan_order_out RPC
-- Run via: psql $DATABASE_URL -f supabase/tests/scan_order_out.atomicity.test.sql
--
-- Requirements:
--   CREATE EXTENSION IF NOT EXISTS pgtap;
--   The warehouse schema migrations must be applied first.

BEGIN;

SELECT plan(25);

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers
-- ─────────────────────────────────────────────────────────────────────────────

-- Insert a bare-minimum market (skip triggers/RLS — test runs as postgres superuser)
CREATE TEMP TABLE _test_ids (
  wh_market_id  UUID DEFAULT gen_random_uuid(),
  other_market  UUID DEFAULT gen_random_uuid(),
  wh_agent_id   UUID DEFAULT gen_random_uuid(),
  sa_agent_id   UUID DEFAULT gen_random_uuid(),
  product_id    UUID DEFAULT gen_random_uuid()
);
INSERT INTO _test_ids DEFAULT VALUES;

DO $$
DECLARE
  r _test_ids%ROWTYPE;
BEGIN
  SELECT * INTO r FROM _test_ids;

  -- Markets
  INSERT INTO markets (id, name, code, currency)
  VALUES (r.wh_market_id, 'Test Market', 'TM', 'TND'),
         (r.other_market, 'Other Market', 'OM', 'LYD')
  ON CONFLICT DO NOTHING;

  -- Users: one warehouse_agent, one super_admin
  INSERT INTO users (id, email, role, market_id)
  VALUES (r.wh_agent_id, 'wh_test@test.local', 'warehouse_agent', r.wh_market_id),
         (r.sa_agent_id, 'sa_test@test.local', 'super_admin',     NULL)
  ON CONFLICT DO NOTHING;

  -- Product with enough stock
  INSERT INTO products (id, name, market_id, current_stock, initial_stock, price)
  VALUES (r.product_id, 'Test Widget', r.wh_market_id, 10, 10, 99.00)
  ON CONFLICT DO NOTHING;
END $$;

-- Helper: insert a confirmed order, return its id
CREATE OR REPLACE FUNCTION _mk_confirmed_order(p_market UUID, p_product UUID, p_qty INT DEFAULT 1)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO orders (id, market_id, product_id, quantity, status,
                      customer_name, customer_phone, total_price)
  VALUES (v_id, p_market, p_product, p_qty, 'confirmed',
          'Test Customer', '0600000000', 100.00);
  RETURN v_id;
END $$;

-- Helper: add a label_prints row (simulates printed label)
CREATE OR REPLACE FUNCTION _mk_label(p_order UUID, p_actor UUID, p_market UUID)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO label_prints (order_id, market_id, printed_by, batch_id, is_reprint, bl_number)
  VALUES (p_order, p_market, p_actor, gen_random_uuid(), false,
          lpad(floor(random()*1e12)::text, 12, '0'));
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Case 1: Happy path — confirms atomicity of all three mutations
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r _test_ids%ROWTYPE;
  v_order UUID;
  v_result JSON;
BEGIN
  SELECT * INTO r FROM _test_ids;
  v_order := _mk_confirmed_order(r.wh_market_id, r.product_id);
  PERFORM _mk_label(v_order, r.wh_agent_id, r.wh_market_id);
  v_result := scan_order_out(v_order, r.wh_agent_id);
  -- store result order id for pgtap assertions below
  PERFORM set_config('test.happy_order', v_order::text, true);
  PERFORM set_config('test.happy_result', v_result::text, true);
END $$;

SELECT is(
  (SELECT status FROM orders WHERE id = current_setting('test.happy_order')::uuid),
  'scanned',
  'Case 1: order status is scanned after scan_order_out'
);

SELECT is(
  (SELECT current_stock FROM products
   WHERE id = (SELECT product_id FROM orders WHERE id = current_setting('test.happy_order')::uuid)),
  9,
  'Case 1: stock decremented by 1'
);

SELECT ok(
  EXISTS(SELECT 1 FROM inventory_log
         WHERE order_id = current_setting('test.happy_order')::uuid
           AND reason = 'scanned'
           AND change = -1
           AND balance_after = 9),
  'Case 1: inventory_log row inserted with correct values'
);

SELECT ok(
  EXISTS(SELECT 1 FROM order_history
         WHERE order_id = current_setting('test.happy_order')::uuid
           AND status_from = 'confirmed'
           AND status_to = 'scanned'),
  'Case 1: order_history row inserted with confirmed→scanned'
);

SELECT is(
  (current_setting('test.happy_result')::json)->>'status',
  'scanned',
  'Case 1: returned JSON has status=scanned'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Case 2: Double-scan — second call rejected, stock not double-decremented
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r _test_ids%ROWTYPE;
  v_order UUID;
  v_stock_before INT;
BEGIN
  -- Use the same order from Case 1 (already scanned)
  v_order := current_setting('test.happy_order')::uuid;
  SELECT * INTO r FROM _test_ids;

  SELECT current_stock INTO v_stock_before
  FROM products WHERE id = r.product_id;

  -- This call must raise an exception
  BEGIN
    PERFORM scan_order_out(v_order, r.wh_agent_id);
    PERFORM set_config('test.double_raised', 'false', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('test.double_raised', 'true', true);
    PERFORM set_config('test.double_stock_before', v_stock_before::text, true);
  END;
END $$;

SELECT is(current_setting('test.double_raised'), 'true',
  'Case 2: double-scan raises exception');

SELECT is(
  (SELECT current_stock FROM products
   WHERE id = (SELECT product_id FROM orders WHERE id = current_setting('test.happy_order')::uuid)),
  current_setting('test.double_stock_before')::int,
  'Case 2: stock not decremented a second time'
);

SELECT is(
  (SELECT count(*)::int FROM inventory_log
   WHERE order_id = current_setting('test.happy_order')::uuid AND reason = 'scanned'),
  1,
  'Case 2: only one inventory_log row for the scanned order'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Case 3: Stock underflow — stock=0, scan must be rejected, nothing committed
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r _test_ids%ROWTYPE;
  v_order UUID;
  v_zero_product UUID := gen_random_uuid();
BEGIN
  SELECT * INTO r FROM _test_ids;

  -- Product with zero stock
  INSERT INTO products (id, name, market_id, current_stock, initial_stock, price)
  VALUES (v_zero_product, 'Zero Stock Widget', r.wh_market_id, 0, 5, 49.00);

  v_order := _mk_confirmed_order(r.wh_market_id, v_zero_product);
  PERFORM _mk_label(v_order, r.wh_agent_id, r.wh_market_id);

  PERFORM set_config('test.zero_order', v_order::text, true);
  PERFORM set_config('test.zero_product', v_zero_product::text, true);

  BEGIN
    PERFORM scan_order_out(v_order, r.wh_agent_id);
    PERFORM set_config('test.zero_raised', 'false', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('test.zero_raised', 'true', true);
  END;
END $$;

SELECT is(current_setting('test.zero_raised'), 'true',
  'Case 3: scan with zero stock raises exception');

SELECT is(
  (SELECT status FROM orders WHERE id = current_setting('test.zero_order')::uuid),
  'confirmed',
  'Case 3: order status unchanged (still confirmed)'
);

SELECT is(
  (SELECT current_stock FROM products WHERE id = current_setting('test.zero_product')::uuid),
  0,
  'Case 3: stock stays at 0 (no decrement)'
);

SELECT is(
  (SELECT count(*)::int FROM inventory_log
   WHERE order_id = current_setting('test.zero_order')::uuid),
  0,
  'Case 3: no inventory_log row inserted'
);

SELECT is(
  (SELECT count(*)::int FROM order_history
   WHERE order_id = current_setting('test.zero_order')::uuid),
  0,
  'Case 3: no order_history row inserted'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Case 4: Missing label — scan rejected before any mutation
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r _test_ids%ROWTYPE;
  v_order UUID;
BEGIN
  SELECT * INTO r FROM _test_ids;
  v_order := _mk_confirmed_order(r.wh_market_id, r.product_id);
  -- Intentionally do NOT call _mk_label

  PERFORM set_config('test.nolabel_order', v_order::text, true);

  BEGIN
    PERFORM scan_order_out(v_order, r.wh_agent_id);
    PERFORM set_config('test.nolabel_raised', 'false', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('test.nolabel_raised', 'true', true);
  END;
END $$;

SELECT is(current_setting('test.nolabel_raised'), 'true',
  'Case 4: missing label raises exception');

SELECT is(
  (SELECT status FROM orders WHERE id = current_setting('test.nolabel_order')::uuid),
  'confirmed',
  'Case 4: order status unchanged'
);

SELECT is(
  (SELECT count(*)::int FROM inventory_log
   WHERE order_id = current_setting('test.nolabel_order')::uuid),
  0,
  'Case 4: no inventory_log row inserted'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Case 5: Market mismatch — warehouse_agent from another market is rejected
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r _test_ids%ROWTYPE;
  v_order UUID;
  v_foreign_agent UUID := gen_random_uuid();
BEGIN
  SELECT * INTO r FROM _test_ids;

  -- Agent belonging to other_market
  INSERT INTO users (id, email, role, market_id)
  VALUES (v_foreign_agent, 'foreign_wh@test.local', 'warehouse_agent', r.other_market)
  ON CONFLICT DO NOTHING;

  -- Order in wh_market
  v_order := _mk_confirmed_order(r.wh_market_id, r.product_id);
  PERFORM _mk_label(v_order, r.wh_agent_id, r.wh_market_id);

  PERFORM set_config('test.mismatch_order', v_order::text, true);

  BEGIN
    PERFORM scan_order_out(v_order, v_foreign_agent);
    PERFORM set_config('test.mismatch_raised', 'false', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('test.mismatch_raised', 'true', true);
  END;
END $$;

SELECT is(current_setting('test.mismatch_raised'), 'true',
  'Case 5: market mismatch raises exception');

SELECT is(
  (SELECT status FROM orders WHERE id = current_setting('test.mismatch_order')::uuid),
  'confirmed',
  'Case 5: order status unchanged after market mismatch'
);

SELECT is(
  (SELECT count(*)::int FROM inventory_log
   WHERE order_id = current_setting('test.mismatch_order')::uuid),
  0,
  'Case 5: no inventory_log row on market mismatch'
);

SELECT * FROM finish();

ROLLBACK;
