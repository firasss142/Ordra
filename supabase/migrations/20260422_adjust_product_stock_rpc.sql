-- adjust_product_stock: the missing RPC that powers POST /api/products/[id]/stock.
-- SECURITY DEFINER so it can bypass the SA-only products UPDATE policy, with an
-- explicit role check inside (super_admin only).
--
-- Two valid reasons:
--   - manual_adjustment  (add or subtract from current_stock)
--   - damaged_writeoff   (increments damaged_return_count, stock unchanged)
--
-- Both write an append-only inventory_log row with balance_after reflecting the
-- post-change value (current_stock for manual_adjustment, damaged_return_count
-- for damaged_writeoff, matching the semantics used by scan_return_in).

CREATE OR REPLACE FUNCTION adjust_product_stock(
  p_product_id UUID,
  p_change     INTEGER,
  p_reason     TEXT,
  p_note       TEXT,
  p_actor_id   UUID,
  p_is_damaged_writeoff BOOLEAN DEFAULT false
) RETURNS TABLE(new_stock INTEGER, new_damaged INTEGER)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role        TEXT;
  v_product     products%ROWTYPE;
  v_new_stock   INTEGER;
  v_new_damaged INTEGER;
BEGIN
  SELECT role INTO v_role FROM users WHERE id = p_actor_id;
  IF v_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can adjust stock';
  END IF;

  IF p_reason NOT IN ('manual_adjustment', 'damaged_writeoff') THEN
    RAISE EXCEPTION 'Invalid reason: %', p_reason;
  END IF;

  IF p_change = 0 THEN
    RAISE EXCEPTION 'change must be non-zero';
  END IF;

  IF p_is_damaged_writeoff AND p_change >= 0 THEN
    RAISE EXCEPTION 'damaged_writeoff requires negative change';
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  IF p_is_damaged_writeoff THEN
    v_new_stock   := v_product.current_stock;
    v_new_damaged := v_product.damaged_return_count + ABS(p_change);
    UPDATE products SET damaged_return_count = v_new_damaged, updated_at = now()
      WHERE id = p_product_id;
    INSERT INTO inventory_log (
      product_id, order_id, change, reason, balance_after, is_damaged, actor_id, note
    ) VALUES (
      p_product_id, NULL, p_change, 'damaged_writeoff', v_new_damaged, true, p_actor_id, p_note
    );
  ELSE
    v_new_stock := v_product.current_stock + p_change;
    IF v_new_stock < 0 THEN
      RAISE EXCEPTION 'stock cannot go below zero';
    END IF;
    v_new_damaged := v_product.damaged_return_count;
    UPDATE products SET current_stock = v_new_stock, updated_at = now()
      WHERE id = p_product_id;
    INSERT INTO inventory_log (
      product_id, order_id, change, reason, balance_after, is_damaged, actor_id, note
    ) VALUES (
      p_product_id, NULL, p_change, 'manual_adjustment', v_new_stock, false, p_actor_id, p_note
    );
  END IF;

  RETURN QUERY SELECT v_new_stock, v_new_damaged;
END;
$$;

REVOKE ALL ON FUNCTION adjust_product_stock(UUID, INTEGER, TEXT, TEXT, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION adjust_product_stock(UUID, INTEGER, TEXT, TEXT, UUID, BOOLEAN) TO authenticated;
