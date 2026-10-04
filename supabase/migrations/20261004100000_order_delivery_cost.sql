-- order_delivery_cost — what one order's carrier charges, ONE row per order.
-- plans/products-redesign-v6.md §3–§4, Phase 2 (owner's answers of 2026-10-03).
--
-- THE RULES
--   · Darb (carriers.code = 'darb_assabil'): no flat fee any more. A delivered
--     parcel costs what Darb INVOICED it — `billed_shipping_amount` of the
--     order's COMPLETED shipment — else the quote recorded at upload
--     (`orders.delivery_cost_quoted`, equal to the invoice on 67 of 73 qr-01
--     parcels), else NULL: the reader applies the market's average and says so.
--     Darb's invoice reads « رسوم الشحن يتحملها المرسل » (borne by the sender).
--   · A failed Darb parcel costs NOTHING (return_cost = 0). The 5 LYD
--     carriers.return_fee on both Darb rows is wrong and is no longer read.
--   · Every other carrier (Tunisia) keeps its flat carriers.delivery_fee /
--     return_fee until it sends invoices.
--   · No carrier (never uploaded): NULL / 0.
--
-- WHY A NEW VIEW AND NOT order_carrier_cost
-- order_carrier_cost LEFT JOINs EVERY Darb shipment of an order, so a re-sent
-- parcel yields two rows and any SUM over it double-counts; it reads any
-- shipment's bill, not the completed one's; it falls back to the flat 10 LYD;
-- and it charges Darb's 5 LYD return fee. Its readers move here in the same
-- change (see 20261004100300).
--
-- security_invoker: RLS on orders / carriers / darb_shipments applies to the
-- caller, so a market manager reads only their market through PostgREST.

CREATE OR REPLACE VIEW public.order_delivery_cost
WITH (security_invoker = true) AS
SELECT
  o.id                                     AS order_id,
  o.market_id,
  o.carrier_id,
  (c.code = 'darb_assabil')                AS invoiced,
  CASE
    WHEN c.id IS NULL               THEN NULL
    WHEN c.code = 'darb_assabil'    THEN COALESCE(inv.amount, o.delivery_cost_quoted)
    ELSE c.delivery_fee
  END                                      AS delivery_cost,
  CASE
    WHEN c.id IS NULL               THEN NULL
    WHEN c.code = 'darb_assabil'    THEN
      CASE WHEN inv.amount IS NOT NULL THEN 'invoice'
           WHEN o.delivery_cost_quoted IS NOT NULL THEN 'quote'
      END
    ELSE 'flat'
  END                                      AS delivery_cost_source,
  CASE
    WHEN c.id IS NULL               THEN 0
    WHEN c.code = 'darb_assabil'    THEN 0
    ELSE COALESCE(c.return_fee, 0)
  END                                      AS return_cost,
  o.created_at
FROM public.orders o
LEFT JOIN public.carriers c ON c.id = o.carrier_id
LEFT JOIN LATERAL (
  SELECT ds.billed_shipping_amount AS amount
  FROM public.darb_shipments ds
  WHERE ds.order_id = o.id
    AND ds.status_slug = 'completed'
    AND ds.billed_shipping_amount IS NOT NULL
  ORDER BY ds.completed_at DESC NULLS LAST, ds.carrier_updated_at DESC NULLS LAST
  LIMIT 1
) inv ON true;

COMMENT ON VIEW public.order_delivery_cost IS
  'One row per order: what its carrier charges. Darb = invoice of the completed shipment, else the upload quote, else NULL (reader applies the market average); a failed Darb parcel costs 0. Other carriers keep their flat delivery_fee / return_fee. Replaces order_carrier_cost (duplicated rows per re-sent parcel, flat 10 LYD fallback, 5 LYD Darb return fee). See plans/products-redesign-v6.md.';

GRANT SELECT ON public.order_delivery_cost TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- The market's average Darb invoice over the last 30 days — the ONE fallback for
-- a delivered parcel that has neither invoice nor quote yet, and the figure the
-- edit page quotes (« 23,6 د.ل en moyenne sur 30 jours »). NULL for a market
-- Darb does not serve. Readers label it as an estimate.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.market_avg_delivery_cost(p_market_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- SECURITY INVOKER on purpose: RLS decides which market a caller may average.
  SELECT round(avg(ds.billed_shipping_amount), 3)
  FROM darb_shipments ds
  JOIN orders o ON o.id = ds.order_id
  WHERE o.market_id = p_market_id
    AND ds.status_slug = 'completed'
    AND ds.billed_shipping_amount IS NOT NULL
    AND ds.completed_at >= now() - interval '30 days';
$$;

COMMENT ON FUNCTION public.market_avg_delivery_cost(uuid) IS
  'Average Darb invoice (billed_shipping_amount of completed shipments) over the last 30 days for a market. The single fallback for a delivered Darb parcel with neither invoice nor quote.';

REVOKE EXECUTE ON FUNCTION public.market_avg_delivery_cost(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.market_avg_delivery_cost(uuid) TO authenticated;
