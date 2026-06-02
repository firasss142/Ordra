# Darb Assabil — Order status display (fermé tab + detail panel)

> Mirror the Dexpress fermé-tab status feature for the Darb Assabil carrier
> (Libya market), using Darb's **real status API** instead of Dexpress's
> HTML-scraping workaround. Read-only projection: NEVER writes `orders.status`.

## Decisions locked with the user

| Topic | Decision |
|---|---|
| Behavior model | **Read-only label**, like Dexpress. Caches a status slug + shows a bucket pill + live timeline. NEVER auto-advances `orders.status` (no stock/cost/revenue effects). Managers advance status manually, exactly as for Dexpress. |
| Refresh trigger | **On-demand, manual** — reuse the existing fermé-tab refresh button. NO cron. (Matches Dexpress: there is no auto-sync on launch/tab-open.) |
| Timeline language | **Arabic** (Libya market is RTL). Darb returns bilingual `{ en, ar }`; we read `ar`. |
| DB columns | **Generic** `carrier_status_slug` / `carrier_status_synced_at`, reusable by any future carrier. Dexpress keeps its own `dexpress_status_*` columns (no risky backfill). Darb writes the new generic columns. |
| Bucket model | The existing 5 fermé buckets **+ a new 6th `cancelled` bucket** (Darb-only for now). |

## Darb status → bucket mapping (confirmed)

Darb exposes 11 documented statuses (INTEGRATION_GUIDE §6). Mapping to fermé buckets:

| Darb status | → Bucket | Why |
|---|---|---|
| `pending`, `booked`, `processing` | **uploaded** | Handed to Darb, not yet moving. (User: "uploaded is the same thing as pending".) |
| `on-branch`, `released`, `resent`, `delayed`, `returning` | **deposit** | In motion inside Darb's network. (`returning` is still moving — guide maps it to in_transit.) |
| `completed` | **delivered** | Terminal success. |
| `returned` | **returned** | Terminal — goods came back. |
| `cancelled` | **cancelled** (NEW) | Post-dispatch carrier cancellation. User: its own distinct pill + chip. |
| *(no slug / never synced)* | **uploaded** | Uploaded to Darb but not yet refreshed. |
| OMS `status === "rejected"` | **rejected** | OMS-side agent rejection. Unchanged, carrier-irrelevant. |

No `order_accept` discriminator — that was a Dexpress portal quirk; Darb has no equivalent.

## API facts (from INTEGRATION_GUIDE.md + postman collection)

- **Timeline (polling) endpoint:** `GET /api/local/shipments/timeline/:reference`
  - `:reference` is the human `SH<digits>` code = our `orders.tracking_number`.
  - Returns `{ status: true, data: { _id, timeline: [ { type, description: {en,ar}, timestamp, ... } ] } }`.
  - **HTTP 200 ≠ success** — must check `body.status === true`.
  - Timeline is append-only, oldest-first.
- **Full shipment (has clean `status` field):** `GET /api/local/shipments/:id`
  - `:id` is the internal `_id` (our `carrier_extra.darb_assabil_id`).
  - Returns a **list shape**: `data.results[0]`.
- **The `status` field** is the 11-value enum we map above. The timeline endpoint
  does NOT directly return the top-level `status` enum — it returns events. So:
  - **Bucket slug** (what we cache) needs the top-level `status` → use the full
    shipment endpoint (`/:id`, needs `_id` from carrier_extra), OR derive from the
    latest timeline event. **Decision: use `GET /api/local/shipments/:id`** because
    it returns the authoritative `status` enum directly. `_id` is already persisted.
  - **Timeline display** (detail panel) → use `GET .../timeline/:reference`.
- Auth headers: `Authorization: apikey <key>`, `X-API-VERSION: 1.0.0`,
  `X-ACCOUNT-ID: <account_id>` (same `buildHeaders` as the adapter).

## File-by-file plan

### Layer 1 — Status fetching (new, Darb-specific) — TDD

1. **`src/lib/carriers/darb-assabil-statuses.ts`** + `.test.ts`
   - The 11-status taxonomy as a frozen list/set.
   - `DarbSlug` type = the 11 literal strings.
   - `mapDarbStatusToBucket(slug)` is NOT here (that lives in buckets.ts);
     this file just validates/normalizes the raw status string → `DarbSlug | null`.
   - Graceful degradation: unknown status string → `null` (logged at the boundary).

2. **`src/lib/carriers/darb-assabil-tracking.ts`** + `.test.ts`
   - `DarbStatusSnapshot` discriminated union: `{ kind: "ok", reference, slug, rawStatus } | { kind: "not_found", reference }`.
   - `parseShipmentStatus(reference, body)` — pure. Reads `data.results[0].status`,
     normalizes via the taxonomy. `body.status === false` or empty results → `not_found`.
   - `DarbTimeline` type + `parseTimeline(body)` — pure. Reads `data.timeline[]`,
     extracts `{ ar, type, timestamp }` per event. For the detail-panel timeline.
   - `fetchDarbStatus(reference, internalId, config)` — fetches `/:id` for the slug.
   - `fetchDarbTimeline(reference, config)` — fetches `/timeline/:reference`.
   - Thin fetch wrappers + 15s timeout, mirroring the adapter's `postJson`.

### Layer 2 — Bucket mapping (extend the existing generic function) — TDD

3. **`src/lib/carriers/dexpress/buckets.ts`** (rename concept, keep file or move)
   - Add `"cancelled"` to the `Bucket` union.
   - Make `bucketFor()` carrier-aware. New `BucketInput` fields (generic):
     `carrierStatusSlug` (replaces nothing — added alongside `dexpressStatusSlug`
     to avoid breaking Dexpress callers; or generalize — see note).
   - When `carrierCode === "darb_assabil"`: fold `carrierStatusSlug` per the table.
   - Dexpress branch unchanged. All existing buckets.test.ts cases stay green.
   - **Note on field naming:** I'll add the Darb mapping using a `carrierStatusSlug`
     input field and keep `dexpressStatusSlug` for the Dexpress branch, so no
     existing test changes. (Cleaner than renaming everything in one pass.)

### Layer 3 — Persistence (migration)

4. **`supabase/migrations/<ts>_orders_carrier_status_slug.sql`**
   - `ALTER TABLE orders ADD COLUMN carrier_status_slug TEXT, carrier_status_synced_at TIMESTAMPTZ;`
   - Partial index `(market_id, carrier_status_slug) WHERE carrier_status_slug IS NOT NULL`.
   - Comments: projection only, NEVER drives stock/cost/revenue.
   - Regenerate TS types if the project tracks them.

### Layer 4 — Sync endpoints (new, Darb-specific, mirror Dexpress) — TDD

5. **`src/app/api/darb-assabil/sync-batch/route.ts`** + `.test.ts`
   - `POST { orderIds[] }`, max 25, concurrency cap 3.
   - RLS-scoped read; `not_visible` / `not_darb` / `no_tracking` / `no_internal_id`
     per-order reasons. Needs both `tracking_number` and `carrier_extra.darb_assabil_id`.
   - Writes `carrier_status_slug` + `carrier_status_synced_at` only.
   - Fire-and-forget `carrier_event_log` for unknown statuses (`source: "tracking_view"`).

6. **`src/app/api/orders/[id]/darb-status/route.ts`** + `.test.ts`
   - `GET` single-order live **timeline** for the detail panel (Arabic events).
   - RLS-scoped; eligibility checks (carrier is darb_assabil, has tracking + _id).
   - Returns `{ kind: "ok", timeline[] } | { kind: "not_found" }`; 502 on fetch error.

### Layer 5 — UI — TDD for logic, design-system for visuals

7. **`src/types/queue.ts`** — add `carrier_status_slug`, `carrier_status_synced_at`
   to `QueueOrder`.

8. **`src/hooks/useAgentQueue.ts`** (+ the queue API route select) — add the two
   columns to the closed-orders select so the pill can read them without a fetch.

9. **`src/components/queue/QueueHeader.tsx`**
   - Add `"cancelled"` to `ClosedSubfilter`.
   - Add a `{ key: "cancelled", icon: Ban }` chip (lucide), with a tone.
   - fr/ar translations for the chip label.

10. **`src/components/queue/QueuePage.tsx`**
    - `bucketForClosed`: pass `carrierStatusSlug` from `o.carrier_status_slug`.
    - `closedCounts` / `matchesClosedSubfilter` already iterate buckets generically;
      just include `cancelled`.
    - Refresh handler: make it carrier-aware — refresh visible **Dexpress** orders
      via `/api/dexpress/sync-batch` AND visible **Darb** orders via
      `/api/darb-assabil/sync-batch`, then `mutate()`.

11. **`src/hooks/useDarbStatus.ts`** + `.test.tsx` — SWR hook for the detail-panel
    timeline (mirror `useDexpressStatus`).

12. **`src/components/queue/DarbStatusSection.tsx`** + **`DarbStatusTimeline.tsx`**
    - Mirror `DexpressStatusSection` / `DexpressStatusTimeline`, Arabic labels, RTL.
    - Wired into `OrderDetailPanel` gated on `carrier_code === "darb_assabil"`.

13. **`src/messages/fr.json` + `ar.json`** — `darbStatus.*` section + the `cancelled`
    chip label under `queue.buckets.closedSubfilter` (or wherever Dexpress chips live).

### Layer 6 — Verify

- `npm test` (all new + existing green), `npm run typecheck`, manual fermé-tab check.
- i18n-reviewer pass (no hardcoded strings, RTL correct).

## Open sub-decisions to confirm during build

- **a)** Slug source: use `GET /api/local/shipments/:id` (authoritative `status`
  enum) vs deriving from latest timeline event. Plan picks the `:id` endpoint
  because it returns the enum directly and `_id` is already stored. (Means
  sync-batch requires `carrier_extra.darb_assabil_id` — orders dispatched before
  _id capture get `no_internal_id` and stay in the `uploaded` bucket. Acceptable.)
- **b)** Refresh button: unify the existing Dexpress refresh button to refresh
  both carriers (plan's choice) vs a separate Darb button. Unify = one button,
  carrier-aware.
- **c)** Bucket file location: extend `src/lib/carriers/dexpress/buckets.ts` in
  place vs promote to `src/lib/carriers/buckets.ts` (carrier-neutral home). Plan
  leans toward **promoting** it since it's now multi-carrier, but that touches
  imports — will confirm to keep the diff tight.

## Already shipped (prerequisites done outside the main build)

- **Carrier logo** — `darb_assabil: "/darb-assabil-logo.png"` registered in
  `src/lib/carriers/carrier-logos.ts`. The asset (`public/darb-assabil-logo.png`)
  and carrier code already existed; only the map entry was missing, so the fermé
  card was falling back to a "DAR" text chip. Fixed + tested. Now the fermé tab
  (and every `getCarrierLogo` call site) shows the Darb brand logo.

## Hard invariants (do not violate)

- `carrier_status_slug` is a projection. It NEVER drives `orders.status`, stock,
  cost, revenue, or `order_history`. Same rule as `dexpress_status_slug`.
- HTTP 200 ≠ success for Darb — always check `body.status === true`.
- Cancel/delete (already shipped) and status-read share `buildHeaders` but are
  independent operations.
