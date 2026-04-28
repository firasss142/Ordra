-- Phase 1b: Remap existing rows
--   'new'        -> 'pending'   (industry-standard wording)
--   'cancelled'  -> 'deleted'   (existing 'cancelled' rows were all manual deletions;
--                                the 'cancelled' enum value now means carrier-cancelled going forward)
--
-- Default on orders.status was 'new'; flip to 'pending'.

ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending';

UPDATE orders SET status = 'pending' WHERE status = 'new';
UPDATE orders SET status = 'deleted' WHERE status = 'cancelled';

UPDATE order_history SET status_from = 'pending' WHERE status_from = 'new';
UPDATE order_history SET status_to   = 'pending' WHERE status_to   = 'new';
UPDATE order_history SET status_from = 'deleted' WHERE status_from = 'cancelled';
UPDATE order_history SET status_to   = 'deleted' WHERE status_to   = 'cancelled';
