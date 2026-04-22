# OMS Performance Gamechanger — Final Audited Plan

**Constraint:** Business logic must not change. Every change below preserves identical order statuses, workflows, role permissions, market isolation, calculations, validations, and user-visible outputs. Only performance characteristics improve.

**Decisions already made by user:**
- Middleware auth: cookie cache with short TTL.
- Pagination counts: keep `count: "exact"`.
- Heavy modals: dynamic-import all three.

---

## Top 3 gamechangers (do these first — biggest perceived-speed wins)

### GC1. Paint instantly on navigation — `loading.tsx` at every route group
**Problem:** Zero `loading.tsx`, zero `Suspense`, zero `error.tsx` anywhere (grep confirmed). On every route change, Next.js holds the previous page onscreen until both AuthProvider resolves *and* the first SWR fetch lands. Users see nothing for 300–1500 ms per nav.

**Change:**
- New [src/app/[locale]/(dashboard)/loading.tsx](src/app/[locale]/(dashboard)/loading.tsx) — skeleton matching the dashboard shell (Sidebar placeholder + content area with 3 card skeletons).
- New [src/app/[locale]/(agent)/loading.tsx](src/app/[locale]/(agent)/loading.tsx) — skeleton matching the agent queue (Topbar + 5 row placeholders).
- New [src/app/[locale]/(dashboard)/orders/loading.tsx](src/app/[locale]/(dashboard)/orders/loading.tsx), `.../products/loading.tsx`, `.../team/loading.tsx`, `.../leads/loading.tsx`, `.../settings/loading.tsx`, `.../unassigned/loading.tsx`.
- New `error.tsx` at `(dashboard)` and `(agent)` group level — plain "Réessayer" button; logs error.

**Safety:** Pure render boundary; zero logic touch.
**Effort:** 1.5 h. **Confidence:** 99%. **Impact:** 🔴🔴🔴

### GC2. Server-component page wrappers — unblock SSR and useful prefetch
**Problem:** All 17 pages under `(dashboard)` and `(agent)` are `"use client"` wrappers that return `null` while auth is loading. This means:
- `next/link` prefetch warms JS but can't paint HTML.
- AuthProvider must hydrate before the page's `<h1>` shows.
- No streaming; no server-side data.

**Change:** Convert the thin wrapper pages to server components. They already only render a header + one child. Read the session and role server-side using existing [src/lib/supabase/server.ts](src/lib/supabase/server.ts), then pass `{user, marketId, locale}` into the existing client child.

**Files to convert (all are ≤30 lines each — read session, pass props, render):**
- [src/app/[locale]/(dashboard)/orders/page.tsx](src/app/[locale]/(dashboard)/orders/page.tsx)
- [src/app/[locale]/(dashboard)/products/page.tsx](src/app/[locale]/(dashboard)/products/page.tsx)
- [src/app/[locale]/(dashboard)/unassigned/page.tsx](src/app/[locale]/(dashboard)/unassigned/page.tsx)
- [src/app/[locale]/(dashboard)/leads/page.tsx](src/app/[locale]/(dashboard)/leads/page.tsx)
- [src/app/[locale]/(dashboard)/markets/page.tsx](src/app/[locale]/(dashboard)/markets/page.tsx)
- [src/app/[locale]/(dashboard)/profile/page.tsx](src/app/[locale]/(dashboard)/profile/page.tsx)
- [src/app/[locale]/(dashboard)/admin/webhook-logs/page.tsx](src/app/[locale]/(dashboard)/admin/webhook-logs/page.tsx)
- [src/app/[locale]/(dashboard)/admin/carrier-events/page.tsx](src/app/[locale]/(dashboard)/admin/carrier-events/page.tsx)

**Do NOT convert (these use client-only hooks at page level):**
- `dashboard/page.tsx` (tab state, period state)
- `settings/page.tsx` (section tabs)
- `(agent)/queue/page.tsx` (already server — just re-exports)
- `(agent)/leads/[id]`, `(dashboard)/leads/[id]`, `(dashboard)/products/[id]`, `(dashboard)/follow-ups/*` (dynamic client pages — wait for later)

**Safety:** The heavy work stays in client components (`OrderList`, `ProductList`, `UnassignedPool`). Only the outer shell moves server-side. Business logic untouched.
**Effort:** 3 h. **Confidence:** 95%. **Impact:** 🔴🔴🔴

### GC3. Kill the 74-route auth double-fetch — `getActor()` via middleware header
**Problem:** 74 API routes call `supabase.auth.getUser()` and 70 of them immediately follow with `supabase.from("users").select("role, market_id").eq("id", user.id)`. Dashboard load = 4 SWR calls = 8 extra Supabase round-trips for auth+role.

**Change:**
1. [src/middleware.ts](src/middleware.ts) — after its existing `users + markets(code)` lookup (which will be cookie-cached per GC4), attach `x-oms-user-id`, `x-oms-role`, `x-oms-market-id` to the outgoing request headers via `request.headers.set(...)` so downstream API handlers can read them without a DB call.
2. Extend the matcher so middleware ALSO runs for `/api/*` (currently excluded). Matcher becomes `"/((?!_next/static|_next/image|favicon.ico).*)"`.
3. New helper [src/lib/auth/actor.ts](src/lib/auth/actor.ts) exporting `getActor(req)` that reads the headers. If headers missing (edge case — webhook routes skip middleware), fall back to the current `auth.getUser + users.select` pattern.
4. Refactor all 70 routes to call `const actor = await getActor(req)` instead of the two-query pattern. Mechanical replacement; same values consumed.

**Exclusions:** `/api/webhooks/*` (no user session) and `/api/cron/*` (service-role) — keep their current flow.

**Safety:** Same role/market values, same checks — only the source changes. Session is still validated by middleware. Business logic untouched.
**Effort:** 4 h (mostly mechanical find-replace across 70 files). **Confidence:** 95%. **Impact:** 🔴🔴

---

## Tier 1 — Safest, high-ROI (ship together)

### T1.1 Middleware: signed cookie cache for role + asset-skip + API inclusion
Folded with GC3. Same [src/middleware.ts](src/middleware.ts) pass:
- Tighten matcher to also skip `.svg|.png|.jpg|.jpeg|.webp|.woff2|.map|.txt|.ico`.
- Signed HTTP-only cookie `oms_profile` carrying `{user_id, role, market_code, exp}`, 5-min TTL, signed with `SUPABASE_JWT_SECRET`.
- `auth.getUser()` still called (session validation stays accurate). `users + markets(code)` query skipped when cookie valid.
- Clear cookie in [src/app/api/auth/logout/route.ts](src/app/api/auth/logout/route.ts).
- 5-min staleness window accepted per user decision.

**Confidence:** 95%. **Effort:** +1 h on top of GC3.

### T1.2 AuthProvider fast-path
[src/context/auth.tsx](src/context/auth.tsx):
1. Call `supabase.auth.getSession()` synchronously on mount; if `session.user.user_metadata` contains `{full_name, role, market_id}`, set `user` + `loading: false` immediately.
2. On `TOKEN_REFRESHED` where `session.user.id === user?.id`, skip the `users` refetch.
3. If metadata is empty, keep current DB-fetch path as fallback.

**Verify first:** `grep -rn 'raw_user_meta_data\|user_metadata' src/app/api/auth` to check whether signup writes these fields. If not, this is a no-op — either skip it or add a one-time backfill in the user-creation path.

**Confidence:** 90%. **Effort:** 1.5 h.

### T1.3 Root `SWRConfig` — kill focus-refetch storms and list flicker
New [src/lib/swr-config.ts](src/lib/swr-config.ts) exporting `defaultSwrConfig`:
```ts
{
  fetcher,                          // shared single impl
  focusThrottleInterval: 60000,     // THE key win — throttle tab-switch storms
  dedupingInterval: 5000,
  keepPreviousData: true,           // THE other key win — no flicker on paginate/filter
  revalidateIfStale: true,
  shouldRetryOnError: false,
}
```
Wrap in [src/app/[locale]/layout.tsx](src/app/[locale]/layout.tsx) around `<AuthProvider>`.

Remove per-hook `revalidateOnFocus: true` from: [useAgentQueue.ts:27](src/hooks/useAgentQueue.ts#L27), [useTeamView.ts:24](src/hooks/useTeamView.ts#L24), [useAgentMetrics.ts:29](src/hooks/useAgentMetrics.ts#L29), [useAgentLeadQueue.ts:29](src/hooks/useAgentLeadQueue.ts#L29), [useAgentNotifications.ts:26](src/hooks/useAgentNotifications.ts#L26), [TeamOverview.tsx:54](src/components/dashboard/TeamOverview.tsx#L54), [TeamTable.tsx:62](src/components/team/TeamTable.tsx#L62), [Sidebar.tsx:80](src/components/layout/Sidebar.tsx#L80), [dashboard/page.tsx:102,108,114](src/app/[locale]/(dashboard)/dashboard/page.tsx#L102).

**Confidence:** 99%. **Effort:** 1 h.

### T1.4 Fix `<a href>` → `<Link>` — eliminate full-reload transitions
**Files:**
- [src/components/products/ProductListItem.tsx:107](src/components/products/ProductListItem.tsx#L107) — the "Edit" link.
- [src/components/follow-ups/FollowUpDetail.tsx:66,148](src/components/follow-ups/FollowUpDetail.tsx)
- [src/app/[locale]/(dashboard)/leads/[id]/page.tsx:22](src/app/[locale]/(dashboard)/leads/[id]/page.tsx#L22)
- [src/components/crm/LeadDetailCard.tsx:213](src/components/crm/LeadDetailCard.tsx#L213)

Each is a 2-line change: import `Link from "next/link"`, swap the tag. Prefetch: default (on-viewport) is correct.

**Confidence:** 99%. **Effort:** 15 min.

### T1.5 Intl formatter cache
[src/lib/format.ts](src/lib/format.ts): replace the three functions with module-scope `Map<string, Intl.*Format>` caches keyed on locale. Same output bytes for same inputs. Match the existing pattern at [ProductListItem.tsx:34-42](src/components/products/ProductListItem.tsx#L34-L42).

Also fix:
- [OrderList.tsx:97](src/components/orders/OrderList.tsx#L97) (`formatDate` inline → delegate to cached `src/lib/format.ts`).
- [UnassignedPool.tsx:77](src/components/unassigned/UnassignedPool.tsx#L77) (`relativeTime` — new cache keyed on locale).

**Confidence:** 99%. **Effort:** 30 min.

### T1.6 `next.config.mjs` — `optimizePackageImports`
```js
experimental: { optimizePackageImports: ['lucide-react', '@supabase/supabase-js', 'focus-trap-react'] }
```
Tree-shakes barrel imports. Pure build transform.

**Confidence:** 99%. **Effort:** 5 min.

---

## Tier 2 — Medium effort, real impact

### T2.1 Parallelize the profitability endpoint + dedup counts
[src/app/api/profitability/business/route.ts](src/app/api/profitability/business/route.ts):
- Lines 60–127 currently `await` 8 queries sequentially. Wrap the 6 independent ones (markets.currency, totalOrdersReceived, totalRejected count, deliveredHistory, returnedHistory, confirmedHistory, adSpend) in a single `Promise.all`.
- Eliminate the separate `totalConfirmed` count query (line 68-74): `confirmedHistory.length` already gives that count.
- Keep `totalRejected` count query — it's a different filter than the history fetches.

Result: rentabilité tab load drops from ~1.5s to ~300–500 ms. Same `calculateBusinessProfitability` inputs. Business logic identical.

**Confidence:** 98%. **Effort:** 45 min.

### T2.2 `unstable_cache` on `/api/team`
[src/app/api/team/route.ts](src/app/api/team/route.ts): wrap the 3-query aggregation in `unstable_cache(fn, [key], { revalidate: 20, tags: ['team', marketId] })`. Key by `{role, actorMarketId, paramMarketId}`.

Rationale: 3 components poll this every 30s per dashboard. A 20-second cache + tag-based invalidation on order writes (if added later) cuts server load by ~3× under multi-user load. **Response shape unchanged.**

**Safety:** 20-second staleness on team counts — values are already ~30s stale under current polling. Business logic untouched.
**Confidence:** 95%. **Effort:** 15 min.

### T2.3 Column projection on hot endpoints
Replace `select("*")` with explicit column lists (keep `count: "exact"` per user decision):
- [orders/route.ts:42](src/app/api/orders/route.ts#L42): `id, external_id, customer_name, customer_city, product_name, total_price, status, assigned_to, created_at, market_id`.
- [agent/queue/route.ts:50,55](src/app/api/agent/queue/route.ts#L50): subset matching `QueueOrder` type: `id, status, customer_name, customer_phone, customer_city, product_name, variant_label, total_price, currency, attempts_count, callback_scheduled_at, customer_note, created_at, assigned_at, updated_at`.
- [leads/route.ts:43](src/app/api/leads/route.ts#L43): match `LeadRow` type.
- [products/route.ts](src/app/api/products/route.ts): match `ProductRow`.

**Audit before trimming:** grep each route's client consumer for any field access. If any is used, include it.
**Confidence:** 95%. **Effort:** 2 h.

### T2.4 Memoize the HOT row — `OrderCard`
[src/components/queue/OrderCard.tsx](src/components/queue/OrderCard.tsx):
- `export const OrderCard = React.memo(function OrderCard(...){...})`.
- [QueueList.tsx](src/components/queue/QueueList.tsx) / [QueuePage.tsx:184-241](src/components/queue/QueuePage.tsx#L184): wrap `onOpenDetail`, `onCallTerminated` in `useCallback([])`.

**Why first over ProductListItem:** `useAgentQueue` refreshes every 30 s. Without memo, every card re-renders every 30s. ProductList doesn't poll.
**Confidence:** 98%. **Effort:** 1 h.

### T2.5 Dynamic-import heavy modals (all three, per user decision)
Using `next/dynamic(..., { ssr: false, loading: () => null })`:
- [src/components/orders/OrderList.tsx](src/components/orders/OrderList.tsx) — `CreateOrderModal`, `OrderDetailPanel`.
- [src/components/queue/QueuePage.tsx](src/components/queue/QueuePage.tsx) — `OrderDetailPanel`, `PostCallActionSheet`, `CreateOrderModal`, `ShortcutsOverlay`.
- [src/components/products/ProductList.tsx](src/components/products/ProductList.tsx) — move both modal bodies + `FocusTrap` into a dynamic-imported child so `focus-trap-react` never ships in the list-page initial bundle.

Bundle reduction: ~150–400 KB off list pages. Modal open shows near-instant skeleton, then full UI after chunk loads (cached after first open).
**Confidence:** 98%. **Effort:** 2 h.

### T2.6 Memoize other row components (order of priority)
1. [OrderList.tsx:417-483](src/components/orders/OrderList.tsx#L417) — extract row to `OrderRow` memoized component; move `onMouseEnter/Leave` to CSS `:hover` class to avoid allocating handler pairs per row.
2. [UnassignedPool.tsx](src/components/unassigned/UnassignedPool.tsx) row.
3. [ProductListItem.tsx](src/components/products/ProductListItem.tsx) — lowest priority (list doesn't poll).
4. [TeamTable.tsx](src/components/team/TeamTable.tsx) row (polls every 30s).

**Effort:** 2 h total. **Confidence:** 98%.

### T2.7 Collapse `OrderDetailPanel` POST → GET waterfall
[src/components/queue/OrderDetailPanel.tsx:192-203](src/components/queue/OrderDetailPanel.tsx#L192): fulfillment override does POST → then issues a separate GET. Have the POST endpoint return the updated order; consume it directly.

**Effort:** 45 min. **Confidence:** 99%.

### T2.8 QueuePage stable filter memo
[QueuePage.tsx:137-161](src/components/queue/QueuePage.tsx#L137): the filter `useMemo` depends on `rawAllOrders` which is reference-new on every 30s SWR tick. Use a stable signature (e.g. `length + last updated_at + bucket`) or SWR's `select` option so downstream re-renders skip when data is equivalent. Synergizes with T2.4.

**Effort:** 1 h. **Confidence:** 95%.

### T2.9 Sidebar poll cadence
[Sidebar.tsx:80](src/components/layout/Sidebar.tsx#L80): `refreshInterval: 60000` (was 30000). With T1.3's `focusThrottleInterval`, idle-tab request volume halves again.
**Effort:** 2 min.

### T2.10 Fix the `/api/team` duplicate-key bug
[useTeamView.ts:20](src/hooks/useTeamView.ts#L20) keys the fetch as `/api/team?market_id=X`, but [TeamTable.tsx:60](src/components/team/TeamTable.tsx#L60) and [TeamOverview.tsx:51](src/components/dashboard/TeamOverview.tsx#L51) use bare `/api/team`. SWR cannot dedupe across different keys — so when a manager is on /dashboard with TeamOverview mounted AND `useTeamView` is used elsewhere in the tree, the same data is fetched twice under different keys.

**Fix:** Align all three call sites on the same key pattern (always append `market_id` when known, even for managers — `/api/team` accepts the query param already). Or consolidate on one hook that all three use.

**Effort:** 30 min. **Confidence:** 95%.

---

## Tier 3 — Larger optimizations (apply after measuring Tier 1–2 impact)

### T3.1 Proposed DB indexes (migration review required — DO NOT auto-apply)
New `supabase/migrations/XXX_perf_indexes.sql`:
- `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_assigned_status_partial ON orders (assigned_to, status) WHERE status NOT IN ('delivered','returned','rejected','cancelled');`
- `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_created ON orders (status, created_at DESC);`
Existing `idx_order_history_actor_created` (migration 019) already covers team metrics.

### T3.2 Consolidate dashboard to one aggregation endpoint (optional)
`/api/dashboard/overview` returning `{ metrics, profitability, adSpend }` from one handler to reduce 4 SWR calls → 1. Same field values. Ship only if Tier 1–2 metrics show dashboard is still slow.

### T3.3 `modularizeImports` for lucide-react
Only if bundle analyzer shows lucide-react still fat after T1.6.

---

## Flagged — intentionally NOT applied

- **F.1** `count: "exact"` → `"estimated"`. User chose exact.
- **F.2** Remove `useState(null) + useEffect(setNow)` in [OrderCard.tsx:31-32](src/components/queue/OrderCard.tsx#L31-L32). Hydration-mismatch risk; deferred to a deliberate design-system review.
- **F.3** Realtime channel for Sidebar unassigned count. Polling at 60s via T2.9 gives similar UX without WebSocket / RLS surface.
- **F.4** Metrics endpoint RPC refactor. Deferred unless a hotspot after Tier 1–2.
- **F.5** Convert `dashboard/page.tsx` or `settings/page.tsx` to server components. Both use client-only page-level state — not worth the split.

---

## Implementation order (critical — ship in batches)

**Batch A — paint-instantly wins (ship first, ~6 h):**
GC1 → GC2 → T1.4 → T1.5 → T1.6. Each is independently mergeable and measurable.

**Batch B — backend waste (~7 h):**
GC3 + T1.1 (middleware cookie + header pass-through) → T1.2 (AuthProvider) → T2.1 (profitability parallel) → T2.2 (team cache) → T2.3 (column projection).

**Batch C — render perf (~5 h):**
T1.3 (SWRConfig) → T2.4 (OrderCard memo) → T2.5 (dynamic modals) → T2.6 (other rows) → T2.7, T2.8, T2.9, T2.10.

**Batch D — optional (measure first):**
T3.1 indexes if query plans show need. T3.2 / T3.3 if still slow.

---

## Critical files (reference)

**Create:**
- [src/app/[locale]/(dashboard)/loading.tsx](src/app/[locale]/(dashboard)/loading.tsx)
- [src/app/[locale]/(agent)/loading.tsx](src/app/[locale]/(agent)/loading.tsx)
- Per-route `loading.tsx` for orders/products/team/leads/settings/unassigned
- [src/lib/swr-config.ts](src/lib/swr-config.ts)
- [src/lib/auth/actor.ts](src/lib/auth/actor.ts)

**Modify (high-impact):**
- [src/middleware.ts](src/middleware.ts) — GC3, T1.1
- [src/context/auth.tsx](src/context/auth.tsx) — T1.2
- [src/app/[locale]/layout.tsx](src/app/[locale]/layout.tsx) — T1.3 (SWRConfig wrap)
- [next.config.mjs](next.config.mjs) — T1.6
- [src/lib/format.ts](src/lib/format.ts) — T1.5
- 70 API routes under [src/app/api/](src/app/api/) — GC3 (mechanical)
- [src/app/api/profitability/business/route.ts](src/app/api/profitability/business/route.ts) — T2.1
- [src/app/api/team/route.ts](src/app/api/team/route.ts) — T2.2
- [src/app/api/orders/route.ts](src/app/api/orders/route.ts), [src/app/api/agent/queue/route.ts](src/app/api/agent/queue/route.ts), [src/app/api/leads/route.ts](src/app/api/leads/route.ts), [src/app/api/products/route.ts](src/app/api/products/route.ts) — T2.3
- 8 thin page wrappers — GC2
- [src/components/queue/OrderCard.tsx](src/components/queue/OrderCard.tsx), [src/components/queue/QueuePage.tsx](src/components/queue/QueuePage.tsx), [src/components/queue/QueueList.tsx](src/components/queue/QueueList.tsx) — T2.4, T2.5, T2.8
- [src/components/orders/OrderList.tsx](src/components/orders/OrderList.tsx) — T2.5, T2.6
- [src/components/products/ProductList.tsx](src/components/products/ProductList.tsx) — T2.5
- [src/components/products/ProductListItem.tsx](src/components/products/ProductListItem.tsx) — T1.4 (Link), T2.6
- [src/components/layout/Sidebar.tsx](src/components/layout/Sidebar.tsx) — T2.9
- [src/hooks/useTeamView.ts](src/hooks/useTeamView.ts), [src/components/team/TeamTable.tsx](src/components/team/TeamTable.tsx), [src/components/dashboard/TeamOverview.tsx](src/components/dashboard/TeamOverview.tsx) — T2.10

**DO NOT TOUCH (business logic):**
- [src/lib/calculations/](src/lib/calculations/) — all financial math
- [src/lib/metrics.ts](src/lib/metrics.ts) — confirmation rate, avg attempts
- [src/lib/role-permissions.ts](src/lib/role-permissions.ts), [src/lib/order-permissions.ts](src/lib/order-permissions.ts)
- [src/lib/orders/queue-sort.ts](src/lib/orders/queue-sort.ts) — agent queue sort order
- Anything inserting into `order_history` or `inventory_log`

---

## Reusable helpers in the codebase (prefer reuse)

- Formatter cache pattern: [ProductListItem.tsx:34-42](src/components/products/ProductListItem.tsx#L34-L42)
- Debounce: [src/hooks/useDebounce.ts](src/hooks/useDebounce.ts)
- Supabase server client: [src/lib/supabase/server.ts](src/lib/supabase/server.ts)
- Locale routing: [src/lib/locale-routing.ts](src/lib/locale-routing.ts) — reuse for middleware cookie `market_code → locale`
- Status/terminal helpers: [src/types/order-status.ts](src/types/order-status.ts)

---

## Verification — run after EACH batch

1. **Fast signal:** `npm run typecheck` → `npm run lint` → `npm run test:run`.
2. **Build:** `npm run build`, note bundle sizes on orders / queue / dashboard chunks.
3. **Dev smoke (UI must look identical):**
   - `npm run dev`; log in as each role: super_admin / manager.tn / manager.ly / agent1.tn.
   - Navigate between Dashboard → Orders → Products → Settings → Team; confirm skeletons appear instantly (GC1) and no blank-shell flash (GC2, T1.2).
   - `/queue`: bucket counts (nouveau / tentative_1..3 / rappel_prevu / confirme / fermees) identical to pre-change.
   - `/orders`: every filter (status, product, agent, city, date) still works, reset still works, CSV export still works, pagination identical.
   - Open `OrderDetailPanel`; fulfillment override now updates without a second GET (T2.7).
   - `/products`: add-product + stock-adjust modals still FocusTrap + Esc close (validates T2.5 dynamic FocusTrap).
   - `/dashboard`: both tabs — rentabilité loads noticeably faster (T2.1).
   - Focus/tab churn: switch away 10s, back — no request burst (T1.3).
4. **Business-logic invariants to eyeball:**
   - Revenue column = `orders.total_price`.
   - Status labels + dot colors identical.
   - Middleware still redirects agents to `/queue`, managers to `/dashboard`.
   - `order_history` still append-only; no route touches existing rows.
5. **Network tab:** expect dashboard API calls drop from ~8 auth round-trips to ~2. Agent queue page drops from ~3 to ~1.
6. **If any divergence: revert that single change before next one.**

---

## Business logic safety confirmation

Every change above only affects performance characteristics — not application rules or outputs. None of the changes alter: order statuses, status transitions, role permissions, market isolation, status labels, rejection reasons, `orders.total_price` revenue semantics, financial calculations in [src/lib/calculations/](src/lib/calculations/), append-only `order_history` / `inventory_log` writes, carrier dispatch synchrony, agent/manager workflow steps, or validation rules.

**Business logic safety: This plan only affects performance characteristics, not application rules or outputs.**

---

## Expected aggregate impact (Batches A + B + C)

| Metric | Before | After | Mechanism |
|---|---|---|---|
| Nav paint | 300–1500 ms blank | <100 ms skeleton | GC1 loading.tsx |
| Dashboard auth round-trips | ~8 | ~1–2 | GC3 + T1.1 |
| Rentabilité tab load | ~1.5 s | ~300–500 ms | T2.1 Promise.all |
| /api/team load under 3 viewers | 3× polling | 1× cached | T2.2 |
| Orders API payload | ~30 cols | ~10 cols | T2.3 |
| Queue list re-renders on 30s poll | all N rows | ~0 when data unchanged | T2.4 + T2.8 |
| List-page first-load JS | +150–400 KB modals | deferred until open | T2.5 |
| Focus-refetch storms | every focus | ≤1×/60 s | T1.3 |
| `<a href>` full reloads | 500–1500 ms | ~50 ms client nav | T1.4 |
