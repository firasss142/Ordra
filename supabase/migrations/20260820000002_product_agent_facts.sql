-- Agent product sheet — facts, commercial levers, and computed signals.
--
-- Builds on 20260820000001_product_agent_content.sql. Three additions:
--
--   1. The facts a customer actually asks about on a confirmation call
--      (composition, how to use, contraindications).
--   2. Two commercial levers: a floor price the agent may negotiate down to,
--      and a cross-sell product to offer when this one is refused.
--   3. get_product_agent_signals() — confirmation rate, return rate and top
--      rejection reason, computed from orders. Nothing to author, never stale.
--
-- floor_price is deliberately NOT writable through the content RPC: it sets
-- revenue, so it belongs with default_price under the super_admin-only
-- products UPDATE policy (20260422_product_stock_lockdown.sql).

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS agent_composition       TEXT,
  ADD COLUMN IF NOT EXISTS agent_contraindications TEXT,
  ADD COLUMN IF NOT EXISTS agent_usage             TEXT,
  ADD COLUMN IF NOT EXISTS floor_price             NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS cross_sell_product_id   UUID REFERENCES products(id) ON DELETE SET NULL;

COMMENT ON COLUMN products.agent_contraindications IS
  'Warnings the agent must raise (pregnancy, age, allergies). Rendered in the critical tone.';
COMMENT ON COLUMN products.floor_price IS
  'Lowest price an agent may agree to without escalating. super_admin-only, like default_price.';
COMMENT ON COLUMN products.cross_sell_product_id IS
  'Alternative to offer when this product is refused. Same market, never self.';

-- ─────────────────────────────────────────────────────────────────────────
-- update_product_agent_content — extended with the three fact fields and the
-- cross-sell pointer. The old 6-arg signature is dropped rather than
-- overloaded so there is exactly one version to reason about.
-- ─────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS update_product_agent_content(UUID, TEXT, TEXT, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION update_product_agent_content(
  p_product_id              UUID,
  p_description             TEXT,
  p_agent_brief             TEXT,
  p_agent_brief_tone        TEXT,
  p_agent_notes             TEXT,
  p_agent_composition       TEXT,
  p_agent_contraindications TEXT,
  p_agent_usage             TEXT,
  p_cross_sell_product_id   UUID,
  p_actor_id                UUID
) RETURNS products
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role       TEXT;
  v_actor_mkt  UUID;
  v_prod_mkt   UUID;
  v_cross_mkt  UUID;
  v_row        products;
BEGIN
  SELECT role, market_id INTO v_role, v_actor_mkt
    FROM users WHERE id = p_actor_id;

  -- Explicit NULL guard: an unknown actor leaves v_role NULL, and
  -- `NULL NOT IN (...)` yields NULL, which IF treats as false — the role
  -- check would fall through to the UPDATE.
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Unknown actor';
  END IF;

  IF v_role NOT IN ('super_admin', 'market_manager') THEN
    RAISE EXCEPTION 'Not authorized to edit product agent content';
  END IF;

  SELECT market_id INTO v_prod_mkt FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  IF v_role <> 'super_admin' AND v_prod_mkt IS DISTINCT FROM v_actor_mkt THEN
    RAISE EXCEPTION 'Market mismatch';
  END IF;

  IF p_agent_brief_tone IS NOT NULL
     AND p_agent_brief_tone NOT IN ('info', 'warning', 'critical') THEN
    RAISE EXCEPTION 'Invalid agent_brief_tone';
  END IF;

  -- Cross-sell must be a real product, in the same market, and not itself.
  -- A self-reference would render a card that reopens the sheet you are in.
  IF p_cross_sell_product_id IS NOT NULL THEN
    IF p_cross_sell_product_id = p_product_id THEN
      RAISE EXCEPTION 'Cross-sell cannot reference the same product';
    END IF;

    SELECT market_id INTO v_cross_mkt FROM products WHERE id = p_cross_sell_product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cross-sell product not found';
    END IF;

    IF v_cross_mkt IS DISTINCT FROM v_prod_mkt THEN
      RAISE EXCEPTION 'Cross-sell product belongs to another market';
    END IF;
  END IF;

  UPDATE products
    SET description              = p_description,
        agent_brief              = p_agent_brief,
        agent_brief_tone         = COALESCE(p_agent_brief_tone, agent_brief_tone),
        agent_notes              = p_agent_notes,
        agent_composition        = p_agent_composition,
        agent_contraindications  = p_agent_contraindications,
        agent_usage              = p_agent_usage,
        cross_sell_product_id    = p_cross_sell_product_id,
        agent_content_updated_at = now(),
        agent_content_updated_by = p_actor_id,
        updated_at               = now()
    WHERE id = p_product_id
    RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION update_product_agent_content(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_product_agent_content(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- get_product_agent_signals — per-product outcome counts for one market.
--
-- Parameterised rather than a view: a view would need a grant broad enough to
-- dump every product's volumes in one query, and the planner guarantees are
-- weaker. Measured at ~40ms over 3 192 rows using idx_orders_market_dup
-- (market_id, product_id, ...), so it is cheap enough to run per panel open.
--
-- Rates are NOT computed here — they live in src/lib/products/signals.ts so
-- the thresholds stay unit-testable.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_product_agent_signals(
  p_product_id UUID,
  p_market_id  UUID
) RETURNS TABLE (
  rejected             BIGINT,
  confirmed            BIGINT,
  delivered            BIGINT,
  returned             BIGINT,
  top_rejection_reason TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*) FILTER (WHERE o.status = 'rejected'),
    count(*) FILTER (WHERE o.status IN ('confirmed','uploaded','scanned',
                     'dispatched','deposit','in_transit','delivered')),
    count(*) FILTER (WHERE o.status = 'delivered'),
    count(*) FILTER (WHERE o.status = 'returned'),
    (mode() WITHIN GROUP (ORDER BY o.rejection_reason)
       FILTER (WHERE o.rejection_reason IS NOT NULL))::TEXT
  FROM orders o
  WHERE o.product_id = p_product_id
    AND o.market_id  = p_market_id;
$$;

-- Read only through the server-side admin client (the product-sheet route).
-- Not granted to `authenticated`: aggregate order volumes across a whole
-- product are more than an agent can see through their own queue.
REVOKE ALL ON FUNCTION get_product_agent_signals(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_product_agent_signals(UUID, UUID) TO service_role;
