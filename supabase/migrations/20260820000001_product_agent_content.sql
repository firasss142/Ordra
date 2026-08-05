-- Agent product sheet — content layer.
--
-- Confirmation agents work orders by phone with almost no product context:
-- name, variant label, a thumbnail, qty, unit price. This adds the knowledge
-- they need mid-call, in three deliberately distinct layers:
--
--   products.description  (already existed, rendered nowhere) — customer-facing
--   products.agent_brief  — the pinned must-know, always visible, no click
--   products.agent_notes  — the body: objections, packs, what not to say
--   product_variants.agent_note — one line per pack tier (the upsell script)
--
-- Costs, stock, name, sku and price are NOT touched here and stay
-- super_admin-only per 20260422_product_stock_lockdown.sql.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS agent_brief TEXT,
  ADD COLUMN IF NOT EXISTS agent_brief_tone TEXT NOT NULL DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS agent_notes TEXT,
  ADD COLUMN IF NOT EXISTS agent_content_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_content_updated_by UUID REFERENCES users(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_agent_brief_tone_check'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_agent_brief_tone_check
      CHECK (agent_brief_tone IN ('info', 'warning', 'critical'));
  END IF;
END $$;

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS agent_note TEXT;

COMMENT ON COLUMN products.agent_brief IS
  'Pinned must-know shown to the agent on the order without a click. Capped at 280 chars app-side.';
COMMENT ON COLUMN products.agent_notes IS
  'Internal selling notes shown in the product sheet drawer. Plain text, newline-separated.';
COMMENT ON COLUMN product_variants.agent_note IS
  'One-line upsell/pack note for this quantity tier. Capped at 160 chars app-side.';

-- ─────────────────────────────────────────────────────────────────────────
-- update_product_agent_content: carve-out from the SA-only products UPDATE
-- policy, mirroring toggle_product_active. Market managers own the selling
-- narrative for their market; they still cannot touch costs or stock.
-- SECURITY DEFINER bypasses RLS; role + market are checked inside.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_product_agent_content(
  p_product_id      UUID,
  p_description     TEXT,
  p_agent_brief     TEXT,
  p_agent_brief_tone TEXT,
  p_agent_notes     TEXT,
  p_actor_id        UUID
) RETURNS products
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role      TEXT;
  v_actor_mkt UUID;
  v_prod_mkt  UUID;
  v_row       products;
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

  UPDATE products
    SET description              = p_description,
        agent_brief              = p_agent_brief,
        agent_brief_tone         = COALESCE(p_agent_brief_tone, agent_brief_tone),
        agent_notes              = p_agent_notes,
        agent_content_updated_at = now(),
        agent_content_updated_by = p_actor_id,
        updated_at               = now()
    WHERE id = p_product_id
    RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION update_product_agent_content(UUID, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_product_agent_content(UUID, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- update_variant_agent_note: same carve-out for the per-pack upsell line.
-- product_variants has no dedicated lockdown, but routing through an RPC
-- keeps the authorization rule in one place.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_variant_agent_note(
  p_variant_id UUID,
  p_agent_note TEXT,
  p_actor_id   UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role      TEXT;
  v_actor_mkt UUID;
  v_prod_mkt  UUID;
BEGIN
  SELECT role, market_id INTO v_role, v_actor_mkt
    FROM users WHERE id = p_actor_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Unknown actor';
  END IF;

  IF v_role NOT IN ('super_admin', 'market_manager') THEN
    RAISE EXCEPTION 'Not authorized to edit variant agent note';
  END IF;

  SELECT p.market_id INTO v_prod_mkt
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    WHERE v.id = p_variant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant not found';
  END IF;

  IF v_role <> 'super_admin' AND v_prod_mkt IS DISTINCT FROM v_actor_mkt THEN
    RAISE EXCEPTION 'Market mismatch';
  END IF;

  UPDATE product_variants SET agent_note = p_agent_note WHERE id = p_variant_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION update_variant_agent_note(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_variant_agent_note(UUID, TEXT, UUID) TO authenticated;
