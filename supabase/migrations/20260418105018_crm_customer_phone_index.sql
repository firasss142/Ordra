-- Optimize CSV import dedup: `.eq(market_id).in(customer_phone, [...])`
-- already uses idx_leads_market_status for market filter, but dedup against
-- phones is a point lookup. Composite index gives a single B-tree probe per
-- phone instead of a partial scan.
CREATE INDEX IF NOT EXISTS idx_leads_market_phone
  ON leads (market_id, customer_phone);
