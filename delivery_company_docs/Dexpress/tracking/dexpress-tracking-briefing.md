# Dexpress Order Tracking — Engineering Briefing

> Hand this to an engineer (human or AI) joining the Dexpress integration. It captures everything we know about reading order status from the Dexpress merchant portal, including how we know it. No instructions, no checklists — just context, decisions, and evidence.

## Where this fits in the broader integration

[Dexpress](https://portal.dexpress.ly/) is the delivery company the merchant uses. They do not offer an API. They've given verbal permission to find workarounds. The integration simulates a browser session against their Laravel 5.x portal.

This document covers **reading order status and tracking history**. Two other documents cover related operations:

- [`dexpress-integration.md`](./dexpress-integration.md) — auth flow, session lifecycle, create order. **Read this first** if you're new — it explains the cookie-based session, CSRF token scraping, and the Supabase-backed session store used by the existing helper.
- [`dexpress-delete-order.md`](./dexpress-delete-order.md) — order deletion endpoint.

The status work documented here builds on the same authenticated session helper (`client.ts`) used by create and delete. No new auth machinery is required.

## What we built

Three artifacts, all production-ready and tested against real captured HTML:

| File | Purpose |
|---|---|
| `dexpress-statuses.ts` | The 19-status taxonomy: numeric ID, English slug, Arabic timeline label, Arabic sidebar label. Fuzzy-match lookup that handles tatweel + whitespace quirks. |
| `dexpress-tracking.ts` | `getOrderStatus()` (fast, JSON), `getOrderTracking()` (rich, HTML), `parseTrackingHtml()` (pure, testable). |
| `dexpress-tracking.test.ts` + 4 fixtures | Vitest test suite running against real captured HTML. |

The taxonomy and module APIs are documented in detail in [`dexpress-tracking.md`](./dexpress-tracking.md). The rest of this briefing covers everything **outside** that reference doc: how we discovered the endpoints, what assumptions are still unconfirmed, what the next reverse-engineering targets look like, and the open questions.

---

## Endpoint 1: `GET /merchant/ajax-order-case/{id}`

**What it does:** Returns the current status of a single order as JSON. Cheap, lightweight, perfect for polling.

**How we found it:** Not visible to a human navigating the portal. It's called by the **search modal's JavaScript** — specifically the `change` handler on `#Merchant_Serach_Single_Order_TForm_1` (the order search select2 in the top-bar 🔍 modal). The portal's inline JS does this:

```javascript
$.ajax({
  type: "GET",
  url: "https://portal.dexpress.ly/merchant/ajax-order-case/" + orderId,
  success: function(result) {
    var json_data = JSON.parse(result);
    if (json_data.response_case === 201) {
      info_notfication(' حالة الطلب ' + json_data.status_name);
      if (json_data.order_accept === 0) {
        // show "edit order" button for pending orders
      }
    }
  }
});
```

This tells us the response is a JSON-encoded **string** (note `JSON.parse(result)` — not a plain JSON object with the right content-type). The keys are `response_case`, `status_name`, `order_accept`.

**Assumptions still unconfirmed:**

- `response_case === 201` is success. This is inferred from the portal JS, not from observing an actual response. Almost certainly correct (Laravel commonly uses 201 for success-with-data), but we haven't seen a literal response body. When the user tried to capture it in DevTools, Brave/Chromium evicted the response body with "failed to load response data" — a known quirk of short-lived XHR requests.

- The behavior for non-existent / unknown order IDs is unknown. Code treats anything other than `response_case === 201` as a failure and throws. If Dexpress returns a different success code for some condition, this is a latent bug.

**Easy way to confirm:** in the browser console while logged in:

```js
fetch('/merchant/ajax-order-case/1138841', {
  headers: { 'X-Requested-With': 'XMLHttpRequest' }
})
  .then(r => r.text())
  .then(t => console.log(t));
```

That dumps the raw response text into the console where it can't be evicted.

**Status name vocabulary:** the `status_name` field uses the **timeline-style** Arabic vocabulary (e.g. `إلى المندوب`), not the sidebar style (`طلبات مرسلة للمندوب`). See "Two coexisting vocabularies" below.

---

## Endpoint 2: `GET /merchant/track-order/{id}`

**What it does:** Returns a full HTML page (the merchant's tracking view for one order). Contains the current status as a header button AND a complete timeline of every status change with timestamps and courier info.

**How we found it:** Visible in the portal as the "tracking" link on each order. Open any order detail, the tracking page renders the timeline visually.

**Critical structural details:**

The response is a complete Laravel-rendered page with sidebar, header, footer. The data we care about is in two places:

### Place 1 — Current status (page header button)

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

Pattern is `حالة الطلب : <STATUS_LABEL>`. The label uses the timeline-style vocabulary (matches `ajax-order-case`'s `status_name`).

### Place 2 — Timeline events

Each event is a `<div class="timeline-item">` inside the **left** portlet (`بيانات التتبع للطلب`). Newest event first.

There's also a **right portlet** (`بيانات المتابعة للطلب`) for follow-up notes. In every order we've observed (4 fixtures, multiple statuses), the right portlet has been empty. The current parser collects all `.timeline-item` elements regardless of which portlet they're in. **If the right portlet ever populates, the parser will silently mix events from both panels into the same list.** Scoping the selector to the left portlet only would require:

```ts
const leftPortlet = root.querySelector(".portlet.light.bordered .timeline");
```

We've deliberately left this broad for now — over-scoping CSS selectors is a top source of breakage when Dexpress tweaks markup, and we have no evidence the right portlet matters.

### Timeline item internal structure

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

    <!-- Optional: courier phone (paired with name block) -->
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

### Important parser decision: disambiguating content blocks

The three optional/required content blocks have **no class differentiator**. They are all `<div class="timeline-body-content">`. The only reliable way to tell them apart is by which Font Awesome icon they contain:

| Icon class | Block content |
|---|---|
| `fa-motorcycle` | Courier name + branch |
| `fa-phone` | Courier phone |
| `fa-calendar` / `fa-clock-o` | Date + time (always present) |

The parser checks `innerHTML.includes("fa-motorcycle"|"fa-phone"|"fa-calendar")`. We deliberately avoided parsing the Arabic prefix text (`"مندوب التوصيل :"`, `"هاتف المندوب :"`) because Arabic text prefixes have proven brittle in our reverse-engineering experience.

### Date and time format quirk

- **Date**: ISO-compatible `YYYY-MM-DD`. Use as-is.
- **Time**: Arabic 12-hour format using **dashes instead of colons**: `HH-MM-SS م` (PM) or `HH-MM-SS ص` (AM).

Conversion rules with worked examples:

| Input | Output | Reasoning |
|---|---|---|
| `05-23-40 م` | `17:23:40` | 5 PM + 12h |
| `02-55-55 ص` | `02:55:55` | 2 AM, no shift |
| `12-30-00 م` | `12:30:00` | Noon stays at 12 (PM hour 12 → 12) |
| `12-15-00 ص` | `00:15:00` | Midnight wraps (AM hour 12 → 0) |

Parser combines `date + time` into an ISO 8601 timestamp with offset `+02:00`. Libya is on UTC+2 year-round, no DST.

### Real courier name variations

We've observed three different surface forms in real fixtures — all parse correctly:

| Courier text | Notes |
|---|---|
| `امير محمد سليم ( طرابلس )` | Long name, spaces around parens |
| `سامي محمد جارالله الصيد(طبرق)` | Long name, no space before paren |
| `مجدى (البيضاء)` | Short name, standard parens |

The parser captures the entire string verbatim and lets the consumer interpret. No attempt is made to split name from branch — too much variance.

---

## The status taxonomy — the most important piece of knowledge here

### Two coexisting Arabic vocabularies

This caught us early and is the single biggest source of confusion when reading the code. Dexpress uses **two different label sets for the same underlying statuses**:

- **Sidebar labels** appear in the left nav (verbose, prefixed with `طلبات` = "orders"). Example: `طلبات في الشركة`.
- **Timeline labels** appear in the tracking page header AND in timeline items (terse, no prefix). Example: `في الشركة`.

Both vocabularies map 1:1 to the **same numeric status ID** (the one in `/merchant/all-orders/{N}` URLs).

The taxonomy in `dexpress-statuses.ts` stores both labels per status, and `findStatusByLabel()` accepts either vocabulary as input. Normalization strips decorative tatweel characters (`ـ`) and collapses whitespace before matching.

### The 19 known statuses

Discovered by parsing the sidebar HTML — every status appears in the sidebar as a `<li>` with a numeric ID in the URL.

| ID | Slug | Confirmed timeline label | Source of confirmation |
|---|---|---|---|
| 1 | `AT_CUSTOMER` | `عند العميل` | ✅ Observed in 4 fixtures |
| 2 | `BEING_PREPARED` | `جارى التجهيز` | ✅ Observed in 4 fixtures |
| 3 | `IN_COMPANY` | `فى الشركة` | ✅ Observed in 3 fixtures |
| 4 | `WILL_BE_SENT_TO_BRANCHES` | *guess: `سترسل للفروع`* | ⚠️ Unconfirmed |
| 5 | `EN_ROUTE_TO_BRANCHES` | *guess: `بالطريق للفروع`* | ⚠️ Unconfirmed |
| 6 | `ARRIVED_AT_BRANCHES` | *guess: `وصلت الفروع`* | ⚠️ Unconfirmed |
| 7 | `OUT_FOR_DELIVERY` | `جارى التوصيل` | ✅ Observed in 1 fixture |
| 8 | `DELIVERY_POSTPONED` | *guess: `مؤجلة التسليم`* | ⚠️ Unconfirmed |
| 9 | `POSTPONED_WITH_COURIER` | *guess: `مؤجلة مع المندوب`* | ⚠️ Unconfirmed |
| 10 | `DELIVERED` | `تم التسليم` | ✅ Observed in 1 fixture |
| 11 | `PARTIALLY_DELIVERED` | *guess: `تم تسليمها جزئياً`* | ⚠️ Unconfirmed |
| 12 | `REPLACED` | *guess: `تم إستبدالها`* | ⚠️ Unconfirmed |
| 13 | `RECEIPT_REFUSED` | *guess: `رفض إستلام`* | ⚠️ Unconfirmed |
| 14 | `RETURNING_VIA_COURIER` | *guess: `راجع لدى المندوب`* | ⚠️ Unconfirmed |
| 15 | `RETURNING_AT_BRANCHES` | *guess: `راجعة بالفروع`* | ⚠️ Unconfirmed |
| 16 | `RETURNING_TO_COMPANY` | *guess: `راجع إلى الشركة`* | ⚠️ Unconfirmed |
| 17 | `RETURNED_AT_COMPANY` | *guess: `راجع فى الشركة`* | ⚠️ Unconfirmed |
| 25 | `AWAITING_COURIER_SETTLEMENT` | `تسليم تحت تسويه المندوب` | ✅ Observed in 1 fixture |
| 29 | `SENT_TO_COURIER` | `إلى المندوب` | ✅ Observed in 2 fixtures |

**7 confirmed, 12 unconfirmed.** The unconfirmed ones were derived by stripping the `طلبات` prefix from the sidebar label. For the 7 we observed, this prefix-stripping rule held without exception — which is moderate evidence it'll hold for the rest. But not proof.

### Why we left the guesses in rather than waiting

The user (the merchant operating this integration) chose **Option B** when asked: rather than capturing one page per status to confirm labels upfront, let real-world traffic confirm them organically over time. The parser is designed for this:

- When a status label doesn't match the taxonomy, `findStatusByLabel()` returns `null`.
- `getOrderStatus()` and `getOrderTracking()` propagate this: they return the raw Arabic string with `statusId: null` and `slug: null` instead of throwing.
- A logger should fire on every `null` resolution with the raw label, so we can incrementally fill in the gaps as orders flow through unobserved states.

**This is a deliberate design decision, not a TODO.** Don't "fix" it by adding throws on unknowns. The graceful degradation is what keeps the OMS running while we learn.

### Status IDs in the gaps (18–24, 26–28)

The numbering has gaps. We don't know if these are deprecated, reserved, or just never appeared in this merchant's data. If `ajax-order-case` ever returns a `status_name` we don't recognize, the logger will catch it and we'll know.

### Two statuses without numeric IDs

The sidebar also has two items that use **dedicated routes**, not the `/merchant/all-orders/{N}` pattern:

- `/merchant/pending-orders` → `طلبات قيد الإنتظار` ("orders awaiting acceptance")
- `/merchant/rejected-orders` → `طلبات تم رفضها` ("rejected orders")

Their internal numeric status IDs (as Dexpress represents them) are unknown. The taxonomy doesn't include them. If `ajax-order-case` ever returns one of these labels, we'd need to extend the taxonomy.

---

## The session/auth context (recap of the existing helper)

The full details live in [`dexpress-integration.md`](./dexpress-integration.md). The condensed version that's relevant here:

- Authentication is **cookie-based** (`laravel_session`), 2-hour lifetime.
- The helper in `client.ts` does plain server-side `fetch` with manually-managed cookies.
- Sessions are cached in Supabase table `dexpress_sessions`.
- On `302 → /login`, the helper invalidates the cached session, re-logs in, and retries once.
- All HTTP calls are wrapped in a 15-second timeout (`AbortSignal.timeout(15_000)`).
- The helper manages only the `laravel_session` cookie. Set-Cookie absorption on later requests is incomplete (it refreshes the DB expiry but doesn't fully re-parse rotated cookies). For status fetches this doesn't matter — both endpoints are GETs with no CSRF and no body — but it's worth knowing if write operations are ever added here.

The status module imports `authenticatedFetch` from `client.ts`. The contract is: takes a path like `/merchant/track-order/123`, returns a `Response`, handles 302→login retry internally. If the actual exported name or shape differs, the import on line 39 of `dexpress-tracking.ts` is the only thing that needs to change.

---

## What we didn't reverse-engineer (yet)

The merchant's dashboard needs more than single-order lookups. Specifically, three things we haven't tackled:

### 1. Bulk list endpoints — `/merchant/all-orders/{statusId}`

These return an HTML table of every order in a given status. We've seen the URL pattern from the sidebar but not captured a list page yet.

What we know from the sidebar links:
- `/merchant/all-orders/1` through `/merchant/all-orders/17`, plus `/merchant/all-orders/25` and `/merchant/all-orders/29`.
- Plus `/merchant/pending-orders` and `/merchant/rejected-orders` (the two without numeric IDs).

What we don't know:
- Table column structure (likely: order ID, customer phone, destination, amount, dates — but unconfirmed).
- Whether pagination exists. Some sidebar counts are 32, 21, 17 — small enough that the portal may render all on one page, but we can't assume that for larger merchants or higher-volume statuses.
- Whether the list page has filter/search query parameters.

A list-page parser plus a `listOrdersByStatus(statusId)` function would unlock OMS dashboard tables.

### 2. Sidebar badges (essentially free)

Every authenticated page response includes the full left sidebar with all 21 status badge counts inline. The HTML structure is straightforward:

```html
<li class="nav-item">
  <a href="https://portal.dexpress.ly/merchant/all-orders/10" class="nav-link nav-toggle">
    <i class="fa fa-check-square-o"></i>
    <span class="title">طلبات تم تسليمها</span>
    <span class="badge badge-success">17</span>
  </a>
</li>
```

A `parseSidebarBadges(html)` function could extract `{ 1: 0, 2: 1, 3: 16, 4: 32, ..., 25: 10, 29: 20, "pending-orders": 9, "rejected-orders": 0 }` from any authenticated page response. This is dashboard widget gold and costs nothing extra — every other endpoint already returns the sidebar as a side effect.

Sidebar-label-to-URL mapping is observable directly in the HTML and matches what's in `dexpress-statuses.ts`.

### 3. Reports — `/merchant/summary-statement`, `/merchant/statement`, `/merchant/orders-report`, `/merchant/sales-analysis`

The sidebar also exposes a "Reports" section with these four URLs. Completely unexplored. Likely contain:

- Aggregate metrics (delivery rate, revenue, average time-to-delivery).
- Date-range filters (since "statement" implies financial reporting periods).
- Possibly downloadable Excel exports (Dexpress already supports `/merchant/add-from-excel` for imports).

Higher complexity (date filters complicate the URL pattern), higher payoff (real analytics for the merchant).

### A small adjacent endpoint worth noting

The page header has a notifications dropdown. The HTML reveals an endpoint `/merchant/update-notfications/{id}` (note: misspelled `notfications`, not `notifications` — that's their typo, mirror it exactly). It's called as a fire-and-forget `GET` when a notification is clicked, presumably to mark it as read. Not relevant to status tracking but documenting the existence in case it's useful.

There's also `/merchant/order-info/{id}` (linked from notifications) and `/merchant/edit-order/{id}` (linked from search modal when `order_accept === 0`). Both unexplored.

---

## The four real fixtures and what each proves

Located in `tests/fixtures/`. Each is a real HTML response from a real order, captured via DevTools and pasted intact into the codebase.

| File | Order ID | Status | What it tests |
|---|---|---|---|
| `track-order-delivered-1138841.html` | 1138841 | Delivered (10) | Full 7-event lifecycle; all 7 timeline labels in their natural sequence; ISO timestamp conversion for both AM and PM times; courier info on delivery events |
| `track-order-to-courier-1339635.html` | 1339635 | Sent to courier (29) | Mid-lifecycle order; courier with name structure `سامي محمد جارالله الصيد(طبرق)` (no space before paren); AM 02:55 timestamp |
| `track-order-in-prep-1343545.html` | 1343545 | Being prepared (2) | Minimal 2-event timeline; proves parser handles small timelines without breaking; no courier info present on either event |
| `track-order-to-courier-1340843.html` | 1340843 | Sent to courier (29) | Different courier-name format: `مجدى (البيضاء)` (short name, standard parens); proves parser is robust across name structures |

The vitest test file (`dexpress-tracking.test.ts`) asserts specific expected outputs for each. If a test ever fails, Dexpress changed something — the fixture is the ground truth.

To capture new fixtures: log into the portal, navigate to a tracking page, in DevTools Network tab find the `track-order/{id}` request, right-click → Copy → Copy Response. Save to `tests/fixtures/`. Pattern: `track-order-{shortdescription}-{orderid}.html`.

---

## Design constraints worth preserving

These aren't suggestions — they're decisions made with reasoning, and changing them will introduce bugs.

### Graceful degradation on unknown statuses

Already explained above. The parser must NEVER throw on an unrecognized Arabic label. Return `statusId: null, slug: null, statusName: <raw>`. The logger catches these as a feedback loop for filling in unconfirmed labels.

### Don't auto-follow redirects

The existing session helper uses `redirect: "manual"` because the 302→/login signal is the only reliable way to detect session expiry. If a future endpoint client follows redirects, you'll lose the auth-expiry signal silently. Inherit the same setting.

### Don't open new sessions for read operations

The status endpoints share the cookie jar with create/delete. Don't write a separate "fetch with my own cookies" path. Even if it works initially, you'll end up with two session caches, two re-login flows, and surprising rate-limit behavior. Use the existing helper.

### Don't try to extract structured data from courier-name strings

The format `NAME (BRANCH)` looks parseable but the real data has wide variance (spaces, paren positions, name lengths). The parser captures the raw string verbatim. If a future feature needs name-vs-branch separately, do it as a separate parsing step downstream — don't put it inside the timeline parser.

### Keep `parseTrackingHtml()` pure

It takes `(orderId, html)` and returns structured data. No I/O, no logging, no side effects. This is why fixture-based tests work. Don't add a "log unknown labels" callback inside it — instead, walk the returned events at the caller and log there. Pure functions are testable; impure ones aren't.

### Logger placement

The unknown-label logger that closes the taxonomy gap should live at the **module boundary** (`getOrderStatus`, `getOrderTracking`), not inside the parser. Inspect the returned object: if `statusId === null && statusName.length > 0`, log a warn with the order ID and raw label. This keeps the parser pure and makes the observability behavior visible at the call site.

---

## Rate-limiting and politeness

We don't know Dexpress's actual rate limits. Reasonable defaults observed working in production for create/delete:

- Reuse the cached session aggressively. 2-hour cookie, so login once per ~2 hours not per-request.
- For background polling: cap at one `getOrderStatus()` per few seconds per order.
- For bulk operations (when the list endpoint exists): a few hundred ms between calls.
- Prefer `getOrderStatus()` over `getOrderTracking()` for polling. Less data, less Dexpress server load.

If we ever see 429 or 503 responses, those would be the signal to back off. We haven't seen them yet.

---

## Brittleness profile — what would break this and how to detect it

This integration depends on the following remaining stable in the Dexpress portal:

- URL patterns: `/merchant/track-order/{id}`, `/merchant/ajax-order-case/{id}`, `/merchant/all-orders/{statusId}`, `/login`, `/merchant/add-orders`, `/merchant/delete-order/{id}`.
- The `response_case === 201` success convention for `ajax-order-case`.
- The `حالة الطلب :` prefix in the page header.
- CSS class names: `.portlet-title`, `.timeline-item`, `.timeline-body-title`, `.timeline-body-content`.
- Font Awesome icon classes used for content-block disambiguation: `fa-motorcycle`, `fa-phone`, `fa-calendar`, `fa-clock-o`.
- The Arabic time format `HH-MM-SS م/ص`.
- The numeric status ID system in `/merchant/all-orders/{N}` URLs.
- Laravel's `_token` CSRF system (relevant to create, not status).

Detection: when `getOrderTracking()` returns zero events for an order known to have history, when current-status header is `""`, when all timeline statuses come back as `statusId: null` — those are red flags. Log responses on unexpected outcomes so debugging is one log line away.

The fixture-backed tests will catch HTML structure changes the moment they happen — but only if the tests are actually run in CI. Don't skip that.

---

## Open questions in priority order

These are things we're not blocked on but should know eventually:

1. **The literal `ajax-order-case` response body and content-type.** Currently inferred from portal JS. One console-snippet capture confirms it.
2. **Whether the right "follow-up notes" portlet (`بيانات المتابعة`) ever populates.** Currently the parser would mix those events with the tracking timeline. Need to find an order with follow-up notes to know if/when that happens.
3. **List page structure** (`/merchant/all-orders/{N}` HTML). Required for bulk dashboard functionality.
4. **List page pagination.** Does it exist? What's the URL parameter?
5. **The 12 unconfirmed timeline labels.** Will be confirmed organically as orders flow through those states; the logger captures them.
6. **The numeric status IDs (if any) for `pending-orders` and `rejected-orders` routes.**
7. **What happens on `ajax-order-case` with a non-existent order ID.** Need to test with an obviously bad ID and see what `response_case` value comes back.
8. **Reports section structure** — `/merchant/summary-statement`, `/merchant/statement`, `/merchant/orders-report`, `/merchant/sales-analysis`.

---

## File index

- [`dexpress-integration.md`](./dexpress-integration.md) — auth, session, create order
- [`dexpress-delete-order.md`](./dexpress-delete-order.md) — delete endpoint
- [`dexpress-tracking.md`](./dexpress-tracking.md) — module API reference (`getOrderStatus`, `getOrderTracking`, taxonomy lookup)
- [`dexpress-states.json`](./dexpress-states.json) — destination ID + route ID mapping (128 entries, used by create)
- `src/dexpress-statuses.ts` — 19-status taxonomy + label-lookup helpers
- `src/dexpress-tracking.ts` — `getOrderStatus()`, `getOrderTracking()`, `parseTrackingHtml()`
- `src/client.ts` — existing session helper (consumed via `authenticatedFetch`)
- `tests/dexpress-tracking.test.ts` — vitest suite
- `tests/fixtures/track-order-*.html` — four real HTML captures
- This document — the why-and-how
