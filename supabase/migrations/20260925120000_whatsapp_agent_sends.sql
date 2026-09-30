-- ============================================================
-- 20260925120000_whatsapp_agent_sends.sql
-- WhatsApp — the agent opens a thread (plan Phase 3).
--
-- WHY: reading a thread must clear its unread count and the bell's
-- `whatsapp_inbound` notification, and `whatsapp_conversations` has no UPDATE
-- policy on purpose (writes go through the service role or a SECURITY DEFINER
-- function). This is that function, guarded the same way the SELECT policy
-- is: super_admin, the market's manager, or the agent who holds the
-- conversation's order or lead.
-- ============================================================

CREATE OR REPLACE FUNCTION public.whatsapp_mark_conversation_read(p_conversation_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text;
  v_market uuid;
  v_conv   RECORD;
  v_n      integer;
BEGIN
  SELECT u.role, u.market_id INTO v_role, v_market FROM public.users u WHERE u.id = v_uid;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT c.id, c.market_id, c.current_order_id, c.current_lead_id
    INTO v_conv
    FROM public.whatsapp_conversations c
   WHERE c.id = p_conversation_id;
  IF v_conv.id IS NULL THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_role = 'super_admin' THEN
    NULL;
  ELSIF v_role = 'market_manager' THEN
    IF v_conv.market_id IS DISTINCT FROM v_market THEN
      RAISE EXCEPTION 'conversation is not in your market' USING ERRCODE = '42501';
    END IF;
  ELSIF v_role = 'agent' THEN
    IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = v_conv.current_order_id AND o.assigned_to = v_uid)
       AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = v_conv.current_lead_id AND l.assigned_to = v_uid)
       -- The thread an agent reads from the panel may be anchored on a newer
       -- order of the same customer; holding ANY message's order is enough.
       AND NOT EXISTS (
         SELECT 1 FROM public.whatsapp_messages m
         JOIN public.orders o ON o.id = m.order_id
         WHERE m.conversation_id = p_conversation_id AND o.assigned_to = v_uid)
    THEN
      RAISE EXCEPTION 'conversation is not assigned to you' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'role % may not read conversations', v_role USING ERRCODE = '42501';
  END IF;

  UPDATE public.whatsapp_conversations
     SET unread_count = 0, updated_at = now()
   WHERE id = p_conversation_id AND unread_count <> 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- The bell's row for this thread is resolved by reading the thread.
  UPDATE public.agent_notifications an
     SET read_at = now()
   WHERE an.kind = 'whatsapp_inbound'
     AND an.read_at IS NULL
     AND an.agent_id = v_uid
     AND an.order_id IN (
       SELECT m.order_id FROM public.whatsapp_messages m
        WHERE m.conversation_id = p_conversation_id AND m.order_id IS NOT NULL
       UNION SELECT v_conv.current_order_id WHERE v_conv.current_order_id IS NOT NULL);

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_mark_conversation_read(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_mark_conversation_read(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_mark_conversation_read(uuid) TO authenticated;
