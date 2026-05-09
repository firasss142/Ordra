-- ============================================================
-- 20260618000002_orders_dexpress_state_id.sql
-- Capture the chosen Dexpress destination at order-creation time so the
-- dispatch step does not have to ask the agent to pick the city again.
-- The carrier-side state list is the source of truth for Libya orders.
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS dexpress_state_id INTEGER
    REFERENCES dexpress_states(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_dexpress_state_id
  ON orders(dexpress_state_id)
  WHERE dexpress_state_id IS NOT NULL;
