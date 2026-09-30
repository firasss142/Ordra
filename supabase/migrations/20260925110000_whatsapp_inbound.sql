-- ============================================================
-- 20260925110000_whatsapp_inbound.sql
-- WhatsApp — what an inbound reply touches (plan Phase 2 / 3).
--
-- WHY: the webhook handler notifies the owning agent when a customer replies,
-- and the order panel's Messages tab listens to the log in real time. Both
-- need one schema fact each: a fourth notification kind, and the two WhatsApp
-- tables in the realtime publication.
--
-- `resolve_stale_notifications()` is untouched: it only matches its three
-- kinds by name, so a `whatsapp_inbound` row is left alone until the agent
-- opens the thread (whatsapp_mark_conversation_read, Phase 3).
-- ============================================================

ALTER TABLE public.agent_notifications
  DROP CONSTRAINT IF EXISTS agent_notifications_kind_check;
ALTER TABLE public.agent_notifications
  ADD CONSTRAINT agent_notifications_kind_check
  CHECK (kind IN ('callback_due', 'attempt_due', 'dispatch_due', 'whatsapp_inbound'));

-- Idempotent publication add (same block as 20260529155948_realtime_publication.sql).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'whatsapp_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'whatsapp_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;
  END IF;
END $$;

-- Realtime sends the whole old row on UPDATE only with REPLICA IDENTITY FULL;
-- the thread only needs the new row, so the default is kept.
