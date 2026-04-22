# Plan: Webhook Intake + Storefront Adapter + Order Engine + Assignment Architecture

## Context

The OMS needs its core order intake pipeline: Easy Orders pushes webhook events, the OMS validates, maps, deduplicates, and stores orders. Once ingested, orders need a status transition engine (atomic status changes + immutable history) and a manual assignment engine (assign/reassign/unassign agents). All of this must follow the adapter pattern so adding Shopify later requires zero core changes.

The database schema (orders, order_history, storefronts tables), types (ORDER_STATUSES, canTransition, isTerminalStatus), and patterns (permission functions, API route auth flow, Supabase RPC for transactions) all exist already.

---

## Design Decisions

1. **Single generic `transition_order_status` RPC** (not one-per-transition) — mirrors the `adjust_product_stock` pattern. The TypeScript `canTransition()` validates first; the RPC is the authoritative guard with `FOR UPDATE` row locking.

2. **Assignment and transition are separate functions** — `assignOrder` calls `transitionOrderStatus` internally when the order is `new`. Reassign/unassign don't change status.

3. **Generic webhook route: `/api/webhooks/[storefrontId]`** — replaces the placeholder `/api/webhooks/easy-orders`. The `storefrontId` in the URL identifies which storefront record to look up; its `platform` field determines which adapter to instantiate. Adding Shopify = new adapter class + one line in the registry.

4. **Typed Easy Orders payload** — `EasyOrdersPayload` interface used inside the adapter. The generic `StorefrontAdapter` interface uses `unknown` so each adapter casts to its own type.

5. **Dedicated `assign_order` RPC** — atomically sets `assigned_to` + transitions `new → assigned` + inserts history in one transaction.

---

## Component 1: StorefrontAdapter Interface

### `src/lib/storefronts/types.ts`

```typescript
export interface InternalOrderData {
  external_id: string;
  external_platform: string;  // 'easy_orders' | 'shopify' | etc.
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  customer_city: string | null;
  customer_note: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;  // SOURCE OF TRUTH — copied directly
}

export type WebhookEventType = 'order.created' | 'order.updated' | 'order.cancelled';

export interface StorefrontAdapter {
  validateWebhook(headers: Headers, rawBody: string, webhookSecret: string): boolean;
  parseEventType(payload: unknown): WebhookEventType;
  mapToInternalOrder(payload: unknown): InternalOrderData;
}
```

- `webhookSecret` passed in already decrypted — adapter never touches crypto
- `InternalOrderData` omits `market_id`, `storefront_id`, `product_id`, `raw_payload` — those are resolved by the webhook handler, not the adapter

### `src/lib/storefronts/adapter-registry.ts`

```typescript
export function getAdapter(platform: string): StorefrontAdapter;
```

Simple map: `{ easy_orders: new EasyOrdersAdapter() }`. Throws on unknown platform. Only file that imports concrete adapter classes.

### `src/lib/storefronts/easy-orders-adapter.ts`

- `validateWebhook`: HMAC-SHA256 of rawBody with webhookSecret, compare to `headers.get('X-Webhook-Signature')` using `timingSafeEqual`
- `parseEventType`: reads `payload.event` field → maps to `WebhookEventType`. Defaults to `'order.created'` if absent
- `mapToInternalOrder`: destructures Easy Orders JSON → `InternalOrderData`

### `src/lib/storefronts/easy-orders-types.ts`

Typed `EasyOrdersPayload` interface (internal to adapter, not exported from barrel).

### `src/lib/storefronts/errors.ts`

- `WebhookValidationError` — invalid signature
- `PayloadMappingError` — missing required fields in payload

---

## Component 2: Webhook Route

### `src/app/api/webhooks/[storefrontId]/route.ts`

Replaces the current placeholder at `src/app/api/webhooks/easy-orders/route.ts`.

**Flow:**
1. Extract `storefrontId` from URL param
2. `await request.text()` — raw body for HMAC (before JSON parse)
3. `createAdminClient()` → look up storefront: `SELECT id, market_id, platform, config, webhook_secret, is_active FROM storefronts WHERE id = storefrontId`
4. Not found or inactive → 404
5. `decrypt(storefront.webhook_secret)` from `src/lib/crypto.ts`
6. `getAdapter(storefront.platform)` from registry
7. `adapter.validateWebhook(headers, rawBody, secret)` — false → 401, log attempt
8. `JSON.parse(rawBody)` → payload
9. `adapter.parseEventType(payload)` → event type
10. `adapter.mapToInternalOrder(payload)` → `InternalOrderData`
11. Resolve `product_id`: query `products` by name within storefront's `market_id` (case-insensitive ILIKE). No match → `product_id = null` (order still created)
12. Handle by event type:
    - **order.created**: INSERT into orders (market_id from storefront, storefront_id, raw_payload, status='new'). On UNIQUE(storefront_id, external_id) violation → 200 OK with existing order (idempotent). INSERT initial order_history (status_from: null, status_to: 'new', actor_type: 'system')
    - **order.updated**: Find existing order. Pre-dispatch → update customer/product fields. Post-dispatch → 200 OK, no changes
    - **order.cancelled**: Find existing order. Not terminal + pre-dispatch → call `transitionOrderStatus(id, 'cancelled', null, 'system')`. Already terminal → 200 OK
13. Return `{ success: true, order_id }` with 200

**Auth model**: No user session — uses `createAdminClient()` (service role, bypasses RLS). Webhook secret validation IS the authentication.

**Error responses**: 400 (malformed), 401 (bad signature), 404 (unknown storefront), 500 (internal)

---

## Component 3: Order Status Transition Engine

### `src/lib/orders/transition.ts`

```typescript
export interface TransitionParams {
  orderId: string;
  newStatus: OrderStatus;
  actorId: string | null;       // null for system actions
  actorType: 'system' | 'agent' | 'manager';
  note?: string;
  rejectionReason?: RejectionReason;   // required when newStatus === 'rejected'
  rejectionNote?: string;              // free text for 'autre'
}

export interface TransitionResult {
  order: { id: string; status: OrderStatus; updated_at: string };
  historyEntry: { id: string };
}

export async function transitionOrderStatus(
  supabase: SupabaseClient,
  params: TransitionParams
): Promise<TransitionResult>;
```

- TypeScript pre-validation: if `newStatus === 'rejected'` and no `rejectionReason` → throw immediately
- Calls `transition_order_status` RPC
- RPC errors with "invalid transition" → throw `TransitionError`

### `supabase/migrations/004_order_rpcs.sql` — `transition_order_status` RPC

1. `SELECT id, status FROM orders WHERE id = p_order_id FOR UPDATE` — row lock
2. Validate transition (same graph as TypeScript, encoded in PL/pgSQL)
3. `UPDATE orders SET status, rejection_reason, rejection_note, callback_scheduled_at (if applicable)`
4. `INSERT INTO order_history` — immutable
5. Return JSON `{ order_id, status, updated_at, history_id }`
6. Invalid transition → `RAISE EXCEPTION 'invalid transition from % to %'`

**Dual graph concern**: Transition map in both TS and PL/pgSQL. TS is fast-fail; PL/pgSQL is authoritative. Cross-reference comment in both files.

---

## Component 4: Assignment Engine

### `src/lib/orders/assignment.ts`

```typescript
// Assign: sets assigned_to + transitions new → assigned (atomic via RPC)
export async function assignOrder(supabase, orderId, agentId, actorId): Promise<AssignResult>;

// Bulk: iterates orderIds, calls assignOrder each. Returns partial success array.
export async function bulkAssign(supabase, orderIds, agentId, actorId): Promise<BulkAssignResult>;

// Reassign: updates assigned_to only, no status change. Inserts history entry.
export async function reassignOrder(supabase, orderId, newAgentId, actorId): Promise<AssignResult>;

// Unassign: sets assigned_to = null, no status change. Inserts history entry.
export async function unassignOrder(supabase, orderId, actorId): Promise<AssignResult>;
```

**`assignOrder` details:**
1. Verify agent exists, is active, same market as order
2. Call `assign_order` RPC (atomically: set assigned_to + transition new→assigned + history)
3. If order is NOT `new` (e.g., reassigning a `callback_scheduled` order) → RPC only updates assigned_to + history, no status change

**`reassignOrder`**: UPDATE assigned_to. INSERT order_history with note "Reassigned from X to Y", status_from = status_to = current status.

**`unassignOrder`**: UPDATE assigned_to = null. INSERT order_history.

### `supabase/migrations/004_order_rpcs.sql` — `assign_order` RPC

Atomically: (a) set assigned_to, (b) if current status = 'new', transition to 'assigned', (c) insert order_history. Uses `FOR UPDATE` row lock for concurrency safety.

---

## Component 5: Order Permissions

### `src/lib/order-permissions.ts`

Following the `settings-permissions.ts` / `product-permissions.ts` pattern:

```typescript
canViewOrders(role, targetMarketId, actorMarketId): boolean
// SA: true, MM: own market, agent: true (RLS filters by assigned_to)

canCreateOrders(role, targetMarketId, actorMarketId): boolean
// SA: true, MM: own market, agent: false

canAssignOrders(role, targetMarketId, actorMarketId): boolean
// SA: true, MM: own market, agent: false

canCancelOrder(role): boolean
// SA: true, MM: true, agent: false

canTransitionOrder(role, from: OrderStatus, to: OrderStatus): boolean
// Combines canTransition(from, to) graph check WITH role restrictions:
// - agent: can set attempt_*, callback_scheduled, confirmed, rejected only
// - agent CANNOT set: dispatched, deposit, in_transit, delivered, returned, cancelled
// - MM: all Phase 1 + cancelled + dispatched
// - SA: all transitions
```

---

## Component 6: Order API Routes

### `src/app/api/orders/route.ts` — GET (list) + POST (manual create)

GET: paginated order list, filtered by market (RLS handles agent-level filtering). Supports query params: status, assigned_to, product_id, page, limit.

POST: manual order creation by SA/MM (rare — most orders come via webhook).

### `src/app/api/orders/[id]/route.ts` — GET (single) + PATCH (update fields)

### `src/app/api/orders/[id]/transition/route.ts` — POST

Body: `{ status, note?, rejectionReason?, rejectionNote? }`
Calls `canTransitionOrder(role, currentStatus, newStatus)` then `transitionOrderStatus()`.

### `src/app/api/orders/[id]/assign/route.ts` — POST

Body: `{ agent_id }` (assign/reassign) or `{ agent_id: null }` (unassign)
Calls `canAssignOrders()` then appropriate assignment function.

### `src/app/api/orders/bulk-assign/route.ts` — POST

Body: `{ order_ids: string[], agent_id: string }`
Calls `canAssignOrders()` then `bulkAssign()`.

---

## New Files Summary

| # | File | Purpose |
|---|------|---------|
| 1 | `src/lib/storefronts/types.ts` | Adapter interface, InternalOrderData, WebhookEventType |
| 2 | `src/lib/storefronts/errors.ts` | WebhookValidationError, PayloadMappingError |
| 3 | `src/lib/storefronts/adapter-registry.ts` | platform → adapter map |
| 4 | `src/lib/storefronts/easy-orders-adapter.ts` | EasyOrdersAdapter implementation |
| 5 | `src/lib/storefronts/easy-orders-types.ts` | Typed Easy Orders payload |
| 6 | `src/lib/storefronts/index.ts` | Barrel export |
| 7 | `src/lib/orders/transition.ts` | transitionOrderStatus function |
| 8 | `src/lib/orders/assignment.ts` | assign/reassign/unassign/bulkAssign |
| 9 | `src/lib/orders/index.ts` | Barrel export |
| 10 | `src/lib/order-permissions.ts` | Permission functions |
| 11 | `src/app/api/webhooks/[storefrontId]/route.ts` | Generic webhook endpoint |
| 12 | `src/app/api/orders/route.ts` | List/create orders |
| 13 | `src/app/api/orders/[id]/route.ts` | Get/update single order |
| 14 | `src/app/api/orders/[id]/transition/route.ts` | Status transition endpoint |
| 15 | `src/app/api/orders/[id]/assign/route.ts` | Assignment endpoint |
| 16 | `src/app/api/orders/bulk-assign/route.ts` | Bulk assignment endpoint |
| 17 | `supabase/migrations/004_order_rpcs.sql` | transition_order_status + assign_order RPCs |

**Delete**: `src/app/api/webhooks/easy-orders/route.ts` (replaced by `[storefrontId]` route)

**Critical dependencies (unchanged)**:
- `src/types/order-status.ts` — canTransition, isTerminalStatus, OrderStatus, RejectionReason
- `src/lib/crypto.ts` — decrypt (for webhook secret)
- `src/lib/supabase/server.ts` — createAdminClient (webhook), createClient (API routes)
- `src/types/index.ts` — Role type

---

## Ambiguities & Flags

1. **Easy Orders payload structure**: We don't have a real payload sample. The `EasyOrdersPayload` type and `mapToInternalOrder` implementation will need to be adjusted once we have real webhook data. The adapter pattern isolates this — only `easy-orders-adapter.ts` and `easy-orders-types.ts` change.

2. **Product resolution by name is fragile**: Case-insensitive name match for v1. Consider adding `external_product_id` or `sku` column to `products` table later for deterministic matching.

3. **Transition map duplication**: Same graph in TypeScript (`order-status.ts`) and PL/pgSQL (`004_order_rpcs.sql`). Both must stay in sync. TypeScript is fast-fail; PL/pgSQL is authoritative.

4. **Webhook URL migration**: Moving from `/api/webhooks/easy-orders` to `/api/webhooks/[storefrontId]` requires updating webhook URLs in the Easy Orders dashboard (one-time per storefront).

5. **`dispatched` cancellation**: The transition map allows `dispatched → cancelled`. Per spec, managers can force cancel at "any pre-dispatch status" — but `dispatched` IS the dispatch boundary. The current `TRANSITIONS` map in `order-status.ts` includes this. Verify with spec: should `dispatched` be cancellable? The existing code allows it; keeping as-is.

---

## Verification Plan

1. **TDD for each component** (per CLAUDE.md — non-negotiable):
   - Test `StorefrontAdapter` interface compliance (easy-orders-adapter)
   - Test webhook validation (valid/invalid HMAC, missing headers)
   - Test field mapping (complete payload, partial payload, missing fields)
   - Test duplicate detection (same external_id = idempotent)
   - Test `transitionOrderStatus` (valid transitions, invalid transitions, rejection with/without reason)
   - Test assignment engine (assign new, reassign, unassign, bulk)
   - Test permission functions (all role × market combinations)
   - Test API routes (auth, permissions, success, error cases)

2. **Integration test**: Full webhook flow — POST to `/api/webhooks/[storefrontId]` with signed payload → verify order created in DB with correct fields + history entry.

3. **Typecheck**: `npm run typecheck` after every file.

4. **Migration**: Apply `004_order_rpcs.sql` via Supabase MCP, verify RPCs exist.
