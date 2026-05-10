# Dexpress Integration — Delete Order Endpoint

## Context

This document covers the **order deletion** endpoint in the Dexpress merchant portal. It complements [`dexpress-integration.md`](./dexpress-integration.md), which covers the broader integration approach (cookie-based Laravel session auth, CSRF tokens, the four-step order creation flow).

If you haven't read that file yet, read it first — this one assumes you understand:
- How session auth works (`laravel_session` cookie, 2-hour lifetime).
- That we simulate a browser session rather than calling a clean API.
- The cookie jar pattern used across requests.

The delete endpoint was reverse-engineered from the merchant dashboard the same way: capture the request in DevTools → identify the URL/method/headers → replicate.

---

## TL;DR

```
GET /merchant/delete-order/{ORDER_ID}
```

- Authenticated via the existing `laravel_session` cookie.
- **No CSRF token required** (Laravel skips CSRF on `GET` requests).
- Returns `200 OK` with an **empty body** on success.
- Returns the **same** `200 OK` + empty body for any `ORDER_ID` — including non-existent, malformed, or another merchant's. There is no failure signal.
- Reuse the session cookie from the login flow; no new auth dance needed.

---

## The endpoint

| Property | Value |
|---|---|
| **Method** | `GET` |
| **URL** | `https://portal.dexpress.ly/merchant/delete-order/{ORDER_ID}` |
| **Auth** | `laravel_session` cookie (from the login flow) |
| **Body** | None |
| **CSRF token** | **Not required** — Laravel only enforces CSRF on `POST/PUT/PATCH/DELETE`, not `GET` |

### Path parameter

- `ORDER_ID` — integer. The order ID returned from the create flow (parsed from the `Location` header of the 302 redirect, e.g. `/merchant/success-added-order/1320434` → `1320434`).

### Required headers

The dashboard sends these and we should mirror them. The session cookie is the only one strictly required for auth, but the others are cheap insurance against future server-side checks.

| Header | Value | Why |
|---|---|---|
| `Cookie` | `laravel_session=...; XSRF-TOKEN=...` | Auth. Handled by the cookie jar. |
| `X-Requested-With` | `XMLHttpRequest` | The dashboard's JS sends this. Some Laravel apps branch on it (e.g. return JSON vs HTML) or refuse without it. Mirror it. |
| `Referer` | `https://portal.dexpress.ly/merchant/pending-orders` | Sent by the dashboard. Probably not enforced, but cheap to include. |
| `Accept` | `*/*` | Mirrors the dashboard request. |

### Optional / browser-y headers

The browser also sends `User-Agent`, `Accept-Language`, `Sec-Fetch-*`, etc. None of these appear to be enforced; send a reasonable `User-Agent` and skip the rest.

---

## Response shape

### Success (and pseudo-success)

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=UTF-8
Set-Cookie: XSRF-TOKEN=...; ...
Set-Cookie: laravel_session=...; ...

(empty body)
```

- **Status:** always `200`.
- **Body:** always empty.
- **Cookies:** `laravel_session` and `XSRF-TOKEN` are rotated (new values returned). This is normal Laravel behavior on every request — make sure the cookie jar updates.

### "Failure" (silent)

There is **no failure response**. We tested:
- Valid order ID belonging to our merchant → `200`, empty body, order is deleted from the dashboard.
- Same order ID a second time (already deleted) → `200`, empty body.
- Non-existent order ID (e.g. `99999`) → `200`, empty body.
- Malformed order ID (wrong number of digits, garbage values) → `200`, empty body.

The endpoint **never** returns a 4xx, never returns a different body, never redirects on bad input. It silently no-ops and returns success-shaped output regardless of whether anything was actually deleted.

### Logged-out case

If the `laravel_session` cookie is missing or expired, Laravel will most likely redirect to `/login` (302) — the same behavior as other authenticated routes. **This is the only real failure signal we get.** Detection rule:
- `200` + empty body → assume deletion succeeded.
- `302` → `/login` → session expired; re-login and retry.
- Anything else (5xx, unexpected HTML body, etc.) → log and fail loudly.

---

## Critical implications for the implementation

### 1. The 200 is not proof of deletion

Because the endpoint returns the same response for valid, invalid, missing, and unauthorized order IDs, **a 200 response from this endpoint cannot be trusted as confirmation that any specific order was deleted**.

Mitigation: only call this endpoint with order IDs we know belong to our merchant — i.e. IDs we ourselves obtained from a `POST /merchant/add-orders` create flow and stored in our own database. Don't pass user-controlled or speculative IDs.

### 2. Track deletion state on our side

Don't rely on Dexpress to tell us anything about deletion. Mark the order as deleted in our own DB at the moment we send the request and get a 200 back. This gives us:
- An audit trail.
- A way to detect "was this order already deleted by us?" without re-hitting Dexpress.
- A source of truth that doesn't depend on Dexpress's silent endpoint.

### 3. No CSRF token = no GET-page scrape needed

Unlike order creation, we **do not** need to do a `GET /merchant/...` first to scrape a `_token`. Just send the `GET /merchant/delete-order/{id}` directly with the existing session cookie. This is one-step, not two.

### 4. Security smell (their problem, not ours)

The endpoint appears to have no ownership or existence check — any logged-in merchant could in principle pass any order ID. This is a Dexpress security issue and we should not exploit it. **Only delete orders that belong to our merchant**, full stop. If we ever build any user-facing feature that triggers a delete, the order ID must come from our own DB after verifying it belongs to the requesting merchant.

---

## Recommended Next.js implementation pattern

This assumes a server-side helper (Next.js API route, server action, or backend service) that already has session management from the create flow. **Credentials and session cookies must never reach the browser.**

### Pseudocode

```ts
async function deleteDexpressOrder(orderId: number): Promise<DeleteResult> {
  // 1. Get a valid session cookie (from cache, or by logging in).
  //    Same helper used by the create flow.
  const session = await getOrCreateDexpressSession();

  // 2. Send the GET request.
  const response = await fetch(
    `https://portal.dexpress.ly/merchant/delete-order/${orderId}`,
    {
      method: "GET",
      headers: {
        Cookie: session.cookieHeader,
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://portal.dexpress.ly/merchant/pending-orders",
        Accept: "*/*",
        "User-Agent": "Mozilla/5.0 (compatible; OurApp/1.0)",
      },
      redirect: "manual", // do NOT follow redirects — we want to see 302→/login if it happens
    }
  );

  // 3. Update the cookie jar with rotated cookies.
  session.absorbSetCookieHeaders(response.headers);

  // 4. Interpret the response.
  if (response.status === 200) {
    const body = await response.text();
    if (body.trim() === "") {
      // Success (or silent no-op — we cannot tell the difference).
      // Mark the order as deleted in our own DB.
      return { ok: true };
    }
    // 200 with a non-empty body is unexpected — log and fail.
    return { ok: false, reason: "unexpected_200_body", body };
  }

  if (response.status === 302) {
    const location = response.headers.get("Location") ?? "";
    if (location.includes("/login")) {
      // Session expired. Invalidate cache and retry once.
      await session.invalidate();
      return deleteDexpressOrder(orderId); // single retry — guard against infinite loops in real code
    }
    return { ok: false, reason: "unexpected_redirect", location };
  }

  // 4xx, 5xx, anything else → log full response and fail.
  return {
    ok: false,
    reason: "unexpected_status",
    status: response.status,
    body: await response.text(),
  };
}
```

### Notes on the pattern

- **`redirect: "manual"`** is essential. Auto-follow would silently chase the `/login` redirect and we'd lose the only failure signal we have.
- **Cookie absorption.** The response rotates `laravel_session` and `XSRF-TOKEN`. The session helper must read `Set-Cookie` headers and update its store.
- **Single retry on session expiry.** Guard with a counter or a flag — don't allow infinite recursion.
- **Logging.** Always log the order ID, status code, and (for non-200 responses) the body. Cheap to add, invaluable when Dexpress changes something.

### Session caching reminder

Same constraints as the create flow ([see the main integration doc](./dexpress-integration.md#1-session-caching)):
- 2-hour cookie lifetime.
- On Vercel/serverless: use Redis, Upstash, or a DB row to share session across invocations.
- On a long-running Node server: in-memory is fine.

---

## Validation checklist before shipping

- [ ] Delete a real test order → confirm `200` + empty body, order disappears from dashboard.
- [ ] Delete an already-deleted order → confirm same response (proves idempotency).
- [ ] Let the session expire (or manually clear the cookie) → confirm we get a `302` → `/login` and our code re-logs in and retries successfully.
- [ ] Pass a malformed/non-existent order ID → confirm we still get `200` + empty body and our code does **not** misreport this as a deletion of an unrelated record (this is what the "only delete IDs from our own DB" rule prevents).
- [ ] Check that response logs include order ID, status, and body for failed cases.
- [ ] Confirm credentials are server-side only (env vars, not `NEXT_PUBLIC_*`, not in client bundles).

---

## Open considerations / things to watch

### Brittleness
This integration breaks if Dexpress changes:
- The URL pattern `/merchant/delete-order/{id}`.
- The HTTP method (e.g. switches to `POST` with CSRF — entirely possible if they tighten security).
- Adds CSRF, ownership checks, or a confirmation step.

Log unexpected responses (non-200, non-empty body) so we can debug fast when it does break.

### Rate limiting
Same as the create flow — we don't know Dexpress's limits. For batch deletions, pace requests (a few hundred ms between calls) and reuse the session cookie.

### Future operations
The same reverse-engineering approach applies for status checks, listing, and other operations. Each new operation = capture in DevTools → identify the request → replicate.

---

## File index

- [`dexpress-integration.md`](./dexpress-integration.md) — main integration doc (auth flow, create order, payload reference)
- [`dexpress-states.json`](./dexpress-states.json) — destination ID + route ID mapping (128 entries)
- This file — delete order endpoint reference
