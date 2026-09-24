-- Storefront connection-health tracking
-- Each successful webhook bumps last_webhook_received_at; each error bumps webhook_failure_count.
-- A successful delivery resets webhook_failure_count to 0.
ALTER TABLE storefronts
  ADD COLUMN IF NOT EXISTS last_webhook_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_webhook_status text CHECK (last_webhook_status IN ('processed', 'ignored', 'error')),
  ADD COLUMN IF NOT EXISTS last_webhook_error text,
  ADD COLUMN IF NOT EXISTS webhook_failure_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_storefronts_last_webhook
  ON storefronts (last_webhook_received_at DESC);
