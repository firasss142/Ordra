-- ============================================================
-- 20260821000001_record_stock_count_rpc.sql
-- record_stock_count: the warehouse counts what it holds.
--
-- WHY A NEW RPC RATHER THAN OPENING adjust_product_stock
--
-- The warehouse agent needs to correct stock — they are the only person who
-- can see the shelf. But adjust_product_stock takes an arbitrary signed delta
-- and also carries 'damaged_writeoff', which is a FINANCIAL act: it moves
-- value out of the business. Handing that to the floor would widen the blast
-- radius far past the need.
--
-- So this is deliberately narrower:
--   * it takes a COUNTED QUANTITY, not a delta — the agent reports what is on
--     the shelf and the server derives the correction, so a fat-fingered sign
--     cannot invent stock;
--   * the note is MANDATORY, because a correction without a cause is exactly
--     the thing that makes a ledger untrustworthy;
--   * writeoffs stay on adjust_product_stock, super_admin only.
--
-- This extends the three-path stock model in CLAUDE.md to a fourth path.
-- inventory_log stays append-only; nothing here updates or deletes a row.
-- ============================================================

CREATE OR REPLACE FUNCTION record_stock_count(
  p_product_id  UUID,
  p_counted_qty INTEGER,
  p_actor_id    UUID,
  p_note        TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role            TEXT;
  v_actor_market    UUID;
  v_product_market  UUID;
  v_current         INTEGER;
  v_delta           INTEGER;
  v_log_id          UUID;
BEGIN
  IF p_counted_qty IS NULL OR p_counted_qty < 0 THEN
    RAISE EXCEPTION 'counted quantity must be zero or more';
  END IF;

  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'a note is required for a stock count';
  END IF;

  SELECT role, market_id INTO v_role, v_actor_market
  FROM users WHERE id = p_actor_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id;
  END IF;
  IF v_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Actor role % cannot count stock', v_role;
  END IF;

  SELECT market_id, current_stock INTO v_product_market, v_current
  FROM products WHERE id = p_product_id
  FOR UPDATE;

  IF v_product_market IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  -- Market isolation, mirroring scan_order_out. super_admin is cross-market.
  IF v_role <> 'super_admin' AND v_actor_market IS DISTINCT FROM v_product_market THEN
    RAISE EXCEPTION 'Product belongs to another market';
  END IF;

  v_delta := p_counted_qty - v_current;

  IF v_delta = 0 THEN
    -- A count that confirms the books is still worth recording: it is the
    -- evidence that the figure was verified on this date.
    INSERT INTO inventory_log (product_id, order_id, change, reason, balance_after, actor_id, note)
    VALUES (p_product_id, NULL, 0, 'stock_count', v_current, p_actor_id, btrim(p_note))
    RETURNING id INTO v_log_id;

    RETURN json_build_object(
      'product_id', p_product_id, 'counted', p_counted_qty, 'previous', v_current,
      'delta', 0, 'stock_after', v_current, 'inventory_log_id', v_log_id
    );
  END IF;

  UPDATE products
  SET current_stock = p_counted_qty, updated_at = now()
  WHERE id = p_product_id;

  INSERT INTO inventory_log (product_id, order_id, change, reason, balance_after, actor_id, note)
  VALUES (p_product_id, NULL, v_delta, 'stock_count', p_counted_qty, p_actor_id, btrim(p_note))
  RETURNING id INTO v_log_id;

  RETURN json_build_object(
    'product_id', p_product_id, 'counted', p_counted_qty, 'previous', v_current,
    'delta', v_delta, 'stock_after', p_counted_qty, 'inventory_log_id', v_log_id
  );
END;
$$;

REVOKE ALL ON FUNCTION record_stock_count(UUID, INTEGER, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_stock_count(UUID, INTEGER, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION record_stock_count IS
  'Warehouse-side physical count. Takes the counted quantity and derives the correction; note mandatory; writes an append-only inventory_log row with reason=stock_count. Damaged writeoffs remain on adjust_product_stock (super_admin).';
