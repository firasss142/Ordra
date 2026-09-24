-- ============================================================
-- 020_perf_seed_data.sql
-- Performance test data: LY market seed + TN bulk orders
--
-- Run this in Supabase SQL Editor (not as a tracked migration).
-- All INSERTs use ON CONFLICT DO NOTHING for idempotency.
-- Agent creation requires Supabase Auth — see comment below.
-- ============================================================

-- ============================================================
-- SECTION 1: LY market seed data
-- ============================================================

-- 1a. LY carrier (D-Express Libya)
INSERT INTO carriers (market_id, name, code, delivery_fee, return_fee, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'D-Express Libya',
  'dexpress_ly',
  8.000,
  5.000,
  true
)
ON CONFLICT (market_id, code) DO NOTHING;

-- 1b. LY storefront (Easy Orders Libya)
INSERT INTO storefronts (market_id, platform, name, webhook_secret, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'easy_orders',
  'Easy Orders LY',
  'changeme_ly',
  true
)
ON CONFLICT DO NOTHING;

-- NOTE: LY test agent requires Supabase Auth API first.
-- Use Supabase dashboard > Authentication > Add user:
--   Email: agent.ly@test.com  Password: TestAgent123!
-- Then run:
--   INSERT INTO users (id, email, full_name, phone, role, market_id)
--   VALUES ('<auth-user-id>', 'agent.ly@test.com', 'وكيل اختبار', '+218911234567',
--           'agent', '00000000-0000-0000-0000-000000000002');

-- 1c. LY test orders (5 orders, status = new, Arabic names)
DO $$
DECLARE
  v_storefront_id UUID;
BEGIN
  SELECT id INTO v_storefront_id
  FROM storefronts
  WHERE market_id = '00000000-0000-0000-0000-000000000002'
    AND platform = 'easy_orders'
  LIMIT 1;

  IF v_storefront_id IS NULL THEN
    RAISE EXCEPTION 'LY storefront not found — run section 1b first';
  END IF;

  INSERT INTO orders (
    market_id, storefront_id, external_id, external_platform,
    status, customer_name, customer_phone, customer_address,
    customer_city, product_name, quantity, unit_price, total_price
  )
  SELECT
    '00000000-0000-0000-0000-000000000002',
    v_storefront_id,
    'LY-TEST-' || g.n,
    'easy_orders',
    'new'::order_status,
    'عميل اختبار ' || g.n,
    '+21891000000' || g.n,
    'عنوان اختبار ' || g.n,
    CASE g.n % 3
      WHEN 0 THEN 'طرابلس'
      WHEN 1 THEN 'بنغازي'
      ELSE 'مصراتة'
    END,
    'منتج اختبار',
    1,
    45.000,
    45.000
  FROM generate_series(1, 5) AS g(n)
  ON CONFLICT (storefront_id, external_id) DO NOTHING;

  -- order_history for each new LY order
  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  SELECT o.id, NULL, 'new', NULL, 'system', 'LY test seed'
  FROM orders o
  WHERE o.storefront_id = v_storefront_id
    AND o.external_id LIKE 'LY-TEST-%'
    AND NOT EXISTS (
      SELECT 1 FROM order_history h WHERE h.order_id = o.id
    );
END $$;

-- ============================================================
-- SECTION 2: Verification queries (run after section 1)
-- ============================================================

-- SELECT * FROM markets WHERE id = '00000000-0000-0000-0000-000000000002';
-- SELECT * FROM carriers WHERE market_id = '00000000-0000-0000-0000-000000000002';
-- SELECT * FROM storefronts WHERE market_id = '00000000-0000-0000-0000-000000000002';
-- SELECT COUNT(*) FROM orders WHERE market_id = '00000000-0000-0000-0000-000000000002';
-- SELECT * FROM users WHERE market_id = '00000000-0000-0000-0000-000000000002' AND role = 'agent';
-- SELECT * FROM settings WHERE market_id = '00000000-0000-0000-0000-000000000002' ORDER BY key;

-- ============================================================
-- SECTION 3: TN performance bulk orders (1000 orders)
-- NOTE: Agents must exist before running this section.
-- Create TN test agents via Supabase dashboard first:
--   agent-perf-1@test.com through agent-perf-25@test.com
--   Then INSERT each into users with role='agent',
--   market_id='00000000-0000-0000-0000-000000000001'
-- ============================================================

DO $$
DECLARE
  v_storefront_id UUID;
  v_agent_ids UUID[];
  v_statuses order_status[] := ARRAY[
    'new', 'assigned', 'attempt_1', 'attempt_2', 'attempt_3',
    'callback_scheduled', 'confirmed', 'dispatched',
    'delivered', 'returned', 'rejected'
  ]::order_status[];
  v_agent_id UUID;
  v_status order_status;
  v_n INTEGER;
BEGIN
  SELECT id INTO v_storefront_id
  FROM storefronts
  WHERE market_id = '00000000-0000-0000-0000-000000000001'
  LIMIT 1;

  IF v_storefront_id IS NULL THEN
    RAISE EXCEPTION 'TN storefront not found';
  END IF;

  SELECT array_agg(id) INTO v_agent_ids
  FROM users
  WHERE market_id = '00000000-0000-0000-0000-000000000001'
    AND role = 'agent'
    AND is_active = true;

  FOR v_n IN 1..1000 LOOP
    v_status := v_statuses[1 + (v_n % array_length(v_statuses, 1))];

    IF v_agent_ids IS NOT NULL AND array_length(v_agent_ids, 1) > 0
       AND v_status != 'new' THEN
      v_agent_id := v_agent_ids[1 + (v_n % array_length(v_agent_ids, 1))];
    ELSE
      v_agent_id := NULL;
    END IF;

    INSERT INTO orders (
      market_id, storefront_id, external_id, external_platform,
      status, customer_name, customer_phone, customer_city,
      product_name, quantity, unit_price, total_price,
      assigned_to, created_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000001',
      v_storefront_id,
      'PERF-TEST-' || v_n,
      'easy_orders',
      v_status,
      'Client Test ' || v_n,
      '+2169800' || lpad(v_n::text, 4, '0'),
      CASE v_n % 5
        WHEN 0 THEN 'Tunis'
        WHEN 1 THEN 'Sfax'
        WHEN 2 THEN 'Sousse'
        WHEN 3 THEN 'Bizerte'
        ELSE 'Monastir'
      END,
      'Produit Test ' || (1 + v_n % 5),
      1,
      (20 + (v_n % 80))::numeric,
      (20 + (v_n % 80))::numeric,
      v_agent_id,
      now() - ((v_n || ' hours')::interval)
    )
    ON CONFLICT (storefront_id, external_id) DO NOTHING;

    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    SELECT o.id, NULL, 'new', NULL, 'system', 'Perf test seed'
    FROM orders o
    WHERE o.storefront_id = v_storefront_id
      AND o.external_id = 'PERF-TEST-' || v_n
      AND NOT EXISTS (SELECT 1 FROM order_history h WHERE h.order_id = o.id);
  END LOOP;
END $$;

-- Verify:
-- SELECT status, count(*) FROM orders
-- WHERE market_id = '00000000-0000-0000-0000-000000000001'
-- GROUP BY status ORDER BY count DESC;
