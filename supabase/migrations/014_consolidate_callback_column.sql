-- Consolidate duplicate callback columns: callback_time → callback_scheduled_at
-- callback_scheduled_at is used by RPCs and already indexed
-- callback_time was used by API routes (now updated to use callback_scheduled_at)

-- 1. Copy any data from callback_time to callback_scheduled_at where callback_scheduled_at is NULL
UPDATE orders
SET callback_scheduled_at = callback_time
WHERE callback_time IS NOT NULL AND callback_scheduled_at IS NULL;

-- 2. Drop the duplicate column
ALTER TABLE orders DROP COLUMN IF EXISTS callback_time;
