-- ============================================================
-- 20260724000001_orders_carrier_status_slug.sql
-- Generic carrier-side status projection columns, usable by ANY carrier that
-- exposes a status API (first consumer: Darb Assabil). Mirrors the role of the
-- Dexpress-specific dexpress_status_slug columns, but carrier-neutral so future
-- carriers reuse it instead of adding a new pair of columns each time.
--
-- Drives the fermé-tab lifecycle bucket pill (Uploaded / Deposit / Delivered /
-- Returned / Cancelled / Rejected) without a per-row carrier call.
--
-- HARD RULE (see plans/darb-assabil-status-display.md):
--   orders.status is the OMS-internal source of truth. carrier_status_slug is a
--   cached projection of the carrier's view. They are correlated but NEVER
--   conflated. Stock / cost / revenue / order_history rules are unaffected by
--   this column — it is read-only display state.
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS carrier_status_slug TEXT,
  ADD COLUMN IF NOT EXISTS carrier_status_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN orders.carrier_status_slug IS
  'Cached projection of the carrier-side status (non-Dexpress carriers; first consumer Darb Assabil). NEVER drives stock/cost/revenue. See plans/darb-assabil-status-display.md';

COMMENT ON COLUMN orders.carrier_status_synced_at IS
  'Last successful carrier status sync for this order. NULL means never synced.';

-- Partial index for the fermé bucket counts/filter. Most orders won't carry a
-- carrier slug, so the WHERE clause keeps the index small (same pattern as
-- idx_orders_dexpress_status_slug).
CREATE INDEX IF NOT EXISTS idx_orders_carrier_status_slug
  ON orders (market_id, carrier_status_slug)
  WHERE carrier_status_slug IS NOT NULL;
