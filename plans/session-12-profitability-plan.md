# Session 12 — Business Profitability Architecture Plan

## Context

The OMS has team/agent performance metrics (Session 6) but no financial visibility. Managers need to see whether their market is profitable — revenue vs all costs — and drill into per-product profitability. This session adds profitability calculations, a dashboard "Rentabilité" tab, product-level profitability, and ad spend management.

---

## PART A — Business Profitability Calculation Architecture

### Approach: Aggregate counts × unit costs (not per-order SUM)

**Recommendation:** Compute aggregate counts from `order_history`, then multiply by unit costs from `carriers`/`products` tables.

**Justification for v1:**
- Simpler SQL — fewer JOINs, fewer GROUP BYs
- The carrier fee is uniform per carrier (carriers.delivery_fee / carriers.return_fee), so `count × fee` equals `SUM(fee)` per carrier grouping
- COGS varies by product, so we group by product_id anyway — `count_per_product × unit_cogs` is equivalent to SUM
- Easier to test — pure functions take counts/rates, not row-level data

### Revenue
```
SUM(orders.total_price)
WHERE order_history.status_to = 'delivered'
  AND order_history.created_at BETWEEN from_date AND to_date
JOIN orders ON order_history.order_id = orders.id
```
- NEVER use delivery_price or unit_price — only `orders.total_price`

### COGS
```
SUM(products.unit_cogs × orders.quantity)
  for orders that reached 'delivered' in period
JOIN orders → products via orders.product_id
```

### Delivery Cost (per-carrier, not flat)
```
GROUP BY orders.carrier_id
For each carrier group of delivered-in-period orders:
  count × carriers.delivery_fee
SUM across all carrier groups
```
- JOIN orders → carriers via `orders.carrier_id`
- Only orders with non-NULL carrier_id (post-dispatch)

### Return Cost (per-carrier)
```
Same pattern but status_to = 'returned' in period
count_per_carrier × carriers.return_fee
```

### Packing Cost
```
SUM(products.packing_cost)
  for orders that reached 'confirmed' in period
  (confirmed = physically packed, includes orders that later get returned)
JOIN orders → products via orders.product_id
```

### Ad Spend
```
SUM(ad_spend.amount)
WHERE ad_spend.period_start <= to_date
  AND ad_spend.period_end >= from_date
  AND ad_spend.market_id = current_market
  AND product_id IS NULL  (market-wide only for dashboard)
```

### Period Filtering (Critical)
| Metric | Status event | Timestamp source |
|--------|-------------|-----------------|
| Revenue (delivered) | `status_to = 'delivered'` | `order_history.created_at` |
| COGS (delivered) | `status_to = 'delivered'` | `order_history.created_at` |
| Delivery cost | `status_to = 'delivered'` | `order_history.created_at` |
| Return cost | `status_to = 'returned'` | `order_history.created_at` |
| Packing cost | `status_to = 'confirmed'` | `order_history.created_at` |
| Orders received | N/A | `orders.created_at` |
| Ad spend | N/A | `ad_spend.period_start/end` overlap |

### Net Profit Formula
```
net_profit = revenue − cogs − delivery_cost − return_cost − packing_cost − ad_spend
```

---

## PART B — Product Profitability Calculation Architecture

Per-product version of Part A, scoped by `orders.product_id`.

### Metrics
- **Revenue:** SUM(orders.total_price) for delivered-in-period orders WHERE product_id = X
- **COGS:** delivered_count × product.unit_cogs × avg_quantity (or SUM of orders.quantity × unit_cogs)
- **Delivery cost:** per-carrier count × carrier.delivery_fee for delivered orders of this product
- **Return cost:** per-carrier count × carrier.return_fee for returned orders of this product
- **Packing cost:** confirmed_count × product.packing_cost
- **Ad spend (CPL-based):** product.cpl × total_leads_in_period (total_leads = orders received in period for this product, using orders.created_at)
- **Processing cost:** product.confirmation_processing_cost × confirmed_count
- **Cost per delivered order:** total_costs ÷ delivered_count

### Rate Denominators
| Rate | Numerator | Denominator |
|------|-----------|-------------|
| Confirmation rate | confirmed-in-period count | actioned-in-period count (confirmed + rejected) |
| Delivery rate | delivered-in-period count | dispatched-in-period count |
| Return rate | returned-in-period count | delivered-in-period + returned-in-period count |

---

## PART C — Carrier Fee Lookup Strategy

- Orders JOIN carriers via `orders.carrier_id` — each order may use a different carrier
- `carrier_id` is NULL for pre-dispatch orders → exclude from delivery/return cost calculations
- Group delivered orders by carrier_id, get count per carrier, multiply by that carrier's `delivery_fee`
- Same for returned orders × `return_fee`
- If a carrier is deactivated (`is_active = false`), its fees still apply to historical orders — query carriers without filtering is_active

---

## PART D — Ad Spend Data Model

### Existing Table (already in migration 001)
```
ad_spend:
  id            UUID PK
  market_id     UUID FK → markets
  product_id    UUID FK → products (NULL = market-wide)
  amount        NUMERIC(10,3)
  period_start  DATE
  period_end    DATE
  note          TEXT
  created_by    UUID FK → users
  created_at    TIMESTAMPTZ
  updated_at    TIMESTAMPTZ
```

**No `is_active` column exists.** User spec requested soft delete via `is_active`.

### Migration needed
- Add `is_active BOOLEAN NOT NULL DEFAULT true` to ad_spend table

### Period matching query
```sql
SUM(amount) WHERE period_start <= to_date
  AND period_end >= from_date
  AND is_active = true
  AND market_id = ?
  AND product_id IS NULL  -- for market-wide dashboard
```

For product-level:
```sql
SUM(amount) WHERE ... AND product_id = ?
```

---

## PART E — Dashboard Layout

### Recommendation: Tab separation (Équipe | Rentabilité)

**Justification:**
- The existing dashboard already has 3 components (MetricsTable + Leaderboard + RejectionBreakdown) — adding profitability below would create an extremely long page
- Tab pattern keeps the PeriodSelector shared between both views
- Clean mental separation: team performance vs financial performance

### Layout
```
[Tableau de bord]
[PeriodSelector]                          ← shared
[Équipe | Rentabilité]                    ← tab bar

--- If Équipe tab (existing) ---
[MetricsTable]
[Leaderboard 60% | RejectionBreakdown 40%]

--- If Rentabilité tab (new) ---
[ProfitabilityTable]                      ← white card, table layout
  Revenue row
  --- Cost breakdown ---
  COGS row
  Delivery cost row
  Return cost row
  Packing cost row
  Ad spend row
  --- Bottom ---
  Total costs row (bold)
  Net profit row (bold, green if positive, red if negative)
  Margin % row

[Ad Spend Management]                     ← below profitability table
  Inline form: period_start, period_end, amount, note → Add button
  List of existing ad_spend entries for period (with soft-delete button)
```

---

## PART F — Product Detail Page Extension

### Current state
- `products/page.tsx` is a placeholder
- No `products/[id]/page.tsx` exists

### Plan
- Create product detail page with basic product info
- Add "Rentabilité" section below product info
- Reuse PeriodSelector component

### Components
- **ProductProfitability** — table layout with product-specific metrics + CPL ad spend + processing cost
- **ProductPerformanceCard** — summary KPIs: confirmation rate, delivery rate, return rate, cost per delivered order

---

## PART G — Pure Function Separation

All in `src/lib/calculations/profitability.ts` — pure, no DB, no async.

```typescript
calculateRevenue(deliveredOrders: { total_price: number }[]): number
calculateCogs(deliveredOrders: { unit_cogs: number; quantity: number }[]): number
calculateDeliveryCost(carrierGroups: { count: number; delivery_fee: number }[]): number
calculateReturnCost(carrierGroups: { count: number; return_fee: number }[]): number
calculatePackingCost(confirmedOrders: { packing_cost: number }[]): number
calculateNetProfit(input: { revenue; cogs; deliveryCost; returnCost; packingCost; adSpend }): number
calculateMargin(netProfit: number, revenue: number): number
calculateProductAdSpend(cpl: number, totalLeads: number): number
calculateProcessingCost(cost: number, confirmedCount: number): number
calculateCostPerDelivered(totalCosts: number, deliveredCount: number): number
calculateDeliveryRate(delivered: number, dispatched: number): number
calculateReturnRate(returned: number, deliveredPlusReturned: number): number
```

---

## PART H — New Files

| File | Responsibility |
|------|---------------|
| `src/lib/calculations/profitability.ts` | Pure profitability functions |
| `src/lib/calculations/__tests__/profitability.test.ts` | TDD tests for pure functions |
| `src/app/api/profitability/route.ts` | Market-level profitability API |
| `src/app/api/products/[id]/profitability/route.ts` | Product-level profitability API |
| `src/app/api/ad-spend/route.ts` | GET list + POST create ad_spend |
| `src/app/api/ad-spend/[id]/route.ts` | PUT soft-delete ad_spend |
| `src/components/dashboard/ProfitabilityTable.tsx` | Market profitability table |
| `src/components/dashboard/AdSpendManager.tsx` | Ad spend form + list |
| `src/components/dashboard/DashboardTabs.tsx` | Tab bar (Équipe / Rentabilité) |
| `src/components/products/ProductProfitability.tsx` | Product profitability table |
| `src/components/products/ProductPerformanceCard.tsx` | Product KPI card |
| `src/app/[locale]/(dashboard)/products/[id]/page.tsx` | Product detail page |
| `supabase/migrations/011_ad_spend_is_active.sql` | Add is_active to ad_spend |
| `docs/business-logic.md` | Profitability formulas documentation |

---

## PART I — Files to Reuse

| File | Contribution |
|------|-------------|
| `src/components/dashboard/MetricsTable.tsx` | `PeriodSelector`, `Period` type, table styling |
| `src/app/[locale]/(dashboard)/dashboard/page.tsx` | Wrap in tabs, add Rentabilité tab |
| `src/lib/metrics.ts` | Pattern for rate calculation functions |
| `src/lib/product-calculations.ts` | Pattern for pure functions with validation |
| `src/lib/supabase/server.ts` | `createClient()` for API routes |
| `src/types/product.ts` | `Product` type |
| `src/types/order-status.ts` | `OrderStatus` type |
| `src/types/carrier.ts` | `CarrierConfig` interface |
| `src/lib/order-engine.ts` | `OrderHistoryEntry` type |
| `src/app/api/metrics/route.ts` | Pattern for auth, market scoping, order_history queries |
| `supabase/migrations/002_rls_policies.sql` | Existing ad_spend RLS |

---

## Verification

1. `npm test` — all profitability pure functions pass
2. `npm run typecheck` — no errors
3. Apply migration via Supabase MCP
4. Hit `/api/profitability` and `/api/products/[id]/profitability` — verify JSON
5. Dashboard → Rentabilité tab → verify table renders
6. Ad spend CRUD → verify profitability updates
7. `npm run build` — clean
