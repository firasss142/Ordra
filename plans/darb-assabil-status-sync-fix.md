# Darb Assabil — Status Sync Fix & Backfill

**Status:** IMPLEMENTED (2026-06-23) — see "Implementation status" at the bottom.
**Author:** Claude (investigation session 2026-06-23)
**Market:** Libya only (Darb Assabil). Tunisia/Dexpress unaffected except shared helpers.

---

## 1. Problem statement (all facts verified against the live Darb API + production DB)

Orders delivered weeks ago still read `status = uploaded` in the OMS, and the
order-detail timeline is empty. Investigation proved **three independent bugs**:

### Bug #1 — `orders.status` never reflects carrier status
The Darb status system only ever writes `carrier_status_slug` (a display
projection). Nothing promotes `orders.status`. Result: **all 306 Darb orders are
stuck at `uploaded`**, including ones the carrier marks `completed`/`returned`/
`cancelled`.

### Bug #2 — Status sync is per-agent + manual-only → 59% never synced
`handleRefreshDexpress` ([QueuePage.tsx]) syncs only `rawClosedOrders`, which the
agent-queue API scopes to `assigned_to = current agent` within a 7-day window,
and only when the agent **manually clicks refresh** in the Fermées tab. Verified
distribution:

| agent | total darb | synced | never synced |
|---|---|---|---|
| 76fda186… | 125 | 125 | 0 |
| 6e5367ef… | 93 | 0 | 93 |
| 32b9dbe0… | 86 | 0 | 86 |

→ **179 / 304 orders (59%) never synced.** Our example order belongs to an agent
who never clicked refresh.

### Bug #3 — `tracking_number` is wrong for 100% of Darb orders → timeline 404s
At dispatch the adapter stores the carrier's **create-time** `reference`, but Darb
**re-references** the shipment ~minutes later (timeline event:
`[referenced] Reference the order by 1143633`). Stored values are unrelated to the
real reference **and** carry a bogus `SH` prefix:

| stored `tracking_number` | real Darb reference (portal + API) |
|---|---|
| `SH1779712` | `1143633` |
| `SH1783163` | `1098873` |
| `SH1755041` | `1106321` |

`useDarbStatus` → `GET /timeline/SH1779712` → **404**. Even `SH1143633` returns a
*different* January shipment. Only the **bare** real reference works.

### Key enabling discovery (simplifies the fix)
`GET /api/local/shipments/:id` (keyed on the immutable `darb_assabil_id`) returns
**both** the authoritative `status` **and** the full `timeline` inline, **and** the
real `reference`. So a single call by `_id` gives us everything — we don't depend
on the broken stored reference at all.

---

## 2. Business context / decisions (confirmed with stakeholder)

- **Libya uses the confirmation system only.** No warehouse, no stock, no
  scan-out, no cost/deposit boundaries. Ignore all stock/inventory logic for Darb.
- **Status model = "like Dexpress" (Option A).** `orders.status` stays neutral
  (`uploaded`) for in-flight Darb statuses; it flips ONLY for the 3 terminal
  states. In-flight statuses (`released`, `delayed`, `processing`, `on-branch`,
  `resent`, `returning`, `booked`, `pending`) show as the live **pill + timeline**.
- **Terminal mapping** (auto-promote `orders.status`):
  - `completed` → `delivered`
  - `returned`  → `returned`
  - `cancelled` → `cancelled` (stakeholder chose own `cancelled`, not `returned`)
- **Sync trigger = app-launch, market-wide, server-side, throttled 10 min,
  non-terminal only.** Not a 24/7 cron. Skips the carrier call if the market was
  synced < 10 min ago, so N browser refreshes = at most 1 carrier sweep.
- **Backfill all 306 old orders** (full sync): real reference + slug +
  synced_at + terminal status promotion. Safe because **Darb prints/scans its own
  labels** — our `tracking_number` barcode is cosmetic, and cancellation uses
  `darb_assabil_id`, not `tracking_number`.

---

## 3. Design

### 3.1 New transitions (status machine)
Add Darb-driven terminal transitions from `uploaded` in
[src/types/order-status.ts] **and** the matching DB transition function/trigger
(keep TS + SQL in lockstep — see migration `20260620000002`):

```
uploaded: [..., "delivered", "returned", "cancelled"]   // added (Darb terminal)
```

These are gated to **Darb orders only** at the promotion call site (carrier code
check), so Tunisia/Dexpress transition rules are unchanged in practice.

> Note: today even Dexpress does NOT promote `orders.status`. Auto-promotion is a
> NEW behavior introduced here, scoped to Darb.

### 3.2 Sync logic — extend `sync-batch` to promote terminal status
In [src/app/api/darb-assabil/sync-batch/route.ts], after persisting
`carrier_status_slug`, when the slug is terminal, also promote `orders.status` via
a dedicated RPC (so the write is auditable and append-only `order_history` fires):

- `completed`  → `dispatch_order`-style RPC → `orders.status = 'delivered'`
- `returned`   → `orders.status = 'returned'`
- `cancelled`  → `orders.status = 'cancelled'`
- in-flight    → slug only (current behavior), `orders.status` untouched

New RPC `promote_darb_status(p_order_id, p_new_status, p_slug, p_actor_id)`:
- Validates the order is Darb + currently a promotable status.
- Writes `orders.status`, `carrier_status_slug`, `carrier_status_synced_at`.
- Inserts one append-only `order_history` row (`source = 'carrier_sync'`).
- Idempotent: re-running with the same terminal status is a no-op.
- **No stock / cost side-effects** (Libya doesn't use them).

### 3.3 Fix the timeline — read by `_id`, not the broken reference
Two-part fix in [src/lib/carriers/darb-assabil-tracking.ts] +
[src/app/api/orders/[id]/darb-status/route.ts]:

1. **Primary:** fetch the timeline from the **by-`_id`** endpoint
   (`darb_assabil_id`), which already includes `timeline` inline — no dependency
   on `tracking_number`. Parse `data.results[0].timeline`.
2. **Repair the stored reference:** while we have the by-`_id` response, capture
   the real `data.results[0].reference` and persist it to `tracking_number`
   (drives correct label/QR + any future bare-reference timeline call).

`useDarbStatus` is unchanged (still calls `/api/orders/[id]/darb-status`); only the
route's data source changes.

### 3.4 Dispatch capture fix (going forward)
In [src/lib/carriers/darb-assabil-adapter.ts] `parseResponse`, the create response
`reference` is unreliable (carrier re-references later). Going forward:

- Continue storing `darb_assabil_id` (correct, immutable).
- Treat the create-time `reference` as provisional; the first sync (launch sweep)
  overwrites `tracking_number` with the authoritative `reference` from the by-`_id`
  read (3.3.2). This converges automatically without a special dispatch path.

### 3.5 Launch sync (Bug #2) — market-wide, throttled
- **New column / table:** `market_carrier_sync` (`market_id`, `carrier_code`,
  `last_synced_at`) — or a `settings` row — to hold per-market last-sync time.
- **New endpoint** `POST /api/darb-assabil/sync-market`:
  - Auth = cookie/RLS (market isolation).
  - If `now - last_synced_at < 10 min` → return `{ skipped: true }` (no carrier
    call).
  - Else select **non-terminal** Darb orders for the market
    (`status = 'uploaded'` AND `carrier_status_slug NOT IN (terminal)` OR slug
    NULL), chunk by 25, reuse the existing concurrency-3 fetch, write back slugs +
    promote terminals, then stamp `last_synced_at`.
  - Terminal orders are **excluded** (vendor guidance: stop polling once
    `completed`/`returned`/`cancelled`).
- **Client trigger:** fire once on app/queue mount (fire-and-forget), then
  `mutate()` the queue when it resolves. Replaces reliance on the manual button
  (button can stay as a force-refresh that bypasses the throttle).
- **Rate-limit safety:** throttle + non-terminal filter + concurrency cap. After
  backfill, the steady-state working set is small (only in-flight shipments).

---

## 4. Backfill procedure (one-time, 306 orders) — SAFE, REVERSIBLE

Scripts live under `scripts/` (or a guarded admin route). Service-role, server-only.

**Stage 0 — Snapshot (reversible).**
```sql
create table if not exists _darb_tracking_backfill_backup as
select id, tracking_number, status, carrier_status_slug, carrier_status_synced_at
from orders o join carriers c on c.id=o.carrier_id where c.code='darb_assabil';
```
Revert at any time:
```sql
update orders o set tracking_number=b.tracking_number, status=b.status,
  carrier_status_slug=b.carrier_status_slug, carrier_status_synced_at=b.carrier_status_synced_at
from _darb_tracking_backfill_backup b where o.id=b.id;
```

**Stage 1 — Dry run (read-only).** For every Darb order, fetch by
`darb_assabil_id`; produce a report: `order_id, old_tracking, real_reference,
live_status → mapped_oms_status, would_change`. **No writes.** Review counts:
expect ~all `tracking_number` to change; terminal counts (`completed`/`returned`/
`cancelled`) to match portal expectations.

**Stage 2 — Apply, batched + idempotent.** For each order with a valid by-`_id`
response:
- `tracking_number = real reference` (bare, no `SH`).
- `carrier_status_slug = normalized status`, `carrier_status_synced_at = now`.
- If terminal → `promote_darb_status` (status flip + order_history row).
- If by-`_id` returns no/empty status (e.g. order `92ab27c9` returned empty) →
  **skip status**, only stamp `synced_at`; log it. Never guess.

**Stage 3 — Verify.** Re-run the dry-run report; `would_change` should be empty.
Spot-check 5 orders against the portal.

**Guarantees:** only touches `tracking_number`, `carrier_status_slug`,
`carrier_status_synced_at`, and (for terminals) `status` + an append-only history
row. Never touches money, products, customer data. Worst case (carrier 404) =
row skipped, leaves today's (already-garbage) value. Fully revertible via Stage 0.

---

## 5. Files to touch

| File | Change |
|---|---|
| `src/types/order-status.ts` | add Darb terminal transitions from `uploaded` |
| `supabase/migrations/…_darb_status_promotion.sql` | `promote_darb_status` RPC + transition fn update + `market_carrier_sync` |
| `src/app/api/darb-assabil/sync-batch/route.ts` | promote terminal status after slug write |
| `src/app/api/darb-assabil/sync-market/route.ts` | **new** throttled market-wide sync |
| `src/lib/carriers/darb-assabil-tracking.ts` | timeline via by-`_id`; capture real reference |
| `src/app/api/orders/[id]/darb-status/route.ts` | use by-`_id` source; persist repaired reference |
| `src/components/queue/QueuePage.tsx` | launch-sync trigger (mount) + keep manual force button |
| `scripts/backfill-darb-references.ts` | **new** dry-run + apply backfill |
| tests for each (TDD — write failing tests first) | mirrors existing `*.test.ts` |

---

## 6. TDD order (non-negotiable per CLAUDE.md)

1. `promote_darb_status` RPC contract (terminal maps, idempotency, no-op on
   non-promotable, order_history append).
2. Transition map additions (`canTransition` for Darb terminals).
3. `sync-batch` promotes terminals (extend existing route tests).
4. by-`_id` timeline parse + reference capture (extend `darb-assabil-tracking.test.ts`).
5. `sync-market` throttle (skips < 10 min; sweeps non-terminal; excludes terminal).
6. Backfill dry-run reporter (pure function over fetched snapshots).
7. Launch-sync trigger (mount fires once; force button bypasses throttle).

---

## 7. Rollout

1. Land code (status promotion + timeline-by-`_id` + sync-market) behind tests.
2. Run backfill **Stage 0 snapshot → Stage 1 dry run → review → Stage 2 → Stage 3**.
3. Verify a known order (`d86867aa` → should become `delivered`, ref `1143633`,
   timeline populated).
4. Confirm launch-sync keeps in-flight orders fresh without rate-limit warnings.

---

## Implementation status (2026-06-23)

**Done + tested (TDD, all green):**
- ✅ `promote_darb_status` RPC — migration `20260817000001` (applied). Terminal
  promotion + slug/reference refresh + append-only order_history, idempotent,
  Darb-only, no stock/cost. TS transition map updated in lockstep.
- ✅ `claim_darb_sync` RPC — migration `20260817000002` (applied). Atomic
  per-market 10-min throttle via `settings(key='darb_last_sync_at')`.
- ✅ Timeline fix — `fetchDarbShipment` / `parseShipmentFull` read status +
  real reference + inline timeline by `_id`. `darb-status` route uses it and
  repairs `tracking_number`. (17 tracking + 8 route tests.)
- ✅ `sync-batch` route — now fetches by `_id` and promotes via
  `promote_darb_status` (terminals promote, in-flight refresh). (13 tests.)
- ✅ `sync-market` route — NEW. Market-wide, throttled, non-terminal-only sweep.
  (4 tests.)
- ✅ Launch trigger in `QueuePage` — fires `sync-market` once per mount,
  revalidates only when the sweep actually ran (not when throttled).
- ✅ Full backfill of 306 orders (104 promoted, refs repaired). Snapshot
  `_darb_tracking_backfill_backup` retained.

**Known tuning item — sweep size:** the non-terminal working set is currently
~205 orders (104 terminal correctly skipped). At concurrency 3 a launch sweep is
~10–15s of background carrier calls, re-run at most every 10 min. Acceptable and
self-shrinking as orders complete, but consider an explicit cap (e.g. oldest-N
non-terminal, or only orders not synced in the last hour) if carrier load is a
concern. `log()` what's dropped if a cap is added.

**Unrelated pre-existing failure:** `src/lib/carriers/dexpress/adapter.test.ts`
(`voidDispatch` supported:false) fails on `main` independent of this work — not
touched here.

## 8. Open items / future
- Some shipments return success with an **empty `status`** (e.g. `92ab27c9`);
  treated as `not_found` today. Monitor via `carrier_event_log`
  (`unknown_darb_status`); decide later if a portal-side state needs mapping.
- Optional: extend the same auto-promotion to Dexpress (currently pill-only) if
  desired — out of scope here.
