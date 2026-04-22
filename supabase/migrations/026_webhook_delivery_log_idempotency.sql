-- Add storefront_id + external_id to webhook_delivery_log for idempotency checks
ALTER TABLE webhook_delivery_log
  ADD COLUMN storefront_id uuid REFERENCES storefronts(id),
  ADD COLUMN external_id   text;

CREATE INDEX idx_wdl_dedup
  ON webhook_delivery_log (storefront_id, external_id, event)
  WHERE storefront_id IS NOT NULL AND external_id IS NOT NULL;
