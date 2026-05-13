-- Per-delivery idempotency for webhook intake.
--
-- The prior dedupe key (storefront_id, external_id, event) collides when a
-- source sends two legitimate events of the same type (e.g. two orders/updated
-- minutes apart, second one silently dropped) and is also weaker than the
-- per-delivery IDs sources already provide. Shopify in particular sends
-- X-Shopify-Webhook-Id which is stable across retries — the ideal dedupe key.
--
-- This migration adds the per-delivery identity column and source-specific
-- Shopify metadata for tracing. The handler dedupes on (storefront_id,
-- delivery_id) when delivery_id is present, and falls back to the legacy
-- (storefront_id, external_id, event) for sources that don't expose one.
--
-- Idempotent: also backfills the storefront_id / external_id columns that
-- migration 026 was supposed to add, in case 026 never ran.

ALTER TABLE webhook_delivery_log
  ADD COLUMN IF NOT EXISTS storefront_id         uuid REFERENCES storefronts(id),
  ADD COLUMN IF NOT EXISTS external_id           text,
  ADD COLUMN IF NOT EXISTS delivery_id           text,
  ADD COLUMN IF NOT EXISTS shopify_event_id      text,
  ADD COLUMN IF NOT EXISTS shopify_topic         text,
  ADD COLUMN IF NOT EXISTS shopify_triggered_at  timestamptz;

-- Legacy (external_id, event) dedupe index from migration 026, recreated
-- if absent so the fallback path keeps a supporting index.
CREATE INDEX IF NOT EXISTS idx_wdl_dedup
  ON webhook_delivery_log (storefront_id, external_id, event)
  WHERE storefront_id IS NOT NULL AND external_id IS NOT NULL;

-- New per-delivery dedupe index. Unique so two deliveries with the same
-- (storefront_id, delivery_id) cannot both land — Postgres rejects the second
-- insert and the handler short-circuits via its pre-check.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wdl_delivery_dedup
  ON webhook_delivery_log (storefront_id, delivery_id)
  WHERE storefront_id IS NOT NULL AND delivery_id IS NOT NULL;
