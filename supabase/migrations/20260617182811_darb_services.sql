-- ============================================================
-- 20260816000002_darb_services.sql
-- Darb Assabil service packages (توصيل رجالي / نسائي / فوري). Each is a distinct
-- Darb service ObjectId sent as `service` on shipment creation. The Darb apikey
-- scope cannot enumerate these (the public rates endpoint is empty for the
-- account and the authenticated list is billing-gated), so we keep the small,
-- account-specific set here and let agents pick one per dispatch.
--
-- `surcharge` is DISPLAY-ONLY context (e.g. express adds 15 LYD): the fee is
-- applied by Darb carrier-side, NOT added to orders.total_price on our side.
--
-- Seeded inline (only 3 rows, unlike darb_destinations which uses a script).
-- ============================================================

CREATE TABLE IF NOT EXISTS darb_services (
  id          SERIAL      PRIMARY KEY,
  service_id  TEXT        NOT NULL UNIQUE,  -- Darb service ObjectId (sent as `service`)
  title       TEXT        NOT NULL,         -- Arabic label shown in the picker
  attribute   TEXT        NOT NULL,         -- male | female | express | normal
  surcharge   NUMERIC(10,3) NOT NULL DEFAULT 0,  -- display-only; carrier-side fee
  currency    TEXT        NOT NULL DEFAULT 'lyd',
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  is_default  BOOLEAN     NOT NULL DEFAULT false,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: read-only for all authenticated users (a shared carrier catalogue).
ALTER TABLE darb_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "darb_services_read"
  ON darb_services FOR SELECT
  TO authenticated
  USING (true);

-- Seed the three known services for the active Darb account.
INSERT INTO darb_services (service_id, title, attribute, surcharge, currency, is_default, sort_order)
VALUES
  ('6783c612dcf305c9e775c987', 'توصيل رجالي', 'male',    0,  'lyd', true,  1),
  ('67c84fbc9ed6c0d5c5bb1d2b', 'توصيل نسائي', 'female',  10, 'lyd', false, 2),
  ('67c84fea9ed6c0d5c5bb1d2c', 'توصيل فوري',  'express', 15, 'lyd', false, 3)
ON CONFLICT (service_id) DO UPDATE SET
  title      = EXCLUDED.title,
  attribute  = EXCLUDED.attribute,
  surcharge  = EXCLUDED.surcharge,
  currency   = EXCLUDED.currency,
  is_default = EXCLUDED.is_default,
  sort_order = EXCLUDED.sort_order,
  is_active  = true,
  updated_at = now();
