# Database Schema Plan — Complete OMS (Corrected)

## Context
Session 1 foundation work. Full Supabase database schema for the OMS — every table, enum, RLS policy, helper function, index, and seed data.

Key correction from user review: `dispatched` is NOT terminal. Orders have a **two-phase lifecycle** — confirmation (agent) then fulfillment (carrier). The fulfillment statuses `deposit`, `in_transit`, `delivered`, `returned` must be in the `order_status` enum.

Sources: `docs/oms-spec.md`, `docs/database-schema.md`, `docs/order-pipeline.md`, user annotations in `plans/database-schema-plan.md`.

---

## Enums (2)

### order_status (14 values)
**Phase 1 — Confirmation:** `new, assigned, attempt_1, attempt_2, attempt_3, callback_scheduled, confirmed`
**Phase 2 — Fulfillment:** `dispatched, deposit, in_transit, delivered, returned`
**Terminal (non-fulfillment):** `rejected, cancelled`

### rejection_reason (7 values)
`refus_client, faux_numero, doublon, injoignable, prix, non_serieux, autre`

---

## Status Lifecycle

```
PHASE 1 — CONFIRMATION (agent workflow):
new → assigned → attempt_1/2/3 → callback_scheduled → confirmed → dispatched (exits agent queue)
                                                                 → rejected (TERMINAL)
cancelled (TERMINAL — manager/system, any pre-dispatch)

PHASE 2 — FULFILLMENT (carrier lifecycle):
dispatched → deposit → in_transit → delivered (TERMINAL)
                                  → returned (TERMINAL)
```

- `dispatched` = exits agent queue, enters fulfillment tracking
- `deposit` = **COST BOUNDARY** — carrier fees begin, stock −1
- `delivered` = revenue realized
- `returned` = stock +1 (unless damaged)
- **Terminal:** delivered, returned, rejected, cancelled
- **Fulfillment statuses set by:** system (carrier webhook/polling) or manager (manual), NEVER agents

### Transition Table

| From | Allowed To | Set By |
|------|-----------|--------|
| new | assigned | System / Manager |
| assigned | attempt_1, callback_scheduled, confirmed, rejected, cancelled | Agent / Manager |
| attempt_1 | attempt_2, callback_scheduled, confirmed, rejected, cancelled | Agent / Manager |
| attempt_2 | attempt_3, callback_scheduled, confirmed, rejected, cancelled | Agent / Manager |
| attempt_3 | callback_scheduled, confirmed, rejected, cancelled | Agent / Manager |
| callback_scheduled | attempt_1, attempt_2, attempt_3, confirmed, rejected, cancelled | Agent / Manager |
| confirmed | dispatched, cancelled | System / Manager |
| dispatched | deposit, cancelled | System / Manager |
| deposit | in_transit | System / Manager |
| in_transit | delivered, returned | System / Manager |
| delivered | *(terminal)* | — |
| returned | *(terminal)* | — |
| rejected | *(terminal)* | — |
| cancelled | *(terminal)* | — |

---

## RLS Helper Functions (2)

### get_user_role()
Returns current user's `role` from `users` table. `SECURITY DEFINER STABLE`.

### get_user_market_id()
Returns current user's `market_id` from `users` table. `SECURITY DEFINER STABLE`.

---

## Tables (12)

### 1. markets
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| code | TEXT | UNIQUE, NOT NULL, CHECK (code IN ('tn','ly')) |
| name | TEXT | NOT NULL |
| language | TEXT | NOT NULL, CHECK (language IN ('fr','ar')) |
| currency | TEXT | NOT NULL, CHECK (currency IN ('TND','LYD')) |
| direction | TEXT | NOT NULL, CHECK (direction IN ('ltr','rtl')) |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

**RLS:** Everyone reads. Only super_admin writes.
**Seed:** Tunisia (tn, fr, TND, ltr) + Libya (ly, ar, LYD, rtl).

### 2. users
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, REFERENCES auth.users ON DELETE CASCADE |
| email | TEXT | NOT NULL |
| full_name | TEXT | NOT NULL |
| phone | TEXT | Nullable |
| role | TEXT | NOT NULL, CHECK (role IN ('super_admin','market_manager','agent')) |
| market_id | UUID | FK → markets, Nullable |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

**CHECK:** `(role = 'super_admin' AND market_id IS NULL) OR (role != 'super_admin' AND market_id IS NOT NULL)`
**RLS:** SA: all. MM: own market. Agent: self only.

### 3. settings
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| market_id | UUID | FK → markets, NOT NULL |
| key | TEXT | NOT NULL |
| value | JSONB | NOT NULL |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_by | UUID | FK → users, Nullable |

**UNIQUE:** (market_id, key)
**RLS:** SA: all. MM+Agent: own market read-only.

### 4. storefronts
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| market_id | UUID | FK → markets, NOT NULL |
| platform | TEXT | NOT NULL |
| name | TEXT | NOT NULL |
| config | JSONB | Nullable |
| webhook_secret | TEXT | NOT NULL |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

**RLS:** SA: all. MM+Agent: own market read-only.

### 5. carriers
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| market_id | UUID | FK → markets, NOT NULL |
| name | TEXT | NOT NULL |
| code | TEXT | NOT NULL |
| api_endpoint | TEXT | Nullable |
| api_credentials | JSONB | Nullable |
| delivery_fee | NUMERIC(10,3) | NOT NULL, DEFAULT 0 |
| return_fee | NUMERIC(10,3) | NOT NULL, DEFAULT 0 |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

**UNIQUE:** (market_id, code)
**RLS:** SA: all. MM+Agent: own market read-only.
**Note:** `carriers.delivery_fee` / `carriers.return_fee` are SOURCE OF TRUTH for profitability. Settings-level fees are market defaults only — never fall back silently.

### 6. products
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| market_id | UUID | FK → markets, NOT NULL |
| name | TEXT | NOT NULL |
| description | TEXT | Nullable |
| unit_cost | NUMERIC(10,3) | NOT NULL, DEFAULT 0 |
| packing_cost | NUMERIC(10,3) | NOT NULL, DEFAULT 0 |
| confirmation_processing_cost | NUMERIC(10,3) | NOT NULL, DEFAULT 0 |
| cpl | NUMERIC(10,3) | NOT NULL, DEFAULT 0 |
| initial_stock | INTEGER | NOT NULL, DEFAULT 0 |
| current_stock | INTEGER | NOT NULL, DEFAULT 0 |
| low_stock_threshold | INTEGER | NOT NULL, DEFAULT 10 |
| damaged_return_count | INTEGER | NOT NULL, DEFAULT 0 |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

**RLS:** SA: all. MM+Agent: own market.

### 7. product_variants
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| product_id | UUID | FK → products ON DELETE CASCADE, NOT NULL |
| label | TEXT | NOT NULL |
| quantity | INTEGER | NOT NULL, DEFAULT 1 |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |

**UNIQUE:** (product_id, label)
**RLS:** Follows products (join through product_id → products.market_id).

### 8. orders
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| market_id | UUID | FK → markets, NOT NULL |
| storefront_id | UUID | FK → storefronts, NOT NULL |
| external_id | TEXT | NOT NULL |
| external_platform | TEXT | NOT NULL |
| status | order_status | NOT NULL, DEFAULT 'new' |
| rejection_reason | rejection_reason | Nullable |
| rejection_note | TEXT | Nullable |
| customer_name | TEXT | NOT NULL |
| customer_phone | TEXT | NOT NULL |
| customer_address | TEXT | Nullable |
| customer_city | TEXT | Nullable |
| customer_note | TEXT | Nullable |
| product_id | UUID | FK → products, Nullable |
| product_name | TEXT | NOT NULL (denormalized) |
| variant_label | TEXT | Nullable |
| quantity | INTEGER | NOT NULL, DEFAULT 1 |
| unit_price | NUMERIC(10,3) | NOT NULL |
| total_price | NUMERIC(10,3) | NOT NULL — SOURCE OF TRUTH for revenue |
| assigned_to | UUID | FK → users, Nullable |
| carrier_id | UUID | FK → carriers, Nullable |
| tracking_number | TEXT | Nullable |
| callback_scheduled_at | TIMESTAMPTZ | Nullable |
| raw_payload | JSONB | Nullable |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

**UNIQUE:** (storefront_id, external_id)
**Indexes:**
- `idx_orders_market_status` ON (market_id, status)
- `idx_orders_assigned_to` ON (assigned_to) WHERE assigned_to IS NOT NULL
- `idx_orders_callback` ON (callback_scheduled_at) WHERE status = 'callback_scheduled'
- `idx_orders_agent_queue` ON (assigned_to, status, callback_scheduled_at, created_at)
- `idx_orders_fulfillment` ON (market_id, status, product_id) WHERE status IN ('dispatched','deposit','in_transit','delivered','returned')

**RLS:** SA: all. MM: own market. Agent: own assigned_to only.

### 9. order_history — APPEND-ONLY
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| order_id | UUID | FK → orders, NOT NULL |
| status_from | order_status | Nullable (NULL for initial creation) |
| status_to | order_status | NOT NULL |
| actor_id | UUID | FK → users, Nullable (NULL for system) |
| actor_type | TEXT | NOT NULL, CHECK (actor_type IN ('system','agent','manager')) |
| note | TEXT | Nullable |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

**NO updated_at. NO UPDATE policy. NO DELETE policy. INSERT-only.**
**Index:** `idx_order_history_order_id` ON (order_id)
**RLS:** Follows order access (join through order_id → orders).

### 10. inventory_log — APPEND-ONLY
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| product_id | UUID | FK → products, NOT NULL |
| order_id | UUID | FK → orders, Nullable |
| change | INTEGER | NOT NULL |
| reason | TEXT | NOT NULL |
| balance_after | INTEGER | NOT NULL |
| is_damaged | BOOLEAN | NOT NULL, DEFAULT false |
| actor_id | UUID | FK → users, Nullable |
| note | TEXT | Nullable |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

**NO updated_at. NO UPDATE policy. NO DELETE policy. INSERT-only.**
**Index:** `idx_inventory_log_product_id` ON (product_id)
**RLS:** SA: all. MM+Agent: own market (via product_id → products.market_id).

Stock rules tied to order status transitions:
- `deposit` → stock −1
- `returned` → stock +1 (unless damaged, then +0 and is_damaged=true)
- Everything before `deposit` → no stock change

### 11. assignment_rules
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| market_id | UUID | FK → markets, UNIQUE, NOT NULL |
| algorithm | TEXT | NOT NULL, DEFAULT 'manual' |
| config | JSONB | Nullable |
| is_active | BOOLEAN | NOT NULL, DEFAULT true |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

**RLS:** SA: all. MM: own market.

### 12. ad_spend
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| market_id | UUID | FK → markets, NOT NULL |
| product_id | UUID | FK → products, Nullable (NULL = market-wide) |
| amount | NUMERIC(10,3) | NOT NULL |
| period_start | DATE | NOT NULL |
| period_end | DATE | NOT NULL |
| note | TEXT | Nullable |
| created_by | UUID | FK → users, NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

**RLS:** SA: all. MM: own market.

---

## Seed Data

### markets (2 rows)
- Tunisia: code='tn', name='Tunisia', language='fr', currency='TND', direction='ltr'
- Libya: code='ly', name='Libya', language='ar', currency='LYD', direction='rtl'

### settings (5 keys x 2 markets = 10 rows)
Per market: delivery_fee, return_fee, packing_cost, max_call_attempts, assignment_algorithm

### assignment_rules (2 rows)
One per market, algorithm='manual', is_active=true.

---

## `updated_at` Trigger
Reusable `update_updated_at()` function. Apply to all mutable tables.

---

## Files to Modify

1. **`src/types/order-status.ts`** — Update ORDER_STATUSES to 14 values, REJECTION_REASONS to 7 values, update TERMINAL_STATUSES, update TRANSITIONS map
2. **`src/types/__tests__/order-status.test.ts`** — Update tests for new counts and transitions
3. **`docs/order-pipeline.md`** — Add Phase 2 fulfillment flow, update transition table, update terminal list
4. **`docs/database-schema.md`** — Update enums, add fulfillment index, update status descriptions
5. **`CLAUDE.md`** — Update status model section to show both phases

---

## Implementation Order

1. Update TypeScript types (order-status.ts) — TDD: update tests first
2. Update docs (order-pipeline.md, database-schema.md, CLAUDE.md)
3. Create Supabase migration: enums → helper functions → tables → indexes → RLS → triggers → seed data

---

## Verification
- `npm test` — all tests pass with updated status model
- `npm run typecheck` — clean
- Supabase migration applies cleanly
