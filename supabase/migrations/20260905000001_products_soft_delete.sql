-- ============================================================
-- 20260905000001_products_soft_delete.sql
-- Archiving for deactivated products: they leave the console for good
-- without taking any history with them.
--
-- ── WHY NOT A REAL DELETE ─────────────────────────────────────────────────
-- `DELETE FROM products` is not available to us, and not because of policy —
-- the foreign keys physically refuse. Measured against production
-- (project vshynigvgrlihngozuwb) on the three currently-deactivated products:
--
--   دمية الملاكمة حجم كبير (179 دل)  128 orders · 1 inventory_log · 1 storefront map
--   أكمام تغطية للساعد                  2 orders ·                   1 storefront map
--   XX                                  0 references
--
--   orders.product_id                  NO ACTION  → DELETE raises
--   inventory_log.product_id           NO ACTION  → DELETE raises
--   storefront_product_mappings        RESTRICT   → DELETE raises
--   investment_positions / agreements  RESTRICT   → DELETE raises
--
-- Two of the three cannot be deleted at all. Forcing it would mean cascading
-- into `orders` and `inventory_log`, both of which CLAUDE.md declares
-- APPEND-ONLY, and would silently rewrite delivered revenue that investor
-- statements have already been issued against.
--
-- So: archive. `deleted_at` becomes the single tombstone, the catalogue view
-- stops emitting the row, and every historical join keeps resolving.
--
-- ── WHY THE FILTER LIVES IN THE VIEW ──────────────────────────────────────
-- 30 call sites read `products` or `product_inventory_view`. Filtering at each
-- one guarantees that the next new route forgets. `product_inventory_view` is
-- what both catalogue surfaces read (/api/products and /api/products/list), so
-- putting `deleted_at IS NULL` inside it makes exclusion the default and
-- opting back in an explicit act. The handful of routes that read the base
-- table for a *listing* are patched alongside this migration; the ones that
-- read it for *history* (profitability, alerts, investor statements) are left
-- deliberately unfiltered — an archived product's past is still real.
--
-- ── WHY is_active = false IS REQUIRED ─────────────────────────────────────
-- Archiving is a two-step gesture on purpose. A live product is one click from
-- vanishing otherwise, and the console has no undo affordance. Deactivate,
-- look at it, then archive. `restore_product` exists for the case where the
-- second step was still a mistake.
-- ============================================================

-- ── 1. tombstone ──────────────────────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);

COMMENT ON COLUMN products.deleted_at IS
  'Archive tombstone. NULL = live. Non-null hides the row from product_inventory_view and every catalogue listing, while leaving orders, inventory_log and investor history intact. Set via archive_product(), cleared via restore_product().';

-- Partial index: every catalogue query is "the live ones", so the index only
-- needs to cover that side. Archived rows are read by id, which the PK serves.
CREATE INDEX IF NOT EXISTS products_live_idx
  ON products (market_id, is_active)
  WHERE deleted_at IS NULL;

-- ── 2. the catalogue view stops emitting archived rows ────────────────────
-- CREATE OR REPLACE cannot reorder, retype or drop columns — the sixteen from
-- 20260824000001 are reproduced verbatim and in position. The ONLY change is
-- the WHERE clause. Do not tidy this list.
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
  p.low_stock_threshold,
  p.sku,
  p.image_url,
  p.unit_cogs,
  p.packing_cost,
  p.confirmation_processing_cost,
  p.default_price,
  p.is_active
FROM products p
WHERE p.deleted_at IS NULL;

COMMENT ON VIEW product_inventory_view IS
  'Dual inventory view: system_inventory = physical (post-scan / post-return); real_inventory = initial − delivered. Delta = in-pipeline stock. Also carries the catalogue + cost columns /api/products serves to market_manager and super_admin. EXCLUDES archived products (products.deleted_at IS NOT NULL). Owner-rights view (security_invoker not set) — RLS on products does NOT apply through it, so callers must scope by market_id themselves; anon is revoked outright because the cost columns would otherwise bypass 20260819000007.';

REVOKE ALL ON product_inventory_view FROM anon;

-- ── 3. archive_product ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION archive_product(
  p_product_id UUID,
  p_actor_id   UUID
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role      TEXT;
  v_is_active BOOLEAN;
  v_deleted   TIMESTAMPTZ;
  v_now       TIMESTAMPTZ := now();
BEGIN
  SELECT role INTO v_role FROM users WHERE id = p_actor_id;

  -- Deliberately narrower than toggle_product_active. Deactivating is
  -- reversible and shared with managers and warehouse; archiving removes the
  -- product from every picker in the console, so it stays with the role that
  -- already owns creation, costs and stock.
  IF v_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Not authorized to archive a product';
  END IF;

  SELECT is_active, deleted_at INTO v_is_active, v_deleted
    FROM products WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  -- Idempotent: archiving an archived product is a no-op, not an error, so a
  -- double-submit from the UI cannot 500.
  IF v_deleted IS NOT NULL THEN
    RETURN v_deleted;
  END IF;

  IF v_is_active THEN
    RAISE EXCEPTION 'Product must be deactivated before it can be archived';
  END IF;

  UPDATE products
     SET deleted_at = v_now,
         deleted_by = p_actor_id,
         updated_at = v_now
   WHERE id = p_product_id;

  RETURN v_now;
END;
$$;

COMMENT ON FUNCTION archive_product(UUID, UUID) IS
  'Soft-deletes a DEACTIVATED product (super_admin only). Returns the tombstone timestamp. Idempotent. History in orders / inventory_log / investor statements is untouched.';

-- ── 4. restore_product ────────────────────────────────────────────────────
-- The archive gesture has no undo in the UI; this is the escape hatch. It
-- restores the row as INACTIVE, never straight back into the agent queue.
CREATE OR REPLACE FUNCTION restore_product(
  p_product_id UUID,
  p_actor_id   UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM users WHERE id = p_actor_id;

  IF v_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Not authorized to restore a product';
  END IF;

  UPDATE products
     SET deleted_at = NULL,
         deleted_by = NULL,
         is_active  = FALSE,
         updated_at = now()
   WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION restore_product(UUID, UUID) IS
  'Clears a product archive tombstone (super_admin only). The product comes back DEACTIVATED — restoring never puts it straight back in front of agents.';

REVOKE ALL ON FUNCTION archive_product(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION restore_product(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION archive_product(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION restore_product(UUID, UUID) TO authenticated;

-- ── assertions: no SQL test harness in this repo, so fail loudly here ──────
DO $$
DECLARE
  v_cols   TEXT[];
  v_expect TEXT[] := ARRAY[
    'id','name','market_id','initial_stock','current_stock','system_inventory',
    'real_inventory','damaged_return_count','low_stock_threshold',
    'sku','image_url','unit_cogs','packing_cost',
    'confirmation_processing_cost','default_price','is_active'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='products' AND column_name='deleted_at'
  ) THEN
    RAISE EXCEPTION 'FAIL: products.deleted_at was not created';
  END IF;

  -- The view's column contract must be byte-identical to 20260824000001 —
  -- only its WHERE clause was allowed to change.
  SELECT array_agg(column_name::TEXT ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='product_inventory_view';

  IF v_cols IS DISTINCT FROM v_expect THEN
    RAISE EXCEPTION 'FAIL: product_inventory_view columns changed. got %, expected %', v_cols, v_expect;
  END IF;

  IF has_table_privilege('anon','product_inventory_view','SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon can still SELECT product_inventory_view';
  END IF;

  IF NOT has_table_privilege('authenticated','product_inventory_view','SELECT') THEN
    RAISE EXCEPTION 'FAIL: authenticated lost SELECT on product_inventory_view';
  END IF;

  RAISE NOTICE 'products soft-delete ready: deleted_at + archive_product/restore_product; view now hides archived rows';
END $$;
