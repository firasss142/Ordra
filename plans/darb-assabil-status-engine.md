# Darb Assabil — dedicated status engine (Tripoli + Benghazi)

## Context

Darb Assabil (درب السبيل, `darb_assabil`, `https://v2.sabil.ly`) is the primary Libya carrier,
running as two accounts: **Tripoli** (`4f1271c8…`, 709 orders) and **Benghazi** (`43077d36…`,
153 orders). 862 orders total.

The integration is mature on the *write* side (dispatch, rates, destinations, areas, warehouse
fulfilment) but the *read* side is thin, browser-driven, and partly broken. Three things prompted
this work:

1. **Orders get uploaded and never get a status.** 17 Darb orders have been sitting at `uploaded`
   with a `NULL` carrier slug since June/July. They *are* being polled — `carrier_status_synced_at`
   is recent — but the carrier returns not-found and nothing is recorded about why.
2. **The status we do get is too coarse.** Only 3 of Darb's 11 statuses move `orders.status`.
   150 orders sit in one flat `uploaded` bucket even when Darb knows they are out for delivery,
   at branch, delayed, or being returned.
3. **We throw away almost everything Darb sends.** The carrier knows the **driver's name and
   phone**, the **comment thread**, **why an order was cancelled**, the real delivery timestamp,
   the actual billed fee, and the COD settlement date. None of it is stored.

Outcome: Darb status is complete, correct, server-side, and 24/7; every past order is reconciled
and explained; and the OMS holds the same operational detail the Darb dashboard shows.

---

## What is actually broken (verified live on project `vshynigvgrlihngozuwb`)

| # | Finding | Evidence |
|---|---|---|
| 1 | **Every Darb forensic log insert is silently rejected.** `carrier_event_log.carrier_code` still has `CHECK (carrier_code IN ('navex','dexpress'))`. Both Darb sync routes insert `'darb_assabil'` inside `catch {}`. | `carrier_event_log` holds 10 rows, all `barcode_deletion`. Zero Darb rows, ever. |
| 2 | **Darb has no cron.** Sync fires from `QueuePage` mount, throttled to 1×/10min/market. If nobody opens the queue, nothing syncs. | Sync timestamps cluster in working hours only (…17:39, 18:30), nothing overnight. |
| 3 | **The sweep never finishes.** 150 non-terminal orders × 1 HTTP call at concurrency 3, on a route with **no `maxDuration` entry** in `vercel.json` → killed mid-sweep. | Orders carry 6 distinct `synced_at` batches (08-08, 08-10, 08-15 ×2, 08-16 ×2) — each sweep reaches a different subset. |
| 4 | **`not_found` is unlogged.** `sync-market` increments a counter and writes `synced_at` with no slug, no event row. | The 17 orphans: recent `synced_at`, `NULL` slug, no trace anywhere. |
| 5 | **The shared carrier poll cron has been 500ing every 10 min.** `poller.ts` uses the ambiguous embed `carriers!inner(...)`; `orders` now has 3 FKs to `carriers` (`carrier_id`, `scheduled_dispatch_carrier_id`, `recommended_carrier_id`). | 36 × HTTP 500 in `net._http_response` in the retained window: `fetchOpenOrders: Could not embed because more than one relationship was found`. |
| 6 | **Darb orders are invisible to every stuck-order surface.** `in-delivery` and `warehouse/carrier-tracking` hard-code `PHASE_2_STATUSES = dispatched/deposit/in_transit/to_be_returned`. Darb orders never enter those. | 150 in-flight Darb orders appear on no tracking surface. |
| 7 | **`upload_stalled` can never fire for Darb.** Each sweep writes `carrier_status_synced_at`, and `trg_orders_updated_at` bumps `updated_at` unconditionally — so the 24h threshold never trips. | Alert catalogue keys on `updated_at`. |

Current slug → internal status reality:

| Darb slug | n | `orders.status` today |
|---|---|---|
| completed | 367 | delivered ✅ |
| cancelled | 248 | cancelled ✅ |
| returned | 97 | returned ✅ |
| pending / processing / delayed / released / returning / on-branch | 133 | **all flat `uploaded`** |
| *(NULL — carrier not-found)* | 17 | **stuck `uploaded` since June** |

---

## The unlock

`GET /api/local/shipments/:id` — the `:id` path segment is **optional**
(`postman_collection.json`, `localShipments/get`, `variable: [{key:"id", description:"(optional)"}]`).
Without it, the endpoint is a filterable, paginated **list**:

```
GET /api/local/shipments?negateStatus=completed,cancelled,returned
    &offset=0&limit=200&includeTotalCount=true&sort={"updatedAt":-1}
```

That replaces 150 sequential per-order calls with **~2 calls per account**. It is what makes
"exact status, as fast as possible" achievable inside a serverless budget.

The same response carries everything currently discarded (per the Postman response schema):

| Field | What it gives us |
|---|---|
| `handler {fname, mname, lname, phone, avatar}` | **Driver name + phone number** |
| `conversation[] {message, createdBy, timestamp}` | **Comment thread with the carrier** |
| `timeline[] {type, description.ar/en, remarks, phone, attachments, isConclusion, locationMarker}` | Full event log incl. `assigned` (courier assignment) and proof-of-delivery images |
| `cancellationCause` | **Why cancelled** — `fake`, `3-days-no-response`, `cancelled-by-the-customer`, `mistake-by-store`, … (248 orders currently have no reason) |
| `delayedUntil` | When a delayed shipment resumes |
| `resendCount`, `cancelCount`, `undoCompletionCount` | Real delivery-attempt counts |
| `completedAt` | True delivery timestamp (we have none — `delivered_at` doesn't exist) |
| `invoices[].items[]` + `breakdown` | **Actually billed** shipping/COD/service fee vs. our flat 10 LYD assumption |
| `deliveryWithdrawalAt` / `…References`, `salesWithdrawalAt` | COD settlement — when the money actually landed |
| `toBranch`, `toBranchGroup`, `toZoneCode`, `priority`, `notes` | Routing + priority |

> **Assumption to verify first.** The list behaviour is read from the vendor's Postman schema,
> not yet from a live call. **Phase 0 is a read-only probe** that confirms it before any code is
> written, with a documented fallback to the existing per-`_id` path if it doesn't hold.

---

## Plan

### Phase 0 — Probe (read-only, no writes)

`Ordra/scripts/probe-darb-shipments-list.ts`, modelled on the existing
`scripts/probe-darb-shipping-rates.ts` (same credential-loading pattern via
`buildConfig` from `src/lib/carriers/dispatch.ts`).

For **both** accounts, GET only:
1. `/api/local/shipments?offset=0&limit=5&includeTotalCount=true` → does list mode work? what's `totalCount`?
2. Same with `negateStatus=completed,cancelled,returned` → does the filter apply?
3. One known-good `_id` → dump the **full** field set to `scratchpad/darb-shape-<account>.json`.
4. Three of the 17 orphan `_id`s → what does not-found actually look like? Then try
   `?reference=SH…` and `?search=SH…` to see if the shipment still exists under a new id.

Output: a short findings file. Everything downstream keys off it. If list mode doesn't work,
Phase 2 keeps the per-`_id` fetch and only the batching strategy changes.

### Phase 1 — Stop the bleeding

| Change | File |
|---|---|
| Widen `carrier_event_log.carrier_code` CHECK to include `darb_assabil` + `cosmos`; widen `source` to add `cron`, `reconcile`. **Until this lands, no Darb logging works at all.** | new migration `2026…_carrier_event_log_darb.sql` |
| Fix the ambiguous embed: `carriers!inner(...)` → `carriers!orders_carrier_id_fkey!inner(...)` (the Darb routes already use the correct form) | `src/lib/carriers/polling/poller.ts:192` |
| Add `maxDuration` for the Darb sync routes | `Ordra/vercel.json` |

### Phase 2 — Mirror the shipment, server-side

**New tables** (migration `2026…_darb_shipments.sql`):

- **`darb_shipments`** — one row per shipment, `UNIQUE(darb_id)`, FK → `orders(id)`, FK → `carriers(id)`.
  Columns for every field in the unlock table above: `handler_name`, `handler_phone`,
  `cancellation_cause`, `delayed_until`, `resend_count`, `completed_at`, `billed_shipping_amount`,
  `invoice_breakdown jsonb`, `delivery_withdrawal_at`, `to_branch_group`, `priority`, `notes`,
  `raw jsonb` (full payload, always — so a schema surprise is never lossy), `first_seen_at`,
  `last_synced_at`.
- **`darb_timeline_events`** — **append-only**, `UNIQUE(darb_id, event_id)`. Persists what is today
  re-fetched and thrown away on every panel open: `type`, `description_ar`, `description_en`,
  `remarks`, `actor_phone`, `attachments jsonb`, `occurred_at`. Enables delta detection
  ("did anything change since last poll?") and real dwell-time analytics.
- **`darb_conversation`** — append-only carrier comment thread, `UNIQUE(darb_id, message_id)`.

Follow the append-only doctrine already applied to `order_history` / `inventory_log`
(`Ordra/CLAUDE.md` → Critical rules).

**New code:**
- `src/lib/carriers/darb-assabil-tracking.ts` — add `fetchDarbShipmentPage(config, {status, negateStatus, offset, limit})`
  and `parseShipmentPage()`, alongside the existing pure parsers. Keep the module's rule: *never
  writes OMS state*.
- `src/lib/carriers/darb-assabil-shipment.ts` **(new)** — pure projection from a raw shipment object
  to the `darb_shipments` / timeline / conversation row shapes. Pure → fully unit-testable, per the
  TDD skill.
- `src/lib/carriers/darb-sync-cycle.ts` **(new)** — the one shared engine: page through the list,
  upsert mirrors, call the status RPC, write `carrier_event_log`. Modelled on the existing
  `darb-rate-harvest-cycle.ts` (planner + circuit breaker + run table).
- `darb_sync_runs` table mirroring `darb_rate_harvest_runs` — every run recorded with counts and
  outcome, so "did the sync work?" is answerable without reading logs.

**Rewire the three existing entry points to call the one engine:**
`api/darb-assabil/sync-market`, `api/darb-assabil/sync-batch`, `api/orders/[id]/darb-status`.

### Phase 3 — 24/7 cron

- New `src/app/api/cron/darb-sync/route.ts` + `handler.ts`, copying the `x-cron-secret`
  timing-safe auth from `src/app/api/cron/poll-carriers/handler.ts`.
- Migration adding `invoke_darb_sync()` + `cron.schedule('darb-sync-10min', '*/10 * * * *', …)`,
  following `20260906000002_pg_cron_meta_ads_sync.sql` exactly (vault `app_url` + `cron_secret`;
  **no** `crons` key in `vercel.json` — that breaks Hobby deploys).
- `maxDuration: 300` in `vercel.json`.
- Register `darb-rates-harvest` on a nightly schedule at the same time — it has a route and a
  `maxDuration` but has never been scheduled.

Keep the browser-triggered sweep as a "refresh now" affordance; the cron becomes the guarantee.

### Phase 4 — Reconcile every past order (the explicit ask)

`Ordra/scripts/reconcile-darb-shipments.ts` — the backfill that
`plans/darb-assabil-status-sync-fix.md` specified but never got written.

Sweep **all 862** Darb orders (not just non-terminal, not just one market), and for each resolve
through a ladder:
1. by stored `carrier_extra.darb_assabil_id`
2. → by `?reference=<tracking_number>`
3. → by `?search=<customer phone>` within the order's date range

Classify every order into an explicit outcome and write one `carrier_event_log` row per order
(`source='reconcile'`) so the result is auditable:

| Outcome | Meaning | Action |
|---|---|---|
| `matched` | found, slug agrees | refresh mirror |
| `drifted` | found, slug differs from ours | promote + history row |
| `re_referenced` | found under a different reference | repair `tracking_number` |
| `hard_deleted` | gone from Darb (DELETE is a hard delete, per guide §5.9) | flag for manual decision — **never** auto-cancel |
| `unresolvable` | no ladder step matched | surface in the UI for a human |

`--dry-run` first, printing the distribution, then `--apply`. This is what finally explains the 17.

### Phase 5 — Richer statuses and real control

**Status mapping.** Extend `promote_darb_status` (migration; keep it the *only* sanctioned path,
keep it idempotent, keep `order_history` append-only, keep zero stock/cost side-effects — Libya has
no warehouse):

| Darb slug | `orders.status` |
|---|---|
| `pending`, `booked` | `uploaded` *(unchanged)* |
| `processing` | `dispatched` |
| `on-branch`, `released`, `resent` | `in_transit` |
| `delayed` | *unchanged* + `delayed_until` on the mirror |
| `returning` | `to_be_returned` |
| `completed` / `returned` / `cancelled` | `delivered` / `returned` / `cancelled` *(unchanged)* |

These four enum values already exist and are already what `in-delivery` and
`warehouse/carrier-tracking` filter on — **so this fixes finding #6 for free**, without touching
those components. No trigger enforces order transitions (only `trg_orders_stamp_terminal` and
`trg_orders_updated_at`), so the RPC's direct UPDATE remains valid. Update the `TRANSITIONS` map in
`src/types/order-status.ts` to match, and re-run the existing suite for the Tunisia pipeline —
those statuses are shared and must not regress.

**Surfaces:**
- `DarbStatusSection.tsx` — read from the mirror (instant) instead of a live carrier call, and add
  driver name + phone, the comment thread, delay reason, cancellation cause, attempt counts.
  Follow `docs/design-system.md`; full RTL.
- New Darb panel on `/[locale]/in-delivery` — per-account (Tripoli vs Benghazi) funnel across the
  11 slugs, using the existing `carrier-account-mark.ts` colour ring to tell accounts apart.
- Alerts (`src/lib/alerts/catalogue.ts`): `darb_no_status` (uploaded, no slug > 24h),
  `darb_stuck_slug` (same slug > 4 days), `darb_delayed` (`delayed_until` passed), `darb_sync_stale`
  (no successful `darb_sync_runs` row in 1h). Key them on the mirror's `last_synced_at`, **not**
  `orders.updated_at` — that's what defeats `upload_stalled` today (finding #7).

---

## Files

**New:** `src/lib/carriers/darb-assabil-shipment.ts`, `src/lib/carriers/darb-sync-cycle.ts`,
`src/app/api/cron/darb-sync/{route,handler}.ts`,
`scripts/probe-darb-shipments-list.ts`, `scripts/reconcile-darb-shipments.ts`,
4 migrations (event-log CHECK, mirror tables + `darb_sync_runs`, `promote_darb_status` v2, pg_cron).

**Modified:** `src/lib/carriers/darb-assabil-tracking.ts`, `src/lib/carriers/polling/poller.ts`,
`src/app/api/darb-assabil/{sync-market,sync-batch}/route.ts`,
`src/app/api/orders/[id]/darb-status/route.ts`, `src/components/queue/DarbStatusSection.tsx`,
`src/types/order-status.ts`, `src/lib/alerts/catalogue.ts`, `vercel.json`,
`src/messages/{fr,ar}.json`.

**Reused, not rebuilt:** `buildConfig`/`decrypt` (`dispatch.ts`, `crypto.ts`), the pure parsers and
`normalizeDarbStatus` (`darb-assabil-tracking.ts`, `darb-assabil-statuses.ts`), `buckets.ts`,
`carrier-account-mark.ts`, `fetchAllRows` (`lib/supabase/fetch-all.ts`), the
`darb-rate-harvest-cycle.ts` run-table pattern, `poll-carriers/handler.ts` cron auth.

Per-file TDD (`Ordra/.claude/skills/test-driven-development`): failing test first for every pure
module — parsers, projection, status mapping, the reconcile ladder.

---

## Verification

1. **Phase 0** — probe output confirms list mode + `totalCount`, and dumps the real field set.
   Everything after this is written against observed shapes, not the schema.
2. `npm run test:run` green; `npm run typecheck` clean. *(Note: 31 test failures pre-date this
   work and lint is unconfigured — typecheck is the gate.)*
3. **Log constraint** — insert a `darb_assabil` row into `carrier_event_log` and confirm it lands
   (today it is silently rejected).
4. **Reconcile dry-run** — outcome distribution over all 862 orders; the 17 orphans must each land
   in a named bucket. Then `--apply`.
5. **Cron** — after one tick, `SELECT status_code, content FROM net._http_response ORDER BY created DESC`
   must show 200 (pg_cron reports `succeeded` even on HTTP 500 — always check the response table),
   and `darb_sync_runs` must have a row.
6. **Coverage** — `orders` with `carrier_status_slug IS NULL` and a non-terminal status → **0**,
   and no `last_synced_at` older than 1 hour.
7. **Data** — spot-check 5 orders against the Darb dashboard: driver name, phone, comments,
   cancellation cause must match.
8. **No regression** — Tunisia/Navex order counts per status unchanged before/after the
   `promote_darb_status` and `order-status.ts` changes.

---

## Open item (not blocking)

**"Dibio"** appears nowhere — not in the code, DB, git history across all 21 branches, or the wider
`XPAND` tree. I've scoped everything above to the Libya market and both Darb accounts, which holds
regardless. One line from you on what Dibio is (a brand we sell? a third Darb account? your name for
the Libya operation?) and I'll shape the filters and the in-delivery panel around it — the mirror
tables are designed so that's an additive change, not a rework.
