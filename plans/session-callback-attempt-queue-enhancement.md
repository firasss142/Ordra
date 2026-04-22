# Agent Queue Enhancement — Callback Scheduling, Attempt Tracking, Stats & Sorting

## Context

The agent queue system (Session 5) is functional but has several gaps: the "Pas de reponse" and "Rappel demande" flows work but the callback/attempt logic has a **dual-column issue** (`callback_scheduled_at` in DB RPCs vs `callback_time` in API routes), stats are computed client-side with incorrect formulas (counting queue `confirmed` instead of querying `order_history`), and the queue sorting is application-layer only. This plan consolidates and completes the callback scheduling state machine, attempt increment flow, queue sorting, agent daily stats, status bucket badges, and max-attempts configuration — all of which mostly exist but need correction, consolidation, and proper server-side implementation.

---

## PART A — Callback Scheduling State Machine

### Current State
- **"Rappel demande" flow** already exists in `PostCallActionSheet.tsx` (line 404-414): opens `CallbackPicker`, submits to `POST /api/orders/[id]/callback` with `callback_time`
- The callback API route (`src/app/api/orders/[id]/callback/route.ts`) sets `status='callback_scheduled'` and stores `callback_time` column
- The RPC `transition_order_status` sets `callback_scheduled_at` column (different column!)
- Queue sorting (`src/lib/queue-sorting.ts` + `src/app/api/orders/queue/route.ts`) uses `callback_time` in the client sort but `callback_scheduled_at` in the server sort

### Column Consolidation (Critical Fix)
- **Problem**: Two columns exist — `callback_scheduled_at` (used by RPCs) and `callback_time` (used by API routes + frontend)
- **Decision**: Consolidate to `callback_scheduled_at` (matches RPC convention, already indexed)
- **Migration**: Update API routes to use `callback_scheduled_at` instead of `callback_time`. Drop `callback_time` column
- **Frontend mapping**: In `toQueueOrder()` in QueuePage.tsx, map `raw.callback_scheduled_at` to `callback_time` field on QueueOrder type (keep frontend type unchanged to minimize churn)

### What Needs to Change
1. `/api/orders/[id]/callback/route.ts` — use `callback_scheduled_at` instead of `callback_time` in the `.update()` call
2. `/api/orders/[id]/attempt/route.ts` — use `callback_scheduled_at` instead of `callback_time` in the `.update()` call (line 115)
3. `QueuePage.tsx` `toQueueOrder()` — map from `raw.callback_scheduled_at` 
4. Queue route server sort — already uses `callback_scheduled_at` (line 79) — no change
5. New migration: `ALTER TABLE orders DROP COLUMN IF EXISTS callback_time`

### Callback Resurfacing
- Already implemented: `getQueuePriority()` in queue route (line 14-38) gives priority 0 to `callback_scheduled` with `callback_scheduled_at <= NOW()`
- No change needed — callbacks resurface on next SWR poll (30s)

### Multiple Callbacks
- Already supported: callback API overwrites `callback_scheduled_at` while keeping `status='callback_scheduled'`
- Order history records each callback scheduling as a new append-only entry

---

## PART B — "Pas de Reponse" Flow + Attempt Increment

### Current State
- **Already fully implemented** in `PostCallActionSheet.tsx` (lines 336-379): "Pas de reponse" button expands to show CallbackPicker (default +2h), submits to `POST /api/orders/[id]/attempt`
- The attempt API route (`src/app/api/orders/[id]/attempt/route.ts`) already:
  - Maps status to next attempt via `NEXT_ATTEMPT` (assigned→attempt_1, attempt_1→attempt_2, etc.)
  - Reads `max_call_attempts` from settings table
  - Auto-rejects with `injoignable` when max reached
  - Supports optional `callback_time` body → transitions to `callback_scheduled` instead of next attempt

### What Needs to Change
1. **Column fix**: Line 115 — change `callback_time` to `callback_scheduled_at` (Part A consolidation)
2. **Use RPC instead of raw update**: Lines 113-134 currently do a raw `.update()` for the callback path, bypassing the `transition_order_status` RPC. This skips row-level locking and the RPC's callback_scheduled_at management. Refactor to call the RPC with `p_callback_at` parameter
3. **Auto-reject note improvement**: Line 97 note says "Auto-rejected: max attempts reached" — should include attempt number for clarity

### Pure Functions (already exist partially)
- `NEXT_ATTEMPT` map at line 6-11 — already serves as `getNextAttemptStatus()`
- `extractAttemptNumber()` at line 15-20 — already serves as attempt number extraction
- `isMaxAttemptsReached()` — derive from `nextAttemptNumber >= maxAttempts` (line 88) — extract as named function for testability

### Extract to `src/lib/attempt-logic.ts`
```
getNextAttemptStatus(currentStatus: OrderStatus): OrderStatus | null
extractAttemptNumber(status: OrderStatus): number
isMaxAttemptsReached(currentStatus: OrderStatus, maxAttempts: number): boolean
```
These are pure functions, easily unit-tested, reused by both attempt API and PostCallActionSheet UI logic.

---

## PART C — Queue Sorting Algorithm

### Current State
- **Already implemented** in two places:
  1. `src/lib/queue-sorting.ts` — client-side `sortQueueByPriority()` with `getPriority()`
  2. `src/app/api/orders/queue/route.ts` — server-side sort via `getQueuePriority()` (lines 14-38)
- Both implement the same 5-tier priority: overdue callbacks (0) → attempts (1) → assigned (2) → future callbacks (3) → confirmed (4)
- Secondary sort: `created_at` ascending within each bucket

### What Needs to Change
- **Minor**: The secondary sort for overdue callbacks should sort by `callback_scheduled_at` ascending (oldest callback first), not `created_at`. Currently both use `created_at`
- **Extract server sort function** into `src/lib/queue-sorting.ts` alongside the existing client function for consistency and testability
- No need for SQL-level ORDER BY with CASE WHEN — the dataset is small per agent (10-50 orders max), application-layer sort is fine and already works

### Updated sort within overdue callbacks bucket
```
Priority 0: callback_scheduled + callback_scheduled_at <= NOW() → sort by callback_scheduled_at ASC
Priority 1: attempt_* → sort by created_at ASC
Priority 2: assigned → sort by created_at ASC  
Priority 3: callback_scheduled (future) → sort by callback_scheduled_at ASC
Priority 4: confirmed → sort by created_at ASC
```

---

## PART D — Agent Daily Stats Calculation

### Current State
- Stats are computed **client-side** in `QueuePage.tsx` `computeStats()` (lines 38-49):
  - `assigned_count` = total orders in queue (incorrect — should be orders assigned today)
  - `processed_count` = orders in queue where status != "assigned" (incorrect — should be orders actioned today from order_history)
  - `confirmation_rate` = confirmed in queue / processed (incorrect — should be from order_history)

### What Needs to Change
- **Move stats to server-side** via new API endpoint `GET /api/agent/stats`
- Query `order_history` table for today's activity:
  - **Assignees (assigned_today)**: COUNT DISTINCT order_id WHERE status_to = 'assigned' AND actor_id-related history shows assignment to current agent AND created_at::date = TODAY
  - **Traitees (actioned_today)**: COUNT DISTINCT order_id WHERE status_to IN ('confirmed', 'dispatched', 'rejected') AND actor_id = agent_id AND created_at::date = TODAY
  - **Taux de confirmation**: (COUNT where status_to IN ('confirmed', 'dispatched')) / (COUNT where status_to IN ('confirmed', 'dispatched', 'rejected')) * 100
- Single query with conditional aggregation:
```sql
SELECT 
  COUNT(DISTINCT CASE WHEN status_to IN ('confirmed', 'dispatched', 'rejected') THEN order_id END) as actioned_today,
  COUNT(DISTINCT CASE WHEN status_to IN ('confirmed', 'dispatched') THEN order_id END) as confirmed_today
FROM order_history
WHERE actor_id = $agent_id
  AND created_at >= $today_start
  AND status_to IN ('confirmed', 'dispatched', 'rejected')
```
- For `assigned_today`: Count from order_history where note LIKE 'Assigned to agent %' or status_to = 'assigned' with the agent's ID context — OR simpler: count orders currently assigned to agent where assigned date = today

### API Response
```json
GET /api/agent/stats → { assigned_today: N, actioned_today: N, confirmation_rate: N }
```

### SWR Integration
- QueuePage fetches stats alongside queue data
- Same 30s refresh interval
- OR: bundle stats into queue response to avoid extra API call (see Part E)

---

## PART E — Status Bucket Badges

### Current State
- **Already fully implemented** in `QueueHeader.tsx` (lines 27-99):
  - Buckets: assigned, attempt_1, attempt_2, attempt_3, callback_scheduled, confirmed
  - Labels: Nouveau, Tentative 1/2/3, Rappel prevu, Confirme (non expedie)
  - Counts computed from orders array client-side
  - Overdue callback badge highlighted red

### What Needs to Change
- **Nothing for bucket badges** — already complete and working
- Consider: split callback_scheduled into "Rappel du" (overdue) and "Rappel prevu" (future) as two separate badge counts for clarity. Currently overdue is shown by red highlight on the single "Rappel prevu" badge — this works but could be improved

### Optional Enhancement
- Add overdue count as separate display: "Rappel du (2)" in red + "Rappel prevu (3)" in gray
- This is a UI refinement, not a blocker

---

## PART F — Max Attempts Configuration

### Current State
- **Already fully implemented**:
  - Settings table has `max_call_attempts` per market (seeded in `003_seed_data.sql`)
  - Attempt API reads it at runtime (line 76-85 of attempt route)
  - Auto-reject triggers when `nextAttemptNumber >= maxAttempts`
  - Settings UI exists in `GeneralSettingsForm.tsx` for managers to configure

### What Needs to Change
- **Nothing for core logic** — already complete
- **UI enhancement**: PostCallActionSheet should disable "Pas de reponse" button when current status is at max-1 attempts (e.g., at `attempt_3` when max=3). Currently the API handles this by auto-rejecting, but the agent doesn't see the warning until after clicking
- To implement: pass `maxAttempts` to PostCallActionSheet, check if `extractAttemptNumber(orderStatus) >= maxAttempts - 1` (would mean next attempt hits max), show warning text on the "Pas de reponse" button
- This requires fetching max_call_attempts setting — could bundle in queue response or fetch in PostCallActionSheet

---

## PART G — SWR Polling Strategy

### Current State
- **Already implemented**: `QueuePage.tsx` uses SWR with `refreshInterval: 30000` (30s)
- Queue re-sorts on each fetch — overdue callbacks automatically surface

### What Needs to Change
- **Nothing for core polling** — already complete
- If we add `/api/agent/stats` endpoint, add a second SWR hook with same 30s interval
- OR bundle stats into queue response to keep single SWR hook (recommended)

### Recommended: Bundle into Queue Response
Modify `GET /api/orders/queue` to return:
```json
{
  "data": [...orders],
  "stats": { "assigned_today": N, "actioned_today": N, "confirmation_rate": N }
}
```
This avoids a second API call and keeps the single SWR hook pattern.

---

## PART H — Migration Plan

### Migration: `014_consolidate_callback_column.sql`
```sql
-- 1. Copy any data from callback_time to callback_scheduled_at where callback_scheduled_at is NULL
UPDATE orders 
SET callback_scheduled_at = callback_time 
WHERE callback_time IS NOT NULL AND callback_scheduled_at IS NULL;

-- 2. Drop the duplicate column
ALTER TABLE orders DROP COLUMN IF EXISTS callback_time;
```

### No New Columns Needed
- `callback_scheduled_at` already exists on orders table
- `max_call_attempts` already exists in settings table
- Indexes `idx_orders_callback` and `idx_orders_agent_queue` already exist

---

## PART I — Interaction with Existing Session 5 Code

### PostCallActionSheet — Modifications
- **Line 115 / `callback_time` references**: Update to use `callback_scheduled_at` in API body keys (or keep `callback_time` in request body and only change server-side column mapping — less churn)
- **"Pas de reponse" button**: Add visual warning when at max-1 attempts
- **No structural changes** — the 4-flow design (option_select, noanswer_expanded, confirm_flow, reject_flow, callback_flow) is solid

### API Routes — Modifications
- `/api/orders/[id]/attempt/route.ts`: Use RPC for callback path (lines 113-134), change column name
- `/api/orders/[id]/callback/route.ts`: Change column name in `.update()` (line 79)
- `/api/orders/queue/route.ts`: Add stats computation to response

### OrderCard.tsx — Additions
- Already displays callback time (lines 156-165) and attempt count (line 151-153)
- May need to read from `callback_scheduled_at` mapping — handled in `toQueueOrder()`
- No structural changes needed

### QueuePage.tsx — Modifications
- `toQueueOrder()`: Map `raw.callback_scheduled_at` → `callback_time` field
- `computeStats()`: Replace with server-side stats from queue response
- Remove client-side stats computation

### QueueHeader.tsx — Modifications
- Update to receive stats from props (already does via `AgentStats` interface)
- Stats values will now come from server instead of client computation
- Optional: split callback badge into overdue/future

---

## PART J — New Files

| File | Responsibility |
|------|----------------|
| `src/lib/attempt-logic.ts` | Pure functions: `getNextAttemptStatus()`, `extractAttemptNumber()`, `isMaxAttemptsReached()` — extracted from attempt route for reuse and testability |
| `src/lib/__tests__/attempt-logic.test.ts` | Unit tests for attempt logic pure functions |
| `src/lib/__tests__/queue-sorting.test.ts` | Unit tests for queue sorting (if not already existing) |
| `supabase/migrations/014_consolidate_callback_column.sql` | Drop `callback_time` column, consolidate to `callback_scheduled_at` |

---

## PART K — Files to Modify (Exact Paths)

| File | Changes |
|------|---------|
| `src/app/api/orders/[id]/attempt/route.ts` | (1) Use `callback_scheduled_at` column, (2) use RPC for callback path instead of raw update, (3) extract pure functions to `attempt-logic.ts`, (4) import from `attempt-logic.ts` |
| `src/app/api/orders/[id]/callback/route.ts` | Change `.update({ callback_time: ... })` to `.update({ callback_scheduled_at: ... })` |
| `src/app/api/orders/queue/route.ts` | Add server-side stats computation (query order_history), return stats in response alongside orders |
| `src/components/queue/QueuePage.tsx` | (1) Map `callback_scheduled_at` in `toQueueOrder()`, (2) consume stats from queue API response instead of client computation, (3) remove `computeStats()` |
| `src/components/queue/QueueHeader.tsx` | Receive updated stats props (interface already matches — minimal change) |
| `src/lib/queue-sorting.ts` | (1) Update secondary sort for callback buckets to use `callback_scheduled_at`, (2) ensure QueueOrder interface in this file stays in sync |
| `src/types/queue.ts` | No change needed — keep `callback_time` field name, mapping happens in `toQueueOrder()` |

---

## Verification Plan

1. **Unit tests**: Run `npm test` — all existing tests pass, new tests for `attempt-logic.ts` and queue sorting pass
2. **Type check**: `npm run typecheck` — no errors after column rename
3. **Manual test — "Pas de reponse" flow**: 
   - Assign order to agent → click "Appel termine" → "Pas de reponse" → adjust callback time → submit
   - Verify status transitions: assigned → callback_scheduled (with callback_scheduled_at set)
   - Wait for callback time to pass → verify order surfaces at top of queue on next refresh
4. **Manual test — "Rappel demande" flow**:
   - From any attempt status → "Rappel demande" → pick time → submit
   - Verify callback_scheduled status and callback_scheduled_at column
5. **Manual test — max attempts auto-reject**:
   - Set max_call_attempts = 2 in settings
   - Attempt from attempt_1 → should auto-reject with "injoignable"
6. **Manual test — stats accuracy**:
   - Process several orders (confirm some, reject some)
   - Verify QueueHeader shows correct assigned_today, actioned_today, confirmation_rate
7. **Manual test — bucket badges**:
   - Create orders in various statuses → verify badge counts match
   - Check overdue callback badge shows red
8. **Lint**: `npm run lint` — passes
9. **Build**: `npm run build` — passes

---

## Summary of Scope

Most of the infrastructure already exists from Session 5. The key changes are:
1. **Consolidate callback columns** (critical data integrity fix)
2. **Use RPC for callback path** in attempt route (consistency fix)
3. **Move stats to server-side** (correctness fix — current client computation is wrong)
4. **Extract attempt logic** to pure functions (testability improvement)
5. **Minor sort refinement** for callback buckets (UX improvement)

This is primarily a **consolidation and correctness pass**, not new feature development.
