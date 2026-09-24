-- ============================================================
-- 007_session5_carriers_and_queue.sql
-- Extend carriers table + add callback_time to orders
-- Add dexpress status column + agent queue RLS
-- ============================================================

-- 1. Extend carriers table
ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS carrier_type TEXT NOT NULL DEFAULT 'navex',
  ADD COLUMN IF NOT EXISTS sender_name TEXT,
  ADD COLUMN IF NOT EXISTS sender_location TEXT,
  ADD COLUMN IF NOT EXISTS api_base_url TEXT;

ALTER TABLE carriers DROP CONSTRAINT IF EXISTS carriers_carrier_type_check;
ALTER TABLE carriers ADD CONSTRAINT carriers_carrier_type_check
  CHECK (carrier_type IN ('navex', 'dexpress'));

-- 2. Add callback_time to orders (separate from callback_scheduled_at used by session-05 RPC)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS callback_time TIMESTAMPTZ;

-- 3. Add status column to dexpress_states and dexpress_places (for filtering active entries)
ALTER TABLE dexpress_states
  ADD COLUMN IF NOT EXISTS status INTEGER NOT NULL DEFAULT 1;

ALTER TABLE dexpress_places
  ADD COLUMN IF NOT EXISTS status INTEGER NOT NULL DEFAULT 1;

-- 4. Agent queue RLS: agents see only their own orders in confirmation phase
-- (orders table RLS already enabled in migration 002 — add policy if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'orders' AND policyname = 'agent_queue_own_orders'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "agent_queue_own_orders" ON orders
        FOR SELECT
        USING (
          assigned_to = auth.uid()
          AND status IN ('assigned','attempt_1','attempt_2','attempt_3','callback_scheduled','confirmed')
        )
    $policy$;
  END IF;
END
$$;
