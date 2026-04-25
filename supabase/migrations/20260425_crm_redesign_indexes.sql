CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_phone_market
  ON leads (customer_phone, market_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_status_updated
  ON leads (status, updated_at DESC)
  WHERE status IN ('callback_scheduled', 'qualified');
