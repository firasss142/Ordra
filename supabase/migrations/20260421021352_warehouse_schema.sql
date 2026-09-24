-- ============================================================
-- 20260421_warehouse_schema.sql
-- Warehouse agent feature — schema layer
--
-- Adds:
--   * new role 'warehouse_agent' (users.role CHECK constraint)
--   * new order_status 'scanned' (enum value, before 'dispatched')
--   * label_prints table (audit trail for QR label print batches)
--   * product_inventory_view (system vs real inventory)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Extend users.role CHECK constraint
-- ------------------------------------------------------------
-- The original constraint is auto-named (users_role_check). Drop by lookup
-- so we work whether the name matches convention or not.
--
-- CORRIGÉ le 2026-09-20 — bug identifié ET DÉCRIT dans
-- 20260819000002_investor_role_and_positions.sql, mais jamais corrigé ICI, à
-- sa source. Le `SELECT ... INTO` ci-dessous filtrait sur '%role%IN%', motif
-- que DEUX contraintes satisfont, parce que Postgres rend `role IN (...)` en
-- `role = ANY (ARRAY[...])` :
--     users_role_check       CHECK (role = ANY (ARRAY['super_admin', ...]))
--     chk_users_role_market  CHECK ((role = 'super_admin' AND market_id IS NULL) OR ...)
-- `SELECT INTO` avec plusieurs correspondances prend une ligne ARBITRAIRE. Sur
-- une base reconstruite il tombait sur `chk_users_role_market`, LA SUPPRIMAIT,
-- puis échouait sur « users_role_check already exists » — laissant l'invariant
-- « un super_admin n'a pas de marché, les autres en ont un » définitivement
-- perdu, et la reconstruction morte.
--
-- On applique ici le même correctif que la migration de 2026-08-19 : viser la
-- contrainte de VALEURS de rôle précisément, et BOUCLER pour traiter toutes
-- les correspondances au lieu d'en tirer une au hasard.
DO $$
DECLARE
  cname TEXT;
BEGIN
  FOR cname IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%market_id%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%deactivation_reason%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin', 'market_manager', 'agent', 'warehouse_agent'));

-- ------------------------------------------------------------
-- 2. Add 'scanned' to order_status enum
-- ------------------------------------------------------------
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'scanned' BEFORE 'dispatched';

-- ------------------------------------------------------------
-- 3. label_prints table — append-only audit log of QR label prints
-- ------------------------------------------------------------
-- One row per (order_id, batch_id) print action. Allowing multiple rows
-- per order covers reprints (e.g. label lost/damaged before scan).
CREATE TABLE IF NOT EXISTS label_prints (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  market_id   UUID        NOT NULL REFERENCES markets(id),
  printed_by  UUID        NOT NULL REFERENCES users(id),
  batch_id    UUID        NOT NULL,
  is_reprint  BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_label_prints_order_created
  ON label_prints (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_label_prints_market_created
  ON label_prints (market_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_label_prints_batch
  ON label_prints (batch_id);

-- ------------------------------------------------------------
-- 4. product_inventory_view — system vs real inventory
-- ------------------------------------------------------------
-- system_inventory = current physical stock (mutated at scan / return)
-- real_inventory   = initial_stock − count(orders delivered)
-- The delta = stock that has been scanned-out but not yet delivered.
CREATE OR REPLACE VIEW product_inventory_view AS
SELECT
  p.id,
  p.name,
  p.market_id,
  p.initial_stock,
  p.current_stock,
  p.current_stock AS system_inventory,
  p.initial_stock - COALESCE(
    (SELECT COUNT(*)::INTEGER
       FROM orders o
       WHERE o.product_id = p.id
         AND o.status = 'delivered'),
    0
  ) AS real_inventory,
  p.damaged_return_count,
  p.low_stock_threshold
FROM products p;

COMMENT ON VIEW product_inventory_view IS
  'Dual inventory view: system_inventory = physical (post-scan / post-return); real_inventory = initial − delivered. Delta = in-pipeline stock.';
