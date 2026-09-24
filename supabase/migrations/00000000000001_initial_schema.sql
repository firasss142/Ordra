-- ============================================================
-- 001_initial_schema.sql
-- Enums, tables, indexes, constraints, updated_at trigger
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE order_status AS ENUM (
  -- Phase 1: Confirmation (agent workflow)
  'new',
  'assigned',
  'attempt_1',
  'attempt_2',
  'attempt_3',
  'callback_scheduled',
  'confirmed',
  -- Phase 2: Fulfillment (carrier lifecycle)
  'dispatched',
  'deposit',
  'in_transit',
  'delivered',
  'returned',
  -- Terminal (non-fulfillment)
  'rejected',
  'cancelled'
);

CREATE TYPE rejection_reason AS ENUM (
  'refus_client',
  'faux_numero',
  'doublon',
  'injoignable',
  'prix',
  'non_serieux',
  'autre'
);

-- ============================================================
-- updated_at TRIGGER FUNCTION (mutable tables only)
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- TABLE 1: markets
-- ============================================================

CREATE TABLE markets (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT        NOT NULL UNIQUE CHECK (code IN ('tn', 'ly')),
  name        TEXT        NOT NULL,
  language    TEXT        NOT NULL CHECK (language IN ('fr', 'ar')),
  currency    TEXT        NOT NULL CHECK (currency IN ('TND', 'LYD')),
  direction   TEXT        NOT NULL CHECK (direction IN ('ltr', 'rtl')),
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_markets_updated_at
  BEFORE UPDATE ON markets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE 2: users
-- ============================================================

CREATE TABLE users (
  id          UUID        PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email       TEXT        NOT NULL,
  full_name   TEXT        NOT NULL,
  phone       TEXT,
  role        TEXT        NOT NULL CHECK (role IN ('super_admin', 'market_manager', 'agent')),
  market_id   UUID        REFERENCES markets(id),
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- super_admin has no market; everyone else must have one
  CONSTRAINT chk_users_role_market CHECK (
    (role = 'super_admin' AND market_id IS NULL) OR
    (role != 'super_admin' AND market_id IS NOT NULL)
  )
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE 3: settings
-- ============================================================

CREATE TABLE settings (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id   UUID        NOT NULL REFERENCES markets(id),
  key         TEXT        NOT NULL,
  value       JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        REFERENCES users(id),
  UNIQUE (market_id, key)
);

CREATE TRIGGER trg_settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE 4: storefronts
-- ============================================================

CREATE TABLE storefronts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id       UUID        NOT NULL REFERENCES markets(id),
  platform        TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  config          JSONB,
  webhook_secret  TEXT        NOT NULL,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_storefronts_updated_at
  BEFORE UPDATE ON storefronts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE 5: carriers
-- ============================================================

CREATE TABLE carriers (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id        UUID           NOT NULL REFERENCES markets(id),
  name             TEXT           NOT NULL,
  code             TEXT           NOT NULL,
  api_endpoint     TEXT,
  api_credentials  JSONB,
  delivery_fee     NUMERIC(10,3)  NOT NULL DEFAULT 0,
  return_fee       NUMERIC(10,3)  NOT NULL DEFAULT 0,
  is_active        BOOLEAN        NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
  UNIQUE (market_id, code)
);

CREATE TRIGGER trg_carriers_updated_at
  BEFORE UPDATE ON carriers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE 6: products
-- ============================================================

CREATE TABLE products (
  id                             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id                      UUID           NOT NULL REFERENCES markets(id),
  name                           TEXT           NOT NULL,
  description                    TEXT,
  unit_cost                      NUMERIC(10,3)  NOT NULL DEFAULT 0,
  packing_cost                   NUMERIC(10,3)  NOT NULL DEFAULT 0,
  confirmation_processing_cost   NUMERIC(10,3)  NOT NULL DEFAULT 0,
  cpl                            NUMERIC(10,3)  NOT NULL DEFAULT 0,
  initial_stock                  INTEGER        NOT NULL DEFAULT 0,
  current_stock                  INTEGER        NOT NULL DEFAULT 0,
  low_stock_threshold            INTEGER        NOT NULL DEFAULT 10,
  damaged_return_count           INTEGER        NOT NULL DEFAULT 0,
  is_active                      BOOLEAN        NOT NULL DEFAULT true,
  created_at                     TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at                     TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE 7: product_variants
-- ============================================================

CREATE TABLE product_variants (
  id          UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID     NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label       TEXT     NOT NULL,
  quantity    INTEGER  NOT NULL DEFAULT 1,
  is_active   BOOLEAN  NOT NULL DEFAULT true,
  UNIQUE (product_id, label)
);

-- No updated_at on product_variants (no timestamp columns per schema)

-- ============================================================
-- TABLE 8: orders
-- ============================================================

CREATE TABLE orders (
  id                     UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id              UUID           NOT NULL REFERENCES markets(id),
  storefront_id          UUID           NOT NULL REFERENCES storefronts(id),
  external_id            TEXT           NOT NULL,
  external_platform      TEXT           NOT NULL,
  status                 order_status   NOT NULL DEFAULT 'new',
  rejection_reason       rejection_reason,
  rejection_note         TEXT,
  customer_name          TEXT           NOT NULL,
  customer_phone         TEXT           NOT NULL,
  customer_address       TEXT,
  customer_city          TEXT,
  customer_note          TEXT,
  product_id             UUID           REFERENCES products(id),
  product_name           TEXT           NOT NULL,
  variant_label          TEXT,
  quantity               INTEGER        NOT NULL DEFAULT 1,
  unit_price             NUMERIC(10,3)  NOT NULL,
  total_price            NUMERIC(10,3)  NOT NULL,  -- SOURCE OF TRUTH for revenue
  assigned_to            UUID           REFERENCES users(id),
  carrier_id             UUID           REFERENCES carriers(id),
  tracking_number        TEXT,
  callback_scheduled_at  TIMESTAMPTZ,
  raw_payload            JSONB,
  created_at             TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ    NOT NULL DEFAULT now(),
  UNIQUE (storefront_id, external_id)
);

-- Indexes for dashboard + agent queue performance
CREATE INDEX idx_orders_market_status   ON orders (market_id, status);
CREATE INDEX idx_orders_assigned_to     ON orders (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_orders_callback        ON orders (callback_scheduled_at) WHERE status = 'callback_scheduled';
CREATE INDEX idx_orders_agent_queue     ON orders (assigned_to, status, callback_scheduled_at, created_at);
CREATE INDEX idx_orders_fulfillment     ON orders (market_id, status, product_id)
  WHERE status IN ('dispatched', 'deposit', 'in_transit', 'delivered', 'returned');

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE 9: order_history — APPEND-ONLY
-- ============================================================

CREATE TABLE order_history (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID          NOT NULL REFERENCES orders(id),
  status_from  order_status,            -- NULL for initial creation
  status_to    order_status  NOT NULL,
  actor_id     UUID          REFERENCES users(id),  -- NULL for system actions
  actor_type   TEXT          NOT NULL CHECK (actor_type IN ('system', 'agent', 'manager')),
  note         TEXT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
  -- NO updated_at — append-only
);

CREATE INDEX idx_order_history_order_id ON order_history (order_id);

-- ============================================================
-- TABLE 10: inventory_log — APPEND-ONLY
-- ============================================================

CREATE TABLE inventory_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID        NOT NULL REFERENCES products(id),
  order_id      UUID        REFERENCES orders(id),
  change        INTEGER     NOT NULL,
  reason        TEXT        NOT NULL,
  balance_after INTEGER     NOT NULL,
  is_damaged    BOOLEAN     NOT NULL DEFAULT false,
  actor_id      UUID        REFERENCES users(id),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  -- NO updated_at — append-only
);

CREATE INDEX idx_inventory_log_product_id ON inventory_log (product_id);

-- ============================================================
-- TABLE 11: assignment_rules
-- ============================================================

CREATE TABLE assignment_rules (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id   UUID        NOT NULL UNIQUE REFERENCES markets(id),
  algorithm   TEXT        NOT NULL DEFAULT 'manual',
  config      JSONB,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_assignment_rules_updated_at
  BEFORE UPDATE ON assignment_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE 12: ad_spend
-- ============================================================

CREATE TABLE ad_spend (
  id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id     UUID           NOT NULL REFERENCES markets(id),
  product_id    UUID           REFERENCES products(id),  -- NULL = market-wide
  amount        NUMERIC(10,3)  NOT NULL,
  period_start  DATE           NOT NULL,
  period_end    DATE           NOT NULL,
  note          TEXT,
  created_by    UUID           NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_ad_spend_updated_at
  BEFORE UPDATE ON ad_spend
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
