# OMS — Technical Interview Study Guide

> Purpose: a single reference to revise every technical aspect of this Order Management System before a technical interview. Each section is **(1) what it is + how it works**, then **(2) anticipated questions with model answers**. Facts here were verified against the actual source (not assumed). File paths are clickable from the repo root.

---

## 0. The 30-second pitch (memorize this)

> "It's a multi-tenant Order Management System for **cash-on-delivery e-commerce in two isolated markets — Tunisia (French/LTR) and Libya (Arabic/RTL)**. Orders flow in from storefronts via webhooks, get **phone-confirmed by agents**, are **uploaded to delivery carriers**, scanned out of the warehouse, and tracked to delivery or return. It's **Next.js 14 App Router + TypeScript on Vercel, with Supabase (Postgres + RLS + Auth + Realtime)** as the backend. The core design ideas are: a **two-phase order state machine enforced atomically in Postgres functions**, **market isolation enforced by Row-Level Security at the data layer**, the **adapter pattern for pluggable carriers and storefronts**, and **append-only audit logs** for order history and inventory."

Scale signals to drop: **~137 SQL migrations, ~50 Postgres RPCs, ~377 test files** (heavy TDD).

---

## 1. Stack & architecture

**Frontend/runtime**
- Next.js 14 **App Router**, TypeScript (strict), React 18, Tailwind.
- `next-intl` for i18n: locale-segment routing `/[locale]/...` with `fr` (LTR) and `ar` (RTL).
- **SWR** for client data fetching (stale-while-revalidate → instant navigation).
- Deployed on **Vercel** (preview per PR, prod on merge). Cron via Vercel Cron hitting `/api/cron/*`.

**Backend**
- **Supabase**: Postgres (data + business logic in RPCs), Auth (JWT session cookies), **RLS** (multi-tenant isolation), **Realtime** (postgres_changes).
- Three Supabase clients in [src/lib/supabase/](src/lib/supabase/):
  - **browser client** — anon key + user session (client components, SWR).
  - **server client** (`createClient`) — anon key + cookie session, **respects RLS** (Route Handlers, Server Components).
  - **admin client** (`createAdminClient`) — **service-role key, bypasses RLS, server-only**, used by webhooks and a few system paths (never imported into the browser).

**Directory map** (the parts that matter)
- `src/app/[locale]/(dashboard|agent|warehouse)/` — role-scoped route groups.
- `src/app/api/` — Route Handlers: `webhooks/`, `cron/`, `orders/`, `products/`, profitability, etc.
- `src/lib/calculations/` — **pure, server-side** financial logic.
- `src/lib/carriers/` + `src/lib/storefronts/` — **adapter pattern** integrations.
- `src/lib/auth/` — actor resolution, permission gates.
- `src/types/order-status.ts` — the canonical state machine (mirrored in SQL).
- `supabase/migrations/` — schema + RPCs + RLS (~137 files).

**Q&A**

- **Q: Why put business logic in Postgres functions instead of the Node API layer?**
  A: Three reasons. **Atomicity** — a status change must update the order *and* append a history row *and* (sometimes) mutate stock in one transaction with a row lock; a function gives me that for free. **Concurrency safety** — `SELECT ... FOR UPDATE` inside the function serializes racing requests (two agents acting on one order). **Single source of truth** — the same RPC is callable from the webhook path, the cron path, and the user path, so the rules can't drift between callers.

- **Q: Why Next.js App Router specifically?**
  A: Server Components let me keep financial calculations and service-role access on the server by default, Route Handlers give me a clean webhook/cron surface, and locale-segment routing (`[locale]`) handles the bilingual FR/AR + RTL requirement natively with `next-intl`.

- **Q: Where's the line between "logic in the DB" and "logic in the app"?**
  A: **Invariants** (state transitions, stock conservation, audit-append, market isolation) live in Postgres (RPCs + RLS) because they must hold no matter who calls. **Orchestration and I/O** (calling a carrier's HTTP API, validating webhook signatures, formatting payloads, computing reports) live in the app because they're side-effectful and easier to test/iterate there.

---

## 2. The order state machine (CORE — expect deep questions)

Two phases. Source of truth: [src/types/order-status.ts](src/types/order-status.ts), mirrored exactly by the `transition_order_status` Postgres function.

**Phase 1 — Confirmation (agent workflow):**
`pending → attempt_1/2/3 → callback_scheduled → confirmed → uploaded → scanned`
plus `confirmed → dispatch_scheduled → uploaded` (cron-driven future upload).

**Phase 2 — Fulfillment (carrier lifecycle, post-scan):**
`dispatched → deposit → in_transit → delivered | to_be_returned → returned/received`

**Cross-cutting**
- `unverified` — carrier-emitted delivery problem; **auto-clears** on the next carrier event (`isAutoCleared`).
- **Terminal:** `delivered, returned, rejected, cancelled, deleted` (no outgoing transitions).
- `assigned` is a **legacy** status — assignment is now `status='pending'` + `assigned_to` set. Ownership ≠ lifecycle.

**Key semantic boundaries (memorize — interviewers love these):**
- `confirmed` = phone-confirmation outcome only, **no carrier work yet**.
- `uploaded` = carrier API succeeded; `tracking_number` + `carrier_id` set; ready to print/scan. **Upload failure leaves the order at `confirmed`** (or `dispatch_scheduled`) — never rolled back further.
- `scanned` = **STOCK BOUNDARY**: warehouse scan-out deducts `−qty`.
- `deposit` = **COST BOUNDARY**: carrier fees begin accruing.
- `delivered` = **REVENUE BOUNDARY**: revenue is realized.
- `returned` = stock `+qty` (or `damaged_return_count++` if damaged).

**Who can set what** (enforced in `canTransitionOrder` + RPC, [src/lib/order-permissions.ts](src/lib/order-permissions.ts)):
- **Agent** → `attempt_*`, `callback_scheduled`, `confirmed`, `dispatch_scheduled`, `uploaded`, `rejected` only.
- **Warehouse** → `scanned` (scan_order_out), `received`/`returned` (scan_return_in).
- **System** (webhook/cron/poller) → `pending` (intake), `dispatched`, `deposit`, `in_transit`, `delivered`, `returned`, `unverified`.
- **Manager/super_admin** → any valid graph transition; can force `cancelled`/`deleted` pre-dispatch.

**Backtracking nuance:** `confirmed` can go *back* to `attempt_*`/`callback_scheduled`/`rejected` (agent confirmed by mistake, customer recanted). The TS graph and the SQL function are kept in lockstep (migration `20260620000002`).

**Q&A**

- **Q: How do you stop an invalid transition?**
  A: Defense in depth. (1) TS `canTransition(from,to)` for UI affordances + early API rejection. (2) `canTransitionOrder(role, from, to)` adds the **role** gate (agents restricted to a whitelist of targets). (3) The authoritative check is inside `transition_order_status`: it locks the row `FOR UPDATE`, re-reads current status, validates the transition against the embedded graph, updates, and appends `order_history` — all atomic. The DB is the source of truth; the TS copy exists so the client and SQL never disagree.

- **Q: Two agents act on the same order simultaneously — what happens?**
  A: The RPC takes a row lock (`FOR UPDATE`), so they serialize. The first commits `pending → confirmed`; the second re-reads *inside the lock*, sees `confirmed`, and its `pending → X` transition is now invalid, so it fails cleanly. No lost update, no double-processing.

- **Q: Why is "assignment" not a status?**
  A: Ownership and lifecycle are orthogonal. An order is `pending` whether or not an agent owns it; conflating them would mean an order couldn't be both "owned by Sara" and "on attempt 2." So ownership is `assigned_to` (a column), lifecycle is `status`. `assigned` survives only as a legacy enum value.

- **Q: An order is `uploaded` but the agent needs to fix the address. How?**
  A: `uploaded` is edit-blocked because it's committed to the carrier. The path is **reopen / barcode-delete**: void the carrier shipment, then `uploaded → confirmed`, which clears `tracking_number` and stamps `carrier_barcode_deleted_at`. A "reference-deleted upload" (`isReferenceDeletedUpload`) is then treated like a `confirmed` order — editable and re-callable. This is the only way an `uploaded` order becomes agent-editable again. (See §6 fail-closed.)

- **Q: What's `unverified` and why auto-clear?**
  A: A carrier signals a transient delivery problem (bad address, unreachable). It's surfaced to agents but isn't terminal — the next carrier event overwrites it, so it self-heals rather than trapping the order.

---

## 3. Data model & audit

Core tables (see [docs/database-schema.md](docs/database-schema.md)): `markets`, `users`, `settings`, `storefronts`, `carriers`, `products`, `product_variants`, `orders`, `order_items`, `order_history` (append-only), `inventory_log` (append-only), plus integration tables `darb_destinations`, `darb_services`, `dexpress_*`, `carrier_event_log`, `webhook_delivery_log`, and CRM tables (`leads`, `follow_ups`, etc.).

**`orders`** is the hub. Notable columns and *why they exist*:
- `total_price` — **the only revenue field** (see §7).
- `status` (enum), `rejection_reason` (enum) + `rejection_note` (free text for `autre`).
- `assigned_to`, `carrier_id`, `tracking_number`, `carrier_extra` (JSONB — carrier-specific state, e.g. Darb's internal `_id`, the chosen `(city, area, service_id)`).
- `darb_destination_id` / `dexpress_state_id` — **pre-resolved** carrier destinations from intake.
- `carrier_barcode_deleted_at` / `carrier_barcode_deleted_carrier_code` — **forensic** record of a reopen/void (survives even after `carrier_id` is cleared).
- `mapping_status` — `complete | product_unmapped | city_unmapped | both_unmapped` from webhook resolution.
- `scheduled_dispatch_at` / `_auto` / `_carrier_id` — future auto-upload.
- `raw_payload` (JSONB) — original webhook for debugging.
- Unique `(storefront_id, external_id)` — **idempotent intake** (a re-delivered webhook can't create a duplicate order).

**Enums:** order status (≈21 live values, §2); rejection reasons: `refus_client | faux_numero | doublon | injoignable | prix | non_serieux | autre`.

**Append-only logs:**
- `order_history` — one row per transition: `status_from, status_to, actor_id, actor_type, note`. No `updated_at`; **no UPDATE/DELETE RLS policy exists**, so mutation is impossible through the API.
- `inventory_log` — one row per stock movement: `change (±)`, `reason`, `balance_after` snapshot, `is_damaged`, `actor_id`, `note`. Same append-only enforcement.

**Q&A**

- **Q: How is "append-only" actually enforced — convention or mechanism?**
  A: Mechanism. RLS is on, and the tables have **only SELECT and INSERT policies** — there is no UPDATE or DELETE policy, so Postgres denies those operations to every non-superuser role, including the service role's normal path. Combined with RPCs that only ever `INSERT`, the audit trail is immutable by construction, not by discipline.

- **Q: Why snapshot `balance_after` in inventory_log if you can sum `change`?**
  A: It's a cheap integrity check and makes the log human-auditable. You can detect drift (sum of changes vs. `products.current_stock`) and read the stock level at any historical point without folding the whole series.

- **Q: Why `carrier_barcode_deleted_at` instead of just clearing the carrier fields?**
  A: Forensics. When you reopen an `uploaded` order you clear `carrier_id`/`tracking_number`, which loses the link to the carrier shipment that was just voided. The two `carrier_barcode_deleted_*` columns preserve "this order was pulled back from carrier X at time T" so you can reconcile if a void didn't actually take at the carrier. (This is exactly what let us reconstruct a lost batch of reopened orders.)

---

## 4. Auth & authorization

**Actor resolution** — [src/lib/auth/actor.ts](src/lib/auth/actor.ts) `getActor(req)`:
- **Fast path:** middleware injects `x-oms-role` / `x-oms-actor-id` / `x-oms-market-id` headers when the signed `oms_profile` cookie cache is warm → zero DB calls.
- **Cold path:** `supabase.auth.getUser()` + a `users` lookup for `role, market_id`. Returns a 401 response object if unauthenticated.
- `Actor = { id, role, market_id }`; `market_id` is **null only for super_admin**.

**Two-tier session model:** Supabase manages the auth JWT in cookies; middleware caches the *profile* (role + market) in a short-TTL signed `oms_profile` cookie so most requests skip the users-table round-trip.

**Roles:** `super_admin` (cross-market, null market_id), `market_manager` (own market), `agent` (own assigned orders), `warehouse_agent` (own market warehouse ops).

**Permission gates** — [src/lib/order-permissions.ts](src/lib/order-permissions.ts): pure functions like `canViewOrders`, `canAssignOrders`, `canReopenOrder`, `canEditOrder`, `canTransitionOrder`. Notable: agents get a **7-day action window** (`AGENT_WINDOW_MS`) for reopen/edit on `rejected`/`confirmed`; reopen is agent-only and requires `assigned_to === actorId`.

**Q&A**

- **Q: Isn't a cached role cookie a privilege-escalation risk?**
  A: No, because it's only an optimization, not the security boundary. The `oms_profile` cookie is **signed** (tamper-evident), short-TTL, and — crucially — **RLS at the database is the real gate**. Even if an attacker forged a role header, every query still runs under their Supabase JWT, and RLS scopes rows by the *real* `auth.uid()`/market. The header just saves a lookup; it can't widen data access.

- **Q: Where is the service-role key used, and why is that safe?**
  A: Only in server-only code — webhooks (which run before any user session exists) and a few system paths. It's never imported into a client component, and `NEXT_PUBLIC_*` is reserved for the URL + anon key. The service role bypasses RLS, so its blast radius is deliberately tiny and server-bound.

- **Q: Permission checks in TS *and* RLS *and* RPCs — isn't that redundant?**
  A: Intentional defense in depth at different layers. TS gates drive UI and give fast, friendly API rejections. RPCs re-check role/market under a lock (authoritative for *writes*). RLS is the floor for *reads/writes* that catches anything the app forgets. If any one layer has a bug, the others still hold.

---

## 5. RLS & market isolation (CORE — multi-tenant question magnet)

Two markets, fixed UUIDs: **Tunisia `…0001`**, **Libya `…0002`**. Every market-scoped table carries `market_id`.

**Mechanism:** RLS is enabled on all tables. Policies call two `SECURITY DEFINER` helpers — `get_user_role()` and `get_user_market_id()` (read from `users` by `auth.uid()`). Pattern per table:
- `super_admin` → all rows (its market_id is null, so it isn't constrained).
- `market_manager` / `agent` / `warehouse_agent` → `market_id = get_user_market_id()`.
- `agent` on `orders` is further narrowed to `assigned_to = auth.uid()`.
- Writes to `settings`/`carriers`/`storefronts` → super_admin only; managers read-only.

**Q&A**

- **Q: "Market isolation is at the data layer, never UI filtering." Defend that.**
  A: UI filtering only hides rows the client *chose* not to show — a crafted API request bypasses it. With RLS, isolation is enforced inside Postgres: a Libya manager's `SELECT * FROM orders` physically returns zero Tunisia rows because the policy appends `market_id = get_user_market_id()` to every query. There's no app code path that can opt out (except the deliberately server-only service role). So a bug in a React filter can leak nothing.

- **Q: How does super_admin see everything without a special bypass?**
  A: super_admin has `market_id = NULL`. The policies are written so the role check short-circuits to "all rows" for super_admin rather than comparing to a market. There's no "disable RLS" toggle — it's just a branch in the policy.

- **Q: RLS adds a subquery to every statement — performance?**
  A: `get_user_market_id()`/`get_user_role()` are tiny indexed lookups on `users` by PK, and Postgres caches within a statement. The market-scoped composite indexes (e.g. `(market_id, status, created_at)`) are designed so the RLS predicate is *part of* the index, not an extra filter. In practice it's negligible vs. the safety.

- **Q: Webhooks use the service role and bypass RLS — how do you keep isolation there?**
  A: The webhook is keyed to a specific `storefront`, which belongs to exactly one market, so every order it creates is stamped with that storefront's `market_id` explicitly. Isolation is preserved by *construction* on the write, even though RLS isn't doing the enforcing on that path.

---

## 6. Carrier integration, dispatch & the fail-closed reopen (CORE)

**Adapter pattern** — [src/lib/carriers/](src/lib/carriers/). Interface in `types.ts`: `formatPayload → dispatch → parseResponse → voidDispatch`. Factory `getCarrierAdapter(code)` in `adapter-registry.ts`. Adapters are stateless; credentials come from the `carriers` row (encrypted JSONB) via `buildConfig`.
- **Navex** (Tunisia), **Dexpress** (Libya, portal/session-based), **Darb Assabil** (Libya, REST `v2.sabil.ly`). Two Darb *accounts* exist (Tripoli + Benghazi) as **separate carrier rows sharing `code='darb_assabil'`** — selected manually, not auto-routed.

**Dispatch (= "upload to carrier") flow:**
`POST /api/orders/[id]/dispatch` (or `bulk-dispatch`) → `performDispatch` ([src/lib/carriers/perform-dispatch.ts](src/lib/carriers/perform-dispatch.ts)) → `dispatchToCarrier` → adapter → on success `dispatch_order` RPC (sets `carrier_id`, `tracking_number`, merges `carrier_extra`, `confirmed/dispatch_scheduled → uploaded`, appends history).

**Preflight** ([src/lib/carriers/bulk-dispatch-preflight.ts](src/lib/carriers/bulk-dispatch-preflight.ts)) — pure, per-order eligibility before bulk upload. `SkipReason`s: `wrong_status`, `wrong_market`, `missing_address`, `no_destination` (Darb multi-area city with no stored pick), `no_state` (Dexpress), `no_service`, `unknown_carrier`. For Darb it resolves `(city, area)` from the persisted `darb_destination_id` first, falling back to `resolveDarbAny(customer_city)`.

**Two guards against double-shipping:**
1. **Duplicate-shipment backstop** (in `performDispatch`): refuse if `tracking_number` is already set — a prior reopen that didn't clear it must not produce a second shipment.
2. **Duplicate-order guard** ([src/lib/duplicate-orders/](src/lib/duplicate-orders/)): same phone + product + qty within 24h, sibling already shipped → 409 `duplicate_confirmation_required` (single) or `needs_confirmation` bucket (bulk), requiring explicit `confirm_duplicate(s)`.

**Fail-closed reopen / void** ([reopen/route.ts](src/app/api/orders/[id]/reopen/route.ts), [bulk-reopen/route.ts](src/app/api/orders/bulk-reopen/route.ts), [carrier-delete/route.ts](src/app/api/orders/[id]/carrier-delete/route.ts)):
- Attempt `adapter.voidDispatch(tracking, config, carrier_extra)` (Darb needs the internal `_id` from `carrier_extra` to cancel).
- **If void is NOT confirmed** (`local_only`) and the operator hasn't passed `confirm_manual_cancel` → **do NOT reopen**; return 409 `needsManualConfirm`. Leaving the order `uploaded` keeps it out of the queue so no second shipment can be created.
- Only `carrier_voided` (or explicit manual confirm, or `no_barcode`) flips `uploaded → confirmed` via `delete_carrier_barcode` / `reopen_order`, stamping the forensic columns.

**Q&A**

- **Q: Why "fail closed"? What's the failure you're preventing?**
  A: A double-shipment to a real customer, which costs real money and is hard to undo. If I can't *confirm* the carrier cancelled the original, the safe default is to leave the order `uploaded` (carrier-committed) rather than reopen it — because reopening invites the agent to upload again, creating a second live shipment. So uncertainty resolves toward "do nothing destructive," and the operator must assert the manual cancel to override.

- **Q: Adding a new carrier — what do you touch?**
  A: One new adapter file implementing the interface, plus a registry entry and a descriptor (credential fields, markets). Zero changes to the dispatch flow, the RPCs, or the UI — that's the point of the adapter pattern. The `carriers` table row holds the per-account endpoint/credentials.

- **Q: How are carrier credentials protected?**
  A: Stored encrypted (AES-256-CBC, random IV per value) in `carriers.api_credentials` JSONB; decrypted only server-side in `buildConfig` at dispatch time; masked in the UI. The `ENCRYPTION_KEY` is a server env var.

- **Q: Bulk upload of 200 orders — how do you avoid mis-shipping the bad ones?**
  A: The pure preflight runs per order and returns an eligibility matrix; ineligible orders are *reported* (skip reason) rather than forced through. There's a `dry_run` mode that returns the breakdown for a UI preview before anything is sent. Then duplicates get filtered to a `needs_confirmation` bucket. Only the clean, confirmed set is dispatched.

---

## 7. Financial calculations (server-only, pure)

[src/lib/calculations/](src/lib/calculations/) — `profitability.ts`, `product-profitability.ts`, `business-profitability.ts`, `order-total.ts`, `inventory-intelligence.ts`, `acquisition.ts`, `waterfall.ts`, `deltas.ts`, `math.ts`. **Pure functions, no DB calls, never imported client-side.**

**The golden rules** (from [docs/business-logic.md](docs/business-logic.md) + CLAUDE.md):
- **Revenue = `orders.total_price` ONLY** — never `unit_price` or any other field.
- **All cost variables come from the `settings`/`carriers`/`products` tables — never hardcoded.**
- Net profit = Revenue − COGS − delivery − return − packing − ad spend; margin = profit / revenue.
- Period attribution uses `order_history.created_at` at the boundary status (revenue/COGS at `delivered`, return cost at `returned`, packing at `confirmed`).
- `order-total.ts` `computeOrderTotal`: card payment adds **+10% on subtotal only** (not on delivery fee), rounded to 3 decimals (millimes) — models Dexpress's cash-withdrawal cut; Darb's native card payment sets the surcharge off to avoid double-billing.

**Q&A**

- **Q: Why must calculations be server-side and pure?**
  A: Pure (data in → number out, no side effects) makes them exhaustively unit-testable and deterministic — critical for money. Server-side keeps cost inputs and margins out of the browser (you don't ship your COGS to the client) and prevents client-side tampering with figures. The purity also means I can test every rounding edge case without a database.

- **Q: Why is revenue strictly `total_price`?**
  A: `total_price` is the single agreed contract value the customer pays (subtotal ± card surcharge + delivery). Summing `unit_price × qty` or other fields would diverge from what's actually collected (surcharges, fees, manual overrides). One field = one truth = reconcilable books.

- **Q: Why source fees from settings, not constants?**
  A: Fees differ per market and change over time; carriers renegotiate. A constant would silently make historical reports wrong and require a deploy to change a rate. Settings-driven costs are auditable (`settings_history`) and per-market.

---

## 8. Storefront intake & webhooks

**Adapter pattern** — [src/lib/storefronts/](src/lib/storefronts/): `validateWebhook → parseEventType → mapToInternalOrder`. Adapters: Shopify, EasyOrders, WooCommerce, LightFunnels, Buybox (+ Google Sheets sync). Auth modes vary: HMAC-SHA256 (Shopify/EasyOrders/Woo) vs `uuid_only` (Buybox — the URL UUID is the secret).

**Intake flow** — [webhook-handler.ts](src/lib/orders/webhook-handler.ts):
1. Validate signature (per adapter).
2. **Idempotency:** dedup via `webhook_delivery_log` (Shopify's stable `X-Shopify-Webhook-Id`, else `(storefront_id, external_id, event)`); the DB unique `(storefront_id, external_id)` is the final backstop (a 23505 unique-violation → logged as "ignored", not an error).
3. Map → resolve product (`resolveProduct`) and city (`resolveCity` → Darb destination / Dexpress state) → set `mapping_status`.
4. Insert order (`pending`), append history, try auto-assign, update storefront health.
5. `order.updated` only touches customer fields; `order.cancelled` → `deleted` (skipped if terminal/post-dispatch).

**Q&A**

- **Q: A storefront sends the same webhook 3 times — what happens?**
  A: Idempotent at two levels. First, `webhook_delivery_log` records each delivery id; a repeat returns the original logged result without reprocessing. If that's somehow bypassed, the `orders` unique `(storefront_id, external_id)` raises 23505 on insert, which the handler treats as "already exists / ignored." So at most one order per external id.

- **Q: What if the product or city can't be mapped at intake?**
  A: The order is still created (we never drop a real order), but with `mapping_status` flagging `product_unmapped` / `city_unmapped`. Agents/managers resolve the mapping later; the carrier preflight will skip it until the destination resolves, rather than mis-ship.

---

## 9. Realtime, scheduled jobs, polling

**Realtime** — a refcounted app-wide bus over Supabase `postgres_changes` ([src/lib/realtime/](src/lib/realtime/) + provider). Multiple subscribers for the same `(table, marketId, extraFilter)` **share one channel**, opened on first subscriber and closed on last (clean unsubscribe on unmount). Filters are applied at Postgres (`market_id=eq.…`, `assigned_to=eq.…`) so clients only receive relevant rows. Handlers explicitly call SWR `mutate()` — realtime signals *what changed*, SWR refetches.

**Cron** ([src/app/api/cron/](src/app/api/cron/), guarded by a secret): `dispatch-scheduled` (auto-upload `dispatch_scheduled` orders whose time arrived, resolving destination server-side; reverts to `confirmed` if unresolvable), `poll-carriers` (status sync for in-flight orders), Google-Sheets sync.

**Q&A**

- **Q: Why refcount realtime channels instead of one per component?**
  A: Hundreds of order cards subscribing individually would open hundreds of websockets/channels. Sharing one channel per `(table, market, filter)` and refcounting keeps it to a handful, and tears down cleanly so there are no leaked subscriptions when an agent navigates away.

- **Q: Cron tries to auto-upload but the destination is missing — what happens?**
  A: It reverts the order to `confirmed` with a note instead of guessing. Graceful degradation: a human picks the destination rather than the system shipping to the wrong place — same fail-safe philosophy as the dispatch preflight.

---

## 10. Stock integrity

Stock changes via **exactly three sanctioned paths**, anything else is a bug:
1. **initial_stock** at product creation (one `inventory_log` row).
2. **`adjust_product_stock` RPC** — super_admin only — `manual_adjustment` / `damaged_writeoff`.
3. **`scan_order_out` (−qty)** and **`scan_return_in` (+qty or damaged)** at the warehouse.

Managers and agents **never** mutate stock. The RPCs are `SECURITY DEFINER`, re-check role, lock the product, write `inventory_log` with `balance_after`. Scan-out requires a printed label and the `uploaded` status; it transitions to `scanned`.

**Q&A**

- **Q: Why centralize stock in three RPCs?**
  A: Stock is a conserved quantity; if many code paths could change it, drift and double-counting are inevitable. Funneling every mutation through three audited, locked RPCs means `current_stock` always equals the sum of `inventory_log` — provable, and every change has an actor and reason.

- **Q: Why is the stock boundary at `scanned`, not `confirmed` or `delivered`?**
  A: `scanned` is the physical moment the unit leaves the warehouse — that's when inventory truly drops. Earlier (`confirmed`/`uploaded`) the order can still be cancelled with no stock effect; later (`delivered`) would over-count stock as available while it's already in transit.

---

## 11. Testing & TDD

Vitest + Testing Library, **~377 test files**, strict TDD ([.claude/skills/test-driven-development/](.claude/skills/test-driven-development/SKILL.md)). The Iron Law: *no production code without a failing test first* — write test → **watch it fail** → minimal code → refactor.

**What's tested where:** pure functions (calculations, preflight, adapters, the status graph) get exhaustive unit tests; Route Handlers are tested with mocked Supabase clients for auth (401/403), validation (400), success (200), and error classification (409/422), asserting the **exact RPC params**. RLS, realtime, and live carrier APIs are verified in staging, not unit tests.

**Anti-patterns explicitly avoided** ([testing-anti-patterns.md](.claude/skills/test-driven-development/testing-anti-patterns.md)): testing mock behavior instead of real behavior, test-only methods on production classes (helpers live in `src/test/`), incomplete mocks that don't mirror the real API.

**Q&A**

- **Q: Why watch the test fail first — isn't coverage the same either way?**
  A: A test written after the code passes immediately, which proves nothing — it might test the wrong thing or miss the edge case. Seeing it fail for the *expected reason* proves the test actually exercises the behavior. Tests-first also answer "what *should* this do?" rather than "what does the code I wrote happen to do?", so they catch design problems early (hard to test = hard to use).

- **Q: How do you test a Route Handler without a real database?**
  A: Mock the Supabase client at the module boundary and assert behavior, not internals: that the right RPC is called with the right params, that auth failures return 401/403, that bad input returns 400, and that RPC errors are mapped to the right status codes. The heavy logic is in pure functions tested separately, so the handler test only needs to verify wiring + guards.

---

## 12. Likely "zoom-out" questions (have these ready)

- **Biggest technical challenge?** → The fail-closed reopen/void across two Darb accounts: guaranteeing no double-shipment when a carrier cancel can't be confirmed, while still letting operators recover orders. It forced the forensic columns, the duplicate backstops, and the manual-confirm override.
- **What would you improve?** → e.g. move carrier API calls behind a queue for retry/back-pressure; add an outbox pattern so `dispatch_order` and the external call can't diverge; formalize the TS↔SQL state-graph sync with a generated test.
- **How does it scale?** → Reads scale via market-scoped composite indexes + SWR caching + keyset pagination; writes are serialized per-row by RPC locks (fine for per-order throughput); realtime is bounded by shared refcounted channels. The hot path (agent queue) is a single indexed query.
- **Consistency model?** → Strong within Postgres (RPC transactions + RLS); eventual between OMS and carriers (reconciled by polling + the event log + forensic columns).
- **Failure modes?** → Carrier API down → upload fails, order stays `confirmed`, retry later. Webhook storms → idempotent intake. Lost reopen tracking → forensic columns reconstruct it.

---

## 13. One-line fact sheet (cram)

- Stack: Next.js 14 App Router + TS + Tailwind on Vercel; Supabase Postgres/Auth/RLS/Realtime; SWR; next-intl (fr/ar, RTL).
- 2 markets (TN `…0001` / LY `…0002`), 4 roles (super_admin/market_manager/agent/warehouse_agent).
- ~137 migrations, ~50 RPCs, ~377 tests.
- State machine: 2 phases, terminal = delivered/returned/rejected/cancelled/deleted; enforced in `transition_order_status` (locked, atomic) + mirrored TS graph.
- Boundaries: scanned=stock, deposit=cost, delivered=revenue.
- Revenue = `orders.total_price` only; costs from settings; calc layer pure + server-only.
- Isolation = RLS at data layer (`get_user_market_id()`), not UI.
- Adapters: carriers (Navex/Dexpress/Darb×2) + storefronts (Shopify/EasyOrders/Woo/LightFunnels/Buybox).
- Dispatch = `performDispatch → adapter → dispatch_order`; fail-closed reopen; 2 dup guards; encrypted credentials.
- Append-only `order_history` + `inventory_log` (no UPDATE/DELETE policy).
- TDD Iron Law: failing test first, always.
