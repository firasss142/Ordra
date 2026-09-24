-- tracking_number column and index already exist from 001_initial_schema.sql and 022_carrier_event_log.sql
-- This migration is a no-op guard in case of fresh environments
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number text;
CREATE INDEX IF NOT EXISTS idx_orders_tracking_number ON orders(tracking_number);
