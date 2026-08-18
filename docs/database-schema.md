# Database Schema Reference

All tables for the OMS. Schema established in Session 1.
Source of truth: OMS spec Sections 2, 3, 5, 6, 9.2, 10, 12.3, 14.2.

---

## Tables Overview

| Table | Purpose | Mutable? | RLS Scope |
|-------|---------|----------|-----------|
| markets | Market config (TN/LY) | Yes | Everyone reads, super_admin writes |
| users | All users with role + market | Yes | SA: all, MM: own market, Agent: self |
| settings | Configurable variables per market | Yes | SA: all, MM+Agent: own market |
| storefronts | Webhook + API config per platform | Yes | SA: all, MM+Agent: own market |
| carriers | Carrier config with fees per market | Yes | SA: all, MM+Agent: own market |
| products | Product catalog with COGS + stock | Yes | SA: all, MM+Agent: own market |
| product_variants | Variant-to-quantity mapping | Yes | Follows products |
| orders | Internal order model | Yes | SA: all, MM: own market, Agent: own assigned_to |
| order_history | Immutable status transition log | **APPEND-ONLY** | Follows order access |
| inventory_log | Immutable stock movement log | **APPEND-ONLY** | SA: all, MM+Agent: own market |
| assignment_rules | Algorithm config per market | Yes | SA: all, MM: own market |
| ad_spend | Manual ad spend entry per period | Yes | SA: all, MM: own market |
| agent_commission_rates | Commission rules per market / agent, effective-dated (see docs/agent-commissions.md) | Append rows, close by new row | SA: all, MM: own market (read) |
| agent_commission_ledger | Signed commission movements per agent — balance = SUM(amount) | **APPEND-ONLY** | SA: all, MM: own market (read); agents via RPC only |

---

## markets

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| code | TEXT UNIQUE | 'tn' or 'ly' |
| name | TEXT | Display name |
| language | TEXT | 'fr' or 'ar' |
| currency | TEXT | 'TND' or 'LYD' |
| direction | TEXT | 'ltr' or 'rtl' |
| is_active | BOOLEAN | |
| created_at, updated_at | TIMESTAMPTZ | |

Seeded with Tunisia and Libya on creation.

## users

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK → auth.users | |
| email | TEXT | |
| full_name | TEXT | |
| phone | TEXT | Nullable |
| role | TEXT | super_admin, market_manager, agent |
| market_id | UUID → markets | NULL for super_admin only |
| is_active | BOOLEAN | Deactivate = soft delete |
| created_at, updated_at | TIMESTAMPTZ | |

Constraint: super_admin must have NULL market_id. Everyone else must have a market_id.

## settings

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| market_id | UUID → markets | |
| key | TEXT | Setting name |
| value | JSONB | Setting value |
| updated_at | TIMESTAMPTZ | |
| updated_by | UUID → users | |

Unique on (market_id, key). Keys include:
- delivery_fee: `{"amount": 6}`
- return_fee: `{"amount": 4}`
- packing_cost: `{"amount": 2}`
- max_call_attempts: `{"value": 3}`
- assignment_algorithm: `{"type": "manual"}`

## storefronts

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| market_id | UUID → markets | |
| platform | TEXT | easy_orders, shopify, woocommerce |
| name | TEXT | Display name |
| config | JSONB | Platform-specific (API keys, store ID) |
| webhook_secret | TEXT | Validates incoming webhooks |
| is_active | BOOLEAN | |
| created_at, updated_at | TIMESTAMPTZ | |

## carriers

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| market_id | UUID → markets | |
| name | TEXT | Display name for agents |
| code | TEXT | Internal code (navex, libyan_carrier) |
| api_endpoint | TEXT | Carrier REST API URL |
| api_credentials | JSONB | Encrypted at app level |
| delivery_fee | NUMERIC(10,3) | Per delivered order |
| return_fee | NUMERIC(10,3) | Per returned order |
| is_active | BOOLEAN | Toggle without deleting |
| created_at, updated_at | TIMESTAMPTZ | |

Unique on (market_id, code).

## products

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| market_id | UUID → markets | |
| name | TEXT | |
| description | TEXT | |
| unit_cost | NUMERIC(10,3) | COGS per unit |
| packing_cost | NUMERIC(10,3) | Per package |
| confirmation_processing_cost | NUMERIC(10,3) | Per confirmed order (optional) |
| cpl | NUMERIC(10,3) | Cost per lead, manual per period |
| initial_stock | INTEGER | Set on product creation |
| current_stock | INTEGER | Updated by inventory_log events |
| low_stock_threshold | INTEGER | Alert threshold |
| damaged_return_count | INTEGER | Counter, not per-order flag |
| is_active | BOOLEAN | Soft delete |
| created_at, updated_at | TIMESTAMPTZ | |

## product_variants

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| product_id | UUID → products | CASCADE delete |
| label | TEXT | Variant name from storefront |
| quantity | INTEGER | Units in this variant |
| is_active | BOOLEAN | |

Unique on (product_id, label). Used for COGS calculation: variant_cogs = unit_cost × quantity.

## orders

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| market_id | UUID → markets | |
| storefront_id | UUID → storefronts | |
| external_id | TEXT | Storefront order ID |
| external_platform | TEXT | easy_orders, shopify, etc. |
| status | order_status ENUM | 14 values (see order-pipeline.md) |
| rejection_reason | rejection_reason ENUM | Required when rejected |
| rejection_note | TEXT | Free text for 'autre' |
| customer_name | TEXT | |
| customer_phone | TEXT | |
| customer_address | TEXT | |
| customer_city | TEXT | |
| customer_note | TEXT | From checkout |
| product_id | UUID → products | |
| product_name | TEXT | Denormalized for display |
| variant_label | TEXT | |
| quantity | INTEGER | |
| unit_price | NUMERIC(10,3) | |
| total_price | NUMERIC(10,3) | **SOURCE OF TRUTH for revenue** |
| assigned_to | UUID → users | Agent assignment |
| carrier_id | UUID → carriers | Selected on confirmation |
| tracking_number | TEXT | From carrier API response |
| callback_scheduled_at | TIMESTAMPTZ | For callback_scheduled status |
| raw_payload | JSONB | Original webhook, debugging only |
| created_at, updated_at | TIMESTAMPTZ | |

Unique on (storefront_id, external_id) — prevents duplicate intake.

Key indexes:
- (market_id, status) — dashboard queries
- (assigned_to) WHERE NOT NULL — agent queue
- (callback_scheduled_at) WHERE callback_scheduled — queue sorting
- (assigned_to, status, callback_scheduled_at, created_at) — agent queue sort
- (market_id, status, product_id) WHERE status IN ('dispatched','deposit','in_transit','delivered','returned') — fulfillment tracking

## order_history — IMMUTABLE

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| order_id | UUID → orders | |
| status_from | order_status | NULL for initial creation |
| status_to | order_status | |
| actor_id | UUID → users | NULL for system actions |
| actor_type | TEXT | system, agent, manager |
| note | TEXT | Rejection reason, callback note, error |
| created_at | TIMESTAMPTZ | |

**No updated_at. No UPDATE/DELETE policies. Append-only.**

## inventory_log — IMMUTABLE

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| product_id | UUID → products | |
| order_id | UUID → orders | NULL for manual adjustments |
| change | INTEGER | +1 or -1 |
| reason | TEXT | deposit, returned, damaged_return, manual_restock, manual_adjustment, initial_stock |
| balance_after | INTEGER | Snapshot of current_stock after change |
| is_damaged | BOOLEAN | For returned items |
| actor_id | UUID → users | |
| note | TEXT | Mandatory for manual adjustments |
| created_at | TIMESTAMPTZ | |

**No updated_at. No UPDATE/DELETE policies. Append-only.**

Stock rules:
- deposit → -1 (physical pickup by carrier)
- returned → +1 (physical return to warehouse)
- damaged_return → 0 change, is_damaged=true, damaged_return_count increments on product
- Everything before deposit (including confirmation) = zero stock impact

## assignment_rules

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| market_id | UUID → markets | Unique |
| algorithm | TEXT | manual, round_robin, workload, product, region |
| config | JSONB | Algorithm-specific config |
| is_active | BOOLEAN | |
| updated_at | TIMESTAMPTZ | |

## ad_spend

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| market_id | UUID → markets | |
| product_id | UUID → products | NULL = market-wide |
| amount | NUMERIC(10,3) | |
| period_start | DATE | |
| period_end | DATE | |
| note | TEXT | |
| created_by | UUID → users | |
| created_at, updated_at | TIMESTAMPTZ | |

---

## Enums

```
order_status (14 values):
  -- Phase 1: Confirmation (agent workflow)
  new, assigned, attempt_1, attempt_2, attempt_3, callback_scheduled, confirmed
  -- Phase 2: Fulfillment (carrier lifecycle)
  dispatched, deposit, in_transit, delivered, returned
  -- Terminal (non-fulfillment)
  rejected, cancelled

rejection_reason (7 values):
  refus_client, faux_numero, doublon, injoignable, prix, non_serieux, autre
```

Terminal statuses: delivered, returned, rejected, cancelled.
dispatched is NOT terminal — it transitions into fulfillment phase.
deposit is the COST BOUNDARY — carrier fees and stock changes begin here.

## RLS Helper Functions

```sql
get_user_role()      → returns current user's role from users table
get_user_market_id() → returns current user's market_id from users table
```

Both are SECURITY DEFINER STABLE functions.