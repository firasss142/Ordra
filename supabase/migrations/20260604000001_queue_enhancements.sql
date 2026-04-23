-- Feature 2: per-order delivery fee
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10,3) NOT NULL DEFAULT 0;

-- Feature 3: second phone
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone_2 TEXT;

-- Feature 1: multi-product line items
CREATE TABLE IF NOT EXISTS order_items (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    UUID          REFERENCES products(id) ON DELETE SET NULL,
  product_name  TEXT          NOT NULL,
  variant_id    UUID          REFERENCES product_variants(id) ON DELETE SET NULL,
  variant_label TEXT,
  quantity      INTEGER       NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  unit_price    NUMERIC(10,3) NOT NULL CHECK (unit_price >= 0),
  line_total    NUMERIC(10,3) NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- Seed from existing orders (backward compat — one item per legacy order)
INSERT INTO order_items (order_id, product_id, product_name, variant_id, variant_label, quantity, unit_price, line_total)
SELECT
  id,
  product_id,
  COALESCE(product_name, 'Unknown'),
  NULL,
  variant_label,
  COALESCE(quantity, 1),
  COALESCE(unit_price, 0),
  COALESCE(unit_price, 0) * COALESCE(quantity, 1)
FROM orders
WHERE NOT EXISTS (
  SELECT 1 FROM order_items oi WHERE oi.order_id = orders.id
);

-- RLS
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_items_super_admin" ON order_items FOR ALL TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY "order_items_market_manager" ON order_items FOR ALL TO authenticated
  USING (
    get_user_role() = 'market_manager' AND EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.market_id = get_user_market_id()
    )
  )
  WITH CHECK (
    get_user_role() = 'market_manager' AND EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.market_id = get_user_market_id()
    )
  );

CREATE POLICY "order_items_agent" ON order_items FOR ALL TO authenticated
  USING (
    get_user_role() = 'agent' AND EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.assigned_to = auth.uid()
    )
  )
  WITH CHECK (
    get_user_role() = 'agent' AND EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.assigned_to = auth.uid()
    )
  );
