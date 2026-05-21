-- Libya online card-payment surcharge flag.
-- When true, orders.total_price = product subtotal * 1.10 + delivery_fee
-- (the +10% applies to the product subtotal only, never the delivery fee).
-- Recovers the 10% the delivery company deducts when we withdraw collected cash;
-- net P&L is unchanged — it is a pass-through to the carrier.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS card_payment BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN orders.card_payment IS
  'Libya online card payment. When true, total_price includes +10% on the product subtotal (delivery fee excluded) to offset the carrier cash-withdrawal deduction.';
