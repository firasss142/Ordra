# Status-History Hover Popover (orders table status badge)

## Context

Managers and super_admins scanning the orders table can only see an order's
*current* status. To understand how an order got there they must open the full
detail panel. The screenshot the user shared shows the desired shortcut: hovering
the status badge in a table row pops up a compact, stacked-card timeline of every
status change — each card showing the status, the timestamp, the (translated)
note, the actor's avatar, and the actor's real name, with the customer name as a
header.

This data already exists (`order_history` table, already rendered as a collapsed
timeline inside `OrderDetailPanel`), but it is **not** in the orders-list payload
and the actor is only a UUID + `actor_type`. So this feature is (a) a new
on-demand history endpoint that resolves actor names/avatars, and (b) a new hover
popover anchored on the table's status `Badge`, reusing the established
hover-bridge popover pattern.

### Locked decisions
- **Per entry:** status badge + timestamp + translated note + small avatar (16–20px, `avatar_url` with initials fallback) + actor real name. **Customer name = single popover header.**
- **Trigger:** the status `Badge` in `OrderRow` (manager + super_admin orders table). **Hover** to open.
- **Interaction:** hover-open, 250 ms hover-bridge + close delay (copy `DuplicateOrderBadge`), NOT click.
- **Data:** new `GET /api/orders/[id]/history` returning entries with `actor_name` + `actor_type` + `actor_avatar_url`; fetched on hover via SWR, cached per order.
- **Name visibility:** all actor names visible to everyone; `actor_type='system'` → "System" label. Market isolation already enforced by RLS + the endpoint's `canViewOrders` check.
- **Order:** newest-first (descending), matching `ChangeHistoryPopover` and the `i===0 === latest` convention.

---

## 1. New API endpoint — `GET /api/orders/[id]/history`

**File:** `src/app/api/orders/[id]/history/route.ts` (new)

Reuse the auth + scoping pattern from `src/app/api/orders/[id]/route.ts` GET (lines 18–42):
1. `getActor(req)` from `@/lib/auth/actor`.
2. Load the order (`id, status, market_id, assigned_to, customer_name`).
3. `canViewOrders(role, order.market_id, actor.market_id ?? "")` → 403 if false.
4. Agent: `order.assigned_to !== actor.id` → 404.
5. Load `order_history` for the order (all columns currently selected at `[id]/route.ts:48`), then batch-resolve actors with **one** query — same shape as `src/app/api/metrics/route.ts:104`:
   ```ts
   supabase.from("users").select("id, full_name, avatar_url").in("id", actorIds)
   ```
   where `actorIds = [...new Set(history.map(h => h.actor_id).filter(Boolean))]`. Build a `Map<id, {full_name, avatar_url}>`.
6. Map + **sort descending by `created_at`** (newest first) before returning.

**Response shape:**
```ts
interface OrderHistoryEntry {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;            // raw note; client translates via formatOrderHistoryNote
  actor_type: "system" | "agent" | "manager";
  actor_name: string | null;      // null when actor_type === "system" (or actor_id unresolved)
  actor_avatar_url: string | null;
  created_at: string;
}
interface OrderHistoryResponse {
  data: {
    customer_name: string | null;     // popover header
    entries: OrderHistoryEntry[];      // newest first
  };
}
```
`export const dynamic = "force-dynamic";`

---

## 2. SWR hook — `useOrderHistory`

**File:** `src/hooks/useOrderHistory.ts` (new)

```ts
export function useOrderHistory(orderId: string | null, enabled: boolean) {
  return useSWR<OrderHistoryResponse>(
    enabled && orderId ? `/api/orders/${orderId}/history` : null,  // null key = no fetch until open
    (url) => fetch(url).then(r => r.json()),
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );
}
```
- `enabled` is the popover `open` state → **fetch only on hover**, cached per order key.
- Mirrors the on-demand SWR gate in `ChangeHistoryPopover.tsx:48-53`.

---

## 3. New component — `StatusHistoryPopover`

**File:** `src/components/orders/StatusHistoryPopover.tsx` (new)

Copy the hover-bridge mechanics **wholesale** from `src/components/shared/DuplicateOrderBadge.tsx`:
- `open` state + `closeTimer` ref; `handleEnter` clears timer & opens, `handleLeave` sets 250 ms close timeout.
- Trigger wrapper `<span>` with `onMouseEnter/Leave/Focus/Blur` and `onClick={e => e.stopPropagation()}` (so opening the popover never triggers the row's `onOpen`).
- Inner `Popover` subcomponent: `useLayoutEffect` reposition with scroll(capture)+resize listeners; RTL-aware `left = isRtl ? rect.right - width : rect.left`; clamp to `VIEWPORT_GUTTER = 8`; `POPOVER_WIDTH = 340`; `createPortal(..., document.body)`; fixed position; `role="dialog"`; transparent bridge wrapper with `pt-1` + `z-[1000]`; repeats `onMouseEnter/Leave`.
- `isRtl = locale === "ar"`; on the Arabic popover root set `dir="rtl" lang="ar"` (see `OrderDetailPanel.tsx:1425-1426`).

**Props:**
```ts
interface StatusHistoryPopoverProps {
  orderId: string;
  children: React.ReactNode;   // the <Badge> rendered as the trigger
}
```
- `locale` via `useLocale()`, translations via `useTranslations("orders.statusHistory")` + `useTranslations("orders.statuses")`.
- Calls `useOrderHistory(orderId, open)`.

**Panel content (the stacked-card timeline):**
- **Header:** customer name (`data.customer_name`) + section title; `text-[13px] font-semibold text-ink-primary`, subtitle `text-[12px] text-ink-muted`; bottom border `border-line-subtle`. (Header pattern from `DuplicateOrderBadge.tsx:278-287`.)
- **States:** loading (`th("loading")`), error (`th("error")`, on `data` undefined after fetch error), empty `entries.length === 0` (`th("empty")`).
- **Entries:** `<ol>` newest-first. Reuse the dot+connector vocabulary from `OrderDetailPanel.tsx:1459-1501`:
  - absolute vertical connector `w-px bg-line-subtle`, `insetInlineStart: 3`;
  - per `<li>`: dot `w-[7px] h-[7px] rounded-full`, `i===0` → `bg-ink-primary` else `bg-line-strong`;
  - first line: `<Badge tone={tone(entry.to_status)}>{tStatuses(entry.to_status)}</Badge>` + right-aligned timestamp `text-[11px] text-ink-muted tabular-nums` via `formatDateTime(entry.created_at, locale)`;
  - actor row: small avatar (see §4) + `actor_name ?? th("systemActor")` in `text-[12px] text-ink-secondary` (e.g. `th("by", { name })`);
  - note (if any): `formatOrderHistoryNote(entry.note, historyLocale)` in `text-[11px] text-ink-secondary`.
  - `historyLocale`: for the Libya market force `"ar"` exactly as `OrderDetailPanel` does (`isLibyaOrder ? "ar" : locale`) — confirm market via the order; if not readily available client-side, use `locale` and note this as acceptable since the endpoint is market-scoped.
- **Styling:** `rounded-lg border border-line-subtle bg-surface-card shadow-floating text-[13px] text-ink-primary`, scrollable body `max-h-[320px] overflow-y-auto p-3` (from `DuplicateOrderBadge.tsx:272-295`).

---

## 4. Actor avatar (small, with initials fallback)

**First search** `src/components/ui/` and `src/components/shared/` for an existing user-avatar component (there is `ProductAvatar` for products; a user avatar may already exist — `metrics` uses `avatar_url`). 

- **If one exists:** reuse it at 16–20px.
- **If not:** add `src/components/ui/UserAvatar.tsx` — renders `<img src={avatarUrl}>` when present, else a `rounded-full bg-surface-selected text-ink-secondary` circle with initials derived from `full_name` (first letters of first two words; "System"/null → a neutral glyph or "S"). Size prop, default 18px. Logical-property safe, no decoration beyond the circle.

---

## 5. Wire into the orders table

**File:** `src/components/orders/OrderRow.tsx` (modify)
- Wrap the existing status `Badge` (lines 273–295) so the badge is the popover trigger:
  ```tsx
  <StatusHistoryPopover orderId={order.id}>
    <Badge tone={statusTone}>{labels.status}</Badge>
  </StatusHistoryPopover>
  ```
  Keep the existing `carrier_barcode_deleted` / `callbackOverdue` adornments outside the popover trigger (they stay in the same `<td>`). The popover's own `stopPropagation` prevents row-open on hover-click.
- **Memo comparator (lines 336–358):** no new prop is added (only `order.id`, already covered by `prev.order === next.order`), so the comparator needs **no change** — confirm during implementation that wrapping the badge doesn't introduce a new prop.

**File:** `src/components/orders/OrdersTable.tsx` — no change required (the `agentNameById` map is unrelated; actor resolution happens in the endpoint).

---

## 6. i18n

**Files:** `src/messages/fr.json` and `src/messages/ar.json` — add namespace `orders.statusHistory`:
- `title` (e.g. "Historique du statut" / "سجل الحالة")
- `by` ("par {name}" / "بواسطة {name}")
- `systemActor` ("Système" / "النظام")
- `empty`, `loading`, `error`
- `triggerAria` ("Voir l'historique du statut" / aria for the trigger)

Reuse existing `orders.statuses.*` for badge labels and `formatOrderHistoryNote` for notes — **no new note keys needed**.

---

## 7. Tests (TDD — write first)

**API:** `src/app/api/orders/[id]/history/__tests__/route.test.ts` (new) — follow existing API route test conventions:
- Returns entries **descending** by `created_at`.
- Resolves `actor_name` + `actor_avatar_url` for agent/manager actors; `actor_type='system'` → `actor_name: null`.
- Returns `customer_name` in `data`.
- Empty history → `entries: []`.
- Auth: agent on unassigned order → 404; cross-market viewer → 403; unauthenticated → existing `getActor` failure path.

**Component:** `src/components/orders/__tests__/StatusHistoryPopover.test.tsx` (new) — Vitest + `@testing-library/react`, query by role/text (not testid), mock `fetch`/SWR:
- Renders the child badge as trigger; **no fetch before hover** (SWR key null).
- On hover: fetches and renders entries **newest-first**.
- Renders customer name header.
- `actor_type='system'` row shows the "System" label, no name.
- Avatar initials fallback when `actor_avatar_url` is null.
- Loading / empty / error states render.
- Arabic locale → popover root has `dir="rtl"`.

Reference conventions: `src/components/queue/__tests__/OrderCard.test.tsx` and any existing `api/.../__tests__` route test.

---

## 8. Verification

1. `npm test` (or `npm run test:run`) — all new + existing tests pass.
2. `npm run typecheck` — clean.
3. `npm run lint`.
4. Manual (`npm run dev`), as a manager:
   - Hover a status badge in the orders table (fr) → popover opens below, newest-first, with customer header, avatars, names, translated notes.
   - A webhook/cron entry shows **"System"** with the fallback avatar.
   - An actor with no `avatar_url` shows **initials**.
   - Switch to the Arabic (Libya) market → layout mirrors (RTL), notes/labels Arabic, Cairo font.
   - Hover a badge near the right viewport edge → popover clamps inside the gutter.
   - Moving the cursor from badge into the popover keeps it open (hover bridge); leaving closes after ~250 ms.
   - Clicking the badge area does **not** open the full row detail panel.
5. As an **agent**, confirm the same popover works on their own assigned orders and the endpoint 404s on others (covered by tests, spot-check in UI if agent queue uses the table).

---

## Optional (clearly out of scope unless requested)
- Extract the duplicated `STATUS_TONE` map (`OrderRow.tsx:15-37` + `OrderDetailPanel.tsx`) into a shared `src/lib/order-status-tone.ts` and import in both + the new popover. Reduces drift but is a refactor independent of this feature.
- Later: reuse the same `StatusHistoryPopover` on the agent queue `OrderCard` status badge and on `OrderDetailPanel`'s inline status, for full cross-role consistency (the user mentioned wanting this across all roles — flag as a fast follow once the table version is approved).

---

# Phase 2 — Minimalist pass + event icons + storefront source

## Context

Phase 1 shipped a working popover but it shows EVERY `order_history` row with a translated note line. That is too noisy for the table-hover use case: agents only need the **status journey** + the **assignment journey**. Notes like `"Mapping needs review: city unmatched (...)"`, field-edit JSON summaries, escalation tags, barcode operations, dispatch-cancel toggles etc. are debugging/audit signal that already lives elsewhere (detail panel, audit log) and clutters the popover.

User decisions (locked):
- **Per-card lines KEPT:** status + timestamp · actor avatar + name · **status transition (from → to)**.
- **Per-card lines DROPPED:** the translated note text. Always.
- **Entries shown:** rows where `status_from !== status_to` **plus** rows whose note marks an initial assignment (`"Assigned to agent"` / `"Auto-assigned*"`). HIDE everything else (mapping warnings, field edits, escalations, barcode ops, reassignments, dispatch-cancel toggles).
- **Event-type icon** leads the status pill — derived from `actor_type` + recognised note pattern. Colour matches the status tone.
- **Storefront source logo** appears on the intake card only (the oldest row, no `from_status`). Reuse `SourceLogo` and add a `google_sheets` entry with a lucide `Sheet` stand-in (swap to a real `/public/google_sheets.svg` later in one line).
- **Visual restyle:** `rounded-2xl` container (no dashed border on cards anymore — hairline `border-line-subtle`, `rounded-xl`); latest card gets a left accent bar in the status tone; pill becomes `rounded-full` with the leading event icon, treated as one unit; lighter spacing; count chip neutralised.

## 1. Filtering — endpoint, not client

**File:** `src/app/api/orders/[id]/history/route.ts` (modify)

Filter on the server so the wire payload is also minimal:

```ts
const ASSIGNMENT_NOTE = /^(Assigned to agent|Auto-assigned)/i;

function isJourneyEntry(h: { status_from: string | null; status_to: string; note: string | null }): boolean {
  if (h.status_from !== h.status_to) return true;                  // real status change
  if (h.note && ASSIGNMENT_NOTE.test(h.note)) return true;         // initial assignment
  return false;                                                    // hide everything else
}
```

Apply after the existing fetch + before the actor join (smaller `users` query). Update `OrderHistoryEntry` to **drop `note`** from the response (the client no longer renders it). Keep `from_status` / `to_status` for the transition display.

**Tests** (`route.test.ts` — modify): add fixture rows for a field-edit (`status_from===status_to`, JSON note) and a mapping-warning row, assert they are **not** in the response; keep an assignment row and assert it IS shown.

## 2. Endpoint also returns the order's source

Add `external_platform` to the order `SELECT` and return it in `data` alongside `customer_name`:

```ts
data: { customer_name, source_platform: order.external_platform ?? null, entries }
```

Update `OrderHistoryDetail` in `src/hooks/useOrderHistory.ts` accordingly.

## 3. Event-type icon helper

**File:** `src/lib/order-history-event-icon.ts` (new) + sibling `.test.ts`

Single pure function:

```ts
import type { LucideIcon } from "lucide-react";
import { Activity, Globe, Sheet, Pencil, Phone, PhoneCall, ShieldAlert,
         CheckCircle2, Truck, Package, XCircle, Trash2, UserPlus } from "lucide-react";

export function eventIconFor(args: {
  to_status: string;
  actor_type: "system" | "agent" | "manager";
  note: string | null;
}): LucideIcon { /* … */ }
```

Mapping (note-pattern wins, then status, then actor_type):
- note starts with `Order received via Google Sheets sync` → `Sheet`
- note starts with `Order received via webhook` → `Globe`
- note starts with `Order created manually` / `…by agent (self-assigned)` → `Pencil`
- note starts with `Assigned to agent` / `Auto-assigned` → `UserPlus`
- `to_status` in {attempt_1, attempt_2, attempt_3} → `Phone`
- `to_status === "callback_scheduled"` → `PhoneCall`
- `to_status === "confirmed"` → `CheckCircle2`
- `to_status` in {uploaded, scanned, dispatched, deposit, in_transit} → `Truck`
- `to_status === "delivered"` → `Package`
- `to_status` in {rejected, cancelled} → `XCircle`
- `to_status === "deleted"` → `Trash2`
- `actor_type === "manager"` (and nothing more specific) → `ShieldAlert`
- fallback → `Activity`

**Tests** cover one example per branch (the ordering of precedence is the part that can drift).

## 4. SourceLogo gets Google Sheets

**File:** `src/components/shared/SourceLogo.tsx` (modify)

Extend the `PLATFORMS` map with a `google_sheets` entry. Until a real asset exists, render the lucide `Sheet` icon on the same tile chrome the manual case already uses (light green tint via inline style is acceptable — keeps the change self-contained). Comment notes: replace with `logoSrc: "/google_sheets.svg"` when the asset lands.

No test change needed; `SourceLogo` has no behaviour test today, and the visible change is one prop value.

## 5. StatusHistoryPopover restyle + new prop

**File:** `src/components/orders/StatusHistoryPopover.tsx` (modify)

- New optional prop: `sourcePlatform?: string | null`. Caller (OrderRow) passes `order.external_platform`. If the prop is null, use the value from the endpoint's `data.source_platform`.
- The first card whose `from_status` is null (the intake) renders the storefront `<SourceLogo platform={sourcePlatform} size={14} />` **leading the status pill**, replacing the event-type icon for that one card.
- All other cards lead the pill with `eventIconFor(entry)` rendered at 12px inside the pill (icon + label as one unit).
- **From → To transition line** under the pill: small muted text `from_status → to_status`, both translated via `useTranslations("orders.statuses")`, separated by an arrow. Hidden for intake (no `from_status`). Reuse `transition` key already in `orders.history.transition`.
- **Note text removed** from `HistoryRow` entirely.
- **Visual chrome:** drop the dashed border. Each card: `rounded-xl border border-line-subtle bg-surface-card`. Latest card gets a left accent bar in the status tone via a 3px-wide leading `<span>` (color via a new tiny helper `statusAccentBarClass(status)` — or inline conditional on tone). Container becomes `rounded-2xl`. Count pill neutralised (`bg-surface-page text-ink-secondary`). Header padding `pt-4`, body `gap-1.5`.

**Tests** (`StatusHistoryPopover.test.tsx` — modify):
- Drop the existing "translated note is rendered" assertions (no longer applicable).
- Add: from → to transition is rendered on a non-intake card (e.g. "En attente" → "Confirmé").
- Add: passing `sourcePlatform="google_sheets"` renders the SourceLogo on the intake card (assert by role/title text).
- Add: a hidden-entry fixture (field-edit row in the mocked response) does not produce a `<li>` — note this is mostly already handled by the server filter; the client should still defensively skip rows that slip through, OR rely entirely on the server (simpler; document the decision in the component comment).
- Keep: newest-first, customer header, System label, empty/loading/error, RTL.

## 6. OrderRow wiring

**File:** `src/components/orders/OrderRow.tsx` (modify)

Pass `sourcePlatform={order.external_platform ?? null}`:

```tsx
<StatusHistoryPopover orderId={order.id} sourcePlatform={order.external_platform ?? null}>
  <Badge tone={statusTone}>{labels.status}</Badge>
</StatusHistoryPopover>
```

No new prop added to `OrderRow` itself — its memo comparator stays untouched.

## 7. i18n

No new keys needed. Drop unused `loading`/`error`/`empty` only if they actually become unused — they don't, keep them. The Phase-1 `orders.statusHistory` namespace already covers the chrome.

## 8. What's deliberately NOT shown anymore

(Document at the top of `StatusHistoryPopover.tsx` so future readers don't bring it back.)

> The popover is intentionally a **journey** view — status transitions and assignment events only. Field edits, mapping warnings, escalations, barcode operations, reassignments, and dispatch-cancel toggles are still stored in `order_history` and visible in the order detail panel + audit log; they are filtered out here to keep the hover read scannable.

## 9. Verification

1. `npm run typecheck` clean.
2. `npx vitest run` of the touched files all green:
   - `src/lib/order-history-event-icon.test.ts`
   - `src/app/api/orders/[id]/history/route.test.ts`
   - `src/components/orders/__tests__/StatusHistoryPopover.test.tsx`
   - `src/lib/order-status-tone.test.ts` (sanity)
   - `src/components/orders/__tests__/OrderRow.test.tsx` (sanity — prop added)
3. Visual (existing Playwright preview pattern): screenshot the rebuilt popover in fr and ar; confirm:
   - Intake card shows the storefront/Sheets logo (and the source matches the order's platform).
   - Non-intake cards show the event-type icon inside the pill.
   - From → To line renders under the pill in muted text.
   - No note text appears anywhere.
   - Latest card has the left accent bar tinted to its status colour.
   - Hidden entry types (mapping warning, field edit) do not produce cards.
