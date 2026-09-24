-- Flag that a manager has escalated an in-flight order to its carrier and is
-- awaiting manual follow-up. Cleared explicitly when the order exits Phase 2
-- or when a manager dismisses the flag.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS needs_carrier_followup BOOLEAN NOT NULL DEFAULT false;

-- Partial index: we only ever query where the flag is true, scoped by market.
CREATE INDEX IF NOT EXISTS idx_orders_needs_carrier_followup
  ON orders (market_id, carrier_id)
  WHERE needs_carrier_followup = true;
