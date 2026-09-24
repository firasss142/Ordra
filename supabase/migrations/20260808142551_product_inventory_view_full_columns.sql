-- ============================================================
-- 20260824000001_product_inventory_view_full_columns.sql
-- Add the seven columns /api/products has always claimed to serve.
--
-- ── THE BUG ───────────────────────────────────────────────────────────────
-- GET /api/products serves `product_inventory_view` to every role except
-- agent. The view (20260421_warehouse_schema.sql:68) carries nine columns:
--   id, name, market_id, initial_stock, current_stock, system_inventory,
--   real_inventory, damaged_return_count, low_stock_threshold
-- The route selects "*" and the client declares unit_cogs, packing_cost,
-- is_active, sku, default_price and image_url on the row type. Those keys
-- simply arrive `undefined`, and `select("*")` makes that silent — no error,
-- no null, just an absent key. Four user-visible defects follow:
--
--   1. `Intl.NumberFormat.format(undefined)` renders the literal string "NaN",
--      so every catalogue row showed "COGS NaN LYD / Emb. NaN LYD".
--   2. getProductHealth() opens with `if (!input.isActive) return "red"`, so
--      with is_active undefined EVERY health dot and accent strip was red.
--   3. The row toggle sent `is_active: !product.is_active` = !undefined = true,
--      always. The toggle could switch a product ON but never OFF.
--   4. The "Actifs" filter matched zero rows and PortfolioStrip reported
--      0 active / 0 low-stock.
--
-- Verified against production (project vshynigvgrlihngozuwb): the live view has
-- exactly those nine columns. `git log -S unit_cogs` on the route shows the
-- field was never selected — the defect dates to the commit that introduced
-- the view-backed route.
--
-- ── WHY A VIEW CHANGE AND NOT A SECOND LOOKUP ─────────────────────────────
-- The route already pays for one extra round trip to backfill image_url
-- (route.ts:95-105, deleted by this change). Widening the view collapses both
-- reads into the original query. The view has exactly ONE consumer in the
-- codebase — src/app/api/products/route.ts — so the blast radius is one route.
--   $ grep -rn product_inventory_view src/
--   src/app/api/products/route.ts
--
-- ── COLUMN ORDER IS LOAD-BEARING ──────────────────────────────────────────
-- CREATE OR REPLACE VIEW cannot reorder, retype or drop existing columns. The
-- original nine are reproduced verbatim, in position, and the seven new ones
-- are APPENDED. Do not tidy this list.
--
-- ── WHAT THIS MIGRATION DELIBERATELY DOES NOT DO ──────────────────────────
-- It does not set `security_invoker = true`, even though it should eventually.
-- On PG15+ the default is false, so this view executes as its owner and
-- `products_select` RLS does NOT apply through it — market isolation for
-- /api/products currently rests entirely on the route's hand-written
-- .eq("market_id", …), which contradicts the standing rule that isolation is
-- enforced at the data layer. Flipping it here would ALSO, in the same commit:
--   * re-evaluate real_inventory's correlated orders count under the caller's
--     `orders_select` policy, and
--   * put the embedded product_variants(count) under product_variants RLS.
-- Either could change a number on screen. Bundling that with "the view was
-- missing seven columns" means a regression in either cannot be isolated.
-- Tracked as a follow-up; see plans/products-page-refactor-v2.md.
--
-- ── COGS EXPOSURE ─────────────────────────────────────────────────────────
-- 20260819000007 stripped unit_cogs / packing_cost /
-- confirmation_processing_cost from `anon` on the base table. Because this view
-- runs with owner rights, adding those columns here would hand `anon` a way
-- around that. The explicit REVOKE below closes it: anon cannot read the view
-- at all. `authenticated` is unchanged and needs no change — that role already
-- holds table-level SELECT on products.unit_cogs (asserted, not granted, by
-- 20260819000007), so the view exposes nothing new to it. Agents are routed to
-- the products table with a narrow column list by the route itself.
-- ============================================================

CREATE OR REPLACE VIEW product_inventory_view AS
SELECT
  -- ── original nine, unchanged and in position ──
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
  -- ── appended ──
  p.sku,
  p.image_url,
  p.unit_cogs,
  p.packing_cost,
  p.confirmation_processing_cost,
  p.default_price,
  p.is_active
FROM products p;

COMMENT ON VIEW product_inventory_view IS
  'Dual inventory view: system_inventory = physical (post-scan / post-return); real_inventory = initial − delivered. Delta = in-pipeline stock. Also carries the catalogue + cost columns /api/products serves to market_manager and super_admin. Owner-rights view (security_invoker not set) — RLS on products does NOT apply through it, so callers must scope by market_id themselves; anon is revoked outright because the cost columns would otherwise bypass 20260819000007.';

REVOKE ALL ON product_inventory_view FROM anon;

-- ── assertions: this repo has no SQL test harness, so fail loudly here ──
DO $$
DECLARE
  expected TEXT[] := ARRAY[
    'id','name','market_id','initial_stock','current_stock','system_inventory',
    'real_inventory','damaged_return_count','low_stock_threshold',
    'sku','image_url','unit_cogs','packing_cost',
    'confirmation_processing_cost','default_price','is_active'
  ];
  col     TEXT;
  actual  TEXT[];
BEGIN
  SELECT array_agg(column_name::TEXT ORDER BY ordinal_position)
    INTO actual
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'product_inventory_view';

  FOREACH col IN ARRAY expected LOOP
    IF NOT (col = ANY (actual)) THEN
      RAISE EXCEPTION 'FAIL: product_inventory_view is missing column %', col;
    END IF;
  END LOOP;

  -- Guard the CREATE OR REPLACE contract: the first nine must keep their slots,
  -- otherwise a client reading positionally (or a future REPLACE) breaks.
  FOR i IN 1..9 LOOP
    IF actual[i] IS DISTINCT FROM expected[i] THEN
      RAISE EXCEPTION 'FAIL: column % is "%", expected "%" — leading column order changed',
        i, actual[i], expected[i];
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'product_inventory_view', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon can still SELECT product_inventory_view (cost columns exposed)';
  END IF;

  IF NOT has_table_privilege('authenticated', 'product_inventory_view', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: authenticated lost SELECT on product_inventory_view — /api/products will 500';
  END IF;

  RAISE NOTICE 'product_inventory_view widened to 16 columns; anon revoked; authenticated intact';
END $$;
