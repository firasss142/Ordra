-- toggle_product_active: column-level carve-out from the SA-only products
-- UPDATE policy. Market managers and warehouse agents can activate/deactivate
-- products in their own market; super_admin can do so cross-market.
-- SECURITY DEFINER bypasses RLS; the actor's role and market are checked
-- inside the function.

CREATE OR REPLACE FUNCTION toggle_product_active(
  p_product_id UUID,
  p_is_active  BOOLEAN,
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

  IF v_role NOT IN ('super_admin', 'market_manager', 'warehouse_agent') THEN
    RAISE EXCEPTION 'Not authorized to toggle product active';
  END IF;

  SELECT market_id INTO v_prod_mkt FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  IF v_role <> 'super_admin' AND v_prod_mkt <> v_actor_mkt THEN
    RAISE EXCEPTION 'Market mismatch';
  END IF;

  UPDATE products
    SET is_active = p_is_active,
        updated_at = now()
    WHERE id = p_product_id;

  RETURN p_is_active;
END;
$$;

REVOKE ALL ON FUNCTION toggle_product_active(UUID, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION toggle_product_active(UUID, BOOLEAN, UUID) TO authenticated;
