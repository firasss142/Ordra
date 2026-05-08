# Dexpress Integration — Reverse-Engineering Notes

## Context

[Dexpress](https://portal.dexpress.ly/) is the delivery company we use. They do **not** offer a public API, and when asked, they confirmed there's no API and gave permission to "find any workarounds." So we reverse-engineered their merchant portal to drive order creation programmatically from our Next.js app.

This document is the canonical record of what we found and how to use it. The companion file [`dexpress-states.json`](./dexpress-states.json) contains the destination ID mapping needed when building order payloads.

---

## What the portal actually is

It's a **server-rendered Laravel 5.x application** (PHP 7.1.33). There is no JSON API hiding underneath — the site renders HTML pages and accepts traditional form POSTs. Authentication is **cookie-based** (`laravel_session`), not token-based.

Key consequence: to integrate, we have to **simulate a browser session**, not call clean REST endpoints. Every form submission must include a CSRF token (`_token`) scraped from the previous HTML page.

---

## The four-step flow for creating an order

| # | Method | URL | Purpose |
|---|--------|-----|---------|
| 1 | `GET`  | `/login`               | Receive initial cookies (`XSRF-TOKEN`, `laravel_session`) and scrape `_token` from hidden input on login page |
| 2 | `POST` | `/login`               | Authenticate. Body: `application/x-www-form-urlencoded` with `_token`, `email`, `password`. Returns **302** → `/merchant`. The `laravel_session` cookie is rotated to an authenticated one |
| 3 | `GET`  | `/merchant/add-orders` | Scrape a fresh `_token` from the order form HTML |
| 4 | `POST` | `/merchant/add-orders` | Submit the order. Body: `multipart/form-data`. Returns **302** → `/merchant/success-added-order/{ORDER_ID}`. The order ID is parsed from the redirect `Location` header |

### Critical details

- **Session cookies persist across requests** — the same `laravel_session` cookie that login produced must be sent on steps 3 and 4. Use a cookie jar.
- **Do not auto-follow redirects.** We need to read the `Location` header on the 302 from step 4 to get the order ID.
- **Step 2 is `application/x-www-form-urlencoded`**, but step 4 is `multipart/form-data`. They are not interchangeable — the order form uses multipart (likely because the original form supported file uploads).
- **CSRF token rotation**: in practice the `_token` value tends to stay the same within a session, but we re-scrape it on step 3 to be safe. If Laravel ever rotates it, our integration won't break.
- **Empty fields must still be sent.** The browser sends `name=""`, `notes=""`, `dimensions[weight]=""`, etc. as empty strings. Omitting them entirely can cause validation failures. Send them with empty string values.

---

## Order payload — field reference

This is the full payload structure for `POST /merchant/add-orders`. Field names with brackets (`dimensions[weight]`) must be sent verbatim — they are PHP array notation that Laravel decodes server-side.

### Account-level fields (constant for our merchant)

| Field | Value | Notes |
|-------|-------|-------|
| `merchant_id` | `807` | Our merchant account ID. Hardcoded. |
| `from_state` | `62` | Pickup state ID (Tripoli = 62). Hardcoded — we ship from one location. |
| `from_place` | `0` | Pickup sub-area. `0` = none. |
| `has_places` | `no` | Whether the destination uses sub-places. We've been sending `no`. |
| `cost_type` | `1` | Enum, meaning unknown. Mirrored from a known-good submission. |
| `order_type` | `2` | Enum, meaning unknown. Mirrored from a known-good submission. |

### Per-order fields

| Field | Example | Notes |
|-------|---------|-------|
| `_token` | `LkElQXgt6poZ...` | CSRF token, scraped from the order page on each submission. |
| `phone` | `9325099500` | Customer's primary phone. |
| `phone_2` | *(empty allowed)* | Optional secondary phone. |
| `name` | *(empty allowed)* | Recipient name. |
| `to_state` | `1` | **Destination state ID.** See [`dexpress-states.json`](./dexpress-states.json). |
| `to_place` | `0` | Sub-area within the state. `0` = none / unspecified. |
| `route_id` | `2` | **Tied to `to_state`** — read it from the same JSON entry. See note below. |
| `address` | `tripoli` | Free-text street address. |
| `info` | `fragile` | Item description / handling info. |
| `notes` | *(empty allowed)* | Internal notes. |
| `qty` | `1` | Number of items. |
| `sub_total` | `50` | Item value (what the merchant charges the customer for the goods). |
| `cost` | `35` | Delivery fee. |
| `total` | `85` | Sum of `sub_total + cost`. The frontend computes this; we should too. |
| `cost_inclusive` | `not_inclusive` | Whether delivery fee is included in `sub_total`. Enum: `not_inclusive` / `inclusive`. |
| `breakable` | `0` | Boolean flag (0/1). |
| `packing` | `0` | Boolean flag (0/1). |
| `plus_weight_cost` | *(empty allowed)* | Extra weight surcharge, usually empty. |
| `dimensions[weight]` | *(empty allowed)* | Package weight. |
| `dimensions[length]` | *(empty allowed)* | Package length. |
| `dimensions[width]` | *(empty allowed)* | Package width. |
| `dimensions[height]` | *(empty allowed)* | Package height. |

### Important: `route_id` depends on `to_state`

The `route_id` is **not free-choice**. Each destination state is bound to a specific route, and the portal's frontend JavaScript auto-fills `route_id` when you pick a destination. We must do the same: when building the payload, look up the destination in `dexpress-states.json` and use its `routeId` value.

Example:
- Destination = Tripoli (`id: 62`) → use `route_id: 12`
- Destination = Benghazi (`id: 10`) → use `route_id: 15`
- Destination = Misrata (`id: 6`) → use `route_id: 1`

Sending the wrong `route_id` for a destination may either fail validation or, worse, silently route the order incorrectly.

---

## States data — see [`dexpress-states.json`](./dexpress-states.json)

The companion JSON file contains all **128 destinations** scraped from the `<select name="to_state">` dropdown on the order form. Each entry has:

```json
{
  "id": 62,
  "name": "طرابلس",
  "routeId": 12,
  "sampleAutoDeliveryDate": "2026-05-09"
}
```

- `id` → goes into `to_state`
- `routeId` → goes into `route_id`
- `name` → Arabic city/area name (display only)
- `sampleAutoDeliveryDate` → present on some entries; it was the next delivery date on the day we scraped (2026-05-08). **Do not rely on this** — it changes daily. If we ever need accurate delivery dates, we should re-scrape live.

### Refreshing the data

If Dexpress adds, removes, or renames destinations, this file goes stale. To refresh:

1. Log into the portal.
2. Visit `/merchant/add-orders`.
3. Open DevTools, find `<select name="to_state">`, copy its `outerHTML`.
4. Re-run the parser script we used originally (it lives in this same repo as `parse.js` if we want to keep it around).

Worth doing maybe quarterly, or whenever an order fails with an unknown state ID.

---

## Validated end-to-end

We replayed the full flow in Postman with real credentials. The order showed up correctly on the Dexpress dashboard with the expected destination, customer phone, and amounts. Order ID was correctly extracted from the `Location` header of the 302.

---

## Open considerations / things to handle in production

These are not blockers but should be addressed before this feels solid in production.

### 1. Session caching
The `laravel_session` cookie is valid for **2 hours** (`Max-Age=7200`). Logging in for every order is wasteful and could get our account flagged. Cache the cookie with its expiry timestamp; reuse it across order creations; re-login only when expired or when a request returns 302→`/login` (Laravel's "you got logged out" signal).

On serverless (Vercel), we can't use in-memory caching — invocations don't share state. Options:
- Redis / Upstash for the cookie store.
- Database row holding the current session.
- Accept a fresh login per cold start (works but wastes credentials).

On a long-running Node server, in-memory is fine.

### 2. Validation error handling
When the order form validation fails server-side, Laravel returns **200** (not 302) with the form re-rendered and error messages embedded in HTML (look for `invalid-feedback` or `is-invalid` CSS classes). Our integration should detect "200 instead of 302" as a failure case, parse the errors out of the HTML, and surface them — not pretend the order succeeded.

### 3. Terms of Service / written authorization
We have verbal permission from Dexpress to "find workarounds." Worth getting that in writing (email or chat log) and saving it, in case the relationship changes.

### 4. Credentials hygiene
Dexpress credentials must never reach the browser. All four steps run server-side only — Next.js API route or server action. Credentials live in environment variables, never in client code or `NEXT_PUBLIC_*` vars.

### 5. Rate limiting / politeness
We don't know what rate limits Dexpress applies. For batch operations (e.g., dispatching 50 orders at once), pace the calls (a few hundred ms between requests) and reuse the session cookie.

### 6. Brittleness
This integration breaks if Dexpress changes:
- The form field names.
- The login URL or method.
- The redirect URL pattern (`/merchant/success-added-order/{id}`).
- The CSRF token mechanism.

Log the response HTML on unexpected outcomes so we can debug fast when it does break.

### 7. Beyond create
Future work — same reverse-engineering approach applies for order status checks, listing, and cancellation. Each new operation = capture the request in DevTools → identify form fields → replicate.

---

## File index

- [`dexpress-states.json`](./dexpress-states.json) — destination ID + route ID mapping (128 entries)
- This file — the why and the how
