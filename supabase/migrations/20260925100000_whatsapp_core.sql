-- ============================================================
-- 20260925100000_whatsapp_core.sql
-- WhatsApp Business Cloud API — foundations (plan: plans/whatsapp-cloud-api.md, Phase 1).
--
-- WHY: WhatsApp in Ordra is a wa.me link opened from the agent's own phone.
-- Nothing is delivered from the business number, no delivery status comes back,
-- no reply is captured, and nothing can be automated. Meta's Cloud API gives
-- all four, but only against a per-market credential set (WABA, phone number
-- id, permanent token, app secret) that must be stored as carefully as the
-- Meta Ads token, and a message log whose rows change state out of order.
--
-- WHAT:
--   whatsapp_configs        one row per market; secrets ciphertext; no grants
--   whatsapp_templates      what Meta holds + which event each one serves
--   whatsapp_conversations  one per (market, phone): window, opt-out, anchor
--   whatsapp_messages       the log; forward-only status guard, immutable text
--   customers.whatsapp_*    language chosen by the agent, opt-out, last touch
--   whatsapp_e164()         SQL mirror of src/lib/whatsapp/phone.ts
--   set_customer_whatsapp_language()  the only write path for the language
--
-- NON-GOALS: no outbox, no trigger, no cron here (Phase 4). No message is sent
-- by this migration; it only makes the Connexions card and the credential
-- store possible.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. whatsapp_configs — the credential row
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_configs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One number per market (owner's decision: two portfolios, one number each).
  market_id             uuid NOT NULL UNIQUE REFERENCES public.markets(id) ON DELETE CASCADE,
  waba_id               text NOT NULL,
  -- The webhook routing key: Meta names the receiving number, not the market.
  phone_number_id       text NOT NULL UNIQUE,
  app_id                text NOT NULL,
  graph_version         text NOT NULL DEFAULT 'v26.0',
  -- Ciphertext (src/lib/crypto.ts, ENCRYPTION_KEY). Never plaintext, never read
  -- by anything but the service role.
  access_token          text NOT NULL,
  app_secret            text NOT NULL,
  verify_token          text NOT NULL,
  display_phone         text,
  verified_name         text,
  quality_rating        text,
  messaging_limit_tier  text,
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'paused', 'auth_failed')),
  status_reason         text,
  -- Pacing for automatic sends; Meta's default throughput is 80 mps, a new
  -- number should not go near it.
  send_rate_per_sec     integer NOT NULL DEFAULT 3 CHECK (send_rate_per_sec BETWEEN 1 AND 80),
  last_webhook_at       timestamptz,
  last_checked_at       timestamptz,
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_configs ENABLE ROW LEVEL SECURITY;

-- No policies → only service_role, which bypasses RLS, can see this table.
-- RLS alone is not enough: a table with RLS on and grants intact still leaks
-- its shape and its error messages, so the grants go too (same as
-- meta_ad_accounts, 20260814230612).
REVOKE ALL ON public.whatsapp_configs FROM authenticated;
REVOKE ALL ON public.whatsapp_configs FROM anon;
REVOKE ALL ON public.whatsapp_configs FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_whatsapp_configs_updated_at ON public.whatsapp_configs;
CREATE TRIGGER trg_whatsapp_configs_updated_at
  BEFORE UPDATE ON public.whatsapp_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. whatsapp_templates — registry, event mapping, variable contract
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id         uuid NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  meta_template_id  text,
  name              text NOT NULL,
  -- ar / fr are ours; anything else is a template Meta holds that we only
  -- mirror for visibility (never mapped to an event, never sent by Ordra).
  language          text NOT NULL CHECK (language ~ '^[a-z]{2}(_[a-z]{2,4})?$'),
  category          text NOT NULL CHECK (category IN ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  status            text NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'DELETED', 'UNKNOWN')),
  rejected_reason   text,
  -- Exactly what Meta holds, so the Modèles drawer can show what was sent.
  components        jsonb NOT NULL DEFAULT '[]'::jsonb,
  body_text         text NOT NULL DEFAULT '',
  header_format     text CHECK (header_format IN ('TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION')),
  footer_text       text,
  -- Ordered variable NAMES bound to {{1}}..{{n}}. The closed union lives in
  -- src/lib/whatsapp/types.ts; the renderer is the only place the two meet.
  variables         text[] NOT NULL DEFAULT '{}',
  -- Which lifecycle event this template serves automatically. NULL for the
  -- agent set and for campaign templates.
  event_key         text CHECK (event_key IN ('could_not_reach', 'shipped', 'out_for_delivery', 'last_chance', 'delivered')),
  -- Which CATALOGUE entry it was created from (agent chip filter). NULL when
  -- it came from Meta or a campaign.
  catalogue_key     text,
  source            text NOT NULL DEFAULT 'synced' CHECK (source IN ('catalogue', 'campaign', 'synced')),
  campaign_id       uuid REFERENCES public.prospect_campaigns(id) ON DELETE SET NULL,
  synced_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_templates_market_name_lang_key UNIQUE (market_id, name, language)
);

-- One template per (market, event, language): the drain resolves by this key.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_templates_event_lang_uq
  ON public.whatsapp_templates (market_id, event_key, language)
  WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS whatsapp_templates_market_status_idx
  ON public.whatsapp_templates (market_id, status);

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

-- Read: super_admin everywhere; anyone else in their own market (agents need
-- the approved list to compose). Writes only via routes on the admin client.
DROP POLICY IF EXISTS whatsapp_templates_select ON public.whatsapp_templates;
CREATE POLICY whatsapp_templates_select ON public.whatsapp_templates
  FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR market_id = (SELECT public.get_user_market_id())
  );

REVOKE ALL ON public.whatsapp_templates FROM anon;
REVOKE ALL ON public.whatsapp_templates FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.whatsapp_templates FROM authenticated;
GRANT SELECT ON public.whatsapp_templates TO authenticated;

DROP TRIGGER IF EXISTS trg_whatsapp_templates_updated_at ON public.whatsapp_templates;
CREATE TRIGGER trg_whatsapp_templates_updated_at
  BEFORE UPDATE ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 3. whatsapp_conversations — one per (market, phone)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id             uuid NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  -- <dial><national>, no plus: what Meta calls wa_id.
  phone_e164            text NOT NULL,
  customer_id           uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  -- Where a reply lands. Attribution rules live in the webhook handler.
  current_order_id      uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  current_lead_id       uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  profile_name          text,
  -- Meta's 24 h customer-service window = last_inbound_at + 24 h.
  last_inbound_at       timestamptz,
  last_outbound_at      timestamptz,
  last_message_at       timestamptz,
  last_message_preview  text,
  unread_count          integer NOT NULL DEFAULT 0,
  opted_out_at          timestamptz,
  opt_out_text          text,
  -- Graph 131026: the number has no WhatsApp. Never retried.
  undeliverable_at      timestamptz,
  claimed_by            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  claimed_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_conversations_market_phone_key UNIQUE (market_id, phone_e164)
);

-- The orphan inbox: conversations nothing claimed, newest first.
CREATE INDEX IF NOT EXISTS whatsapp_conversations_orphans_idx
  ON public.whatsapp_conversations (market_id, last_inbound_at DESC)
  WHERE current_order_id IS NULL AND current_lead_id IS NULL;
CREATE INDEX IF NOT EXISTS whatsapp_conversations_order_idx ON public.whatsapp_conversations (current_order_id);
CREATE INDEX IF NOT EXISTS whatsapp_conversations_lead_idx  ON public.whatsapp_conversations (current_lead_id);
CREATE INDEX IF NOT EXISTS whatsapp_conversations_customer_idx ON public.whatsapp_conversations (customer_id);

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;

-- Helpers wrapped as (SELECT f()) so the planner evaluates them once per
-- statement, not once per row (RLS InitPlan note).
DROP POLICY IF EXISTS whatsapp_conversations_select ON public.whatsapp_conversations;
CREATE POLICY whatsapp_conversations_select ON public.whatsapp_conversations
  FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR ((SELECT public.get_user_role()) = 'market_manager'
        AND market_id = (SELECT public.get_user_market_id()))
    OR ((SELECT public.get_user_role()) = 'agent' AND (
          (current_order_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.orders o
             WHERE o.id = whatsapp_conversations.current_order_id
               AND o.assigned_to = (SELECT auth.uid())))
       OR (current_lead_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.leads l
             WHERE l.id = whatsapp_conversations.current_lead_id
               AND l.assigned_to = (SELECT auth.uid())))
    ))
  );

REVOKE ALL ON public.whatsapp_conversations FROM anon;
REVOKE ALL ON public.whatsapp_conversations FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.whatsapp_conversations FROM authenticated;
GRANT SELECT ON public.whatsapp_conversations TO authenticated;

DROP TRIGGER IF EXISTS trg_whatsapp_conversations_updated_at ON public.whatsapp_conversations;
CREATE TRIGGER trg_whatsapp_conversations_updated_at
  BEFORE UPDATE ON public.whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 4. whatsapp_messages — the log
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id               uuid NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  conversation_id         uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  direction               text NOT NULL CHECK (direction IN ('in', 'out')),
  -- Meta's message id. Webhook idempotency and status lookup key.
  wamid                   text,
  phone_e164              text NOT NULL,
  customer_id             uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  order_id                uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  lead_id                 uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  campaign_id             uuid REFERENCES public.prospect_campaigns(id) ON DELETE SET NULL,
  template_id             uuid REFERENCES public.whatsapp_templates(id) ON DELETE SET NULL,
  -- FK to whatsapp_outbox arrives with that table (Phase 4).
  outbox_id               uuid,
  event_key               text,
  kind                    text NOT NULL DEFAULT 'text'
                            CHECK (kind IN ('template', 'text', 'image', 'video', 'audio', 'document', 'sticker',
                                            'location', 'contacts', 'interactive', 'button', 'reaction', 'unsupported')),
  language                text CHECK (language IN ('ar', 'fr')),
  -- Rendered snapshot (out) or the inbound text (in). Immutable.
  body                    text,
  variables               jsonb,
  media_id                text,
  media_link              text,
  media_mime              text,
  media_caption           text,
  context_wamid           text,
  status                  text NOT NULL
                            CHECK (status IN ('received', 'queued', 'sent', 'delivered', 'read', 'failed')),
  sent_at                 timestamptz,
  delivered_at            timestamptz,
  read_at                 timestamptz,
  failed_at               timestamptz,
  error_code              integer,
  error_title             text,
  error_detail            text,
  pricing_category        text,
  pricing_billable        boolean,
  pricing_model           text,
  conversation_meta_id    text,
  conversation_origin     text,
  conversation_expires_at timestamptz,
  sent_by                 uuid REFERENCES public.users(id) ON DELETE SET NULL,
  actor_type              text NOT NULL
                            CHECK (actor_type IN ('agent', 'manager', 'system', 'campaign', 'customer')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_wamid_uq
  ON public.whatsapp_messages (wamid) WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_messages_conversation_idx ON public.whatsapp_messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_messages_order_idx        ON public.whatsapp_messages (order_id, created_at DESC) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_messages_lead_idx         ON public.whatsapp_messages (lead_id, created_at DESC) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_messages_market_idx       ON public.whatsapp_messages (market_id, created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_messages_campaign_idx     ON public.whatsapp_messages (campaign_id, status) WHERE campaign_id IS NOT NULL;

-- Forward-only rank. `failed` is terminal and always applies.
CREATE OR REPLACE FUNCTION public.whatsapp_status_rank(p_status text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_status
    WHEN 'received'  THEN 0
    WHEN 'queued'    THEN 1
    WHEN 'sent'      THEN 2
    WHEN 'delivered' THEN 3
    WHEN 'read'      THEN 4
    WHEN 'failed'    THEN 5
    ELSE -1
  END;
$$;

-- The guard. Meta delivers status webhooks in any order and more than once;
-- the row is the CURRENT state with monotone timestamps, so a late `sent`
-- after `delivered` is kept out silently (a raise would fail the whole
-- webhook batch), while the content of a message can never be rewritten.
CREATE OR REPLACE FUNCTION public.whatsapp_messages_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.direction       IS DISTINCT FROM OLD.direction
     OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.phone_e164   IS DISTINCT FROM OLD.phone_e164
     OR NEW.kind         IS DISTINCT FROM OLD.kind
     OR NEW.body         IS DISTINCT FROM OLD.body
     OR NEW.variables    IS DISTINCT FROM OLD.variables
     OR NEW.actor_type   IS DISTINCT FROM OLD.actor_type
     OR NEW.sent_by      IS DISTINCT FROM OLD.sent_by
     OR NEW.created_at   IS DISTINCT FROM OLD.created_at
     OR NEW.market_id    IS DISTINCT FROM OLD.market_id
  THEN
    RAISE EXCEPTION 'whatsapp_messages: content columns are immutable'
      USING ERRCODE = '42501';
  END IF;

  -- The wamid is set once (an in-flight send learns it), never changed.
  IF OLD.wamid IS NOT NULL AND NEW.wamid IS DISTINCT FROM OLD.wamid THEN
    RAISE EXCEPTION 'whatsapp_messages: wamid is immutable once set'
      USING ERRCODE = '42501';
  END IF;

  -- Status: forward or to failed. A backwards status keeps the old one.
  IF NEW.status <> 'failed'
     AND public.whatsapp_status_rank(NEW.status) < public.whatsapp_status_rank(OLD.status) THEN
    NEW.status := OLD.status;
  END IF;

  -- Timestamps are monotone: an update may fill one, never erase one.
  NEW.sent_at      := COALESCE(NEW.sent_at,      OLD.sent_at);
  NEW.delivered_at := COALESCE(NEW.delivered_at, OLD.delivered_at);
  NEW.read_at      := COALESCE(NEW.read_at,      OLD.read_at);
  NEW.failed_at    := COALESCE(NEW.failed_at,    OLD.failed_at);

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_messages_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_messages_guard() FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_messages_guard() FROM authenticated;

DROP TRIGGER IF EXISTS trg_whatsapp_messages_guard ON public.whatsapp_messages;
CREATE TRIGGER trg_whatsapp_messages_guard
  BEFORE UPDATE ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_messages_guard();

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_messages_select ON public.whatsapp_messages;
CREATE POLICY whatsapp_messages_select ON public.whatsapp_messages
  FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR ((SELECT public.get_user_role()) = 'market_manager'
        AND market_id = (SELECT public.get_user_market_id()))
    OR ((SELECT public.get_user_role()) = 'agent' AND (
          (order_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.orders o
             WHERE o.id = whatsapp_messages.order_id
               AND o.assigned_to = (SELECT auth.uid())))
       OR (lead_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.leads l
             WHERE l.id = whatsapp_messages.lead_id
               AND l.assigned_to = (SELECT auth.uid())))
    ))
  );

REVOKE ALL ON public.whatsapp_messages FROM anon;
REVOKE ALL ON public.whatsapp_messages FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.whatsapp_messages FROM authenticated;
GRANT SELECT ON public.whatsapp_messages TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. customers — the language the agent chose, and the brakes
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS whatsapp_language          text CHECK (whatsapp_language IN ('ar', 'fr')),
  ADD COLUMN IF NOT EXISTS whatsapp_opted_out_at      timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_last_inbound_at   timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_last_outbound_at  timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_undeliverable_at  timestamptz;

-- ─────────────────────────────────────────────────────────────
-- 6. whatsapp_e164 — SQL mirror of toWhatsAppE164()
-- ─────────────────────────────────────────────────────────────
-- Tunisia: 8 digits. Libya: a mobile is 9 digits starting with 9 (Darb takes
-- 021 landlines; WhatsApp cannot deliver to one). Built on normalize_phone so
-- the WhatsApp identity is the same key as customers.phone_normalized.
CREATE OR REPLACE FUNCTION public.whatsapp_e164(p_phone text, p_market_code text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v text;
BEGIN
  IF p_phone IS NULL OR btrim(p_phone) = '' THEN RETURN NULL; END IF;
  v := public.normalize_phone(p_phone);
  IF p_market_code = 'tn' THEN
    IF v ~ '^[0-9]{8}$' THEN RETURN '216' || v; END IF;
  ELSIF p_market_code = 'ly' THEN
    IF v ~ '^9[0-9]{8}$' THEN RETURN '218' || v; END IF;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_e164(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_e164(text, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 7. set_customer_whatsapp_language — the only write path
-- ─────────────────────────────────────────────────────────────
-- customers has no UPDATE policy (writes go through SECURITY DEFINER functions
-- — 20260913152417). The agent picks ar/fr on the first send and Ordra
-- remembers it; this is that write. Allowed to a super_admin, to the market's
-- manager, and to the agent who holds one of the customer's orders or leads.
CREATE OR REPLACE FUNCTION public.set_customer_whatsapp_language(p_customer_id uuid, p_lang text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text;
  v_market uuid;
BEGIN
  IF p_lang IS NULL OR p_lang NOT IN ('ar', 'fr') THEN
    RAISE EXCEPTION 'whatsapp language must be ar or fr' USING ERRCODE = '22023';
  END IF;

  SELECT u.role, u.market_id INTO v_role, v_market
  FROM public.users u WHERE u.id = v_uid;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_role = 'super_admin' THEN
    NULL;
  ELSIF v_role = 'market_manager' THEN
    IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = p_customer_id AND c.market_id = v_market) THEN
      RAISE EXCEPTION 'customer is not in your market' USING ERRCODE = '42501';
    END IF;
  ELSIF v_role = 'agent' THEN
    IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = p_customer_id AND o.assigned_to = v_uid)
       AND NOT EXISTS (
         SELECT 1
         FROM public.leads l
         JOIN public.customers c
           ON c.id = p_customer_id
          AND c.market_id = l.market_id
          AND c.phone_normalized = public.normalize_phone(l.customer_phone)
         WHERE l.assigned_to = v_uid)
    THEN
      RAISE EXCEPTION 'customer is not assigned to you' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'role % may not set a customer language', v_role USING ERRCODE = '42501';
  END IF;

  UPDATE public.customers
     SET whatsapp_language = p_lang, updated_at = now()
   WHERE id = p_customer_id;
END;
$$;

-- EXECUTE goes to PUBLIC by default on a SECURITY DEFINER function; revoke
-- before granting (anon-executable RPCs note, 2026-09-24).
REVOKE ALL ON FUNCTION public.set_customer_whatsapp_language(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_customer_whatsapp_language(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_customer_whatsapp_language(uuid, text) TO authenticated;

COMMENT ON TABLE public.whatsapp_configs IS
  'WhatsApp Cloud API credential per market. Secrets are ciphertext; no grants to authenticated — service role only.';
COMMENT ON TABLE public.whatsapp_templates IS
  'Meta message templates per market with the lifecycle event each one serves and its ordered variable names.';
COMMENT ON TABLE public.whatsapp_conversations IS
  'One row per (market, phone): 24 h window, opt-out, undeliverable flag, and the order/lead replies land on.';
COMMENT ON TABLE public.whatsapp_messages IS
  'Message log. Content immutable; status forward-only or failed (whatsapp_messages_guard).';
