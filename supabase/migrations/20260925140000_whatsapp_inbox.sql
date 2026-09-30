-- ============================================================
-- 20260925140000_whatsapp_inbox.sql
-- WhatsApp — the orphan inbox (plan Phase 5).
--
-- WHY: a reply from a number Ordra cannot match to a live order or an open
-- prospect still deserves an answer, and somebody has to decide whose it is.
-- Managers see those conversations at Clients › Messages, answer them, and
-- attach them to an order or a prospect — after which every message of the
-- thread that had no anchor gets one, and the owning agent sees it.
--
-- WHAT:
--   whatsapp_claim_conversation()  attach + back-fill, manager/super_admin only
--   whatsapp_orphan_unread_count() the sidebar badge, one integer
-- ============================================================

CREATE OR REPLACE FUNCTION public.whatsapp_claim_conversation(
  p_conversation_id uuid,
  p_order_id uuid DEFAULT NULL,
  p_lead_id uuid DEFAULT NULL
)
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
  v_target_market uuid;
  v_n      integer := 0;
BEGIN
  IF (p_order_id IS NULL) = (p_lead_id IS NULL) THEN
    RAISE EXCEPTION 'exactly one of p_order_id or p_lead_id is required' USING ERRCODE = '22023';
  END IF;

  SELECT u.role, u.market_id INTO v_role, v_market FROM public.users u WHERE u.id = v_uid;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_role NOT IN ('super_admin', 'market_manager') THEN
    RAISE EXCEPTION 'role % may not claim conversations', v_role USING ERRCODE = '42501';
  END IF;

  SELECT c.id, c.market_id INTO v_conv FROM public.whatsapp_conversations c WHERE c.id = p_conversation_id;
  IF v_conv.id IS NULL THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_role = 'market_manager' AND v_conv.market_id IS DISTINCT FROM v_market THEN
    RAISE EXCEPTION 'conversation is not in your market' USING ERRCODE = '42501';
  END IF;

  -- The target must exist and belong to the SAME market as the conversation.
  IF p_order_id IS NOT NULL THEN
    SELECT o.market_id INTO v_target_market FROM public.orders o WHERE o.id = p_order_id;
  ELSE
    SELECT l.market_id INTO v_target_market FROM public.leads l WHERE l.id = p_lead_id;
  END IF;
  IF v_target_market IS NULL THEN
    RAISE EXCEPTION 'target not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_target_market IS DISTINCT FROM v_conv.market_id THEN
    RAISE EXCEPTION 'target is in another market' USING ERRCODE = '42501';
  END IF;

  UPDATE public.whatsapp_conversations
     SET current_order_id = p_order_id,
         current_lead_id  = CASE WHEN p_order_id IS NOT NULL THEN NULL ELSE p_lead_id END,
         claimed_by = v_uid,
         claimed_at = now(),
         updated_at = now()
   WHERE id = p_conversation_id;

  -- Back-fill: the messages that had no anchor now belong to the target.
  -- Anchoring is not content, so the guard lets it through.
  IF p_order_id IS NOT NULL THEN
    UPDATE public.whatsapp_messages m
       SET order_id = p_order_id
     WHERE m.conversation_id = p_conversation_id AND m.order_id IS NULL AND m.lead_id IS NULL;
  ELSE
    UPDATE public.whatsapp_messages m
       SET lead_id = p_lead_id
     WHERE m.conversation_id = p_conversation_id AND m.order_id IS NULL AND m.lead_id IS NULL;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- The owning agent's bell: one unread row, like the webhook would have made.
  IF p_order_id IS NOT NULL THEN
    INSERT INTO public.agent_notifications (agent_id, order_id, kind, due_at)
    SELECT o.assigned_to, o.id, 'whatsapp_inbound', now()
      FROM public.orders o
     WHERE o.id = p_order_id AND o.assigned_to IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.agent_notifications an
                        WHERE an.order_id = o.id AND an.kind = 'whatsapp_inbound' AND an.read_at IS NULL)
       AND EXISTS (SELECT 1 FROM public.whatsapp_conversations c WHERE c.id = p_conversation_id AND c.unread_count > 0);
  END IF;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_claim_conversation(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_claim_conversation(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_claim_conversation(uuid, uuid, uuid) TO authenticated;

-- The sidebar badge: unread replies nobody has claimed, in one market or,
-- for a super_admin with no market chosen, everywhere.
CREATE OR REPLACE FUNCTION public.whatsapp_orphan_unread_count(p_market uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text;
  v_market uuid;
  v_n      integer;
BEGIN
  SELECT u.role, u.market_id INTO v_role, v_market FROM public.users u WHERE u.id = v_uid;
  IF v_role IS NULL THEN RETURN 0; END IF;
  IF v_role = 'market_manager' THEN
    p_market := v_market;
  ELSIF v_role <> 'super_admin' THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(c.unread_count), 0)::integer INTO v_n
    FROM public.whatsapp_conversations c
   WHERE c.current_order_id IS NULL AND c.current_lead_id IS NULL
     AND c.unread_count > 0
     AND (p_market IS NULL OR c.market_id = p_market);
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_orphan_unread_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_orphan_unread_count(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_orphan_unread_count(uuid) TO authenticated;
