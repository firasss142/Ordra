-- ============================================================
-- 20260525000001_carrier_event_log_tracking_view.sql
-- Allow carrier_event_log.source = 'tracking_view' so the
-- GET /api/orders/{id}/dexpress-status route can record unknown
-- Dexpress status IDs for offline taxonomy review.
--
-- Mirrors the pattern from 20260620000001_carrier_barcode_deletion.sql
-- (which added 'barcode_deletion' the same way).
-- ============================================================

ALTER TABLE carrier_event_log
  DROP CONSTRAINT IF EXISTS carrier_event_log_source_check;
ALTER TABLE carrier_event_log
  ADD CONSTRAINT carrier_event_log_source_check
    CHECK (source IN ('poll', 'webhook', 'barcode_deletion', 'tracking_view'));
