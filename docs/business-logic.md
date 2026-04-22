# Business Profitability Logic

Created in Session 12. Defines how profitability is calculated at market and product level.

---

## Core Formula

```
Net Profit = Revenue − COGS − Delivery Cost − Return Cost − Packing Cost − Ad Spend
Margin = (Net Profit / Revenue) × 100
```

---

## Revenue

```
SUM(orders.total_price)
for orders that reached 'delivered' in the selected period
```

- Source of truth: `orders.total_price` — NEVER `unit_price` or other fields
- "Delivered in period" = `order_history.status_to = 'delivered' AND order_history.created_at BETWEEN from AND to`

## COGS (Cost of Goods Sold)

```
SUM(products.unit_cost × orders.quantity)
for orders delivered in period
```

- Join: `orders.product_id → products.id`

## Delivery Cost

```
Per carrier: count_of_delivered_orders × carriers.delivery_fee
SUM across all carriers
```

- Join: `orders.carrier_id → carriers.id`
- Only orders with non-NULL carrier_id
- Inactive carriers still count for historical orders

## Return Cost

```
Per carrier: count_of_returned_orders × carriers.return_fee
SUM across all carriers
```

- "Returned in period" = `order_history.status_to = 'returned'`

## Packing Cost

```
SUM(products.packing_cost) for orders confirmed in period
```

- "Confirmed in period" = `order_history.status_to = 'confirmed'`
- Includes orders that are later returned (packing already happened)

## Ad Spend (Market-level)

```
SUM(ad_spend.amount)
WHERE period_start <= to_date AND period_end >= from_date
AND is_active = true AND market_id = X AND product_id IS NULL
```

---

## Product-Level Profitability

Same as market-level but scoped to `orders.product_id = X`, plus:

### Ad Spend (Product-level via CPL)

```
products.cpl × total_leads_in_period
```

- total_leads = orders received (orders.created_at) in period for this product

### Processing Cost

```
products.confirmation_processing_cost × confirmed_count
```

### Cost Per Delivered

```
total_costs / delivered_count
```

---

## Period Filtering Rules

| Metric | Filter column | Timestamp |
|--------|--------------|-----------|
| Revenue | `status_to = 'delivered'` | `order_history.created_at` |
| COGS | `status_to = 'delivered'` | `order_history.created_at` |
| Delivery cost | `status_to = 'delivered'` | `order_history.created_at` |
| Return cost | `status_to = 'returned'` | `order_history.created_at` |
| Packing cost | `status_to = 'confirmed'` | `order_history.created_at` |
| Total leads | N/A | `orders.created_at` |
| Ad spend | N/A | `ad_spend.period_start/end` overlap |

---

## Implementation

- Pure functions: `src/lib/calculations/profitability.ts` (no DB, no async)
- Market API: `GET /api/profitability?from_date=&to_date=`
- Product API: `GET /api/products/[id]/profitability?from_date=&to_date=`
- Ad spend API: `GET/POST /api/ad-spend`, `PUT /api/ad-spend/[id]` (soft delete)
