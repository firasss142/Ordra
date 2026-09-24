-- Phase 1a: Add new enum values to order_status
-- Postgres requires ADD VALUE to be committed before the new value can be used.
-- Renames are achieved via ADD + UPDATE in a follow-up migration.

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'pending' BEFORE 'new';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'unverified' AFTER 'in_transit';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'received' AFTER 'to_be_returned';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'deleted' AFTER 'cancelled';
