# OMS Full Codebase Audit Plan

## Context

This audit covers the entire OMS codebase to identify security gaps, data integrity risks, i18n/RTL readiness for the Libya market, design system compliance, performance risks, and missing seed data — before the system goes to production. The audit reads every API route, UI component, business logic module, migration, and translation file.

---

## PART A — Security Audit Findings

### Authentication (401 check)
**All 50+ API routes check for session** via `supabase.auth.getUser()` and return 401 if missing. No gaps found.

**Exception**: `/api/webhooks/[storefrontId]` uses `createAdminClient()` (service role, no session) — correct by design. Auth is via encrypted `webhook_secret` + `adapter.validateWebhook()` signature validation.

### Authorization (403 role check)
**All routes enforce role-based access:**
- Agent routes (`/api/agent/*`) verify `role === "agent"`
- Manager/admin routes verify via helper functions (`canAssignOrders()`, `canUpdateFulfillment()`, `canManageCarriers()`, etc.)
- Bulk operations explicitly block agents

No route missing role check.

### Market Isolation
**All routes enforce market isolation** via one of:
- Explicit `WHERE market_id = actor.market_id` in query
- RLS policies (enabled on all 12 tables per `002_rls_policies.sql`)
- Agent ownership check (`assigned_to = user.id`)
- `super_admin` requires `market_id` query parameter

No route bypasses market isolation.

### Stack Trace Exposure
**No routes expose stack traces.** All catch blocks use `err instanceof Error ? err.message : "generic"` pattern. Error responses use sanitized messages ("Internal server error", "Transition failed").

### Error Handling Issues
| Route | Issue |
|-------|-------|
| `/api/webhooks/[storefrontId]` | Always returns HTTP 200 even for errors (anti-retry pattern) — correct but should be documented |
| All routes | Proper status codes (400, 401, 403, 404, 500) used consistently |

**Verdict: Security is solid. No critical security gaps found.**

---

## PART B — Cross-Market + RTL Assessment

### Arabic Labels
- `src/lib/status-labels.ts` — **French only** (17 lines, hardcoded `STATUS_LABELS` Record)
- `src/messages/ar.json` — **Complete Arabic translations** exist, mirroring `fr.json` structure (auth, nav, dashboard, orders, status labels, rejection reasons)
- **Problem**: Many components import `STATUS_LABELS` from `status-labels.ts` instead of using `useTranslations()`. Three sources of status labels exist: `status-labels.ts`, inline French in `OrderCard.tsx`, and `fr.json`/`ar.json`

### RTL CSS in Codebase
**Components using logical CSS properties (RTL-ready):**
- `OrderDetailPanel.tsx` — `insetInlineEnd: 0`
- `PoolOrderDetailPanel.tsx` — `insetInlineEnd: 0`
- `BulkAssignBar.tsx` — `marginInlineStart`
- `ProductListItem.tsx` — `marginInlineStart`, `marginInlineEnd`
- `OrderList.tsx` — `marginInlineStart: "auto"`
- Dashboard layout — `marginInlineStart: "240px"`
- `Sidebar.tsx` — conditional `left`/`right` based on `isRtl`
- `SettingsNav.tsx` — conditional `borderLeft`/`borderRight` based on `isRtl`

**Components using `textAlign: "left"/"right"` (will break in RTL):**
- `PostCallActionSheet.tsx` — `textAlign: "left"` (lines 95, 115)
- `MetricsTable.tsx` — `textAlign: "left"` (line 74)
- `TeamOverview.tsx` — `textAlign: "left"` (line 84)
- `Leaderboard.tsx` — `textAlign: "left"` (line 68)
- `RejectionBreakdown.tsx` — `textAlign: "left"` (line 57)
- `CarriersSection.tsx` — `textAlign: "left"` (line 52)
- `StorefrontsSection.tsx` — `textAlign: "left"` (line 56)
- `TeamSection.tsx` — `textAlign: "left"` (line 52)
- `TeamTable.tsx` — `textAlign: "left"` (lines 79, 86)

### Components that are RTL-Unaware (will break for LY market)
1. `OrderCard.tsx` — hardcoded French, no logical properties
2. `PostCallActionSheet.tsx` — hardcoded French, `textAlign: "left"`
3. `QueueHeader.tsx` — hardcoded French, no logical properties
4. `CallbackPicker.tsx` — uses `useTranslations` but no RTL layout
5. `TeamOverview.tsx` — hardcoded French, `textAlign: "left"`
6. `AgentDrilldown.tsx` — hardcoded French, no RTL awareness
7. `MetricsTable.tsx` — hardcoded French, `textAlign: "left"`
8. `Leaderboard.tsx` — hardcoded French, `textAlign: "left"`
9. `RejectionBreakdown.tsx` — hardcoded French, `textAlign: "left"`
10. `CarriersSection.tsx` — hardcoded French, `textAlign: "left"`
11. `StorefrontsSection.tsx` — hardcoded French, `textAlign: "left"`
12. `TeamSection.tsx` — hardcoded French, `textAlign: "left"`
13. `FulfillmentControls.tsx` — hardcoded French
14. Dashboard `page.tsx` — hardcoded French section titles

### Components using `useTranslations` (i18n ready)
`UnassignedPool`, `BulkAssignBar`, `PoolOrderDetailPanel`, `OrderList`, `ProductList`, `ProductListItem`, `CarrierSelector`, `RejectionReasonPicker`, `CallbackTimePicker`, `AssignmentDropdown`, login page

### Currency Formatting
- `ProductListItem.tsx` — uses `Intl.NumberFormat` with market-based currency (`ly` = LYD, else TND)
- `ProductList.tsx` — passes currency based on market code
- `OrderCard.tsx` — displays `total_price` with hardcoded "TND" suffix — **BUG for LY market**
- Most other components display raw numbers without currency formatting

### Date/Number Locale Formatting
- `OrderCard.tsx` — uses `fr-FR` locale for callback time formatting — **BUG for LY market**
- No `ar-TN` or `ar-LY` locale formatting found elsewhere

### Scope of RTL Work
**Moderate** — not a full layout rewrite, but requires:
1. Replace all `textAlign: "left"/"right"` with `"start"/"end"` (~15 components)
2. Replace all hardcoded French strings with `useTranslations()` calls (~14 components)
3. Fix currency display in `OrderCard.tsx`
4. Fix date locale in `OrderCard.tsx`
5. The `dir="rtl"` attribute is already set at the root layout level via `[locale]/layout.tsx`

---

## PART C — End-to-End Lifecycle Gaps

### Phase 1: Confirmation

| Transition | API Route | `canTransition()` called? | `order_history` logged? | Notes |
|---|---|---|---|---|
| `(webhook) → new` | `/api/webhooks/[storefrontId]` via `webhook-handler.ts` | N/A (creation) | Yes (actor_type="system") | Correct |
| `new → assigned` | `/api/orders/[id]/assign` + `/api/orders/bulk-assign` | Via `transition_order_status` RPC | Yes (via RPC) | Correct |
| `assigned → attempt_1` | `/api/orders/[id]/attempt` or `/api/orders/[id]/no-answer` or `/api/orders/[id]/no-response` | Via `transition_order_status` RPC | Yes (via RPC) | Multiple routes handle this |
| `attempt_N → attempt_N+1` | `/api/orders/[id]/no-answer` or `/api/orders/[id]/no-response` | Via RPC | Yes | Uses `getNextAttemptStatus()` |
| `any → callback_scheduled` | `/api/orders/[id]/callback` | Via RPC | Yes | Sets `callback_scheduled_at` |
| `callback_scheduled → attempt_N` | `/api/orders/[id]/no-response` or `/api/orders/[id]/attempt` | Via RPC | Yes | Re-enters attempt flow |
| `any → confirmed` | `/api/orders/[id]/confirm` | Via RPC | Yes | Also triggers dispatch to carrier |
| `any → rejected` | `/api/orders/[id]/reject` | Via RPC | Yes | Requires `rejection_reason` |
| `any pre-dispatch → cancelled` | `/api/orders/[id]/cancel` | Via `canCancelOrder()` + RPC | Yes | Manager/super_admin only |

### Phase 2: Fulfillment

| Transition | API Route | `canTransition()` called? | `order_history` logged? | Stock trigger? |
|---|---|---|---|---|
| `confirmed → dispatched` | `/api/orders/[id]/dispatch` or `/api/orders/[id]/confirm` | Via RPC | Yes | No stock change |
| `dispatched → deposit` | `/api/orders/[id]/fulfillment` | Via `fulfillment-engine.ts` `validateTransition()` | Yes | **stock -quantity** + inventory_log |
| `deposit → in_transit` | `/api/orders/[id]/fulfillment` | Yes | Yes | No stock change |
| `in_transit → delivered` | `/api/orders/[id]/fulfillment` | Yes | Yes | No stock change |
| `in_transit → to_be_returned` | `/api/orders/[id]/fulfillment` | Yes (TypeScript) | **WILL FAIL** | **DB enum missing `to_be_returned`** |
| `to_be_returned → returned` | `/api/orders/[id]/fulfillment` | Yes (TypeScript) | **WILL FAIL** | **stock +quantity** (or damaged_return_count) |
| `in_transit → returned` | Via `transition_order_status` RPC (DB path) | Yes (DB) | Yes | Via fulfillment engine |

### CRITICAL GAP: `to_be_returned` status

**The `to_be_returned` status exists in TypeScript** (`order-status.ts:14`, `status-labels.ts:12`, `fulfillment route:11`, `FulfillmentControls.tsx`) **but NOT in the PostgreSQL `order_status` enum** (`001_initial_schema.sql:10-28`).

Any attempt to set status to `to_be_returned` will fail with a Postgres type error. Neither `transition_order_status` RPC (line 53) nor `fulfill_order_transition` RPC (line 71) includes `to_be_returned` in their transition validation.

**Fix**: New migration: `ALTER TYPE order_status ADD VALUE 'to_be_returned' BEFORE 'delivered'` + update both RPCs.

### Stock Triggers Summary
- `deposit` = stock **-quantity**, inventory_log with reason `"deposit"` — **Correct**
- `returned` (normal) = stock **+quantity**, inventory_log with reason `"returned"` — **Correct**
- `returned` (damaged) = `damaged_return_count` **+quantity**, inventory_log with reason `"damaged_writeoff"`, change=0 — **Correct**
- All stock movements create `inventory_log` entries — **Correct**

---

## PART D — Data Integrity Assessment

### order_history Immutability
- **No UPDATE or DELETE queries against `order_history`** found in source code (`src/` directory). Confirmed via grep.
- RLS policies in `002_rls_policies.sql` only grant SELECT and INSERT on `order_history` — no UPDATE or DELETE policies.
- The table has no `updated_at` column — append-only by design.
- **Verdict: Immutable. Correct.**

### Settings Always from DB
- All settings reads go through `/api/settings/[marketId]` or `/api/agent/settings`
- `max_call_attempts` read from settings table in agent routes
- `assignment_algorithm` read from `assignment_rules` table
- Carrier fees read from `carriers` table (`delivery_fee`, `return_fee`)
- Product costs from `products` table (`unit_cost`, `packing_cost`, `confirmation_processing_cost`, `cpl`)
- **No hardcoded fee/rate fallbacks found in API routes.**
- **One caveat**: `attempt-logic.ts` has no max_attempts parameter — the caller must pass it. The default 3 is only in the seed data, not hardcoded.

### inventory_log Written on Every Stock Movement
- `fulfillment-engine.ts`: inventory_log INSERT for deposit (line 76), returned normal (line 102), returned damaged (line 129)
- `fulfill_order_transition` RPC: inventory_log INSERT for all three cases
- `/api/products/[id]/stock` route: manual stock adjustments also write to inventory_log
- **Verdict: Correct. All stock movements logged.**

### UNIQUE Constraint on (external_id, storefront)
- `001_initial_schema.sql:230`: `UNIQUE (storefront_id, external_id)` on orders table
- Webhook handler at `webhook-handler.ts:148` catches PostgreSQL error code `23505` (unique violation) for duplicate detection
- **Verdict: Present and correctly handled.**

---

## PART E — Performance Risk Assessment

### N+1 Query Patterns
- **Team route** (`/api/team`): 3 batched queries (agents, queue orders via `.in()`, history via `.in()`) — no N+1
- **Metrics route** (`/api/metrics`): 2 queries (history with orders join, agent names via `.in()`) — no N+1
- **Agent queue route** (`/api/agent/queue`): Single query filtered by `assigned_to` — no N+1
- **Unassigned pool** (`/api/orders/unassigned`): Single query with filters — no N+1
- **Profitability routes**: Batch queries per market — no N+1
- **No obvious N+1 patterns found.**

### Index Coverage
Indexes present in migrations:
| Index | Table | Columns | Migration |
|---|---|---|---|
| `idx_orders_market_status` | orders | `(market_id, status)` | 001 |
| `idx_orders_assigned_to` | orders | `(assigned_to)` WHERE NOT NULL | 001 |
| `idx_orders_callback` | orders | `(callback_scheduled_at)` WHERE callback_scheduled | 001 |
| `idx_orders_agent_queue` | orders | `(assigned_to, status, callback_scheduled_at, created_at)` | 001 |
| `idx_orders_fulfillment` | orders | `(market_id, status, product_id)` partial | 001 |
| `idx_order_history_order_id` | order_history | `(order_id)` | 001 |
| `idx_order_history_status_to_created` | order_history | `(status_to, created_at)` | 010 |
| `idx_inventory_log_product_id` | inventory_log | `(product_id)` | 001 |
| `idx_orders_unassigned_pool` | orders | `(market_id, status, created_at)` WHERE new | 013 |

**Potential missing indexes:**
- `order_history (actor_id, created_at)` — the team route queries by `actor_id IN (...) AND created_at >= ...`
- `orders (market_id, created_at)` — for date-range queries on the orders list page
- `ad_spend (market_id, period_start, period_end)` — for profitability date range queries

### SWR Polling
| Component/Hook | Interval | Notes |
|---|---|---|
| `useAgentQueue` | 30s | Correct for real-time agent queue |
| `QueuePage` | 30s (queue), 0 (active order) | Correct |
| `useTeamView` | 60s | Used alongside `TeamTable` (30s) and `TeamOverview` (30s) — potential redundant fetches |
| `TeamTable` | 30s | OK |
| `TeamOverview` | 30s | OK |
| `Sidebar` (unassigned count) | 30s | OK |
| Dashboard `page.tsx` | revalidateOnFocus only | Acceptable for historical period data |

**Potential issue**: `useTeamView` (60s) and `TeamTable`/`TeamOverview` (30s) may fetch the same `/api/team` endpoint at different intervals. Should verify they don't conflict.

---

## PART F — Design System Compliance Gaps

### NOTE: design-system.md vs Reality
`docs/design-system.md` describes a Shopify-inspired dark cinematic aesthetic (#02090A, neon green #36F4A4, NeueHaasGrotesk fonts, pill buttons, multi-layered shadows). **The actual codebase uses a different, simpler design**: #1A1A1A sidebar, system fonts, rectangular buttons, zero shadows. `CLAUDE.md` defines the actual design rules. `design-system.md` appears aspirational/outdated.

### Shadows
- **NONE found** in any `.tsx` component (confirmed via grep for `box-shadow`, `drop-shadow`, `shadow`)

### Icons
- **NONE found** (no `lucide-react` or icon library imports)

### HTML `<form>` Tags
Found in:
- `PostCallActionSheet.tsx` — rejection form, callback form
- `CallbackPicker.tsx` / `CallbackTimePicker.tsx` — date/time inputs
- `CarriersSection.tsx` — carrier create/edit form
- `StorefrontsSection.tsx` — storefront create/edit form
- `TeamSection.tsx` — agent create form, password reset form
- `MetricsTable.tsx` — custom date range inputs
- `UnassignedPool.tsx` — filter inputs, checkboxes
- `AgentDrilldown.tsx` — checkboxes

### Colored Focus Rings
- Only `CallbackPicker.tsx` has focus state: `border: "2px solid #1A1A1A"` — **correct** (black, not colored)

### Modals
- `PostCallActionSheet.tsx` — centered overlay modal (correct per design system)
- `OrderDetailPanel.tsx` — right-side 480px slide panel with overlay
- `PoolOrderDetailPanel.tsx` — right-side slide panel
- `AgentDrilldown.tsx` — right-side 420px slide panel
- `CarriersSection.tsx` — right-side 420px slide panel
- `StorefrontsSection.tsx` — right-side 420px slide panel
- `TeamSection.tsx` — right-side slide panel

### Toasts
- **NONE** (no react-hot-toast, sonner, or toast library)
- Feedback is inline text (success: #008060 green, error: #DC2626 red) with 3s auto-dismiss

### Spinners
- **NONE** (no `animate-spin` classes)
- Loading states use text: "Chargement...", "Enregistrement...", "Expédition en cours..."

### English Labels in UI-Facing Text
- **No English labels found in UI components.** All user-facing text is French.
- Some English exists in error messages returned by API routes ("Internal server error", "Unauthorized") but these are not displayed directly in UI.

---

## PART G — Settings Completeness

### Confirmed Settings Keys (per market, from seed data)
| Key | Value | Source |
|---|---|---|
| `delivery_fee` | `{"amount": 6}` | `003_seed_data.sql` |
| `return_fee` | `{"amount": 4}` | `003_seed_data.sql` |
| `packing_cost` | `{"amount": 2}` | `003_seed_data.sql` |
| `max_call_attempts` | `{"value": 3}` | `003_seed_data.sql` |
| `assignment_algorithm` | `{"type": "manual"}` | `003_seed_data.sql` |

### Settings Read from Code (may or may not exist in DB)
| Key | Read by | Notes |
|---|---|---|
| `active_agents_only` | `auto-assignment-orchestrator.ts` | Optional — defaults to false if missing |

### Settings on `assignment_rules` Table (not `settings`)
| Column | Value | Source |
|---|---|---|
| `algorithm` | `"manual"` | `003_seed_data.sql` — both TN and LY |
| `config` | NULL | Not seeded |

### Potentially Missing Settings
- `callback_max_delay` — no constraint on how far in future callbacks can be scheduled
- `working_hours` — no business hours constraint on callback scheduling
- `confirmation_processing_cost` — currently per-product, not per-market (may be intentional)
- `cpl` (cost per lead) — currently per-product, not per-market (may be intentional)

**Verdict**: The 5 core settings exist for both markets. Product-level costs are on the products table (by design). No critical missing settings.

---

## PART H — Prioritized Fix Plan

### CRITICAL (blocks production launch)

1. **`to_be_returned` DB enum mismatch** — New migration to add `to_be_returned` to `order_status` enum and update both RPCs (`transition_order_status`, `fulfill_order_transition`). Without this, the entire `in_transit → to_be_returned → returned` workflow is broken at the database layer.

2. **Fulfillment route uses non-atomic TypeScript path** — `/api/orders/[id]/fulfillment` imports `applyFulfillmentTransition` from `fulfillment-engine.ts` (multi-step, non-transactional) instead of the atomic `fulfill_order_transition` RPC. A crash between stock adjustment and order update could leave data inconsistent. Switch to RPC-based path.

### NICE TO HAVE (polish)

3. **i18n: Migrate hardcoded French to `useTranslations()`** — ~14 components have hardcoded French strings. Required for Libya market but TN-only launch works fine without this.

4. **RTL: Replace `textAlign: "left"/"right"` with `"start"/"end"`** — ~15 instances across ~10 components. Required for Libya market.

5. **Currency display in `OrderCard.tsx`** — Hardcoded "TND" suffix instead of market-aware currency.

6. **Date locale in `OrderCard.tsx`** — Hardcoded `fr-FR` locale for callback time formatting.

7. **`design-system.md` divergence** — Document should either be updated to match reality or marked as aspirational.

8. **Add missing indexes** — `order_history (actor_id, created_at)` for team metrics queries.

9. **Consolidate status label sources** — Three sources (status-labels.ts, OrderCard inline, i18n files). Should use only i18n.

10. **SWR polling overlap** — `useTeamView` (60s) vs `TeamTable`/`TeamOverview` (30s) may cause redundant fetches.

### OUT OF SCOPE for v1

- Toast notification system (inline feedback works fine)
- Loading spinners (text loading states work fine)
- `callback_max_delay` / `working_hours` settings
- Real-time Supabase subscriptions (SWR polling is sufficient for v1)
- Carrier webhook integration for automated fulfillment status updates
- Multi-currency financial reports

---

## PART I — Cross-Market Seed Data Plan (Libya / Arabic / RTL)

### What Exists
- LY market record: **EXISTS** (`003_seed_data.sql` line 13, id=`00000000-0000-0000-0000-000000000002`)
- LY settings (5 keys): **EXISTS** (`003_seed_data.sql` lines 28-33)
- LY assignment_rules: **EXISTS** (`003_seed_data.sql` line 60)

### What's Missing
- LY carrier: **MISSING** — needed for dispatch workflow
- LY storefront: **MISSING** — needed for webhook order intake
- LY agent(s): **MISSING** — needed for agent queue testing
- LY orders: **MISSING** — needed for end-to-end testing

### Seed Queries (for Supabase MCP or migration)

```sql
-- 1. LY carrier (D-Express Libya)
INSERT INTO carriers (market_id, name, code, delivery_fee, return_fee, is_active)
VALUES ('00000000-0000-0000-0000-000000000002', 'D-Express Libya', 'dexpress_ly', 8.000, 5.000, true);

-- 2. LY storefront
INSERT INTO storefronts (market_id, platform, name, webhook_secret, is_active)
VALUES ('00000000-0000-0000-0000-000000000002', 'easy_orders', 'Easy Orders LY', 'changeme_ly', true);

-- 3. LY test agent (requires auth.users entry first — use createAdminClient or Supabase dashboard)
-- After creating auth user with email 'agent.ly@test.com':
-- INSERT INTO users (id, email, full_name, phone, role, market_id)
-- VALUES ('<auth-user-id>', 'agent.ly@test.com', 'وكيل اختبار', '+218911234567', 'agent', '00000000-0000-0000-0000-000000000002');

-- 4. LY test orders (5 orders in various statuses)
-- Must be inserted after storefront and product setup
-- Example:
INSERT INTO orders (market_id, storefront_id, external_id, external_platform, status, customer_name, customer_phone, customer_address, customer_city, product_name, quantity, unit_price, total_price)
SELECT
  '00000000-0000-0000-0000-000000000002',
  s.id,
  'LY-TEST-' || g.n,
  'easy_orders',
  CASE g.n
    WHEN 1 THEN 'new'::order_status
    WHEN 2 THEN 'new'::order_status
    WHEN 3 THEN 'new'::order_status
    WHEN 4 THEN 'new'::order_status
    WHEN 5 THEN 'new'::order_status
  END,
  'عميل اختبار ' || g.n,
  '+21891000000' || g.n,
  'عنوان اختبار ' || g.n,
  CASE g.n % 3 WHEN 0 THEN 'طرابلس' WHEN 1 THEN 'بنغازي' ELSE 'مصراتة' END,
  'منتج اختبار',
  1,
  45.000,
  45.000
FROM storefronts s, generate_series(1, 5) AS g(n)
WHERE s.market_id = '00000000-0000-0000-0000-000000000002'
LIMIT 5;
```

---

## PART J — Performance Seed Data Plan

### What Exists
- **No test agents or orders are seeded.** The DB starts empty (beyond markets, settings, 1 carrier, 1 storefront).

### Seed Strategy

```sql
-- Step 1: Create 20 TN test agents (requires Supabase Auth API — cannot INSERT directly)
-- Use the /api/agents POST endpoint or Supabase admin API to create 20 agents:
-- Loop i = 1..20:
--   POST /api/agents { email: "agent{i}@test.tn", full_name: "Agent TN {i}", phone: "+2169800000{i}", market_id: "00000000-0000-0000-0000-000000000001" }

-- Step 2: After agents exist, create 1000 test orders distributed across agents
-- Using a SQL function or script:

-- Generate 1000 orders with varied statuses and assignments
DO $$
DECLARE
  v_storefront_id UUID;
  v_agents UUID[];
  v_statuses order_status[] := ARRAY['new', 'assigned', 'attempt_1', 'attempt_2', 'confirmed', 'dispatched', 'deposit', 'in_transit', 'delivered', 'returned', 'rejected'];
  v_agent_id UUID;
  v_status order_status;
  i INTEGER;
BEGIN
  -- Get TN storefront
  SELECT id INTO v_storefront_id FROM storefronts
  WHERE market_id = '00000000-0000-0000-0000-000000000001' LIMIT 1;

  -- Get all TN agents
  SELECT array_agg(id) INTO v_agents FROM users
  WHERE market_id = '00000000-0000-0000-0000-000000000001' AND role = 'agent';

  FOR i IN 1..1000 LOOP
    v_status := v_statuses[1 + (i % array_length(v_statuses, 1))];
    v_agent_id := CASE
      WHEN v_status IN ('new') THEN NULL
      ELSE v_agents[1 + (i % array_length(v_agents, 1))]
    END;

    INSERT INTO orders (
      market_id, storefront_id, external_id, external_platform,
      status, customer_name, customer_phone, customer_city,
      product_name, quantity, unit_price, total_price,
      assigned_to, created_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000001',
      v_storefront_id,
      'PERF-TEST-' || i,
      'easy_orders',
      v_status,
      'Client Test ' || i,
      '+2169800' || lpad(i::text, 4, '0'),
      CASE i % 5
        WHEN 0 THEN 'Tunis' WHEN 1 THEN 'Sfax'
        WHEN 2 THEN 'Sousse' WHEN 3 THEN 'Bizerte'
        ELSE 'Monastir'
      END,
      'Produit Test ' || (1 + i % 10),
      1 + (i % 3),
      (20 + (i % 80))::numeric,
      (20 + (i % 80))::numeric * (1 + (i % 3)),
      v_agent_id,
      now() - (i || ' hours')::interval
    );

    -- Add history entry
    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    SELECT id, NULL, 'new', NULL, 'system', 'Perf test seed'
    FROM orders WHERE external_id = 'PERF-TEST-' || i
      AND storefront_id = v_storefront_id;
  END LOOP;
END $$;
```

**Notes:**
- Agent creation requires Supabase Auth API (password hashing) — cannot be done via raw SQL INSERT into `users` alone
- The seed script should be run via Supabase SQL editor or as a migration
- After seeding, verify with: `SELECT status, count(*) FROM orders GROUP BY status ORDER BY count DESC`
- For stress testing the team view: ensure 50+ orders have `assigned_to` set to various agents

---

## Verification Plan

After implementing fixes:

1. **`to_be_returned` fix**: Run `SELECT enum_range(NULL::order_status)` to verify enum includes `to_be_returned`. Then test via API: `POST /api/orders/{id}/fulfillment { status: "to_be_returned" }` on an `in_transit` order.

2. **Fulfillment atomicity**: Kill the server mid-fulfillment and verify stock + order_history remain consistent (no partial updates).

3. **RTL testing**: Log in as LY agent, verify sidebar mirrors, text aligns right, and all strings render in Arabic.

4. **Performance**: Load team view with 20+ agents, verify response time < 500ms. Load dashboard with 1000+ orders, verify aggregation completes < 2s.

5. **Security**: Attempt cross-market access as market_manager — should get 403. Attempt agent access to manager routes — should get 403.
