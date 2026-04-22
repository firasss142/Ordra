-- ============================================================
-- 20260601000001_dynamic_statuses_and_campaigns_rehome.sql
-- Phase 1 of "Rehome campaigns + dynamic statuses".
-- STRICTLY ADDITIVE. No renames, no drops.
--
-- Split in two files because ALTER TYPE ... ADD VALUE introduces an
-- enum value that cannot be used in the same transaction as its
-- addition. The RPCs (defined in 20260601000002) reference the new
-- 'campaign' lead_source value, so they ship in the next migration.
--
-- This file:
--   1. Extends lead_source enum with 'campaign' (upsell-generated leads)
--   2. Creates status_configs table + RLS + seed for both markets × scopes
--   3. Adds status_key, campaign_id, source_order_id columns on leads
--      and status_key on order_follow_ups; backfills from existing enum
--   4. Installs dual-write triggers (status ↔ status_key) for the
--      Phase 1–3 transition window
--   5. Adds idempotency partial unique index for campaign-spawned leads
-- ============================================================

ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'campaign';

CREATE TABLE status_configs (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id            UUID         NOT NULL REFERENCES markets(id),
  scope                TEXT         NOT NULL CHECK (scope IN ('prospect', 'follow_up')),
  key                  TEXT         NOT NULL,
  label_fr             TEXT         NOT NULL,
  label_ar             TEXT         NOT NULL,
  color                TEXT         NOT NULL DEFAULT '#64748B',
  sort_order           INT          NOT NULL,
  is_initial           BOOLEAN      NOT NULL DEFAULT false,
  is_terminal          BOOLEAN      NOT NULL DEFAULT false,
  allowed_transitions  JSONB        NOT NULL DEFAULT '[]'::jsonb,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_status_configs_market_scope_key UNIQUE (market_id, scope, key),
  CONSTRAINT chk_status_configs_key_format CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT chk_status_configs_allowed_transitions_array CHECK (jsonb_typeof(allowed_transitions) = 'array')
);

CREATE UNIQUE INDEX uq_status_configs_one_initial
  ON status_configs (market_id, scope)
  WHERE is_initial = true;

CREATE INDEX idx_status_configs_market_scope_sort
  ON status_configs (market_id, scope, sort_order);

CREATE TRIGGER trg_status_configs_updated_at
  BEFORE UPDATE ON status_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed prospect statuses (Tunisia defaults mirror src/types/lead.ts)
INSERT INTO status_configs (market_id, scope, key, label_fr, label_ar, color, sort_order, is_initial, is_terminal, allowed_transitions)
SELECT
  m.id, 'prospect', v.key, v.label_fr, v.label_ar, v.color, v.sort_order, v.is_initial, v.is_terminal, v.transitions::jsonb
FROM markets m
CROSS JOIN (VALUES
  ('new',                 'Nouveau',            'جديد',            '#64748B',  1, true,  false, '["assigned","archived"]'),
  ('assigned',            'Assigné',            'مُسند',           '#3B82F6',  2, false, false, '["attempt_1","callback_scheduled","qualified","lost","archived"]'),
  ('attempt_1',           'Tentative 1',        'محاولة 1',        '#8B5CF6',  3, false, false, '["attempt_2","callback_scheduled","qualified","lost","archived"]'),
  ('attempt_2',           'Tentative 2',        'محاولة 2',        '#8B5CF6',  4, false, false, '["attempt_3","callback_scheduled","qualified","lost","archived"]'),
  ('attempt_3',           'Tentative 3',        'محاولة 3',        '#8B5CF6',  5, false, false, '["callback_scheduled","qualified","lost","archived"]'),
  ('callback_scheduled',  'Rappel programmé',   'إعادة اتصال',     '#F59E0B',  6, false, false, '["attempt_1","attempt_2","attempt_3","qualified","lost","archived"]'),
  ('qualified',           'Qualifié',           'مؤهل',            '#10B981',  7, false, false, '["won","lost","archived"]'),
  ('won',                 'Gagné',              'ربح',             '#059669',  8, false, true,  '[]'),
  ('lost',                'Perdu',              'خسارة',           '#EF4444',  9, false, true,  '[]'),
  ('archived',            'Archivé',            'مؤرشف',           '#6B7280', 10, false, true,  '[]')
) AS v(key, label_fr, label_ar, color, sort_order, is_initial, is_terminal, transitions);

-- Seed follow-up statuses (Tunisia defaults mirror src/types/follow-up.ts)
INSERT INTO status_configs (market_id, scope, key, label_fr, label_ar, color, sort_order, is_initial, is_terminal, allowed_transitions)
SELECT
  m.id, 'follow_up', v.key, v.label_fr, v.label_ar, v.color, v.sort_order, v.is_initial, v.is_terminal, v.transitions::jsonb
FROM markets m
CROSS JOIN (VALUES
  ('open',         'Ouvert',     'مفتوح',      '#3B82F6', 1, true,  false, '["in_progress","resolved","escalated"]'),
  ('in_progress',  'En cours',   'قيد التنفيذ','#F59E0B', 2, false, false, '["open","resolved","escalated"]'),
  ('escalated',    'Escaladé',   'تم تصعيده',  '#EF4444', 3, false, false, '["in_progress","resolved"]'),
  ('resolved',     'Résolu',     'مُنجز',      '#10B981', 4, false, true,  '["in_progress"]')
) AS v(key, label_fr, label_ar, color, sort_order, is_initial, is_terminal, transitions);

ALTER TABLE status_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "status_configs_select"
  ON status_configs FOR SELECT TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR market_id = get_user_market_id()
  );

CREATE POLICY "status_configs_insert"
  ON status_configs FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );

CREATE POLICY "status_configs_update"
  ON status_configs FOR UPDATE TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  )
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );

CREATE POLICY "status_configs_delete"
  ON status_configs FOR DELETE TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );

ALTER TABLE leads
  ADD COLUMN status_key      TEXT,
  ADD COLUMN campaign_id     UUID REFERENCES follow_up_campaigns(id),
  ADD COLUMN source_order_id UUID REFERENCES orders(id);

UPDATE leads SET status_key = status::text WHERE status_key IS NULL;
ALTER TABLE leads ALTER COLUMN status_key SET NOT NULL;

CREATE UNIQUE INDEX uq_leads_campaign_source_order
  ON leads (campaign_id, source_order_id)
  WHERE campaign_id IS NOT NULL AND source_order_id IS NOT NULL;

CREATE INDEX idx_leads_campaign_id
  ON leads (campaign_id) WHERE campaign_id IS NOT NULL;

CREATE INDEX idx_leads_source_order_id
  ON leads (source_order_id) WHERE source_order_id IS NOT NULL;

ALTER TABLE order_follow_ups ADD COLUMN status_key TEXT;
UPDATE order_follow_ups SET status_key = status::text WHERE status_key IS NULL;
ALTER TABLE order_follow_ups ALTER COLUMN status_key SET NOT NULL;

CREATE OR REPLACE FUNCTION sync_lead_status_columns()
RETURNS TRIGGER AS $$
DECLARE
  v_valid_enum BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status_key IS NOT NULL AND NEW.status::text <> NEW.status_key THEN
      SELECT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'lead_status' AND e.enumlabel = NEW.status_key
      ) INTO v_valid_enum;
      IF v_valid_enum THEN
        NEW.status := NEW.status_key::lead_status;
      END IF;
    ELSIF NEW.status_key IS NULL THEN
      NEW.status_key := NEW.status::text;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status
       AND OLD.status_key IS NOT DISTINCT FROM NEW.status_key THEN
      NEW.status_key := NEW.status::text;
    ELSIF OLD.status_key IS DISTINCT FROM NEW.status_key
          AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
      SELECT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'lead_status' AND e.enumlabel = NEW.status_key
      ) INTO v_valid_enum;
      IF v_valid_enum THEN
        NEW.status := NEW.status_key::lead_status;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_lead_status
  BEFORE INSERT OR UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION sync_lead_status_columns();

CREATE OR REPLACE FUNCTION sync_follow_up_status_columns()
RETURNS TRIGGER AS $$
DECLARE
  v_valid_enum BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status_key IS NOT NULL AND NEW.status::text <> NEW.status_key THEN
      SELECT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'follow_up_status' AND e.enumlabel = NEW.status_key
      ) INTO v_valid_enum;
      IF v_valid_enum THEN
        NEW.status := NEW.status_key::follow_up_status;
      END IF;
    ELSIF NEW.status_key IS NULL THEN
      NEW.status_key := NEW.status::text;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status
       AND OLD.status_key IS NOT DISTINCT FROM NEW.status_key THEN
      NEW.status_key := NEW.status::text;
    ELSIF OLD.status_key IS DISTINCT FROM NEW.status_key
          AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
      SELECT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'follow_up_status' AND e.enumlabel = NEW.status_key
      ) INTO v_valid_enum;
      IF v_valid_enum THEN
        NEW.status := NEW.status_key::follow_up_status;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_follow_up_status
  BEFORE INSERT OR UPDATE ON order_follow_ups
  FOR EACH ROW EXECUTE FUNCTION sync_follow_up_status_columns();
