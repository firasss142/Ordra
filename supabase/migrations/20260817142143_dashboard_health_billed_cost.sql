-- ============================================================
-- 20260909000008_dashboard_health_billed_cost.sql
-- Point get_dashboard_health's carrier cost at what the carrier ACTUALLY BILLED.
--
-- WHY: every cost figure in that function summed carriers.delivery_fee — one
-- flat number per account (10 LYD for both Darb rows). Darb bills 5-50 LYD
-- depending on destination, averaging 28.80 (Tripoli) / 25.34 (Benghazi) across
-- 828 live shipments. Over the 90-day window that understated delivered-order
-- delivery cost by 6,995 LYD (3,780 reported vs 10,775 real), overstating Libya
-- profit by the same amount.
--
-- HOW: only the two SOURCE CTEs (hist, hist_carrier) change — they now read
-- per-order cost from the shared `order_carrier_cost` view instead of joining
-- carriers directly. Everything downstream (money, products_agg, carriers_agg)
-- consumes those CTEs unchanged. Note carriers_agg's `c.delivery_fee` is the
-- hist_carrier alias, NOT the carriers table, so two substitutions correct
-- every cost figure in the function.
--
-- WHY A DEFINITION REWRITE rather than re-pasting the 480-line body: it
-- guarantees the rest of the function is bit-identical to what was running.
-- Re-pasting risks silently reverting an unrelated fix applied since
-- 20260826000002. Each substitution is asserted, so a future refactor that
-- moves these anchors fails loudly here instead of leaving flat-fee cost in
-- place unnoticed.
--
-- get_carrier_true_cost was changed the same way in the same batch
-- (20260909000007). Those two MUST agree about what a delivery cost; that is
-- the invariant 20260825000003 was written to protect.
--
-- Return fees stay flat: the carrier reports no per-shipment return charge, so
-- effective_return_fee is still carriers.return_fee.
-- ============================================================

DO $rewrite$
DECLARE
  def  TEXT;
  prev TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'get_dashboard_health' AND n.nspname = 'public';

  IF def IS NULL THEN
    RAISE EXCEPTION 'get_dashboard_health not found';
  END IF;

  -- Already migrated? Nothing to do (keeps this migration idempotent).
  IF position('order_carrier_cost' IN def) > 0 THEN
    RETURN;
  END IF;

  -- 1. hist CTE: take the fees from the view
  prev := def;
  def := replace(def,
    '      c.delivery_fee, c.return_fee,',
    '      occ.effective_delivery_fee AS delivery_fee, occ.effective_return_fee AS return_fee,');
  IF def = prev THEN RAISE EXCEPTION 'anchor 1 (hist fee columns) not found'; END IF;

  -- 2. hist CTE: swap the carriers join for the view
  prev := def;
  def := replace(def,
    '    LEFT JOIN carriers c  ON c.id = o.carrier_id',
    '    LEFT JOIN order_carrier_cost occ ON occ.order_id = o.id');
  IF def = prev THEN RAISE EXCEPTION 'anchor 2 (hist carriers join) not found'; END IF;

  -- 3. hist_carrier CTE: keep the carriers join (needed for c.name), add the view
  prev := def;
  def := replace(def,
    E'    SELECT h.status_to, h.order_id, o.carrier_id, c.name, c.delivery_fee, c.return_fee\n    FROM order_history h\n    JOIN orders   o ON o.id = h.order_id\n    JOIN carriers c ON c.id = o.carrier_id',
    E'    SELECT h.status_to, h.order_id, o.carrier_id, c.name,\n           occ.effective_delivery_fee AS delivery_fee,\n           occ.effective_return_fee   AS return_fee\n    FROM order_history h\n    JOIN orders   o ON o.id = h.order_id\n    JOIN carriers c ON c.id = o.carrier_id\n    JOIN order_carrier_cost occ ON occ.order_id = o.id');
  IF def = prev THEN RAISE EXCEPTION 'anchor 3 (hist_carrier CTE) not found'; END IF;

  EXECUTE def;
END
$rewrite$;
