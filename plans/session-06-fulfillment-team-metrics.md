# Session Plan: Fulfillment Transitions, Damaged Returns, Metrics, Team View, Drill-Down

## Context

The OMS has a complete Phase 1 (confirmation) workflow but Phase 2 (fulfillment) transitions have no orchestrator — `transition_order_status` RPC handles status changes but is unaware of inventory. Fulfillment transitions (`deposit`, `returned`) require atomic stock modifications alongside the status change. Without a dedicated fulfillment orchestrator, two separate calls (transition + stock adjust) create a race condition window. This session adds: fulfillment transitions with stock, damaged returns, agent performance metrics, team overview for managers, agent drill-down with reassignment, and fulfillment permissions.

---

## PART A — Fulfillment Transition Orchestrator

### New RPC: `fulfill_order_transition`

**Parameters:** `p_order_id UUID`, `p_new_status order_status`, `p_actor_id UUID`, `p_note TEXT DEFAULT NULL`, `p_is_damaged BOOLEAN DEFAULT false`

**Locking strategy (deadlock-safe):**
1. `SELECT ... FROM orders WHERE id = p_order_id FOR UPDATE` — lock order first
2. If stock change needed: `SELECT ... FROM products WHERE id = v_product_id FOR UPDATE` — lock product second
3. Always orders-then-products ordering prevents deadlocks

**Validation inside RPC:**
- Fulfillment-only transitions: dispatched→deposit, deposit→in_transit, in_transit→delivered, in_transit→returned
- `p_is_damaged = true` and `p_new_status != 'returned'` → raise exception
- `product_id IS NULL` on stock-affecting transition → raise exception

**Conditional stock logic:**

| Target status | Stock effect | inventory_log.reason | is_damaged | note |
|---|---|---|---|---|
| `deposit` | `current_stock -= order.quantity` | `'deposit'` | false | `'Stock déduit au dépôt'` |
| `returned` (normal) | `current_stock += order.quantity` | `'returned'` | false | `'Retour normal'` |
| `returned` (damaged) | `damaged_return_count += order.quantity` | `'damaged_writeoff'` | true | `'Retour endommagé'` |
| `in_transit` | none | — | — | — |
| `delivered` | none | — | — | — |

For deposit: validate `current_stock - quantity >= 0` (mirrors `calculateStockAfterMovement`). Raise if underflow.

**Atomically performs:** lock order → validate transition → lock product (if needed) → update stock → update order status → insert order_history → insert inventory_log → return JSON.

**Returns:** `{ order_id, status, updated_at, history_id, inventory_log_id }`

### TypeScript wrapper: `applyFulfillmentTransition()`
- **File:** `src/lib/orders/fulfillment.ts`
- Calls `supabase.rpc('fulfill_order_transition', ...)`, parses result
- Pre-flight guard: `isDamaged && newStatus !== 'returned'` → throw before RPC round-trip
- Same pattern as `transitionOrderStatus()` in `src/lib/orders/transition.ts`

### Why new RPC (not extending `transition_order_status`)
The existing RPC is used by Phase 1 transitions (no-response, cancel, agent actions). Adding stock logic would mean every call site needs stock awareness. Separate RPC = clean separation of responsibilities.

---

## PART B — Damaged Return Flow

### API Route: `POST /api/orders/[id]/fulfillment`

**Request body:**
```
{ status: "deposit"|"in_transit"|"delivered"|"returned", is_damaged?: boolean, note?: string }
```

**Validation:**
- `is_damaged === true` and `status !== 'returned'` → 400
- Permission: `canUpdateFulfillment(role)` → manager + super_admin only → 403 for agents
- Market scope: order.market_id must match actor.market_id (or super_admin)

**Inventory log entries:**
- Damaged return: `change=+order.quantity, reason='damaged_writeoff', is_damaged=true, note='Retour endommagé'`, `balance_after` = new `damaged_return_count`
- Normal return: `change=+order.quantity, reason='returned', is_damaged=false, note='Retour normal'`, `balance_after` = new `current_stock`

---

## PART C — Metrics Computation Strategy

### Recommendation: Query-time SQL aggregation via Postgres RPC

**Justification:** At v1 scale (<10k orders/month, ~30-50k order_history rows/month), real-time aggregation is trivially fast for Postgres. Materialized views add write-time complexity and staleness for zero benefit.

### Definitions
- **Actioned** = orders with `order_history.status_to IN ('confirmed','dispatched','rejected')` within period
- **Confirmation rate** = `COUNT(confirmed + dispatched) / COUNT(actioned) * 100`
- **Avg attempts** = `SUM(attempt_1/2/3 history rows for actioned orders) / COUNT(actioned)`

### New RPC: `get_agent_metrics(p_market_id, p_from_date, p_to_date, p_agent_id DEFAULT NULL)`

Single CTE-based query:
1. `actioned` CTE: DISTINCT order_ids that reached confirmed/dispatched/rejected in period
2. `counts` CTE: confirmed+dispatched count vs total actioned
3. `attempts` CTE: SUM of attempt history rows for actioned orders

Returns: `{ actioned_count, confirmed_count, confirmation_rate, avg_attempts }`

### New index
`CREATE INDEX idx_order_history_status_to_created ON order_history (status_to, created_at);`

### API Route: `GET /api/team/metrics`
- Query params: `market_id`, `from_date`, `to_date`, optional `agent_id`
- Permission: market_manager + super_admin

---

## PART D — Team View Live Data

### SWR polling: 60 seconds
- Team view is summary data, not real-time order updates — lower urgency than agent queue (30s)
- `revalidateOnFocus: true` covers tab-switch refresh

### "Actif" definition
Agent has at least one `order_history` row where `actor_id = agent.id` and `created_at >= NOW() - INTERVAL '2 hours'`

### Queue size
`COUNT(orders) WHERE assigned_to = agent.id AND status NOT IN terminal_statuses`

### New RPC: `get_team_overview(p_market_id)`
Single query with LEFT JOIN orders on users, using FILTER aggregates + EXISTS subquery for activity. Returns one row per active agent in market with: `agent_id, full_name, is_actif, queue_size, today_actioned`.

### API Route: `GET /api/team`
- Permission: market_manager + super_admin
- Response: `{ data: [{ agent_id, full_name, is_actif, queue_size, today_actioned }] }`

### Hook: `useTeamView()` in `src/hooks/useTeamView.ts`
- SWR with 60s refresh, same fetcher pattern as `useAgentQueue`

---

## PART E — Agent Drill-Down + Reassignment

### GET /api/team/[agentId]/queue
- Manager/super_admin only
- Verifies target agent is in caller's market
- Uses session client (manager RLS already allows reading all orders in their market) — no admin client needed
- Queries orders with `assigned_to = agentId` and non-terminal status
- Returns same shape as queue data for reuse with `OrderCard` component

### POST /api/orders/[id]/reassign
**Request:** `{ target_agent_id: string | null }`

**Case: UUID (reassign to another agent)**
- Reuse `reassignOrder()` from `src/lib/orders/assignment.ts`
- Validates target agent exists, same market, is_active

**Case: null (return to pool)**
- New RPC: `return_order_to_pool(p_order_id, p_actor_id)` — atomically:
  - Lock order row
  - Validate status is pre-fulfillment (not dispatched/deposit/in_transit/terminal)
  - Set `assigned_to = NULL`, `status = 'new'`, clear `callback_scheduled_at`
  - Insert order_history: `from=current, to='new', note='Returned to pool by manager'`
- New wrapper: `returnToPool()` added to `src/lib/orders/assignment.ts`

### Why separate `/reassign` route (not extending `/assign`)
Existing `/assign` DELETE = simple unassign (no status change). Return-to-pool = unassign + status reset to `new`. Different semantics warrant a dedicated route.

---

## PART F — Fulfillment Permissions

### New function: `canUpdateFulfillment(role: Role): boolean`
- Added to `src/lib/order-permissions.ts`
- `super_admin` or `market_manager` → true, `agent` → false

### Agent visibility
- Existing RLS already restricts agents to confirmation-phase statuses only
- Agents cannot see dispatched/deposit/in_transit/delivered/returned orders
- `canTransitionOrder()` already blocks agents from fulfillment targets
- No RLS changes needed

---

## PART G — New Files

| # | File | Responsibility |
|---|---|---|
| 1 | `supabase/migrations/010_fulfillment_transition.sql` | RPCs: `fulfill_order_transition`, `return_order_to_pool`, `get_agent_metrics`, `get_team_overview`. Index: `idx_order_history_status_to_created` |
| 2 | `src/lib/orders/fulfillment.ts` | `applyFulfillmentTransition()` wrapper + `FulfillmentTransitionResult` type |
| 3 | `src/app/api/orders/[id]/fulfillment/route.ts` | POST handler — auth, permission, body validation, delegates to wrapper |
| 4 | `src/app/api/team/route.ts` | GET handler — team overview aggregation |
| 5 | `src/app/api/team/metrics/route.ts` | GET handler — agent metrics with date range |
| 6 | `src/app/api/team/[agentId]/queue/route.ts` | GET handler — specific agent's queue for manager drill-down |
| 7 | `src/app/api/orders/[id]/reassign/route.ts` | POST handler — reassign to agent or return to pool |
| 8 | `src/hooks/useTeamView.ts` | SWR hook for team overview (60s polling) |
| 9 | `src/hooks/useAgentMetrics.ts` | SWR hook for metrics panel |
| 10+ | Test files for each of the above (TDD — tests written first) |

---

## PART H — Files to Reuse

| File | Contribution |
|---|---|
| `src/types/order-status.ts` | `canTransition()`, `isTerminalStatus()`, `OrderStatus` type — validation in wrapper and routes |
| `src/lib/order-engine.ts` | `validateTransition()` for pre-flight, `buildOrderHistoryEntry()` pattern |
| `src/lib/order-permissions.ts` | `canAssignOrders()` for reassign route market check. Extended with `canUpdateFulfillment()` |
| `src/lib/product-calculations.ts` | `calculateStockAfterMovement()` for client-side pre-flight validation |
| `src/lib/orders/transition.ts` | Pattern template: RPC call convention, result parsing, type structure |
| `src/lib/orders/assignment.ts` | `reassignOrder()` reused by reassign route. Extended with `returnToPool()` |
| `src/lib/supabase/server.ts` | `createClient()` for all route handlers |
| `src/types/index.ts` | `Role` type for permission checks |
| `src/hooks/useAgentQueue.ts` | Pattern template for new SWR hooks |
| `src/app/api/orders/[id]/transition/route.ts` | Pattern template: auth flow, actor lookup, error mapping |
| `src/app/api/orders/[id]/assign/route.ts` | Pattern template: market-scope validation, agent checks |
| `supabase/migrations/004_order_rpcs.sql` | Pattern for new RPCs: lock strategy, SECURITY DEFINER, json_build_object |
| `supabase/migrations/005_carrier_dispatch.sql` | `dispatch_order` RPC — closest existing analog (specialized transition with side effects) |

---

## Implementation Order (TDD)

1. Migration `010_fulfillment_transition.sql` — all 4 RPCs + index
2. `canUpdateFulfillment()` in order-permissions (test first)
3. `applyFulfillmentTransition()` wrapper (test first)
4. `returnToPool()` in assignment.ts (test first)
5. API routes: fulfillment → reassign → team → team/metrics → team/[agentId]/queue (each test first)
6. SWR hooks: `useTeamView`, `useAgentMetrics`

## Verification
- Run `npm test` after each file pair (test + implementation)
- Run `npm run typecheck` after each file change
- Apply migration via Supabase MCP, then test RPCs with `execute_sql`
- End-to-end: create order → confirm → dispatch → deposit (verify stock decreases) → return damaged (verify damaged_return_count increases, stock unchanged)
- End-to-end: team view → drill into agent → reassign order → verify order moves → return to pool → verify status=new and assigned_to=null
