-- ============================================================
-- 003_seed_data.sql
-- Markets, settings, carriers, storefronts, assignment_rules
-- ============================================================

-- ============================================================
-- MARKETS (2 rows)
-- ============================================================

INSERT INTO markets (id, code, name, language, currency, direction, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'tn', 'Tunisia', 'fr', 'TND', 'ltr', true),
  ('00000000-0000-0000-0000-000000000002', 'ly', 'Libya',   'ar', 'LYD', 'rtl', true);

-- ============================================================
-- SETTINGS (5 keys × 2 markets = 10 rows)
-- ============================================================

-- Tunisia settings
INSERT INTO settings (market_id, key, value) VALUES
  ('00000000-0000-0000-0000-000000000001', 'delivery_fee',            '{"amount": 6}'),
  ('00000000-0000-0000-0000-000000000001', 'return_fee',              '{"amount": 4}'),
  ('00000000-0000-0000-0000-000000000001', 'packing_cost',            '{"amount": 2}'),
  ('00000000-0000-0000-0000-000000000001', 'max_call_attempts',       '{"value": 3}'),
  ('00000000-0000-0000-0000-000000000001', 'assignment_algorithm',    '{"type": "manual"}');

-- Libya settings
INSERT INTO settings (market_id, key, value) VALUES
  ('00000000-0000-0000-0000-000000000002', 'delivery_fee',            '{"amount": 6}'),
  ('00000000-0000-0000-0000-000000000002', 'return_fee',              '{"amount": 4}'),
  ('00000000-0000-0000-0000-000000000002', 'packing_cost',            '{"amount": 2}'),
  ('00000000-0000-0000-0000-000000000002', 'max_call_attempts',       '{"value": 3}'),
  ('00000000-0000-0000-0000-000000000002', 'assignment_algorithm',    '{"type": "manual"}');

-- ============================================================
-- CARRIERS
-- Navex for Tunisia (delivery 6, return 4)
-- ============================================================

INSERT INTO carriers (market_id, name, code, delivery_fee, return_fee, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Navex', 'navex', 6.000, 4.000, true);

-- ============================================================
-- STOREFRONTS
-- Easy Orders for Tunisia
-- ============================================================

INSERT INTO storefronts (market_id, platform, name, webhook_secret, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'easy_orders', 'Easy Orders TN', 'changeme', true);

-- ============================================================
-- ASSIGNMENT RULES (2 rows — one per market)
-- ============================================================

INSERT INTO assignment_rules (market_id, algorithm, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'manual', true),
  ('00000000-0000-0000-0000-000000000002', 'manual', true);
