# Session 05: Carrier Dispatch Layer + Agent Confirmation Queue

## Context

This session builds the carrier dispatch integration and agent confirmation queue — the core operational workflow of the OMS. Agents need a sorted queue of their assigned orders, a post-call action sheet to log outcomes, and a dispatch pipeline that pushes confirmed orders to carrier APIs (Navex for Tunisia, Dexpress for Libya). The system must auto-reject orders that exceed max call attempts, and the entire flow must be atomic, auditable, and carrier-agnostic at the interface level.

The codebase already has: order status model with transitions (types + RPC), storefront adapter pattern to mirror, carrier CRUD with encrypted credentials, agent layout shell (topbar, no sidebar), and RLS policies scoping agents to their own orders.

---

## PART A — CarrierAdapter Interface

**Location:** `src/lib/carriers/types.ts`

### Type Hierarchy

```
CarrierOrderData        — subset of order fields needed for dispatch
CarrierConfig           — parsed from carriers table (code, decrypted credentials JSONB, endpoint)
CarrierRawResponse      — { status: number, body: unknown }
CarrierDispatchResult   — discriminated union: success w/ trackingNumber | failure w/ errorCode, errorMessage, retryable
```

### Interface: `CarrierAdapter`

Three methods mirroring the three stages of a carrier API call:

1. **`formatPayload(order: CarrierOrderData, config: CarrierConfig, extra?: Record<string, unknown>): Record<string, string>`**
   - Transforms OMS order into carrier-specific key-value pairs
   - Returns `Record<string, string>` because both carriers use `application/x-www-form-urlencoded`
   - `extra` carries carrier-specific UI data (Dexpress state_id/place_id) — Navex ignores it, Dexpress reads it
   - Pure function, easily testable

2. **`dispatch(payload: Record<string, string>, config: CarrierConfig): Promise<CarrierRawResponse>`**
   - Executes the HTTP POST with `Content-Type: application/x-www-form-urlencoded`
   - Handles HTTP-level concerns only — does NOT interpret success/failure
   - 15-second timeout to prevent blocking the agent

3. **`parseResponse(raw: CarrierRawResponse): CarrierDispatchResult`**
   - Interprets carrier's response into normalized result
   - `retryable` flag: true for 500-level transient errors, false for validation errors

### Factory: `getCarrierAdapter(carrierCode: string): CarrierAdapter`

**Location:** `src/lib/carriers/adapter-registry.ts`

Mirrors `getAdapter(platform)` from `src/lib/storefronts/adapter-registry.ts`. Maps `'navex'` → NavexAdapter, `'dexpress'` → DexpressAdapter. Throws on unknown code. Only file that imports concrete adapter classes.

### Error Types: `src/lib/carriers/errors.ts`

- `CarrierDispatchError` — HTTP-level failures (network timeout, DNS)
- `CarrierConfigError` — missing required fields or decryption failure

Mirrors `src/lib/storefronts/errors.ts` pattern.

### Why no carrier-specific branching

The adapter interface is the seam. The dispatch orchestrator (`src/lib/carriers/dispatch.ts`) calls `formatPayload → dispatch → parseResponse` generically. The confirm route passes `extra` through without inspecting it. The `CarrierSelector` component reads carrier metadata to decide whether to show a location picker. Adding a new carrier = new adapter class + one line in the registry + one entry in carrier metadata. Zero changes to orchestrator, route, or action sheet.

---

## PART B — NavexAdapter

**Location:** `src/lib/carriers/navex-adapter.ts`

### Token-in-URL Pattern
URL constructed as: `https://app.navex.tn/api/{decryptedToken}/v1/post.php`
- `api_credentials` JSONB stores: `{ token, sender_name, sender_location }` (encrypted)
- `decrypt()` from `src/lib/crypto.ts` decrypts the token
- `api_endpoint` in carriers table stores the base: `https://app.navex.tn/api`

### Content-Type: `application/x-www-form-urlencoded` (NOT JSON)
Body encoded via `new URLSearchParams(payload).toString()`

### Field Mapping
`nom` (customer_name), `tel` (phone), `adresse` (address), `gouvernerat` (resolved governorate), `cod` (total_price), `produit` (product_name), `nb_piece` (quantity), `sender_name`, `sender_location` (from config)

### Governorate Resolution — `src/lib/carriers/governorates.ts`

The critical challenge: Navex requires `gouvernerat` to exactly match one of 24 Tunisian governorates with correct French accents. Orders only have free-text `customer_city`.

Exports:
- `TUNISIAN_GOVERNORATES: string[]` — the 24 valid values (Tunis, Ariana, Ben Arous, Manouba, Nabeul, Zaghouan, Bizerte, Beja, Jendouba, Le Kef, Siliana, Sousse, Monastir, Mahdia, Sfax, Kairouan, Kasserine, Sidi Bouzid, Gabes, Medenine, Tataouine, Gafsa, Tozeur, Kebili)
- `CITY_TO_GOVERNORATE: Record<string, string>` — lowercased city → exact governorate. e.g. `'la marsa' → 'Tunis'`, `'hammamet' → 'Nabeul'`
- `resolveGovernorate(city: string | null): string | null` — lookup with fallback to raw city

### Response Handling
| HTTP Status | Meaning | CarrierDispatchResult |
|---|---|---|
| 201 | Success — extract tracking from `colis` field | `{ success: true, trackingNumber }` |
| 400 | ERREUR — Navex validation message | `{ success: false, errorCode: 'NAVEX_VALIDATION', errorMessage: <msg>, retryable: false }` |
| 401/403/404 | Config error | `{ success: false, errorCode: 'NAVEX_CONFIG', errorMessage: 'Carrier configuration error', retryable: false }` |
| 500+ | Transient | `{ success: false, errorCode: 'NAVEX_TRANSIENT', retryable: true }` |

### `extra` parameter: ignored by NavexAdapter

---

## PART C — DexpressAdapter

**Location:** `src/lib/carriers/dexpress-adapter.ts`

### Authorization Header Pattern (not token-in-URL)
`Authorization: Bearer {api_key}` header. `api_credentials` JSONB stores: `{ api_key, api_base_url }`.

### Content-Type: `application/x-www-form-urlencoded` for create-order

### State/Place ID System

Dexpress does not accept free-text city names. Requires numeric `state_id` and `place_id` from its own location hierarchy.

**Two new tables** (reference data, not market-scoped):
- `dexpress_states` — `id INTEGER PK, name TEXT UNIQUE`. ~20-30 rows.
- `dexpress_places` — `id INTEGER PK, state_id INTEGER FK, name TEXT, UNIQUE(state_id, name)`. Hundreds of rows.

**Seed strategy:** Separate migration `006_dexpress_seed.sql` with INSERT statements from Dexpress dumps. Decoupled from schema migration.

**Resolution strategy:**
1. Server attempts case-insensitive match of `customer_city` against `dexpress_places.name`
2. If exactly one match → pre-fill the dropdown
3. If zero or multiple → agent picks from dropdown (`DexpressLocationPicker`)

**Proxy API routes:**
- `GET /api/carriers/dexpress/states` — all states
- `GET /api/carriers/dexpress/places?state_id={id}` — places filtered by state

### `formatPayload` reads from `extra: { state_id, place_id }`

### Response Handling
| Response Code | Meaning | CarrierDispatchResult |
|---|---|---|
| 4000 | Success — extract `tracking_code` | `{ success: true, trackingNumber }` |
| 4011 | Invalid state_id | `{ success: false, errorCode: 'DEXPRESS_INVALID_STATE', retryable: false }` |
| 4012 | Invalid place_id | `{ success: false, errorCode: 'DEXPRESS_INVALID_PLACE', retryable: false }` |
| 4010 | Validation errors | `{ success: false, errorCode: 'DEXPRESS_VALIDATION', retryable: false }` |
| HTTP 500+ | Transient | `{ success: false, retryable: true }` |

### Carrier config fields: `api_base_url` (configurable, not hardcoded), `api_key`

---

## PART D — Confirm Flow Branching

### Two-Phase Confirm (two API calls from client)

**Call 1:** `POST /api/orders/{id}/transition` with `{ status: 'confirmed' }` — existing route, agent-authorized

**Call 2:** `POST /api/orders/{id}/dispatch` with `{ carrier_id, extra? }` — NEW route, transitions to `dispatched` as system

If Call 1 succeeds but Call 2 fails → order stays `confirmed`, agent sees error, retry available. This is spec-defined behavior.

### Navex Path
Agent clicks Confirme → selects carrier (Navex) → immediate dispatch → dispatched on success / stays confirmed on failure

### Dexpress Path
Agent clicks Confirme → selects carrier (Dexpress) → `DexpressLocationPicker` appears (state dropdown → place dropdown, pre-filled if auto-resolved) → agent confirms → dispatch

### No Carrier-Specific If/Else in PostCallActionSheet

**Carrier metadata registry** at `src/lib/carriers/carrier-metadata.ts`:
```
{ navex: { requiresLocationPicker: false }, dexpress: { requiresLocationPicker: true } }
```

PostCallActionSheet checks `requiresLocationPicker` to decide whether to show the location picker step. New carriers only need an entry here.

### `carrier_extra` Column (jsonb, nullable on orders)
After successful dispatch, stores the `extra` object. Navex: null. Dexpress: `{ state_id, place_id }`. Audit trail.

### Dispatch API Route — `src/app/api/orders/[id]/dispatch/route.ts`

Separate from transition route because:
1. Makes external HTTP calls (carrier APIs)
2. Must use `createAdminClient()` to read encrypted credentials and set `dispatched` (agents cannot set dispatched)
3. The existing transition route is a pure database operation

Flow:
1. Auth: agent must own the order
2. Validate order status = `confirmed`
3. Load carrier, decrypt credentials via admin client
4. Build `CarrierOrderData` from order
5. `getCarrierAdapter(carrier.code)` → `formatPayload` → `dispatch` → `parseResponse`
6. On success: call `dispatch_order` RPC (atomic: confirmed → dispatched + tracking_number + carrier_extra)
7. On failure: return error to agent, order stays confirmed

### Dispatch Orchestrator — `src/lib/carriers/dispatch.ts`

`dispatchOrder(orderId, carrierId, extra, supabaseAdmin)` — loads carrier config, decrypts, runs adapter pipeline, calls RPC on success. This is the function the route handler calls. Keeps the route thin.

---

## PART E — Queue Sorting Algorithm

### SQL-Layer Sort (recommended)

The three-tier priority sort requires `CASE WHEN` logic that is natural in SQL. The existing `idx_orders_agent_queue` index on `(assigned_to, status, callback_scheduled_at, created_at)` already supports this.

### Sort Order (in `GET /api/orders/queue` route)

```sql
ORDER BY
  CASE
    WHEN status = 'callback_scheduled' AND callback_scheduled_at <= NOW() THEN 0
    WHEN status IN ('attempt_1','attempt_2','attempt_3') THEN 1
    WHEN status = 'assigned' THEN 2
    WHEN status = 'callback_scheduled' AND callback_scheduled_at > NOW() THEN 3
    WHEN status = 'confirmed' THEN 4
    ELSE 5
  END,
  created_at ASC
```

- Priority 0: callback_scheduled where callback_time has arrived (due/overdue)
- Priority 1: attempt_1-3, oldest created_at first
- Priority 2: assigned (new, untouched), oldest first
- Priority 3: future callbacks, sorted by callback_scheduled_at ASC
- Priority 4: confirmed but not yet dispatched (retry available)

### Why SQL over app-layer
- Pagination-safe (though agents typically have 20-50 orders, no pagination needed)
- Leverages existing composite index
- Single source of truth for sort logic — no divergence between API and client
- Callback time comparison with `NOW()` is inherently a DB concern

### Queue API Route — `GET /api/orders/queue`

Agent-only. Uses `createClient()` (RLS enforced: `assigned_to = auth.uid()`). Filters out terminal + dispatched statuses. Returns full list (no pagination needed for agent queues).

### SWR Polling: 30 seconds

`refreshInterval: 30000` — frequent enough to surface due callbacks within 30s of scheduled time. SWR's `dedupingInterval` prevents double-fetches. Optimistic UI via `mutate()` on agent actions for instant feedback.

### Not using Supabase Realtime

The agent is the one making changes to their own queue. SWR polling is sufficient. Realtime would add complexity for negligible benefit.

---

## PART F — Max-Attempts Auto-Rejection

### Server-Side Enforcement

**Who triggers it:** The server, not the agent. The agent clicks "Pas de reponse" and the system decides whether to auto-reject.

**When:** "Pas de reponse" on an order where the next attempt number >= `max_call_attempts` (from settings table, default 3).

**What happens:** status → rejected, rejection_reason → 'injoignable', note → 'Auto-rejected: max attempts reached', actor_type → 'system'. Order exits queue.

**The agent never sees the rejection confirmation** — no reason picker, no confirmation dialog. A toast displays: "Ordre rejeté automatiquement (injoignable)".

### New RPC: `no_response_with_auto_reject`

**Location:** `supabase/migrations/005_carrier_dispatch.sql`

Atomically in one transaction:
1. Lock order
2. Validate transition to `p_next_attempt` (e.g. attempt_1 → attempt_2)
3. Update order status + set `callback_scheduled_at`
4. Insert order_history for the attempt transition
5. Read `max_call_attempts` from settings WHERE market_id = order.market_id AND key = 'max_call_attempts'
6. Extract attempt number from new status (attempt_3 → 3)
7. IF attempt_number >= max_call_attempts THEN:
   - Update order: status → rejected, rejection_reason → 'injoignable'
   - Insert order_history: attempt_N → rejected, actor_type = 'system'
8. Return JSON with final status (rejected or the attempt status)

### New Route: `POST /api/orders/{id}/no-response`

**Location:** `src/app/api/orders/[id]/no-response/route.ts`

Body: `{ callback_at?: string }` (ISO timestamp for next callback, omitted if auto-rejecting)

Logic:
1. Auth: agent must own the order
2. Determine current attempt from order status
3. Calculate next attempt status (assigned/attempt_1 → attempt_2, etc.)
4. If next attempt would exceed max: call RPC without callback_at, it will auto-reject
5. If not exceeding max: call RPC with callback_at

### Client-Side Flow

The client fetches `max_call_attempts` from the queue response (embedded in the response metadata) or from settings.

- If current attempt < max: show CallbackTimePicker → then call no-response route
- If current attempt = max: skip CallbackTimePicker → call no-response route → show auto-rejection toast

### No changes to canTransition() or canTransitionOrder()

The existing graph already allows `attempt_3 → rejected`. The auto-rejection uses `actor_type: 'system'`, bypassing the role-based check. The TS `canTransitionOrder` is only checked for agent-initiated transitions.

### Callback → Re-attempt Edge Case

When a callback fires and agent records "Pas de reponse", the order transitions from `callback_scheduled` → next attempt (the one AFTER the attempt that was active before the callback). The client tracks which attempt number applies by reading the order_history or the last attempt status stored in the queue response.

---

## PART G — DB Migration

### Migration: `supabase/migrations/005_carrier_dispatch.sql`

**1. Add `carrier_extra` column to orders:**
```sql
ALTER TABLE orders ADD COLUMN carrier_extra JSONB;
```

**2. Create `dexpress_states` table:**
```sql
CREATE TABLE dexpress_states (
  id    INTEGER PRIMARY KEY,
  name  TEXT    NOT NULL UNIQUE
);
```

**3. Create `dexpress_places` table:**
```sql
CREATE TABLE dexpress_places (
  id        INTEGER PRIMARY KEY,
  state_id  INTEGER NOT NULL REFERENCES dexpress_states(id),
  name      TEXT    NOT NULL,
  UNIQUE (state_id, name)
);
CREATE INDEX idx_dexpress_places_state ON dexpress_places (state_id);
```

**4. RLS for dexpress tables:**
```sql
ALTER TABLE dexpress_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE dexpress_places ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dexpress_states_read" ON dexpress_states FOR SELECT TO authenticated USING (true);
CREATE POLICY "dexpress_places_read" ON dexpress_places FOR SELECT TO authenticated USING (true);
```

**5. New RPC: `dispatch_order`**
Atomically: validates order is `confirmed`, transitions to `dispatched`, sets carrier_id + tracking_number + carrier_extra. Uses FOR UPDATE row locking.

**6. New RPC: `no_response_with_auto_reject`**
Atomically: transitions to next attempt, sets callback_scheduled_at, checks max_call_attempts, auto-rejects if exceeded.

**7. Update `transition_order_status` RPC**
Add `p_callback_at TIMESTAMPTZ DEFAULT NULL` parameter. When transitioning TO `callback_scheduled`, set it. When transitioning FROM `callback_scheduled`, clear to null.

### Migration: `supabase/migrations/006_dexpress_seed.sql`
INSERT statements for all Dexpress states and places. Decoupled from schema.

---

## PART H — New Files

### Carrier Library (`src/lib/carriers/`)
| File | Responsibility |
|---|---|
| `types.ts` | CarrierAdapter interface, CarrierOrderData, CarrierConfig, CarrierRawResponse, CarrierDispatchResult |
| `errors.ts` | CarrierDispatchError, CarrierConfigError custom error classes |
| `adapter-registry.ts` | `getCarrierAdapter(code)` factory |
| `navex-adapter.ts` | NavexAdapter: formatPayload, dispatch, parseResponse for Navex API |
| `dexpress-adapter.ts` | DexpressAdapter: formatPayload, dispatch, parseResponse for Dexpress API |
| `governorates.ts` | TUNISIAN_GOVERNORATES list, CITY_TO_GOVERNORATE map, resolveGovernorate() |
| `carrier-metadata.ts` | UI metadata per carrier code (requiresLocationPicker, etc.) |
| `dispatch.ts` | dispatchOrder() orchestration: load carrier → decrypt → adapter pipeline → RPC |
| `index.ts` | Barrel exports |

### API Routes
| File | Responsibility |
|---|---|
| `src/app/api/orders/[id]/dispatch/route.ts` | POST: carrier dispatch (agent-initiated, system-executed transition to dispatched) |
| `src/app/api/orders/queue/route.ts` | GET: agent queue with priority sort, filtered for active orders |
| `src/app/api/orders/[id]/no-response/route.ts` | POST: "Pas de reponse" action (attempt increment + auto-reject) |
| `src/app/api/carriers/dexpress/states/route.ts` | GET: proxy for dexpress_states data |
| `src/app/api/carriers/dexpress/places/route.ts` | GET: proxy for dexpress_places filtered by state_id |

### SWR Hooks (`src/hooks/`)
| File | Responsibility |
|---|---|
| `useAgentQueue.ts` | SWR hook for queue API with 30s polling |
| `useCarriers.ts` | SWR hook for market carriers list |
| `useDexpressLocations.ts` | SWR hooks for Dexpress states and places |

### Queue Components (`src/components/queue/`)
| File | Responsibility |
|---|---|
| `AgentQueue.tsx` | Main queue: SWR-fetched order list with priority sort display |
| `OrderCard.tsx` | Individual order card: customer info, status badge, action trigger |
| `PostCallActionSheet.tsx` | Modal: 4 action options after a call, multi-step confirm flow |
| `CarrierSelector.tsx` | Carrier dropdown within confirm flow |
| `DexpressLocationPicker.tsx` | Two cascading dropdowns: state → places |
| `CallbackTimePicker.tsx` | Date/time picker for scheduling callbacks |
| `RejectionReasonPicker.tsx` | Rejection reason selection with free text for "autre" |
| `QueueHeader.tsx` | Agent stats bar: assigned count, actioned, confirmation rate, status buckets |

### Agent Page
| File | Responsibility |
|---|---|
| `src/app/[locale]/(agent)/queue/page.tsx` | Agent queue page rendering AgentQueue component |

### Database
| File | Responsibility |
|---|---|
| `supabase/migrations/005_carrier_dispatch.sql` | Schema changes + RPCs for dispatch and auto-reject |
| `supabase/migrations/006_dexpress_seed.sql` | Seed data for Dexpress states and places |

### Tests (one per production file, TDD)
| File |
|---|
| `src/lib/carriers/navex-adapter.test.ts` |
| `src/lib/carriers/dexpress-adapter.test.ts` |
| `src/lib/carriers/adapter-registry.test.ts` |
| `src/lib/carriers/governorates.test.ts` |
| `src/lib/carriers/dispatch.test.ts` |
| `src/app/api/orders/[id]/dispatch/route.test.ts` |
| `src/app/api/orders/queue/route.test.ts` |
| `src/app/api/orders/[id]/no-response/route.test.ts` |
| Queue component tests (one per component) |

---

## PART I — Reused Files from Sessions 1–4

| Existing File | What It Contributes This Session |
|---|---|
| `src/types/order-status.ts` | `canTransition()` validates confirmed→dispatched and attempt_N→rejected. ORDER_STATUSES, REJECTION_REASONS types used throughout. No changes needed. |
| `src/lib/orders/transition.ts` | `transitionOrderStatus()` wraps the RPC — reused by dispatch orchestrator and no-response route. |
| `src/lib/order-permissions.ts` | `canTransitionOrder()` enforces agents can set confirmed/rejected but NOT dispatched. Dispatch route bypasses via system actor. No changes needed. |
| `src/lib/order-engine.ts` | `validateTransition()` reused for client-side pre-validation before API calls. |
| `src/app/api/orders/[id]/transition/route.ts` | Still handles the initial confirmed transition (agent-initiated). No changes needed. |
| `src/lib/crypto.ts` | `decrypt()` called by dispatch orchestrator to decrypt carrier api_credentials. |
| `src/lib/supabase/server.ts` | `createClient()` for authenticated routes; `createAdminClient()` for dispatch (read creds + set dispatched). |
| `src/types/index.ts` | `Role`, `AuthUser` types used in route authentication. |
| `src/lib/storefronts/types.ts` | Pattern reference for CarrierAdapter interface design (mirrored structure). |
| `src/lib/storefronts/adapter-registry.ts` | Pattern reference for getCarrierAdapter() factory (same approach). |
| `src/lib/storefronts/errors.ts` | Pattern reference for carrier error classes (same structure). |
| `src/context/auth.tsx` | `useAuth()` provides user.market_id and user.id to queue components. |
| `src/app/[locale]/(agent)/layout.tsx` | Agent layout shell: topbar, no sidebar, RTL support. Queue renders inside. No changes needed. |
| `src/components/layout/Topbar.tsx` | Renders in agent layout. May enhance to pass queue stats. |
| `src/app/api/carriers/route.ts` | Existing GET endpoint returns active carriers per market — reused by CarrierSelector. |
| `supabase/migrations/004_order_rpcs.sql` | Contains `transition_order_status` RPC — updated in 005 to add callback_at parameter. |
| `src/messages/fr.json` + `src/messages/ar.json` | Add new `queue.*` translation keys for agent queue strings. |
| `supabase/migrations/002_rls_policies.sql` | Existing orders RLS: agents see only assigned_to = auth.uid(). Already correct for queue. |

---

## Verification Plan

1. **Unit tests:** Run `npm test` — all carrier adapter tests (formatPayload, parseResponse), governorate resolution, dispatch orchestration, route handler tests
2. **Type check:** `npm run typecheck` — no TypeScript errors
3. **Lint:** `npm run lint` — clean
4. **Build:** `npm run build` — production build succeeds
5. **Migration:** Apply 005 + 006 via Supabase MCP — verify tables, RPCs, RLS
6. **Manual E2E:** Create test order → assign to agent → open agent queue → verify sort → test each post-call action → dispatch to carrier (mock) → verify tracking number stored
7. **RLS audit:** Run rls-reviewer agent after migration
8. **i18n audit:** Run i18n-reviewer agent after UI components

---

## Execution Order

**Phase 1 — Foundation:** Migration 005 + 006 → carrier types → errors → governorates
**Phase 2 — Adapters:** NavexAdapter + tests → DexpressAdapter + tests → registry + tests → dispatch orchestrator + tests
**Phase 3 — API Routes:** dispatch route → queue route → no-response route → dexpress proxy routes (all with tests)
**Phase 4 — Hooks:** useAgentQueue → useCarriers → useDexpressLocations
**Phase 5 — UI:** i18n keys → QueueHeader → OrderCard → CallbackTimePicker → RejectionReasonPicker → CarrierSelector → DexpressLocationPicker → PostCallActionSheet → AgentQueue → queue page
