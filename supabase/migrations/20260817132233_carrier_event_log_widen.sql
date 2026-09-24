-- ============================================================
-- 20260909000001_carrier_event_log_widen.sql
--
-- Widen carrier_event_log so Darb Assabil can actually be logged.
--
-- THE BUG: 022_carrier_event_log.sql shipped
--     CHECK (carrier_code IN ('navex','dexpress'))
-- and never grew. Both Darb sync routes
-- (api/darb-assabil/sync-market, api/darb-assabil/sync-batch) insert
-- carrier_code = 'darb_assabil', and both wrap that insert in a
-- swallow-everything `catch {}` because it is forensic-only.
--
-- Result: EVERY Darb log insert has been rejected by the constraint and
-- silently discarded. Live proof — carrier_event_log holds 10 rows total, all
-- source='barcode_deletion' from Dexpress. Not one Darb row exists, despite
-- the unknown-status logging path having been in production since 20260817.
--
-- This is why the 74 orders whose shipments the OMS never caught up with left
-- no trace anywhere: the one place designed to record them silently dropped
-- every write.
--
-- Also widens:
--   * carrier_code → adds 'darb_assabil' and 'cosmos' (cosmos has 226 orders
--     and no credentials at all; when that is addressed it must be loggable).
--   * source       → adds 'cron'      (the scheduled Darb sweep)
--                    and  'reconcile' (the historical backfill script)
--     on top of the existing poll / webhook / barcode_deletion / tracking_view.
--
-- Purely additive: widening a CHECK cannot invalidate an existing row, so this
-- is safe to apply to a live table with no backfill and no lock concern beyond
-- the brief ACCESS EXCLUSIVE needed to swap the constraint.
-- ============================================================

ALTER TABLE carrier_event_log
  DROP CONSTRAINT IF EXISTS carrier_event_log_carrier_code_check;

ALTER TABLE carrier_event_log
  ADD CONSTRAINT carrier_event_log_carrier_code_check
  CHECK (carrier_code IN ('navex', 'dexpress', 'darb_assabil', 'cosmos'));

ALTER TABLE carrier_event_log
  DROP CONSTRAINT IF EXISTS carrier_event_log_source_check;

ALTER TABLE carrier_event_log
  ADD CONSTRAINT carrier_event_log_source_check
  CHECK (source IN (
    'poll',              -- generic carrier polling cron (Navex)
    'webhook',           -- carrier push (Navex only — Darb has no webhooks)
    'barcode_deletion',  -- shipment voided / barcode removed
    'tracking_view',     -- browser-triggered status read
    'cron',              -- scheduled Darb sweep
    'reconcile'          -- historical backfill / reconciliation script
  ));

COMMENT ON CONSTRAINT carrier_event_log_carrier_code_check ON carrier_event_log IS
  'Allowed carrier codes. MUST be widened before adding a carrier that logs events — '
  'the Darb sync routes swallow insert errors, so a missing code fails silently and '
  'costs you the entire forensic trail. See docs/darb-assabil-sync.md.';
