# Dexpress current-status display on order panel

## Goal

Surface the **current Dexpress-side status** of an order inside the OMS order detail panel, so any user opening a Dexpress order that has been pushed to the carrier can see at a glance where it is in the Dexpress lifecycle (in company, sent to courier, out for delivery, delivered, returning, etc.) without leaving the OMS.

Read-only. Display-only. Does not change order status, fulfillment transitions, stock, or any OMS state.

## Why this is feasible (and small)

A complete reverse-engineering effort has already produced two endpoints, a 19-status taxonomy, parsing code, fixture-based tests, and an engineering briefing. The OMS already has the Dexpress session client, cookie management, 302→login retry, and CSRF infrastructure that the new endpoints will piggy-back on. There is no new auth machinery, no new cron, no migration, and no fulfillment plumbing required.

The reverse-engineering docs are:
- [`delivery_company_docs/Dexpress/tracking/dexpress-tracking.md`](../delivery_company_docs/Dexpress/tracking/dexpress-tracking.md) — endpoint reference + module API
- [`delivery_company_docs/Dexpress/tracking/dexpress-tracking-briefing.md`](../delivery_company_docs/Dexpress/tracking/dexpress-tracking-briefing.md) — full engineering context, discovery story, taxonomy table

## Empirical findings (2026-05-25 probes)

Before writing a line of feature code we ran five probes against the live Dexpress portal — three normal lookups, one bad-ID lookup, one rate-burst, and two HTML page captures. The scripts live under [`scripts/probe-dexpress-*.ts`](../scripts/). Findings (and how they change this plan vs. the original draft):

| Probe | Tracking | Result | Implication for plan |
|---|---|---|---|
| ajax-order-case (in company) | `1343188` | `{response_case:201, order_status:"3", order_accept:"1", status_name:"فى الشركة"}` | Body is a **plain JSON object** (not a JSON-encoded string). One `JSON.parse` is enough. |
| ajax-order-case (delivered) | `1339630` | `{response_case:201, order_status:"10", order_accept:"1", status_name:"تم التسليم"}` | `order_status` numeric ID always present + stable across statuses → use as primary lookup. |
| ajax-order-case (out for delivery) | `1341657` | `{response_case:201, order_status:"7", order_accept:"1", status_name:"جارى التوصيل"}` | Confirms 3 of the 7 briefing-confirmed labels exactly (`IN_COMPANY`, `DELIVERED`, `OUT_FOR_DELIVERY`). |
| ajax-order-case (bad ID) | `99999999` | `{response_case:404}` — **no `status_name`, no `order_status`** | Dexpress has a clean not-found signal. Surface as HTTP 404 from our route, distinct from network/server errors. |
| Rate burst (10× sequential) | `1343188` | 10/10 200 OK, avg 587ms, p95 783ms, no `Retry-After`/`X-RateLimit-*` headers | No throttling at panel-open volumes. SWR 60s dedupe is comfortably within tolerance. |
| track-order HTML | `1339630`, `1341657` | 200 OK, ~295KB each, all 7 briefing structural claims hold (header pattern, `.timeline-item`, `fa-calendar`, sidebar, portlet container), 9 + 7 timeline items respectively | Briefing's HTML structure claims still hold. Fixtures saved under `delivery_company_docs/Dexpress/tracking/fixtures/`. Unblocks future timeline feature, not v1. |

The probes invalidated three things the briefing inferred but never confirmed, and revealed one field the briefing missed:

1. **Body is not a JSON-encoded string** — it's a plain JSON object. Portal JS doing `JSON.parse(result)` was misleading (probably defensive coding or older behavior). Single `JSON.parse(text)` works; no double-parse needed.
2. **Real response shape includes a 4th key, `order_status`** — the numeric status ID, as a string. The briefing said the response is `{ response_case, status_name, order_accept }`. The real response is `{ response_case, order_status, order_accept, status_name }`. This is a meaningful win: ID-based lookup is robust against Arabic-label variations.
3. **`order_accept` is a string `"1"`, not a number `1`** — briefing example `=== 0` would never match. Use `Number(order_accept) === 1` if reading it.
4. **Not-found returns `{response_case: 404}` with no other fields** — well-behaved, lets us distinguish "Dexpress doesn't know this order" from "Dexpress is down".

The probes also confirmed three things the briefing claimed but hadn't proven:

- `response_case === 201` is the success convention.
- The 7 confirmed taxonomy labels (`IN_COMPANY`, `OUT_FOR_DELIVERY`, `DELIVERED` validated directly; others inferred from same pattern) are stable.
- The `/merchant/track-order/{id}` HTML structure (timeline portlets, status header, icon-based disambiguation) is intact.

Effect on this plan: see "Files to create → tracking.ts" and "Failure handling" below — both rewritten in light of these findings.

## Out of scope (deliberately deferred)

The reverse-engineering work produced enough material to build a much larger feature. This plan intentionally builds the smallest useful slice:

- **No background polling.** No cron entry, no addition to `runPollCycle()`, no Dexpress branch in `src/lib/carriers/polling/poller.ts`. Status is fetched **only** when a user opens the order panel.
- **No auto-advance of OMS fulfillment statuses.** `applyFulfillmentTransition()` is not called. OMS status remains driven by warehouse scans, manager actions, and Navex (the Tunisia carrier already wired into polling). Dexpress remains a manual-update carrier from the OMS-status perspective.
- **No timeline.** Only the **current** status is shown — one line. The richer `track-order/{id}` HTML page is not fetched.
- **No courier name/phone.** That data lives in timeline events; we are not parsing timeline events.
- **No sidebar-badge harvesting, no `all-orders/{statusId}` list pages, no Dexpress reports.** All future work.
- **No DB schema changes.** Status is fetched live each time the panel opens; nothing persisted on the order row.

These are explicit roadmap items, not regressions. Once the on-demand status display is in production and we have unknown-label observability, expanding to timeline + polling becomes incremental.

## Visibility rule

Section renders **only** when both conditions hold on the order being displayed:

1. `carrier.code === "dexpress"`
2. `tracking_number` is non-empty

This single rule covers everywhere the user expects to see it and naturally excludes everywhere they don't:

| Where | Status examples | Shown? |
|---|---|---|
| Agent queue, Closed tab → `uploaded` sub-filter | `uploaded` | ✅ |
| Agent queue, Closed tab → `dispatched` sub-filter | `dispatched` | ✅ |
| Agent queue, Closed tab → `rejected` sub-filter | `rejected` (no tracking number) | ❌ |
| Agent queue, other tabs | `pending`, `attempt_*`, `confirmed` | ❌ |
| Manager orders page | `uploaded`, `dispatched`, `deposit`, `in_transit`, `unverified`, `to_be_returned` | ✅ |
| Archive page | `delivered`, `returned` | ✅ |
| Any Navex (Tunisia) order, any status | — | ❌ |

The rule is enforced once, inside `OrderDetailPanel`. The same panel is rendered by [`src/components/queue/QueuePage.tsx`](../src/components/queue/QueuePage.tsx), [`src/app/[locale]/(dashboard)/orders/OrdersPageClient.tsx`](../src/app/[locale]/(dashboard)/orders/OrdersPageClient.tsx), and the archive page — so all three surfaces inherit the behavior with zero per-page wiring.

## Display rules (per role)

The Dexpress portal labels are in Arabic. Display format depends on viewer role:

| Viewer | Format | Example |
|---|---|---|
| Agent (Libya market, Arabic-native) | Raw Arabic label only | `جارى التوصيل` |
| Market manager / super_admin | `ENGLISH_SLUG (raw Arabic)` | `OUT_FOR_DELIVERY (جارى التوصيل)` |
| Any viewer, unknown label (taxonomy returned `null`) | Raw Arabic only + subtle "unrecognized" hint visible to manager/admin | `(unrecognized) النص الخام` |

Slugs are the canonical SCREAMING_SNAKE_CASE identifiers defined in the taxonomy (`AT_CUSTOMER`, `IN_COMPANY`, `SENT_TO_COURIER`, `DELIVERED`, etc.). They are intentionally not translated into French — they are the universal short reference, not user-facing prose.

## Fetch behavior

- Auto-fires the moment the panel mounts an eligible order.
- Uses the **lightweight** endpoint only: `GET /merchant/ajax-order-case/{tracking_number}`. Returns a JSON string `{ response_case, status_name, order_accept }`. The HTML `track-order/{id}` page is **not** called.
- SWR-cached per `order.id`. Dedupe window: 60s. Revalidate-on-focus disabled (the panel is the only consumer).
- Manual refresh affordance: a small icon next to the status line. Forces an SWR revalidation. Justified at ~3 lines of code because real users wait minutes for status changes and reopening the panel for that is bad UX.

## Failure handling

Four failure modes, all handled inline inside the section without affecting the rest of the panel:

| Failure | UX | Distinguished from others how |
|---|---|---|
| Network error / Dexpress 5xx / timeout | Inline error `Couldn't load tracking. Retry?` + retry button | Route returns HTTP 502 |
| Session unrecoverable (302→login twice) | Same as above. Underlying `DexpressClient.requestWithRetry` already attempts one re-login; we surface its final throw as the same inline error | Route returns HTTP 502 |
| **Dexpress does not recognize tracking number** (`response_case === 404`) | Distinct message: `Carrier doesn't recognize this tracking number — may have been deleted on their side`. No retry button (retry would always fail). | Route returns HTTP 404, hook surfaces `kind: "not_found"` |
| `response_case` is neither `201` nor `404` (unexpected response shape) | Same as the generic "Couldn't load" error | Route returns HTTP 502 |

The `response_case === 404` branch is a real, empirically-confirmed Dexpress signal (see Empirical Findings) — not a synthetic mapping. The not-found state is permanent for that tracking number, so we explicitly hide the retry affordance in that case. This also doubles as a useful diagnostic for the `delete_carrier_barcode` flow: if the OMS thinks an order is `uploaded` but Dexpress returns 404, it likely means the deletion succeeded on the carrier side but our local rollback was missed.

No global toast, no error boundary, no panel-wide blocking spinner. The order panel must remain usable when Dexpress is down or rate-limiting.

## Unknown-label observability

When `statusName` is non-empty but the taxonomy returns `statusId: null` / `slug: null`, the route writes a row to `carrier_event_log`:

```
carrier_code: 'dexpress'
source:       'tracking_view'   ← new source value, requires a CHECK constraint update
tracking_number: <the order's tracking number>
order_id:     <the order id>
carrier_status_raw: <the raw Arabic statusName>
outcome:      'ignored'
outcome_reason: 'unknown_dexpress_label'
raw_body:     { response_case, status_name, order_accept }
```

This closes the feedback loop on the 12 unconfirmed timeline labels in the taxonomy (per the engineering briefing). Each ignored row is a candidate confirmation. Review periodically; promote confirmed labels into `dexpress-statuses.ts` and remove the *(unconfirmed)* annotation.

## 1. Files to create

### `src/lib/carriers/dexpress/statuses.ts`

The 19-status taxonomy. One source of truth for ID + slug + Arabic timeline label + Arabic sidebar label. Exposes:

```ts
export interface DexpressStatusEntry {
  id: number;
  slug: DexpressSlug;
  timelineLabel: string;  // Arabic, terse vocabulary
  sidebarLabel: string;   // Arabic, "طلبات …" prefixed vocabulary
  confirmed: boolean;     // false for the 12 unconfirmed labels
}

export type DexpressSlug =
  | "AT_CUSTOMER"
  | "BEING_PREPARED"
  | "IN_COMPANY"
  | "WILL_BE_SENT_TO_BRANCHES"
  | "EN_ROUTE_TO_BRANCHES"
  | "ARRIVED_AT_BRANCHES"
  | "OUT_FOR_DELIVERY"
  | "DELIVERY_POSTPONED"
  | "POSTPONED_WITH_COURIER"
  | "DELIVERED"
  | "PARTIALLY_DELIVERED"
  | "REPLACED"
  | "RECEIPT_REFUSED"
  | "RETURNING_VIA_COURIER"
  | "RETURNING_AT_BRANCHES"
  | "RETURNING_TO_COMPANY"
  | "RETURNED_AT_COMPANY"
  | "AWAITING_COURIER_SETTLEMENT"
  | "SENT_TO_COURIER";

export const DEXPRESS_STATUSES: readonly DexpressStatusEntry[] = [ … ];

export function normalizeArabic(label: string): string;
// strips tatweel (ـ), collapses whitespace, trims

export function findStatusById(id: number): DexpressStatusEntry | null;
// PRIMARY lookup path for ajax-order-case responses (which include numeric ID).
// Returns null only on truly unknown IDs (e.g. Dexpress invents a new one).

export function findStatusByLabel(rawLabel: string): DexpressStatusEntry | null;
// FALLBACK lookup, used by:
//   1. parseAjaxOrderCase if order_status is missing/unparseable (defensive)
//   2. future track-order HTML parser (timeline labels expose label, not ID)
// accepts EITHER timeline or sidebar vocabulary; returns null on unknown
```

Source data is the table in `dexpress-tracking.md`. All 19 entries, mapping `id → slug → timelineLabel → sidebarLabel`. The unconfirmed ones are flagged with `confirmed: false` but still searchable — graceful degradation per the briefing is non-negotiable.

### `src/lib/carriers/dexpress/tracking.ts`

One exported function plus a pure helper. The snapshot is a **discriminated union** to make the `not_found` branch a first-class state, not an error:

```ts
export type DexpressStatusSnapshot =
  | {
      kind: "ok";
      trackingNumber: string;
      slug: DexpressSlug | null;       // null only if order_status is an ID we don't have in the taxonomy
      statusId: number | null;         // numeric ID from response, parsed
      rawLabel: string;                // verbatim status_name; always present
      isAccepted: boolean;             // order_accept === "1"
    }
  | {
      kind: "not_found";
      trackingNumber: string;          // Dexpress returned response_case === 404
    };

export async function fetchDexpressStatus(
  trackingNumber: string,
  client: DexpressClient
): Promise<DexpressStatusSnapshot>;

// pure for tests: takes the raw response text, returns parsed snapshot
export function parseAjaxOrderCase(
  trackingNumber: string,
  responseText: string
): DexpressStatusSnapshot;
```

Implementation notes:

- Uses the existing [`DexpressClient`](../src/lib/carriers/dexpress/client.ts) — does **not** create a new fetch path. `client.getMerchantPage('/merchant/ajax-order-case/{id}')` is wrong (it expects HTML); add a small `getJsonEndpoint(path, extraHeaders)` method to `DexpressClient` that mirrors `getMerchantPage` but sets `X-Requested-With: XMLHttpRequest` and `Accept: application/json, text/plain, */*` per the briefing, and returns the response body as text.
- Response body is a **plain JSON object** (confirmed by probe, despite the briefing's prior assumption). Parse with `JSON.parse(text)` after the network read. Do **not** trust `response.json()` — Dexpress sets `Content-Type: text/html; charset=UTF-8` on this endpoint despite returning JSON, so `response.json()` would error.
- Parsing order:
  1. `response_case === 404` → return `{ kind: "not_found", trackingNumber }`.
  2. `response_case === 201` → resolve slug via `findStatusById(Number(parsed.order_status))` (primary); fall back to `findStatusByLabel(parsed.status_name)` if `order_status` is missing/unparseable; return `{ kind: "ok", ... }` with `slug: null` only if both lookups fail.
  3. Anything else → throw `CarrierDispatchError("DEXPRESS_TRACKING_UNEXPECTED_RESPONSE_CASE")`. The route catches and converts to a 502 inline error.
- `parsed.order_accept === "1"` → `isAccepted: true`. The field is a string in JSON; do NOT compare `=== 1`.
- Pass `rawLabel` through `normalizeArabic` before label-fallback lookup. Always preserve the original (pre-normalization) `rawLabel` in the snapshot — that's what we log on unknowns and what we display.

### `src/app/api/orders/[id]/dexpress-status/route.ts`

Thin Next.js route handler. Responsibilities, in order:

1. **Authenticate** via the user's Supabase client (NOT admin client) so RLS enforces market isolation. An agent in Tunisia must not be able to fetch tracking for a Libyan order id even if guessing succeeds.
2. **Load order** by id, selecting `id, tracking_number, carriers!inner(code)`. RLS filters to the user's market automatically.
3. **Validate eligibility**: 404 if no row, 400 if `carriers.code !== 'dexpress'` or `tracking_number` is empty.
4. **Resolve carrier config**: load the matching `carriers` row's `api_endpoint` and `api_credentials` (admin client OK at this point — already established market match).
5. **Instantiate `DexpressClient`** with that config and call `fetchDexpressStatus(trackingNumber, client)`.
6. **Branch on snapshot kind**:
   - `kind: "not_found"` → return HTTP **404** with `{ kind: "not_found", trackingNumber }`. No log row (this is a clean Dexpress signal, not a parsing miss).
   - `kind: "ok"` with `slug === null && rawLabel.length > 0` → log to `carrier_event_log` (admin client, fire-and-forget — log failure must not break the response). With ID-based lookup, this branch fires only on a status ID we haven't seen — rare but possible.
   - `kind: "ok"` with `slug !== null` → no log row.
7. **Return JSON**:
   - On `kind: "ok"`: HTTP 200, body `{ kind: "ok", slug, statusId, rawLabel, isAccepted }`.
   - On `kind: "not_found"`: HTTP 404, body `{ kind: "not_found", trackingNumber }`.
   - On thrown `CarrierDispatchError` or other failure: HTTP 502, body `{ error: <code>, message: <human> }`.

Response is small enough to set `Cache-Control: private, max-age=30` so a quick reopen doesn't re-hit Dexpress. SWR's own dedupe handles same-tab repeats; the header guards multi-tab + reload.

Latency budget: probes measured ~600ms typical, ~800ms p95 against Dexpress directly. Route overhead (auth + RLS query + admin client) adds maybe ~50–100ms. **Plan for a ~1s loading state** in the section.

### `src/hooks/useDexpressStatus.ts`

```ts
export function useDexpressStatus(
  orderId: string,
  enabled: boolean
): {
  snapshot: DexpressStatusSnapshot | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
};
```

- `enabled` is the gate: callers pass `carrier.code === 'dexpress' && Boolean(tracking_number)`.
- Returns `null` snapshot + no fetch when `!enabled` (SWR conditional fetch via a `null` key).
- `refresh()` calls `mutate(key)` to force revalidation.

### `src/components/queue/DexpressStatusSection.tsx`

New component, ~80 lines including i18n + states. Renders one of:

- **Loading**: a small skeleton — one line height, subdued background. Budget ~1s.
- **Loaded ok, known status, agent role**: `<Arabic label>` in a status pill, big-ish.
- **Loaded ok, known status, manager/super_admin role**: `SLUG (Arabic label)`.
- **Loaded ok, unknown status ID** (taxonomy miss): `<raw Arabic>` + a subdued "unrecognized" chip visible only to manager/super_admin.
- **Not-found** (`response_case === 404` from Dexpress): distinct message `Tracking number not recognized by carrier — may have been deleted on their side`. **No retry button** — retry would always fail.
- **Error** (network / 5xx / unexpected response): `Couldn't load tracking` + a Retry button.

Reads viewer role from the existing auth context (the panel already knows the user's role; pass it as a prop).

Section placement inside [`src/components/queue/OrderDetailPanel.tsx`](../src/components/queue/OrderDetailPanel.tsx): immediately **below** the existing `TrackingBarcode` (around line 842) and **above** the customer summary block. That puts the OMS-side identifier (barcode) and the carrier-side state (Dexpress status) next to each other in the same logical zone of the panel.

### `src/messages/fr.json` and `src/messages/ar.json`

New i18n namespace `dexpressStatus`:

- `dexpressStatus.sectionTitle` — "Carrier status" / "حالة الشحن"
- `dexpressStatus.loadError` — "Couldn't load Dexpress status" / "تعذر تحميل حالة دكسبرس"
- `dexpressStatus.retry` — "Retry" / "إعادة المحاولة"
- `dexpressStatus.unrecognized` — "Unrecognized status" / "حالة غير معروفة"
- `dexpressStatus.notFound` — "Tracking number not recognized by carrier" / "رقم التتبع غير معروف لدى الشركة"
- `dexpressStatus.lastFetched` — "Updated {time}" / "آخر تحديث {time}"

Slug-to-English-label dictionary lives in code (not i18n) — slugs are stable identifiers, not translatable copy.

## 2. Files to modify

### `src/lib/carriers/dexpress/client.ts`

Add **one** new method to `DexpressClient` to call JSON/AJAX endpoints (vs the existing `getMerchantPage` which is HTML-oriented). The signature:

```ts
async getJsonEndpoint(path: string): Promise<{ status: number; bodyText: string }>;
```

Uses the same `requestWithRetry` plumbing, same session cookie, same logout-detection. Sets `X-Requested-With: XMLHttpRequest` and `Accept: application/json, text/plain, */*` headers per the briefing. Returns raw body text — parsing is the caller's responsibility (since the body is a JSON-encoded string, not a JSON object).

### `supabase/migrations/<new>.sql`

One small migration: extend the `carrier_event_log.source` CHECK constraint to allow `'tracking_view'`. Mirrors the pattern already used in `20260620000001_carrier_barcode_deletion.sql` for `'barcode_deletion'`. No other DB changes.

```sql
ALTER TABLE carrier_event_log
  DROP CONSTRAINT IF EXISTS carrier_event_log_source_check;
ALTER TABLE carrier_event_log
  ADD CONSTRAINT carrier_event_log_source_check
    CHECK (source IN ('poll', 'webhook', 'barcode_deletion', 'tracking_view'));
```

### `src/components/queue/OrderDetailPanel.tsx`

Inject `<DexpressStatusSection orderId={order.id} role={user.role} enabled={eligible} />` between the existing tracking-barcode block and the customer-summary block. The `eligible` boolean is computed locally:

```ts
const dexpressEligible =
  order.carriers?.code === "dexpress" &&
  Boolean(order.tracking_number);
```

No other panel logic changes.

## 3. TDD order — what to build, and in what sequence

Per project rules: failing test first, watch it fail, minimum code to pass, refactor. Each step lands as a green test before moving to the next.

### Step 1 — Taxonomy + label normalization (pure, no I/O)
1. `src/lib/carriers/dexpress/__tests__/statuses.test.ts`
   - `normalizeArabic` strips tatweel and collapses whitespace
   - `findStatusById(3)` returns the `IN_COMPANY` entry (primary lookup path used by ajax-order-case)
   - `findStatusById(7)` returns `OUT_FOR_DELIVERY`
   - `findStatusById(10)` returns `DELIVERED`
   - `findStatusById(9999)` returns `null` (unknown ID)
   - `findStatusByLabel` matches all 7 confirmed timeline labels
   - `findStatusByLabel` matches sidebar vocabulary too (`طلبات في الشركة` → `IN_COMPANY`)
   - `findStatusByLabel` matches with surrounding whitespace + tatweel padding
   - `findStatusByLabel` returns `null` for an obviously-wrong string
   - Every entry has unique `id` and unique `slug`
2. `src/lib/carriers/dexpress/statuses.ts` — implement.

### Step 2 — Pure ajax-order-case parser
1. `src/lib/carriers/dexpress/__tests__/tracking.test.ts` — fixtures use **real probe captures** (2026-05-25):
   - **In-company** body `'{"response_case":201,"order_status":"3","order_accept":"1","status_name":"فى الشركة"}'` → `{ kind: "ok", slug: "IN_COMPANY", statusId: 3, rawLabel: "فى الشركة", isAccepted: true }`
   - **Delivered** body `'{"response_case":201,"order_status":"10","order_accept":"1","status_name":"تم التسليم"}'` → `{ kind: "ok", slug: "DELIVERED", statusId: 10, ... }`
   - **Out-for-delivery** body `'{"response_case":201,"order_status":"7","order_accept":"1","status_name":"جارى التوصيل"}'` → `{ kind: "ok", slug: "OUT_FOR_DELIVERY", statusId: 7, ... }`
   - **Not-found** body `'{"response_case":404}'` → `{ kind: "not_found", trackingNumber: <passed> }` — does **NOT** throw
   - **Unknown status ID** body `'{"response_case":201,"order_status":"9999","order_accept":"1","status_name":"???"}'` → `{ kind: "ok", slug: null, statusId: 9999, rawLabel: "???", isAccepted: true }`
   - **`order_accept` is a string** — `"1"` → `isAccepted: true`; `"0"` → `false`
   - **Throws on `response_case` other than 201/404** (e.g. 500)
   - **Throws on malformed JSON body**
2. `src/lib/carriers/dexpress/tracking.ts` — implement `parseAjaxOrderCase` first, then the I/O wrapper `fetchDexpressStatus`.

### Step 3 — `DexpressClient.getJsonEndpoint`
1. `src/lib/carriers/dexpress/__tests__/client-json-endpoint.test.ts`
   - Sends `X-Requested-With: XMLHttpRequest` and the right `Accept` header
   - Returns body as text (no JSON.parse inside the client)
   - 302→login triggers re-login + retry via existing `requestWithRetry`
   - Two consecutive logouts throw `DEXPRESS_SESSION_UNRECOVERABLE`
2. `src/lib/carriers/dexpress/client.ts` — add the method.

### Step 4 — Route handler with market-isolation auth
1. `src/app/api/orders/[id]/dexpress-status/__tests__/route.test.ts`
   - 401 when no user session
   - 404 when order does not exist for the user's market (RLS) — note: same HTTP code as "Dexpress not-found" but distinguished by body shape (`{ error }` vs `{ kind: "not_found" }`)
   - 400 when carrier is not Dexpress
   - 400 when `tracking_number` is empty
   - 200 with `{ kind: "ok", ... }` snapshot JSON on the happy path
   - **404 with `{ kind: "not_found", trackingNumber }`** when `fetchDexpressStatus` returns `kind: "not_found"` (Dexpress `response_case === 404`)
   - 502 on `fetchDexpressStatus` throw, with `{ error, message }`
   - Writes a `carrier_event_log` row with `source='tracking_view'`, `outcome='ignored'`, `outcome_reason='unknown_dexpress_status_id'` when `kind: "ok"` but `slug === null`
   - Does **not** write a log row on known statuses
   - Does **not** write a log row on `kind: "not_found"` (clean signal, not a parsing miss)
2. `src/app/api/orders/[id]/dexpress-status/route.ts` — implement.

### Step 5 — SWR hook
1. `src/hooks/__tests__/useDexpressStatus.test.ts`
   - `enabled: false` → no fetch, snapshot stays null
   - `enabled: true` → fetches, returns snapshot
   - `refresh()` triggers a revalidation
   - Error state propagates
2. `src/hooks/useDexpressStatus.ts` — implement.

### Step 6 — Component
1. `src/components/queue/__tests__/DexpressStatusSection.test.tsx`
   - Renders nothing when `enabled` is false
   - Renders skeleton while loading
   - Agent role renders raw Arabic only
   - Manager role renders `SLUG (Arabic)`
   - Unknown status ID renders raw Arabic + "Unrecognized" chip for managers, no chip for agents
   - **Not-found state** renders the `dexpressStatus.notFound` message and **no retry button**
   - Error state renders the retry button; clicking it calls `refresh`
   - i18n strings come from the `dexpressStatus` namespace (assert with `useTranslations` mock)
2. `src/components/queue/DexpressStatusSection.tsx` — implement.

### Step 7 — Panel integration
1. `src/components/queue/__tests__/OrderDetailPanel.test.tsx` — add cases:
   - Section is mounted for a Dexpress order with `tracking_number`
   - Section is **not** mounted for a Dexpress order without `tracking_number` (e.g. `rejected`)
   - Section is **not** mounted for a Navex order regardless of tracking
2. `src/components/queue/OrderDetailPanel.tsx` — add the eligibility check + render the section in the right slot.

### Step 8 — Migration + i18n
1. Run the new migration locally; verify the CHECK constraint accepts `'tracking_view'`.
2. Add the new i18n keys to both `fr.json` and `ar.json`. Verify with `npm run typecheck` and `npm test`.

### Step 9 — Manual verification (per CLAUDE.md "test UI in browser")
1. `npm run dev`, log in as a Libya agent, open a recently-uploaded Dexpress order from the Closed tab → assert the Arabic status appears.
2. Switch to `manager.ly@oms.local` → assert the slug + Arabic appears, and that opening the same order is instant (SWR cache).
3. Network-throttle to "Offline" in DevTools and click refresh → assert inline error appears with retry button. Bring network back, click retry → assert recovery.
4. Find or contrive an order whose Dexpress status maps to an unconfirmed label → assert `carrier_event_log` gets a `source='tracking_view'`, `outcome='ignored'` row. Manually verify the raw Arabic label is in `carrier_status_raw`.

## 4. Risks and how the design absorbs them

### Dexpress changes the response shape

Brittleness inherited from the entire integration. The pure `parseAjaxOrderCase` will throw on `response_case !== 201` or malformed JSON; the route converts to a 502; the section renders the inline error. The OMS keeps working. The fixture-backed test in step 2 is the canary.

### Dexpress adds rate limiting

Per-panel-open fetching is naturally low-volume (a user opens at most a few panels per minute). SWR dedupe + 30s HTTP cache further reduce. If we ever see 429s, the route can degrade to "show last known status" — but that requires DB persistence which is out of scope for v1.

### A new status label appears that we haven't mapped

Already handled by graceful degradation: snapshot's `slug` is `null`, the section renders the raw Arabic, the event log captures the raw label for offline review. No user-visible failure.

### Performance regression on panel open

Single round-trip to Dexpress, ~1–2s typical, SWR-cached after. Skeleton during loading prevents layout shift. Section is a sibling of other panel content, not blocking it. Worst case: the section shows the error state while the rest of the panel is fully usable.

### Session contention with create/delete flows

The same `DexpressClient` instance type backs all three operations. The existing session cache is per-carrier, not per-operation. Reads do not invalidate writes, and the 302→login retry is idempotent for GET. The briefing's "Don't open new sessions for read operations" rule is honored — we reuse `DexpressClient`.

## 5. Acceptance criteria

A reviewer can verify the feature is done by:

1. Opening a `uploaded` or `dispatched` Dexpress order in the agent's Closed tab as a Libya agent. Expect to see the Arabic status under the barcode within ~2s.
2. Opening the same order as `manager.ly@oms.local` (manager). Expect to see `SLUG (Arabic)`.
3. Opening a Dexpress order in `delivered` status from the archive page. Expect the section to render with `DELIVERED (تم التسليم)` (or similar terminal label).
4. Opening a Navex order, any status — section is absent.
5. Opening a Dexpress order with no tracking number (e.g. `rejected`) — section is absent.
6. With Dexpress unreachable (network blocked), opening an eligible order — section renders the inline error + retry. Order panel remains otherwise usable.
7. Forcing an unknown status ID (point the order at a fake Dexpress response, or use a fixture-driven test environment) — section renders the raw Arabic, manager view shows the "Unrecognized" chip, a row is written to `carrier_event_log` with `source='tracking_view'`, `outcome_reason='unknown_dexpress_status_id'`.
8. **Forcing a not-found** — use a tracking number that Dexpress doesn't recognize (e.g. temporarily edit `orders.tracking_number` to `99999999` on a Dexpress order in a dev environment). Section renders the `dexpressStatus.notFound` message with no retry button. **No** `carrier_event_log` row is written.
9. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass.

## 6. Future work this unlocks

In rough priority order, with each item depending only on what's been built above:

1. **Full timeline on demand**. Add a "View carrier history" button next to the status line; clicking it fetches `/merchant/track-order/{tracking}` once, parses with the existing `parseTrackingHtml` (also to be ported), and renders the timeline + courier name/phone. No new auth, no new gating rule.
2. **Background polling**. Add Dexpress to `runPollCycle`, mirroring Navex. Decide mapping per the table sketched in the discussion. Requires `mapDexpressStatus()` in `status-map.ts` and a Dexpress branch in the poller. Returns get the `to_be_returned` safety-net mapping (warehouse scan required for stock), not direct `returned`.
3. **Sidebar badge harvesting**. Every authenticated Dexpress response carries the full sidebar with status counts; a `parseSidebarBadges()` function applied to the response we already fetch gives a "Dexpress at-a-glance" widget for free.
4. **List endpoints**. `/merchant/all-orders/{statusId}` for bulk reconciliation between OMS and Dexpress (find orders we think are `in_transit` that Dexpress already marks `RETURNED_AT_COMPANY`, etc.). Bigger lift, bigger payoff.
5. **Reports**. `/merchant/summary-statement` etc. for analytics.

Each of these is independent of v1. v1 establishes the on-demand session-backed read pattern, the taxonomy, and the observability hook. The rest is filling in the surface area.

## 7. File index

New:
- `src/lib/carriers/dexpress/statuses.ts`
- `src/lib/carriers/dexpress/tracking.ts`
- `src/lib/carriers/dexpress/__tests__/statuses.test.ts`
- `src/lib/carriers/dexpress/__tests__/tracking.test.ts`
- `src/lib/carriers/dexpress/__tests__/client-json-endpoint.test.ts`
- `src/app/api/orders/[id]/dexpress-status/route.ts`
- `src/app/api/orders/[id]/dexpress-status/__tests__/route.test.ts`
- `src/hooks/useDexpressStatus.ts`
- `src/hooks/__tests__/useDexpressStatus.test.ts`
- `src/components/queue/DexpressStatusSection.tsx`
- `src/components/queue/__tests__/DexpressStatusSection.test.tsx`
- `supabase/migrations/<timestamp>_carrier_event_log_tracking_view.sql`

Modified:
- `src/lib/carriers/dexpress/client.ts` — add `getJsonEndpoint()`
- `src/components/queue/OrderDetailPanel.tsx` — render the new section conditionally
- `src/components/queue/__tests__/OrderDetailPanel.test.tsx` — assert eligibility gating
- `src/messages/fr.json` — add `dexpressStatus` namespace
- `src/messages/ar.json` — add `dexpressStatus` namespace

Reference (no changes):
- `delivery_company_docs/Dexpress/tracking/dexpress-tracking.md`
- `delivery_company_docs/Dexpress/tracking/dexpress-tracking-briefing.md`
- `src/lib/carriers/dexpress/client.ts` — session helper consumed via new method
- `src/lib/carriers/polling/poller.ts` — explicitly **not** touched in v1
- `src/lib/carriers/polling/status-map.ts` — explicitly **not** touched in v1
