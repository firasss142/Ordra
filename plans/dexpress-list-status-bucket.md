# Dexpress-aware bucket pill in the fermé tab list

## Why

Today, when you open the **fermé** (closed) tab in the agent queue, every order card
shows a status pill driven purely by the OMS-internal `orders.status` column. In
practice that's only ever one of three things: `uploaded` (purple),
`dispatched` (green), or `rejected` (red). That's coarse, and it's also
*stale* — once an order is uploaded to Dexpress, the OMS-side status never moves
again until a warehouse or webhook event fires. So a parcel that's actually been
delivered to the customer days ago still reads as "Téléchargé" on the list.

We recently shipped the **Dexpress status timeline** ([commit f89d6ef](https://github.com/.../commit/f89d6ef)),
which fetches the live carrier-side status when the order panel is opened and
renders a 5-node timeline. That data is precise — 19 distinct slugs — but only
visible *inside* the panel. The list outside still doesn't know about it.

This plan brings a *projected* version of that Dexpress state to the list-side
pill, mapping the 19-slug carrier taxonomy down to **5 buckets** that the agent
can scan at a glance:

> **Uploaded · Deposit · Delivered · Returned · Rejected**

## Critical architectural constraint — do NOT mutate `orders.status`

We explicitly considered (and rejected) the idea of updating `orders.status`
itself based on the Dexpress status. The CLAUDE.md status model is load-bearing
for stock, cost, and revenue accounting:

- `scanned` = STOCK BOUNDARY
- `deposit` = COST BOUNDARY
- `delivered` = revenue realized
- `order_history` is APPEND-ONLY
- Terminal statuses (`delivered`, `returned`, `rejected`, `cancelled`, `deleted`) never transition

Letting a Dexpress poll drive `orders.status` would:

1. Skip the scanned → dispatched → deposit → in_transit chain that financial /
   metrics code under `src/lib/calculations/` depends on.
2. Write append-only `order_history` rows from a flaky external source.
3. Silently desync stock counts (Dexpress poll could jump ahead of scan-out).
4. Violate the terminal-status rule when Dexpress later corrects a status
   (e.g. a parcel marked delivered that comes back as `RECEIPT_REFUSED`).

**Rule for this feature**: `orders.status` is the OMS-internal truth.
`orders.dexpress_status_slug` is a *cached projection of the carrier's view*.
The list pill is a *pure function* of both. The two never get confused.

## The five buckets — full status mapping

### Bucket 1 — Rejected
Pure OMS-side outcome. Carrier-irrelevant. Set by the agent during confirmation.

| Trigger | Pill |
|---|---|
| `orders.status === 'rejected'` | **Rejected** (red) |

### Bucket 2 — Uploaded
"Order is with Dexpress but we don't know what they're doing with it yet."
This is the fallback bucket — used when the order is in our uploaded state and
either we haven't synced its Dexpress slug yet, the slug came back unrecognized,
or the order is on a non-Dexpress carrier.

| Trigger | Pill |
|---|---|
| `status === 'uploaded'` AND `carrier_code !== 'dexpress'` | **Uploaded** (purple — keeps current behavior for non-Dexpress carriers) |
| `status === 'uploaded'` AND carrier is Dexpress AND `dexpress_status_slug IS NULL` | **Uploaded** (purple — never synced) |
| `status === 'uploaded'` AND carrier is Dexpress AND slug is set but not in the 19-slug taxonomy | **Uploaded** (purple — graceful degradation; the unknown-label log already exists) |

### Bucket 3 — Deposit
Parcel is in motion inside Dexpress's network — being prepared, sitting in their
warehouse, moving between branches, with the courier, out for delivery, or
postponed mid-route. Maps to **12 of the 19 slugs**.

| Dexpress slug | Arabic label | English gloss |
|---|---|---|
| `BEING_PREPARED` | جارى التجهيز | Being prepared |
| `IN_COMPANY` | فى الشركة | In the company |
| `WILL_BE_SENT_TO_BRANCHES` | سترسل للفروع | Will be sent to branches |
| `EN_ROUTE_TO_BRANCHES` | بالطريق للفروع | En route to branches |
| `ARRIVED_AT_BRANCHES` | وصلت الفروع | Arrived at branches |
| `SENT_TO_COURIER` | إلى المندوب | Sent to courier |
| `OUT_FOR_DELIVERY` | جارى التوصيل | Out for delivery |
| `AT_CUSTOMER` | عند العميل | At the customer |
| `DELIVERY_POSTPONED` | مؤجلة التسليم | Delivery postponed |
| `POSTPONED_WITH_COURIER` | مؤجلة مع المندوب | Postponed with courier |
| `REPLACED` | تم إستبدالها | Replaced |

Also: `orders.status === 'dispatched'` with no Dexpress slug falls into
**Deposit** (warehouse marked it as dispatched but Dexpress hasn't reported back
yet).

**Decisions captured during planning:**
- `AT_CUSTOMER` stays in Deposit — operationally it means "out for delivery to the customer," not "customer has it."
- `REPLACED` stays in Deposit per the CSV (Dexpress swapped the item; treat as still in motion).
- Postponements stay in Deposit. The timeline inside the panel carries the nuance for stuck/stale postponements. We may want to surface stale ones differently in a future iteration, but it's out of scope for v1.

### Bucket 4 — Delivered
Customer has received the parcel (or a partial of it). Three slugs:

| Dexpress slug | Arabic label | English gloss |
|---|---|---|
| `DELIVERED` | تم التسليم | Delivered |
| `AWAITING_COURIER_SETTLEMENT` | تسليم تحت تسويه المندوب | Awaiting courier settlement |
| `PARTIALLY_DELIVERED` | تم تسليمها جزئياً | Partially delivered |

Plus: `orders.status === 'delivered'` (OMS terminal, set by webhook / manager).

**Decisions captured:**
- `PARTIALLY_DELIVERED` was originally marked Deposit in the CSV but flipped to Delivered during planning. Rationale: "partially delivered" means some of the money has come in — that's a delivered-with-asterisk, not still-moving.
- `AWAITING_COURIER_SETTLEMENT` stays in Delivered. The parcel has reached the customer; only the money settlement is pending. The CSV had this right.

### Bucket 5 — Returned
Parcel is heading back, or has been refused at the door. Five slugs:

| Dexpress slug | Arabic label | English gloss |
|---|---|---|
| `RECEIPT_REFUSED` | رفض إستلام | Receipt refused |
| `RETURNING_VIA_COURIER` | راجع لدى المندوب | Returning with courier |
| `RETURNING_AT_BRANCHES` | راجعة بالفروع | Returning at branches |
| `RETURNING_TO_COMPANY` | راجع إلى الشركة | Returning to the company |
| `RETURNED_AT_COMPANY` | راجع فى الشركة | Returned at the company |

Plus: `orders.status === 'returned'` (OMS terminal).

### What's *not* changing
- Non-Dexpress orders (Navex, Libyan carrier) continue to use the existing
  status-pill logic in [OrderCard.tsx:181-222](src/components/queue/OrderCard.tsx#L181-L222) untouched.
- The order panel's [DexpressStatusSection](src/components/queue/DexpressStatusSection.tsx) and timeline are unchanged.
- The existing per-order [/api/orders/[id]/dexpress-status](src/app/api/orders/[id]/dexpress-status/route.ts)
  route is unchanged.
- Stock, cost, revenue, and `order_history` logic — all untouched.

## How the data flows

```
                ┌──────────────────────────┐
                │  Manual refresh button   │  (only trigger — no auto-sync)
                │     on fermé header      │
                └────────────┬─────────────┘
                             │ POST { orderIds: [...] }
                             ▼
        ┌─────────────────────────────────────────────┐
        │  POST /api/dexpress/sync-batch               │
        │  - Auth + RLS-scoped client                  │
        │  - Filter: carrier=dexpress, has tracking#   │
        │  - Concurrency 3, ≤25 orders per call        │
        │  - For each: fetchDexpressStatus(tracking#)  │
        │  - UPDATE orders SET dexpress_status_slug,   │
        │                       dexpress_status_synced_at │
        │  - Return per-order result map               │
        └────────────┬────────────────────────────────┘
                     │
                     ▼
        ┌─────────────────────────────────────────────┐
        │  orders table (new columns)                  │
        │  - dexpress_status_slug    text  null        │
        │  - dexpress_status_synced_at  tz   null      │
        └────────────┬────────────────────────────────┘
                     │ SELECT in queue route
                     ▼
        ┌─────────────────────────────────────────────┐
        │  bucketFor(order) → 'uploaded' | 'deposit'  │
        │                   | 'delivered' | 'returned'│
        │                   | 'rejected' | null        │
        │  Pure function — no I/O                      │
        └────────────┬────────────────────────────────┘
                     │
                     ▼
        ┌─────────────────────────────────────────────┐
        │  OrderCard pill / QueueHeader chip counts    │
        └─────────────────────────────────────────────┘
```

### Refresh model — manual only

We agreed (final decision) on the simplest possible refresh strategy:

- **No** automatic sync at app launch.
- **No** automatic sync when the fermé tab is opened.
- **No** background cron, no scheduled polling.
- **Only** a manual refresh button in the fermé header. Clicking it syncs the
  *currently visible page* of fermé orders.

Rationale: free-tier on Vercel + Supabase, plus respect for Dexpress's portal.
The persisted slug from the previous manual refresh is good enough as the
default view. If the user wants fresher data they click the button. We can layer
on smarter refresh policies in a future iteration if this proves too manual —
but ship the simple thing first.

## Implementation plan

### 1. Database migration

New migration: `supabase/migrations/<timestamp>_orders_dexpress_status_slug.sql`

```sql
ALTER TABLE orders
  ADD COLUMN dexpress_status_slug text,
  ADD COLUMN dexpress_status_synced_at timestamptz;

-- Filter index for "uploaded + carrier=dexpress" subset, so the bucket counts
-- in the fermé tab don't scan the whole orders table.
CREATE INDEX orders_dexpress_status_slug_idx
  ON orders (market_id, dexpress_status_slug)
  WHERE dexpress_status_slug IS NOT NULL;

COMMENT ON COLUMN orders.dexpress_status_slug IS
  'Cached projection of the Dexpress portal status. NEVER drives stock/cost/revenue — see plans/dexpress-list-status-bucket.md';
```

No backfill — slug stays null until the first manual refresh hits each order.

### 2. Bucket function (TDD)

**File**: `src/lib/carriers/dexpress/buckets.ts`

```ts
export type Bucket = "uploaded" | "deposit" | "delivered" | "returned" | "rejected";

interface BucketInput {
  status: string;
  carrierCode: string | null;
  dexpressStatusSlug: DexpressSlug | string | null;
}

export function bucketFor(input: BucketInput): Bucket | null
```

Returns one of the 5 buckets, or `null` if the order doesn't belong in the new
bucket model (caller falls back to the existing pill).

**Test file (written FIRST)**: `src/lib/carriers/dexpress/buckets.test.ts`

Must cover:
- `status === 'rejected'` → 'rejected' regardless of slug or carrier.
- Each of the 12 Deposit slugs → 'deposit'.
- Each of the 3 Delivered slugs → 'delivered'.
- Each of the 5 Returned slugs → 'returned'.
- `status === 'uploaded'` + carrier='dexpress' + slug=null → 'uploaded'.
- `status === 'uploaded'` + carrier='dexpress' + slug='WHO_KNOWS' (unrecognized) → 'uploaded'.
- `status === 'uploaded'` + carrier='navex' → 'uploaded'.
- `status === 'dispatched'` + no Dexpress slug → 'deposit'.
- `status === 'delivered'` → 'delivered'.
- `status === 'returned'` → 'returned'.
- `status === 'pending'` / `'confirmed'` / `'attempt_1'` → null (these never show in fermé).

### 3. Sync-batch endpoint (TDD)

**File**: `src/app/api/dexpress/sync-batch/route.ts`

**Contract**:
```
POST /api/dexpress/sync-batch
Body:   { orderIds: string[] }    // max 25 per request
200:    { results: Record<orderId, { ok: true, slug } | { ok: false, reason }> }
400:    { error } — body validation
401:    { error: "Unauthorized" }
429:    (future) — rate limited; not in v1
```

**Behavior**:
1. Auth via `createClient()` (RLS-scoped).
2. Reject batches > 25 with 400.
3. SELECT orders in batch via RLS-scoped client — market isolation enforced
   at the data layer.
4. Filter server-side to carrier=dexpress + has tracking_number. Non-Dexpress
   orders return `{ ok: false, reason: 'not_dexpress' }`.
5. Concurrency 3 via a small p-limit-style helper. For each:
   `fetchDexpressStatus(tracking_number, client)` (reuses existing code).
6. On `kind === 'ok'`: UPDATE orders SET dexpress_status_slug, dexpress_status_synced_at = now().
7. On `kind === 'not_found'`: still set dexpress_status_synced_at, slug stays
   null. Returns `{ ok: false, reason: 'not_found' }`.
8. On thrown error: returns `{ ok: false, reason: 'fetch_failed' }`. No update.
9. Unknown-slug observability: same fire-and-forget log as the existing per-order
   route (write `carrier_event_log` with `outcome_reason: 'unknown_dexpress_status_id'`).

**Test file (written FIRST)**: `src/app/api/dexpress/sync-batch/route.test.ts`

Must cover:
- 401 when unauthenticated.
- 400 when batch > 25.
- 400 when body is malformed.
- Cross-market order in batch → not in result (RLS hid it).
- Non-Dexpress order → `{ ok: false, reason: 'not_dexpress' }`.
- Dexpress order without tracking number → `{ ok: false, reason: 'no_tracking' }`.
- Happy path: slug returned, columns updated, `synced_at` set.
- Dexpress not-found: slug stays null, `synced_at` updated.
- Dexpress fetch throws: slug not touched, result is `fetch_failed`.
- Concurrency cap: 10 orders submitted, mock observes max 3 in flight at any time.
- Unknown slug from Dexpress → fire-and-forget log row created.

### 4. Queue route — surface the new columns

**File**: `src/app/api/agent/queue/route.ts`

Add `dexpress_status_slug` and `dexpress_status_synced_at` to the fermé-tab
SELECT (and to the all-orders query if needed by search). They flow through
`QueueOrder` to the client.

**File**: `src/types/queue.ts`

Add the two fields to `QueueOrder`.

### 5. Client wiring

**File**: `src/components/queue/QueuePage.tsx`

- `closedCounts` is now computed by passing each closed order through
  `bucketFor(...)` and counting per-bucket.
- `matchesClosedSubfilter` becomes `bucketFor(order) === selectedBucket`.

**File**: `src/components/queue/QueueHeader.tsx`

- Replace `ClosedSubfilter` type:
  ```ts
  export type ClosedSubfilter = "all" | "uploaded" | "deposit" | "delivered" | "returned" | "rejected";
  ```
- Replace the existing 3 closed sub-chips with 5 chips (icons TBD — propose:
  `UploadCloud / Truck / CheckCircle / RotateCcw / XCircle`).
- Add a small **manual refresh button** adjacent to the chip row, only visible
  when `selectedBucket === 'fermees'`. Disabled while a sync is in flight.
  Shows a small spinner + last-synced timestamp ("Synced 2 min ago").

**File**: `src/components/queue/OrderCard.tsx`

- The `statusPill` IIFE consults `bucketFor(order)` first.
- If non-null, render the bucket pill with the bucket's color (see palette below).
- If null, fall through to the existing logic (preserves all non-fermé behavior
  and non-Dexpress carriers).

### 6. Color palette for the bucket pill

To stay visually consistent with the existing in-panel timeline color story
([pipeline.ts:139-159](src/lib/carriers/dexpress/pipeline.ts#L139-L159)), the
pill colors are:

| Bucket | Background | Text | Why this color |
|---|---|---|---|
| Uploaded | `bg-[#F3E8FF]` | `text-[#7C3AED]` | Purple — matches today's "Téléchargé" pill so existing users aren't disoriented |
| Deposit | `bg-[#E0F2FE]` | `text-[#0891B2]` | Cyan — matches the timeline's `SENT_TO_COURIER` family (in carrier custody) |
| Delivered | `bg-status-successBg` | `text-status-success` | Green — terminal success, matches the timeline's DELIVERED node |
| Returned | `bg-rose-50` | `text-rose-700` | Rose — matches the timeline's RETURNING family |
| Rejected | `bg-status-criticalBg` | `text-status-critical` | Red — unchanged from today |

### 7. i18n keys

**File**: `src/messages/fr.json` + `src/messages/ar.json`

```
queue.buckets.closedSubfilter.all      = "Tout" / "الكل"
queue.buckets.closedSubfilter.uploaded = "Téléchargé" / "تم الرفع"
queue.buckets.closedSubfilter.deposit  = "En cours" / "قيد التوصيل"
queue.buckets.closedSubfilter.delivered= "Livré" / "تم التسليم"
queue.buckets.closedSubfilter.returned = "Retourné" / "راجع"
queue.buckets.closedSubfilter.rejected = "Rejeté" / "مرفوض"

queue.fermeesRefresh.button     = "Rafraîchir Dexpress" / "تحديث Dexpress"
queue.fermeesRefresh.syncing    = "Synchronisation…" / "جارٍ التحديث…"
queue.fermeesRefresh.lastSynced = "Mis à jour il y a {time}" / "آخر تحديث منذ {time}"
queue.fermeesRefresh.error      = "Échec — réessayer" / "فشل — أعد المحاولة"
```

For the **list-side pill labels** (when bucket is shown on the card), reuse the
same subfilter strings — same words, same meaning.

### 8. Manual refresh button — UX detail

- Position: in the fermé sub-row, right edge, next to the chips.
- States: idle / syncing (spinner + disabled) / success (brief check icon, then
  back to idle) / error (brief error tone, click to retry).
- Sync covers the **currently rendered fermé list** (whatever the bucket filter
  and pagination show), not all of fermé.
- Splits into chunks of 25 client-side, fires sequentially (not in parallel,
  to be polite to Dexpress). Total wall-time for 25 orders @ concurrency 3 should
  be well under 10s — comfortably inside Vercel's serverless limit.
- On completion, the `SWR` cache for the queue is invalidated so the new slugs
  flow into the UI.

## Test plan

### Unit / integration (Vitest)
- `src/lib/carriers/dexpress/buckets.test.ts` — full slug coverage + edge cases.
- `src/app/api/dexpress/sync-batch/route.test.ts` — auth, market isolation,
  validation, happy / not-found / error per-order outcomes, concurrency cap,
  unknown-slug log.
- `src/components/queue/__tests__/QueueHeader.test.tsx` — 5 chips render,
  counts pass through, refresh button states.
- `src/components/queue/__tests__/OrderCard.test.tsx` — Dexpress order with
  each slug shows the right bucket pill; non-Dexpress order shows the legacy
  pill; rejected always wins; null bucket falls through.

### Manual verification (per CLAUDE.md UI rule — must run dev server)
1. Open fermé tab as `tn_agent_1`. Confirm 5 chips appear, with "all" selected.
2. Pre-state: all closed orders show "Téléchargé" (purple) because no slugs
   are synced yet.
3. Click manual refresh. Spinner appears, then bucket pills update across the
   visible cards. Confirm pills match what the order panel timeline says for
   each card.
4. Switch chips: each filter narrows to the matching orders.
5. Open an order's panel — the timeline must still render correctly. The slug
   in the panel and the bucket on the list must agree.
6. RTL: switch to Arabic (`ly_agent_1`). Confirm chip order is mirrored and
   Arabic labels render.
7. Non-Dexpress order (Navex / Libyan carrier): confirm the list pill keeps
   its current behavior — no bucket pill replacement.
8. Rejected order: confirm "Rejeté" pill regardless of any cached slug.
9. Refresh during sync: button is disabled, no double-fires.
10. Cross-market: as `super_admin`, switch markets. Confirm syncs in one market
    don't leak slugs into the other (RLS).

## Rollout

- Single PR. All behind the existing fermé-tab UX — no feature flag needed since
  non-Dexpress orders are unaffected and Dexpress orders that haven't been
  synced still render correctly (they show "Téléchargé" until the user clicks
  refresh).
- Migration runs first, code ships behind it. Order of deploy: migration → code.

## Out of scope (explicit)

These came up during planning and were deliberately deferred:
- Multi-carrier generalization. Dexpress only for v1; if/when Navex or other
  carriers grow, factor `bucketFor` into a per-adapter contribution.
- Background cron / scheduled polling. Free-tier doesn't support it cleanly and
  the manual-button UX is enough until we have data saying otherwise.
- Auto-sync on app launch / on fermé open. Same reasoning.
- Stale freshness indicator per card. Possible upgrade — show a small "older
  than 6h" warning dot — but not in v1.
- Mutating `orders.status` based on Dexpress. Architecturally rejected; see the
  top of this plan for why.
- Surfacing stale postponements (`DELIVERY_POSTPONED` / `POSTPONED_WITH_COURIER`
  stuck for N days) differently from active Deposit. The timeline inside the
  panel already carries that nuance; the list pill stays coarse for v1.

## Files touched (summary)

**New**:
- `supabase/migrations/<ts>_orders_dexpress_status_slug.sql`
- `src/lib/carriers/dexpress/buckets.ts` + `.test.ts`
- `src/app/api/dexpress/sync-batch/route.ts` + `.test.ts`

**Modified**:
- `src/app/api/agent/queue/route.ts` (SELECT new columns)
- `src/types/queue.ts` (extend `QueueOrder`)
- `src/components/queue/QueuePage.tsx` (counts + filter via `bucketFor`)
- `src/components/queue/QueueHeader.tsx` (5 chips + refresh button)
- `src/components/queue/OrderCard.tsx` (pill consults `bucketFor`)
- `src/messages/fr.json` + `ar.json` (new keys)

**Untouched (by design)**:
- `orders.status` write paths
- `order_history` write paths
- `src/lib/calculations/`
- `src/lib/carriers/dexpress/statuses.ts`, `pipeline.ts`, `tracking.ts`, `client.ts`
- `src/app/api/orders/[id]/dexpress-status/route.ts`
- `src/components/queue/DexpressStatusSection.tsx`, `DexpressStatusTimeline.tsx`
