-- ============================================================
-- 20260526000001_orders_dexpress_status_slug.sql
-- Cache the carrier-side Dexpress status slug on each order so the fermé-tab
-- list can render a precise lifecycle bucket pill (Uploaded / Deposit /
-- Delivered / Returned / Rejected) without making a Dexpress call per row.
--
-- Hard rule (see plans/dexpress-list-status-bucket.md):
--   orders.status is the OMS-internal source of truth. dexpress_status_slug
--   is a cached projection of the carrier portal's view. They are correlated
--   but NEVER conflated. Stock / cost / revenue / order_history rules are
--   unaffected by this column.
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS dexpress_status_slug TEXT,
  ADD COLUMN IF NOT EXISTS dexpress_status_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dexpress_status_accepted BOOLEAN;

COMMENT ON COLUMN orders.dexpress_status_slug IS
  'Cached projection of the Dexpress portal status. NEVER drives stock/cost/revenue. See plans/dexpress-list-status-bucket.md';

COMMENT ON COLUMN orders.dexpress_status_synced_at IS
  'Last successful Dexpress sync timestamp for this order. NULL means never synced.';

COMMENT ON COLUMN orders.dexpress_status_accepted IS
  'Mirrors Dexpress order_accept field. FALSE = sitting in /merchant/pending-orders awaiting Dexpress operator review (order_status reuses the AT_CUSTOMER id ''1'' in this state, so the slug alone is ambiguous). TRUE = accepted and on the lifecycle. The bucket function overrides slug-based bucket to ''uploaded'' whenever this is FALSE.';

-- Partial index for the fermé bucket counts. Most orders won't have a slug,
-- so the WHERE clause keeps the index small.
CREATE INDEX IF NOT EXISTS idx_orders_dexpress_status_slug
  ON orders (market_id, dexpress_status_slug)
  WHERE dexpress_status_slug IS NOT NULL;
