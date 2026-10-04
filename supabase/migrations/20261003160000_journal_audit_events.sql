-- Journaux, phase 1 — the internal audit trail (plans/journaux-redesign.md §3.2).
--
-- WHY. Prices, costs, carrier accounts, shops, users' role / market / site, ad
-- spend, distribution shares… changed with no trace. On 2026-10-01 at 18:26 the
-- Darb Benghazi account was switched off and nobody can say by whom.
--
-- WHAT
--   audit_events        append-only (ledger_append_only), read by super_admin only
--   journal_actor()     who is writing: the session's user, the actor a
--                       service-role route declared, or the system
--   journal_row_change  one generic AFTER trigger: changed columns only, as
--                       {column: [before, after]}, secrets masked, long text cut
--   journal_record()    explicit events that change no row (export, campaign…)
--
-- WHO WROTE IT. Three cases, decided per statement by journal_actor():
--   * a logged-in session (PostgREST, role authenticated) → the JWT `sub`
--   * the service role WITH the header `x-ordra-actor` → that user. The header
--     is honoured ONLY for the service role: an authenticated caller already
--     has a sub, and anon cannot write any audited table. createAdminClient
--     ({ actorId }) sets it (src/lib/supabase/server.ts).
--   * anything else (pg_cron, a service route that declared nobody) → 'system'
--     or 'service', actor NULL. Honest « inconnu » beats a guessed name.
--
-- NOISE. Columns the system rewrites on its own (updated_at, heartbeats, sync
-- stamps, stock totals that inventory_log already journals) are ignored per
-- table, and two high-churn tables only journal PEOPLE: order_items (every
-- intake inserts lines) and ad_spend (Meta sync upserts every hour).

CREATE TABLE public.audit_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  market_id     UUID REFERENCES public.markets(id),
  actor_id      UUID,
  actor_role    TEXT,
  actor_kind    TEXT NOT NULL CHECK (actor_kind IN ('person', 'system', 'service')),
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  entity_label  TEXT,
  changes       JSONB NOT NULL DEFAULT '{}'::jsonb,
  context       JSONB NOT NULL DEFAULT '{}'::jsonb,
  order_id      UUID
);

COMMENT ON TABLE public.audit_events IS
  'Journaux: who changed what, before → after. Append-only. Written by journal_row_change() and journal_record().';

CREATE INDEX audit_events_occurred_idx ON public.audit_events (occurred_at DESC, id DESC);
CREATE INDEX audit_events_entity_idx   ON public.audit_events (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_events_action_idx   ON public.audit_events (action, occurred_at DESC);
CREATE INDEX audit_events_order_idx    ON public.audit_events (order_id, occurred_at) WHERE order_id IS NOT NULL;

CREATE TRIGGER trg_audit_events_append_only
  BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.ledger_append_only();

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_events_select_super_admin"
  ON public.audit_events FOR SELECT TO authenticated
  USING ((SELECT public.get_user_role()) = 'super_admin');
REVOKE ALL ON public.audit_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_events FROM authenticated;
GRANT SELECT ON public.audit_events TO authenticated;

-- ── who is writing ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.journal_actor(
  OUT actor_id UUID, OUT actor_role TEXT, OUT actor_kind TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claims JSONB := NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB;
  v_headers JSONB := NULLIF(current_setting('request.headers', TRUE), '')::JSONB;
  v_role TEXT := v_claims ->> 'role';
  v_hdr TEXT := v_headers ->> 'x-ordra-actor';
BEGIN
  IF v_role = 'authenticated' AND (v_claims ->> 'sub') IS NOT NULL THEN
    actor_id := (v_claims ->> 'sub')::UUID;
    actor_kind := 'person';
  ELSIF v_role = 'service_role'
        AND v_hdr ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    actor_id := v_hdr::UUID;
    actor_kind := 'person';
  ELSIF v_role = 'service_role' THEN
    actor_kind := 'service';
  ELSE
    actor_kind := 'system';
  END IF;
  IF actor_id IS NOT NULL THEN
    SELECT u.role INTO actor_role FROM public.users u WHERE u.id = actor_id;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.journal_actor() FROM PUBLIC, anon, authenticated;

-- ── one value, made safe to keep ────────────────────────────────────────────
-- Long text is cut (an agent brief is not an audit fact), objects are kept as
-- they are (config JSON is small and its shape matters).
CREATE OR REPLACE FUNCTION public.journal_clip(p JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p IS NULL THEN NULL
    WHEN jsonb_typeof(p) = 'string' AND length(p #>> '{}') > 200
      THEN to_jsonb(left(p #>> '{}', 197) || '…')
    ELSE p
  END
$$;

-- ── the generic trigger ─────────────────────────────────────────────────────
-- TG_ARGV[0]  secret columns, comma-separated  → value replaced by "••••"
-- TG_ARGV[1]  ignored columns, comma-separated → never journaled
-- TG_ARGV[2]  label column (what a person calls the row), '' for none
-- TG_ARGV[3]  'people' → journal only when a person is the actor
CREATE OR REPLACE FUNCTION public.journal_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret TEXT[] := string_to_array(COALESCE(NULLIF(TG_ARGV[0], ''), ''), ',');
  v_ignore TEXT[] := string_to_array(COALESCE(NULLIF(TG_ARGV[1], ''), ''), ',')
                     || ARRAY['updated_at', 'created_at'];
  v_label_col TEXT := NULLIF(TG_ARGV[2], '');
  v_people_only BOOLEAN := COALESCE(TG_ARGV[3], '') = 'people';
  v_old JSONB := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  v_new JSONB := CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN to_jsonb(NEW) END;
  v_row JSONB := COALESCE(v_new, v_old);
  v_changes JSONB := '{}'::jsonb;
  v_key TEXT;
  v_a RECORD;
  v_before JSONB;
  v_after JSONB;
BEGIN
  SELECT * INTO v_a FROM public.journal_actor();
  IF v_people_only AND v_a.actor_kind <> 'person' THEN
    RETURN NULL;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_row) LOOP
    CONTINUE WHEN v_key = ANY (v_ignore) OR v_key = 'id';
    v_before := CASE WHEN v_old IS NULL THEN NULL ELSE v_old -> v_key END;
    v_after  := CASE WHEN v_new IS NULL THEN NULL ELSE v_new -> v_key END;
    CONTINUE WHEN v_before IS NOT DISTINCT FROM v_after;
    CONTINUE WHEN TG_OP <> 'UPDATE' AND COALESCE(v_before, v_after) = 'null'::jsonb;
    IF v_key = ANY (v_secret) THEN
      v_before := CASE WHEN v_before IS NULL OR v_before = 'null'::jsonb THEN v_before ELSE to_jsonb('••••'::TEXT) END;
      v_after  := CASE WHEN v_after  IS NULL OR v_after  = 'null'::jsonb THEN v_after  ELSE to_jsonb('••••'::TEXT) END;
    END IF;
    v_changes := v_changes || jsonb_build_object(
      v_key, jsonb_build_array(public.journal_clip(v_before), public.journal_clip(v_after)));
  END LOOP;

  -- An UPDATE that only touched ignored columns is not an event.
  IF TG_OP = 'UPDATE' AND v_changes = '{}'::jsonb THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.audit_events (
    market_id, actor_id, actor_role, actor_kind, action,
    entity_type, entity_id, entity_label, changes, context, order_id
  ) VALUES (
    NULLIF(v_row ->> 'market_id', '')::UUID,
    v_a.actor_id, v_a.actor_role, v_a.actor_kind,
    TG_TABLE_NAME || '.' || CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END,
    TG_TABLE_NAME,
    v_row ->> 'id',
    CASE WHEN v_label_col IS NULL THEN NULL ELSE left(v_row ->> v_label_col, 120) END,
    v_changes,
    '{}'::jsonb,
    CASE WHEN TG_TABLE_NAME = 'order_items' THEN NULLIF(v_row ->> 'order_id', '')::UUID END
  );
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.journal_row_change() FROM PUBLIC, anon, authenticated;

-- ── attach it ───────────────────────────────────────────────────────────────
-- (table, secrets, ignored, label, people-only)
DO $attach$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('carriers',                  'api_credentials,api_key_encrypted', '',                                         'name',       ''),
    ('carrier_order_preferences', '',                                  '',                                         'option_key', ''),
    ('storefronts',               'webhook_secret',                    'last_webhook_received_at,last_webhook_status,last_webhook_error,webhook_failure_count', 'name', ''),
    ('warehouses',                '',                                  '',                                         'name_fr',    ''),
    ('markets',                   '',                                  '',                                         'name',       ''),
    ('products',                  '',                                  'current_stock,damaged_return_count,agent_content_updated_at,agent_content_updated_by', 'name', ''),
    ('product_variants',          '',                                  'current_stock,damaged_return_count',       'label',      ''),
    ('rejection_reason_configs',  '',                                  '',                                         'label_fr',   ''),
    ('status_configs',            '',                                  '',                                         'label_fr',   ''),
    ('agent_distribution_shares', '',                                  'updated_by',                               '',           ''),
    ('assignment_rules',          '',                                  '',                                         'algorithm',  ''),
    ('agent_commission_rates',    '',                                  'set_by',                                   '',           ''),
    ('users',                     '',                                  'last_seen_at,is_available,available_since,avatar_url', 'full_name', ''),
    ('whatsapp_configs',          'access_token,app_secret,verify_token', 'last_webhook_at,last_checked_at,last_error,quality_rating,messaging_limit_tier,last_test_at,last_test_ok,last_test_stages', 'display_phone', ''),
    ('whatsapp_templates',        '',                                  'synced_at,components',                     'name',       ''),
    ('meta_ad_accounts',          'access_token',                      'last_synced_at,last_sync_error',           'account_name', ''),
    ('investors',                 '',                                  '',                                         'legal_name', ''),
    ('reception_payments',        '',                                  '',                                         'method',     ''),
    ('ad_spend',                  '',                                  'synced_at,impressions,reach,clicks,frequency,platform_results', 'campaign_name', 'people'),
    ('order_items',               '',                                  '',                                         'product_name', 'people')
  ) AS t(tbl, secrets, ignored, label, mode)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL THEN
      RAISE EXCEPTION 'journal: table % introuvable', r.tbl;
    END IF;
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_journal AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION public.journal_row_change(%2$L, %3$L, %4$L, %5$L)',
      r.tbl, r.secrets, r.ignored, r.label, r.mode);
  END LOOP;
END $attach$;

-- ── explicit events ─────────────────────────────────────────────────────────
-- For what changes no row: an export, a campaign sent, a sign-in. A logged-in
-- caller may only record the actions below, as themselves; the service role
-- (server routes) may record any action and names the actor through the header.
CREATE OR REPLACE FUNCTION public.journal_record(
  p_action       TEXT,
  p_entity_type  TEXT,
  p_entity_id    TEXT DEFAULT NULL,
  p_entity_label TEXT DEFAULT NULL,
  p_market_id    UUID DEFAULT NULL,
  p_context      JSONB DEFAULT '{}'::jsonb,
  p_order_id     UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_a RECORD;
  v_id UUID;
  v_role TEXT := NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role';
BEGIN
  IF p_action IS NULL OR p_action !~ '^[a-z_]+\.[a-z_]+$' THEN
    RAISE EXCEPTION 'journal_record: action invalide %', p_action USING ERRCODE = '22023';
  END IF;
  IF v_role = 'authenticated' AND p_action NOT IN ('auth.login', 'export.orders', 'export.customers', 'export.history') THEN
    RAISE EXCEPTION 'journal_record: action % réservée au serveur', p_action USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_a FROM public.journal_actor();
  INSERT INTO public.audit_events (
    market_id, actor_id, actor_role, actor_kind, action,
    entity_type, entity_id, entity_label, changes, context, order_id
  ) VALUES (
    p_market_id, v_a.actor_id, v_a.actor_role, v_a.actor_kind, p_action,
    p_entity_type, p_entity_id, left(p_entity_label, 120), '{}'::jsonb,
    COALESCE(p_context, '{}'::jsonb), p_order_id
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.journal_record(TEXT, TEXT, TEXT, TEXT, UUID, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.journal_record(TEXT, TEXT, TEXT, TEXT, UUID, JSONB, UUID) TO authenticated, service_role;
