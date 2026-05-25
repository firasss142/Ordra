# Dexpress Integration — Order Status & Tracking

## Context

This document covers **reading order status and tracking history** from the Dexpress merchant portal. It complements:

- [`dexpress-integration.md`](./dexpress-integration.md) — main integration doc (auth, session, create order)
- [`dexpress-delete-order.md`](./dexpress-delete-order.md) — order deletion endpoint

If you haven't read those yet, read `dexpress-integration.md` first. This document assumes you understand:

- Session auth via the `laravel_session` cookie (2-hour lifetime).
- Why we simulate a browser session rather than calling a clean API.
- The session-caching pattern (Supabase-backed in this codebase).

The status endpoints were reverse-engineered the same way as the other operations: capture in DevTools → identify the URL/method/headers → replicate.

---

## TL;DR

Two read-only endpoints, both authenticated by the existing `laravel_session` cookie, neither requiring a CSRF token (both are `GET`):

| Endpoint | Returns | Use case |
|---|---|---|
| `GET /merchant/ajax-order-case/{id}` | JSON: `{ response_case, status_name, order_accept }` | Cheap polling — current status only |
| `GET /merchant/track-order/{id}` | Full HTML page with a `.timeline-item` history | Rich display — current status + full event log with timestamps and courier info |

Module exports (in `dexpress-tracking.ts`):

- `getOrderStatus(orderId): Promise<OrderStatusSnapshot>` — fast.
- `getOrderTracking(orderId): Promise<OrderTracking>` — rich, parses HTML.

A canonical status taxonomy lives in `dexpress-statuses.ts` with **19 known statuses** indexed by their numeric ID (the same ID Dexpress uses in `/merchant/all-orders/{N}` URLs).

---

## Endpoint 1: `ajax-order-case` (lightweight)

### The endpoint

| Property | Value |
|---|---|
| **Method** | `GET` |
| **URL** | `https://portal.dexpress.ly/merchant/ajax-order-case/{ORDER_ID}` |
| **Auth** | `laravel_session` cookie |
| **CSRF token** | Not required (GET) |
| **Body** | None |

### How it was discovered

It's not visible to a human navigating the portal — it's called by the **search modal's JavaScript** (`#Merchant_Serach_Single_Order_TForm_1` change handler in the portal's inline JS). When a user searches for an order in the modal, this endpoint resolves the order's current status and is-accepted flag so the modal can decide which buttons to show.

The portal's own JS does exactly this:

```javascript
$.ajax({ type: "GET", url: "/merchant/ajax-order-case/" + orderId,
  success: function(result) {
    var json_data = JSON.parse(result);
    if (json_data.response_case === 201) {
      // status_name and order_accept are available
    }
  }
});
```

We mirror that pattern.

### Required headers

The browser sends these and we should too:

| Header | Value | Why |
|---|---|---|
| `Cookie` | `laravel_session=...` | Auth. Handled by the cookie jar. |
| `X-Requested-With` | `XMLHttpRequest` | Mirrors the AJAX call. May influence Laravel's response shape. |
| `Accept` | `application/json, text/plain, */*` | Mirrors a typical jQuery AJAX call. |

### Response shape

```json
{
  "response_case": 201,
  "status_name": "إلى المندوب",
  "order_accept": 1
}
```

**Important quirk:** the response `Content-Type` is **not** `application/json`. The body is a JSON-encoded **string** that must be parsed with `JSON.parse()` after reading as text. Don't trust `response.json()` to work; do `JSON.parse(await response.text())`.

| Field | Meaning |
|---|---|
| `response_case` | `201` = success. Anything else = lookup failure. |
| `status_name` | Arabic label, **timeline-style** vocabulary (e.g. `"إلى المندوب"`, not the sidebar form `"طلبات مرسلة للمندوب"`). |
| `order_accept` | `0` = order is still in the pending queue (editable). `1` = accepted into workflow (read-only). |

### Failure modes

- **Unknown order ID**: we did not test this directly. The portal's modal handles a separate "not found" code path. Treat any non-`201` `response_case` as an error and log it.
- **Logged-out session**: like all authenticated routes, Dexpress redirects to `/login`. The session helper detects this and re-logs in automatically (same as create/delete).

---

## Endpoint 2: `track-order` (full HTML page)

### The endpoint

| Property | Value |
|---|---|
| **Method** | `GET` |
| **URL** | `https://portal.dexpress.ly/merchant/track-order/{ORDER_ID}` |
| **Auth** | `laravel_session` cookie |
| **CSRF token** | Not required (GET) |
| **Body** | None |
| **Response Content-Type** | `text/html; charset=UTF-8` (full Laravel-rendered page) |

### Response structure

The response is the entire merchant dashboard layout — sidebar, header, footer, the works. The data we care about lives in two places:

#### 1. Current status (page header)

There's a button in the portlet header containing the current status as plain text:

```html
<div class="portlet-title">
  <div class="actions">
    <div class="btn-group">
      <div class="btn btn-lg blue-chambray">
        <i class="fa fa-tag"></i> حالة الطلب : إلى المندوب
      </div>
    </div>
  </div>
</div>
```

The pattern is `حالة الطلب : <STATUS_LABEL>`. The label uses the **timeline-style vocabulary** (same as `ajax-order-case`'s `status_name`).

#### 2. Timeline events

Each event is a `<div class="timeline-item">` inside the **left** `bordered` portlet (`بيانات التتبع للطلب`). Events are rendered **newest-first** by Dexpress.

There's also a right-side `bg-inverse` portlet (`بيانات المتابعة للطلب`) for follow-up notes — empty in every order we've seen so far. Currently the parser collects all `.timeline-item` elements regardless of which portlet they're in. If Dexpress ever populates the right panel, scope the selector to the left portlet only.

#### Timeline item internal structure

```html
<div class="timeline-item">
  <div class="timeline-body">
    <div class="timeline-body-head">
      <div class="timeline-body-title font-blue-madison">
        <i class="fa fa-tag"></i> STATUS_NAME_HERE
      </div>
    </div>

    <!-- Optional: courier name (only for delivery-related events) -->
    <div class="timeline-body-content">
      <span class="timeline-body-time">
        <i class="fa fa-motorcycle"></i> مندوب التوصيل : COURIER_NAME (BRANCH)
      </span>
    </div>

    <!-- Optional: courier phone (paired with the name block) -->
    <div class="timeline-body-content">
      <span class="timeline-body-time">
        <i class="fa fa-phone"></i> هاتف المندوب : COURIER_PHONE
      </span>
    </div>

    <!-- Always present: date + time -->
    <div class="timeline-body-content">
      <span class="timeline-body-time">
        <i class="fa fa-calendar"></i> 2026-05-21
        <i class="fa fa-clock-o"></i> 09-12-46 م
      </span>
    </div>
  </div>
</div>
```

#### Disambiguating timeline-body-content blocks

The three optional content blocks have **no class differentiator**. They are all `<div class="timeline-body-content">`. The only way to tell them apart is by which Font Awesome icon they contain:

| Icon class | Block content |
|---|---|
| `fa-motorcycle` | Courier name + branch |
| `fa-phone` | Courier phone |
| `fa-calendar` / `fa-clock-o` | Date + time (always present) |

The parser branches on `innerHTML.includes("fa-motorcycle"|"fa-phone"|"fa-calendar")` because parsing the prefix text (`"مندوب التوصيل :"`, `"هاتف المندوب :"`) is more fragile.

#### Date and time format

- **Date**: ISO-compatible `YYYY-MM-DD`. Use as-is.
- **Time**: Arabic 12-hour format using **dashes instead of colons**: `HH-MM-SS م` (PM) or `HH-MM-SS ص` (AM).

Conversion to 24h `HH:MM:SS`:

| Input | Output |
|---|---|
| `05-23-40 م` (5:23:40 PM) | `17:23:40` |
| `02-55-55 ص` (2:55:55 AM) | `02:55:55` |
| `12-30-00 م` (12:30:00 PM noon) | `12:30:00` |
| `12-15-00 ص` (12:15:00 AM midnight) | `00:15:00` |

The parser combines date + normalized time into an ISO 8601 timestamp with offset `+02:00` (Libya does not observe DST and is on UTC+2 year-round).

---

## The status taxonomy

### Two coexisting vocabularies

Dexpress uses two slightly different label sets for the same underlying statuses:

- **Sidebar labels** appear in the left nav (e.g. `طلبات في الشركة`). They're verbose, prefixed with `طلبات` ("orders").
- **Timeline labels** appear in the tracking page header and timeline items (e.g. `في الشركة`). They're terse.

Both vocabularies map 1:1 to the **same numeric status ID** — the one in the `/merchant/all-orders/{N}` URLs.

### The numeric ID system

19 known statuses, IDs from 1–17 plus two out-of-sequence: `25` and `29`. The out-of-sequence ones were added by Dexpress later.

| ID | Slug | Timeline label | Sidebar label |
|---|---|---|---|
| 1 | `AT_CUSTOMER` | عند العميل | طلبات عند العميل |
| 2 | `BEING_PREPARED` | جارى التجهيز | طلبات جارى تجهيزها |
| 3 | `IN_COMPANY` | فى الشركة | طلبات فى الشركة |
| 4 | `WILL_BE_SENT_TO_BRANCHES` | سترسل للفروع *(unconfirmed)* | طلبات سترسل للفروع |
| 5 | `EN_ROUTE_TO_BRANCHES` | بالطريق للفروع *(unconfirmed)* | طلبات بالطريق للفروع |
| 6 | `ARRIVED_AT_BRANCHES` | وصلت الفروع *(unconfirmed)* | طلبات وصلت الفروع |
| 7 | `OUT_FOR_DELIVERY` | جارى التوصيل | طلبات جارى توصيلها |
| 8 | `DELIVERY_POSTPONED` | مؤجلة التسليم *(unconfirmed)* | طلبات مؤجلة التسليم |
| 9 | `POSTPONED_WITH_COURIER` | مؤجلة مع المندوب *(unconfirmed)* | مؤجلة مع المندوب |
| 10 | `DELIVERED` | تم التسليم | طلبات تم تسليمها |
| 11 | `PARTIALLY_DELIVERED` | تم تسليمها جزئياً *(unconfirmed)* | طلبات تسليمها جزئياً |
| 12 | `REPLACED` | تم إستبدالها *(unconfirmed)* | طلبات تم إستبدالها |
| 13 | `RECEIPT_REFUSED` | رفض إستلام *(unconfirmed)* | طلبات رفض إستلام |
| 14 | `RETURNING_VIA_COURIER` | راجع لدى المندوب *(unconfirmed)* | راجع لــــــدى المندوب |
| 15 | `RETURNING_AT_BRANCHES` | راجعة بالفروع *(unconfirmed)* | طلبات راجعة بالفروع |
| 16 | `RETURNING_TO_COMPANY` | راجع إلى الشركة *(unconfirmed)* | طلبات راجع إلى الشركة |
| 17 | `RETURNED_AT_COMPANY` | راجع فى الشركة *(unconfirmed)* | طلبات راجع فى الشركة |
| 25 | `AWAITING_COURIER_SETTLEMENT` | تسليم تحت تسويه المندوب | بإنتظار تسوية المندوب |
| 29 | `SENT_TO_COURIER` | إلى المندوب | طلبات مرسلة للمندوب |

**"Unconfirmed" timeline labels** were derived by stripping the `طلبات` prefix from the sidebar version. They are educated guesses, not observed values. When a real order flows through one of these statuses, verify the actual timeline string and update `dexpress-statuses.ts`.

### Two statuses without numeric IDs (yet)

The portal also exposes two sidebar items with **non-numeric routes**:

- `/merchant/pending-orders` → `طلبات قيد الإنتظار` (pending orders, not yet accepted)
- `/merchant/rejected-orders` → `طلبات تم رفضها` (rejected orders)

Their underlying numeric status IDs (as Dexpress represents them internally) are not known. If `ajax-order-case` ever returns a `status_name` matching these labels, add entries to the taxonomy at that point.

### Label normalization

Before matching a label to a status, the parser normalizes it:

1. Strip tatweel characters (`ـ`) — Dexpress decoratively pads `راجع لــــــدى المندوب` with these.
2. Collapse runs of whitespace to single spaces.
3. Trim leading/trailing whitespace.

This is implemented in `normalizeArabic()` in `dexpress-statuses.ts`. Both sides of the lookup (the map keys and the input label) go through it.

---

## Module API

### `getOrderStatus(orderId): Promise<OrderStatusSnapshot>`

Hits `ajax-order-case`. Returns:

```ts
{
  orderId: number,
  statusId: number | null,    // null if status_name didn't match the taxonomy
  slug: string | null,        // e.g. "DELIVERED", null on unknown
  statusName: string,         // raw Arabic, always present
  isAccepted: boolean         // mirrors order_accept === 1
}
```

### `getOrderTracking(orderId): Promise<OrderTracking>`

Hits `track-order`. Returns:

```ts
{
  orderId: number,
  current: OrderStatusSnapshot,  // same shape as above; isAccepted defaults true
  events: TrackingEvent[]        // newest first
}
```

Each `TrackingEvent`:

```ts
{
  statusId: number | null,
  slug: string | null,
  statusName: string,            // raw Arabic from timeline-body-title
  date: string | null,           // "YYYY-MM-DD" as Dexpress provides
  time: string | null,           // normalized 24h "HH:MM:SS"
  timestamp: string | null,      // ISO 8601 with +02:00 offset, or null if either part missing
  courierName: string | null,    // null when not present in this event
  courierPhone: string | null    // null when not present in this event
}
```

### `parseTrackingHtml(orderId, html): OrderTracking`

Exported separately from the fetch — pass it raw HTML for unit testing. Save HAR captures or `.html` fixtures and use this function to verify the parser without hitting the live portal.

---

## Critical implementation considerations

### 1. The graceful-degradation rule

Both functions are designed to **never throw on a new/unknown status**. If Dexpress introduces a new status tomorrow:

- `getOrderStatus()` returns `{ statusId: null, slug: null, statusName: "<the new Arabic label>", ... }`.
- `getOrderTracking()` includes the event with the same `null` IDs.

**Do not change this behavior.** The integration is brittle by nature; degrading gracefully on unknowns is what keeps the OMS functional during the lag between Dexpress changing something and us updating the taxonomy.

### 2. Logging unknown labels is non-negotiable

The flip side of graceful degradation: if we never see the unknowns, we never fix them. Whenever the resolver returns `statusId: null` for a non-empty `statusName`, **log it at warn level** with the order ID and the raw label. Aggregate these and review weekly.

A reasonable log line:

```
[dexpress] unknown status label encountered: order=1339635 label="<raw arabic>"
```

### 3. Session reuse — same rules as create/delete

The 2-hour `laravel_session` cookie is shared with the create/delete flows. Don't open a new session for status fetches; use the existing helper. On serverless (Vercel), the Supabase-backed session store handles this transparently.

On a 302→`/login`, the helper invalidates the cached session, re-logs in, and retries — same as other endpoints. Make sure your retry counter guards against infinite recursion (single retry, then fail loudly).

### 4. Rate limiting

We don't know Dexpress's rate limits. Reasonable defaults:

- For polling (background sync): no more than one `getOrderStatus()` call every few seconds per order.
- For bulk operations: pace at a few hundred ms between calls; reuse the session cookie.
- Prefer `getOrderStatus()` over `getOrderTracking()` for polling — it returns much less data and presumably costs Dexpress less to render.

### 5. The right-side portlet (`بيانات المتابعة`)

Empty in every order observed so far. If it ever starts containing items, the current parser will merge those events into the same list as the left portlet. To prevent that, change the events selector from `root.querySelectorAll(".timeline-item")` to scope it to the left portlet:

```ts
const leftPortlet = root.querySelector(".portlet.light.bordered .timeline");
const events = leftPortlet
  ? leftPortlet.querySelectorAll(".timeline-item").map(parseTimelineItem)...
  : [];
```

Leave the broad selector in place until we actually see the right portlet used; over-scoping a CSS selector is the most common source of breakage when Dexpress tweaks HTML.

### 6. `isAccepted` from `getOrderTracking()` is approximate

The tracking page HTML doesn't expose `order_accept` directly. The parser defaults it to `true` because if the page rendered at all, the order has moved past the editable pending stage. If you need the exact value, prefer `getOrderStatus()`.

---

## Brittleness watch list

This integration breaks if Dexpress changes:

- The URL pattern `/merchant/track-order/{id}` or `/merchant/ajax-order-case/{id}`.
- The `response_case === 201` success convention.
- The `حالة الطلب :` prefix in the page header.
- The `.timeline-item` / `.timeline-body-title` / `.timeline-body-content` class names.
- The Font Awesome icon classes used to disambiguate content blocks (`fa-motorcycle`, `fa-phone`, `fa-calendar`).
- The Arabic time format (`HH-MM-SS م/ص`).
- The numeric status ID system (e.g. renumbering, removing the gaps at 18-24, 26-28).

**Mitigation**: log the response HTML/JSON on unexpected outcomes (non-200, empty timeline, parser returning zero events for an order known to have history) so debugging is one log line away, not a re-capture session.

---

## Validation checklist before shipping

- [ ] Call `getOrderStatus()` on three orders with different statuses; confirm `statusId` and `slug` resolve correctly.
- [ ] Call `getOrderTracking()` on a delivered order with full history (5+ events); confirm event count, ordering (newest first), and timestamp conversion.
- [ ] Confirm courier name + phone are extracted when present and `null` when absent.
- [ ] Call `getOrderTracking()` on a freshly created order (1–2 events); confirm it works with minimal timelines.
- [ ] Let the session expire (or clear the cached cookie), call either function; confirm the helper re-logs in and retries.
- [ ] Call `getOrderStatus(99999999)` (non-existent ID); confirm we get a non-`201` `response_case` and the function throws rather than silently returning bad data.
- [ ] Wire up the unknown-label logger; verify it fires by feeding the parser a fixture with a fake status label.
- [ ] Confirm no Dexpress credentials reach the browser bundle.

---

## Open considerations / things to watch

### Confirming the unconfirmed timeline labels

12 of the 19 known statuses have unconfirmed timeline labels (derived by stripping `طلبات`). As real orders flow through these states, capture the actual label text and update `dexpress-statuses.ts`. Easiest path: review the logger output from "Critical consideration #2" — every `unknown label` warn line is a confirmation opportunity.

### IDs in the gaps (18-24, 26-28)

The numbering scheme has gaps. Dexpress may have deprecated statuses in those ranges, or they may be reserved for future use. We have no way to know without seeing them surface in real data. If `ajax-order-case` ever returns a `status_name` we don't recognize that maps to a gap-range URL, add it.

### `pending-orders` and `rejected-orders`

These two routes don't use the numeric-ID URL pattern (`/merchant/all-orders/{N}`). They have their own dedicated routes (`/merchant/pending-orders`, `/merchant/rejected-orders`). Their internal numeric IDs (if any) are unknown. Watch for them in `ajax-order-case` responses.

### Next reverse-engineering target

The natural next step is the **list endpoints** — `/merchant/all-orders/{statusId}` for each numeric status, plus the two dedicated routes. These return HTML tables of orders matching a status, which feeds the OMS dashboard ("show me all my in-progress orders"). The same capture → identify → replicate workflow applies.

---

## File index

- [`dexpress-integration.md`](./dexpress-integration.md) — main integration doc (auth, create order)
- [`dexpress-delete-order.md`](./dexpress-delete-order.md) — delete endpoint
- [`dexpress-states.json`](./dexpress-states.json) — destination ID + route ID mapping
- `dexpress-statuses.ts` — the 19-status taxonomy + label-lookup helpers
- `dexpress-tracking.ts` — `getOrderStatus()`, `getOrderTracking()`, `parseTrackingHtml()`
- This file — order status & tracking endpoint reference
