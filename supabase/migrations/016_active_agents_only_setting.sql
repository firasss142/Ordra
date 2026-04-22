-- Add active_agents_only setting per market (default: false)
INSERT INTO settings (market_id, key, value) VALUES
  ('00000000-0000-0000-0000-000000000001', 'active_agents_only', '{"value": false}'),
  ('00000000-0000-0000-0000-000000000002', 'active_agents_only', '{"value": false}')
ON CONFLICT (market_id, key) DO NOTHING;
