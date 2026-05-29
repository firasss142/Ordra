-- Explicitly enroll every table the OMS realtime layer subscribes to.
--
-- Supabase's `supabase_realtime` publication has historically defaulted to
-- "all tables", but that default is configurable per project and silently
-- changing it would kill live UI sync. Listing tables explicitly makes the
-- realtime contract visible in migrations and immune to default drift.
--
-- This migration is idempotent: each table is added only if not already
-- present in the publication.

DO $$
DECLARE
  tbl text;
  needed text[] := ARRAY[
    'orders',
    'order_items',
    'order_history',
    'order_follow_ups',
    'products',
    'inventory_log',
    'label_prints',
    'user_presence',
    'alert_acknowledgements'
    -- agent_notifications already enrolled in 20260418_agent_notifications.sql
  ];
BEGIN
  FOREACH tbl IN ARRAY needed LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END
$$;
