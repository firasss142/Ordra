# Produits v6 — the cohort, the money, and where each figure comes from

The product list (`/products`), the product sheet (`/products/[id]`) and the edit page's
calculator (`/products/[id]/edit`) since 2026-10-03. Built from the approved prototype
(`prototypes/products-v6.html`, local only: it holds real figures) on the owner's answers
recorded in `plans/products-redesign-v6.md` §3. This page is the reference; the plan is the history.

## 1. The cohort

An order belongs to a period when it was **created** in it (market-local days, `marketTimezone()`),
and it is judged on **what it is today**. A product is in an order when it is `orders.product_id` or
any `order_items.product_id`; a mixed order counts **+1 for each** of its products.

The old screens counted `order_history` events by their own date and orders by their creation date,
so two different groups of orders were divided by each other (133 % confirmation, more uploads than
confirmations). Never mix the two bases on one screen.

## 2. What became of an order — one definition, shared

| Bucket | Rule |
|---|---|
| rejetée / supprimée / annulée | never uploaded; status `rejected` / `deleted` / `cancelled` |
| en appel | never uploaded; `pending`, `attempt_*`, `callback_scheduled` |
| à uploader | never uploaded; `confirmed`, `dispatch_scheduled` |
| livrée · échouée · chez le transporteur · annulée avant envoi | uploaded: **read from `carrier_parcel_outcome`** |

`carrier_parcel_outcome` (migration `20261004090000`) is the ONE definition of a parcel's fate, shared
with the Transporteurs page: delivered when Ordra says so or Darb says `completed`; failed when picked
up by the carrier and not delivered (Darb's own status wins when Ordra says `cancelled`; a `released`
counts as handed back only behind a cancel); in flight otherwise; cancelled before pickup. Change it
only through a NEW migration — both branches carry the file byte for byte.

`src/lib/products/cohort.ts` maps a line to its bucket (`bucketOf`) and counts (`countCohort`).

**Rates.** Confirmation = uploaded ÷ (uploaded + rejected) — Salle de contrôle's. Delivery =
delivered ÷ (delivered + failed), « provisoire » above 10 % of uploaded parcels still with the carrier.
« Résultat définitif » = 1 − (en appel + à uploader + en route) ÷ received.

## 3. The money (`src/lib/calculations/product-cohort.ts`)

| Line | Rule |
|---|---|
| Payé par les clients | Σ delivered lines: line share × `orders.total_price` (the only revenue field) |
| Frais transporteur | delivered: `order_delivery_cost.delivery_cost` (Darb invoice → upload quote → market average, counted as estimated); failed: `return_cost` (0 for Darb) |
| **Encaissé** (the revenue headline) | payé − frais transporteur |
| Coût produit | units delivered × `products.unit_cogs` |
| Emballage | parcels that LEFT (every uploaded order, shared by line share) × `packing_cost` |
| Traitement | confirmed orders (shared) × `confirmation_processing_cost` — shown only when non-zero |
| Publicité | `ad_spend` of the period, a multi-day row spread evenly over its days |
| Profit net | encaissé − product − packaging − processing − ads |

Line share = the product's line value ÷ the order's mapped line value (zero-priced lines split evenly;
an unmapped line is left out so the mapped products absorb the order — the rule of
`order-revenue-attribution.ts`). Margin = net ÷ encaissé. Per delivery = ÷ delivered orders.
Break-even (« point mort ») = what ads may cost per delivery before the product loses money.

## 4. The pipe

```
get_product_cohort(market, from, to, tz, product?)   ← 20261004100100, SECURITY DEFINER, market guard
   one fact row per (order, product) + ads per day + units left in 30 days
   + market_avg_delivery_cost + (sheet) deliveries per day, stock moves, agent names
        ↓
src/lib/products/overview.ts  → buildProductsOverview / buildProductSheet (server)
        ↓
GET /api/products/overview          → the list (whole catalogue; the page filters and sorts)
GET /api/products/[id]/overview     → the sheet, and the edit page's last-30-days averages
```

Stock cover = stock ÷ (units uploaded over the last 30 days ÷ 30); the « à réapprovisionner » signal
fires under `supplier_lead_time_days` (default 14). Stock reads « Jamais compté » until
`record_stock_count` has run for the product.

## 5. Screens

`src/components/products/v6/` — the prototype's markup and class names, styled by
`products-v6.css`, the prototype's own stylesheet scoped under `.pv6` (px values: the root font is
14px). Translations: `products.v6`, the prototype's dictionary key for key (parity test
`src/messages/__tests__/products-v6-parity.test.ts`). Two deliberate departures from the mock-up:
its duplicated `f_active` key (the filter now reads « Actifs ») and its Arabic flow-chart labels,
whose tspans overlapped in a right-to-left run.

The edit page saves the whole product with one button (PATCH product, image, agent content); the
variants editor keeps its per-row save — each size is a record with its own stock.

## 6. Darb at its real price, app-wide

See `docs/darb-assabil-sync.md` §6. In short: `order_delivery_cost` (one row per order) is the cost
truth, `order_carrier_cost` is rebuilt on it for the readers that already used it (dashboard, carrier
true cost), and the P&L, Dépenses pub and investor accrual read the invoice; a failed Darb parcel
costs nothing everywhere.
