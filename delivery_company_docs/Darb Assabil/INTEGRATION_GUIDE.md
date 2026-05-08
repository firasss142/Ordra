# Darb Assabil API — Integration Guide

A practical, end-to-end reference for integrating with the Darb Assabil
shipping platform (Libya). This guide is **vendor-pure** — it documents the
API as it actually behaves, including the parts that differ from the
official documentation. It is not tied to any particular merchant's
codebase.

If you are integrating Darb Assabil from scratch, read this top to bottom
once. Every gotcha noted here was found by hitting the live API; the
official docs and the Postman collection do not always match production
behavior.

---

## 1. Overview

Darb Assabil is a Libyan logistics platform. It exposes a REST API for:

- Listing your service plans (rate cards)
- Listing carrier branches (cities/areas served)
- Creating and tracking local shipments (within Libya)
- Managing receiver contacts
- Calculating shipping cost previews
- Cancelling shipments

The integration model is simple: create a contact for the receiver, then
create a shipment that references a service plan, that contact, and a
destination. The carrier auto-resolves the origin and destination branches.

**Base URL:** `https://v2.sabil.ly`

---

## 2. Authentication

Every request requires **three** headers. Missing any one of them produces
an authentication failure or a misleading "empty results" response.

| Header | Required | Format | Example |
|---|---|---|---|
| `Authorization` | Yes | `apikey <YOUR_API_KEY>` | `Authorization: apikey abc123...` |
| `X-API-VERSION` | Yes | Version string | `X-API-VERSION: 1.0.0` |
| `X-ACCOUNT-ID` | Yes | 24-char ObjectId of your account | `X-ACCOUNT-ID: 692637b42f63874515cebd63` |

### Gotchas

- **The literal word `apikey` is part of the header value.** It is not
  `Bearer`, not `Token`, not `apiKey`. The format is exactly
  `Authorization: apikey <key>` with a single space separator.
- **Bearer tokens also work** if you have a session token from web login,
  but for server-to-server integration always use `apikey`.
- **`X-ACCOUNT-ID`** is your account's ObjectId. It is shown in the
  developer portal at `app.sabil.ly/developer` under "API Headers
  Reference". It is *not* your username.
- **Where to find each value:** Log into `app.sabil.ly`, go to the
  developer page. The `X-ACCOUNT-ID` is shown in plain text. The API key
  must be generated from the "API Keys" page; treat it as a password.

### Recommended setup

Store the API key in an environment variable or secret manager. Never
commit it. The account ID is non-sensitive and can be configured per
environment alongside the base URL.

---

## 3. Response envelope

Every response follows this shape, regardless of HTTP status code:

```json
{
  "status": true,            // boolean — true on success, false on error
  "data": { ... },           // present on success
  "messages": [ ... ],       // present on error (sometimes also on success)
  "metrics": { "handledInMs": 12, "respondInMs": 14 }
}
```

### Critical gotcha — HTTP 200 does not mean success

**The HTTP status code is almost always 200.** Validation failures, missing
fields, and invalid ObjectIds all return HTTP 200 with `status: false` and
a populated `messages` array. Your client code **must** check
`body.status === true` before treating a response as successful.

A naive integration that only checks `response.ok` (HTTP 2xx) will:
- Treat validation failures as successes
- Miss the actual error message
- Potentially retry shipments that "failed" but actually never reached the
  carrier — or worse, double-create shipments because the first attempt
  was misclassified

### Error message shape

```json
{
  "status": false,
  "messages": [
    {
      "message": "Value is not an instanceOf ObjectId!",
      "name": "localShipments.body",
      "location": "localShipments.body.service",
      "stack": "Error: Value is not an instanceOf ObjectId!\n    at ..."
    }
  ]
}
```

The `location` field tells you exactly which input field failed
validation. The `stack` field is a full server-side stack trace — useful
during integration but should not be surfaced to end users in production.

---

## 4. Data conventions

A few formatting rules that the official docs get wrong or omit:

| Field | Rule | Wrong | Right |
|---|---|---|---|
| `countryCode` | Lowercase ISO-3 | `LBY` | `lby` |
| `currency` | Lowercase ISO-4217 | `LYD` | `lyd` |
| Cities/areas | Native Arabic UTF-8 | `Tripoli` | `طرابلس` |
| ObjectId fields | 24-char hex string | — | `692637b42f63874515cebd63` |

The official docs show `LBY` and `LYD` uppercase. Production rejects
those values silently — the request gets through and validates everything
*else*, but the country lookup fails and you get
`Cannot read properties of undefined (reading 'name')` referring to
`to.country`. Always use lowercase.

### Reference format

Created shipments are identified two ways:

- **`_id`** — internal ObjectId, e.g. `69fd0af4889e7a3cd010f1a1`. Used in
  `GET`/`DELETE /api/local/shipments/:id`.
- **`reference`** — human-readable code, e.g. `SH1584689`. Used in
  `GET /api/local/shipments/timeline/:reference`. **The format is
  `SH<digits>`, not `DS-12345` as the official docs show.**

Both can be used to look up a shipment, but they live in different
endpoints. Save both when you create a shipment; you'll need them for
different operations.

---

## 5. Endpoints

### 5.1 Health / auth check

```
GET /api/wallet/metadata
```

Returns your account's default wallet type and supported currencies.
Useful as a "test connection" call to verify auth headers are wired up
correctly before doing anything destructive.

**Success response:**
```json
{
  "status": true,
  "data": {
    "defaultType": "local",
    "availableTypes": ["local", "international", "local-bank"],
    "defaultCurrency": "lyd",
    "availableCurrencies": ["lyd", "usd"]
  }
}
```

If this returns `status: false` or HTTP 401, your auth headers are wrong.
Stop and fix them before continuing.

### 5.2 List service plans

```
GET /api/local/service/rates/public
```

Returns the service plans (rate cards) available on your account. **Do
not pass an `:id` path parameter** — the documented form
`/api/local/service/rates/public/:id` exists but with `:id` populated as
your account ID it returns an empty list. Calling without any path
parameter returns the actual list.

**Success response:**
```json
{
  "status": true,
  "data": {
    "results": [
      {
        "_id": "6783c612dcf305c9e775c987",
        "title": "توصيل رجالي",
        "currency": "lyd",
        "amount": 0,
        "priority": 4,
        "attributes": ["male"],
        "isPrimary": true
      },
      {
        "_id": "67c84fbc9ed6c0d5c5bb1d2b",
        "title": "توصيل نسائي",
        "currency": "lyd",
        "amount": 10,
        "priority": 2,
        "attributes": ["female"]
      }
    ]
  }
}
```

The `_id` of the desired service is what you pass as `service` in
shipment creation. You typically pick one as your default and store its
ID in your configuration.

**Service `attributes`** is the most useful metadata. Common values:

| Attribute | Meaning |
|---|---|
| `male` | Male courier delivers |
| `female` | Female courier delivers |
| `express` | Faster/priority delivery |
| `normal` | Standard delivery |
| `deposit` | Cash collection-only service |

The male/female split exists for cultural appropriateness — a female
recipient may prefer a female courier. If your platform supports
collecting customer gender or preference, route to the matching service.

`isPrimary: true` flags the account's default service.

### 5.3 List carrier branches (optional)

```
GET /api/local/branches/public?offset=0&limit=100
```

Returns Darb Assabil's delivery branches across Libya. Each entry has a
city, area, polygon zone, and per-area delivery rates. **You do not need
to send a branch ID when creating shipments** — the carrier auto-resolves
the destination branch from the recipient's city/area. This endpoint is
mainly useful for:

- Validating that a city/area is served before submitting an order
- Building a destination autocomplete in your UI
- Showing per-area delivery surcharges to the customer

**Critical:** the documented form `/api/local/branches/public/:id`
filters by an account ID and almost always returns an empty list when
you pass your own merchant account. Use the form *without* a path
parameter.

The default `offset` query parameter on this endpoint is `2` per the
schema, which silently skips the first two results. Always pass
`offset=0` explicitly.

### 5.4 Create or upsert a contact

```
POST /api/contacts/create/public/contact
```

**Body:**
```json
{
  "account": "692637b42f63874515cebd63",
  "name": "Customer Name",
  "phone": "+218911234567"
}
```

Phone numbers must be in E.164 format (`+` then country code then
number). Libyan numbers start with `+218`.

**Success response:**
```json
{
  "status": true,
  "data": {
    "_id": "67e778264cd046f533aeb900",
    "phone": "+218911234567",
    "accounts": ["...", "..."],
    "nameMap": { "692637b42f63874515cebd63": "Customer Name" },
    "successCount": 2,
    "failureCount": 2
  }
}
```

### Important: this endpoint is idempotent by phone

This is **not** "create a new contact every time." It is "find or upsert
by phone number." If the phone number already exists in Darb Assabil's
shared contact directory (across *all* merchants on the platform), the
existing contact is returned with the *same* `_id`, your account is
appended to the contact's `accounts` array, and your custom name is
added to `nameMap`.

**What this means for your integration:**

- You can safely call this endpoint on every shipment creation. You will
  not create duplicates.
- The `_id` returned is stable for a given phone number — you can also
  cache it on your side keyed by phone, if you want to avoid the round
  trip.
- The `successCount` / `failureCount` fields reflect platform-wide
  delivery history for that phone number, not yours alone. Useful for
  fraud signals (see also `GET /api/contacts/trust/score?phone=...`).

### 5.5 Calculate shipping cost (preview)

```
POST /api/local/shipments/calculate/shipping
```

**Body:**
```json
{
  "service": "6783c612dcf305c9e775c987",
  "paymentBy": "receiver",
  "products": [
    {
      "title": "Product Name",
      "quantity": 1,
      "amount": 100,
      "currency": "lyd",
      "isChargeable": true
    }
  ],
  "to": {
    "countryCode": "lby",
    "city": "طرابلس",
    "area": "الرياضية"
  }
}
```

**Success response (excerpt):**
```json
{
  "status": true,
  "data": {
    "invoices": [
      {
        "currency": "lyd",
        "items": [
          { "type": "product", "amount": 100, "currency": "lyd", "quantity": 1 },
          {
            "type": "shipping",
            "amount": 5,
            "currency": "lyd",
            "breakdown": {
              "branchToBranch": 0,
              "pickFromDoor": 0,
              "dropToDoor": 5
            }
          }
        ]
      }
    ],
    "remainings": [{ "currency": "lyd", "remainings": { "amount": 105 } }]
  }
}
```

The `breakdown` object splits shipping into three legs:

- **`pickFromDoor`** — surcharge for picking up from the merchant's door
- **`branchToBranch`** — inter-branch transit cost
- **`dropToDoor`** — surcharge for delivering to the customer's door

Use this endpoint before creating a shipment if you want to display the
cost to the customer or to your operations team. It is otherwise
optional.

### 5.6 Create a shipment

```
POST /api/local/shipments
```

**Body:**
```json
{
  "service": "6783c612dcf305c9e775c987",
  "contacts": ["67e778264cd046f533aeb900"],
  "paymentBy": "receiver",
  "to": {
    "countryCode": "lby",
    "city": "طرابلس",
    "area": "الرياضية",
    "address": "Street name, building, apartment"
  },
  "products": [
    {
      "title": "Product Name",
      "quantity": 1,
      "amount": 100,
      "currency": "lyd",
      "isChargeable": true
    }
  ],
  "notes": "Optional internal notes"
}
```

#### Required fields

| Field | Type | Notes |
|---|---|---|
| `service` | ObjectId string | From step 5.2 |
| `contacts` | Array of ObjectId strings | At least one; from step 5.4 |
| `paymentBy` | Enum | `sender`, `receiver`, or `sales` (see below) |
| `to.countryCode` | String | Lowercase, e.g. `lby` |
| `to.city` | String | Arabic UTF-8 |
| `to.area` | String | Arabic UTF-8 |
| `products` | Array | At least one |
| `products[].title` | String | Display name |
| `products[].quantity` | Integer | ≥ 1 |
| `products[].amount` | Number | Per-unit price (the COD amount, if applicable) |
| `products[].currency` | String | Lowercase, e.g. `lyd` |
| `products[].isChargeable` | Boolean | If `true` and `paymentBy=receiver`, this amount is collected on delivery |

#### `paymentBy` values

- **`receiver`** — Cash on Delivery. The customer pays the carrier on
  delivery, and the carrier later remits the COD amount to you. Use this
  for COD e-commerce.
- **`sender`** — You (the merchant) prepaid the shipping. Customer pays
  nothing on delivery. Used for free-shipping promotions.
- **`sales`** — The carrier deducts the shipping fee from the COD amount
  before settling with you. Different accounting flow.

#### Optional fields

| Field | Type | Notes |
|---|---|---|
| `to.address` | String | Free-text street address (max 100 chars) |
| `to.geoPoint.coordinates` | `[long, lat]` | If you have GPS pickup |
| `notes` | String | Internal notes for the carrier |
| `tags` | String[] | Free-form labels |
| `metadata` | Object | Arbitrary key-value pairs |
| `pickupAt` | ISO timestamp | Scheduled pickup time |
| `isPickup` | Boolean | Whether the carrier picks up from you |
| `allowCardPayment` | Boolean | Customer can pay by card on delivery |
| `cardFeePaymentBy` | `sender` \| `receiver` | Who pays the card fee |
| `products[].widthCM`, `heightCM`, `lengthCM` | Number | Per-product dimensions |

If you don't send dimensions, Darb Assabil applies a default box
(`حجم مجاني 1` — "Free Size 1", currently 50×40×40 cm) at no extra cost.

#### Success response (full example)

```json
{
  "status": true,
  "data": {
    "_id": "69fd0af4889e7a3cd010f1a1",
    "reference": "SH1584689",
    "status": "pending",
    "service": "6783c612dcf305c9e775c987",
    "contacts": ["67e778264cd046f533aeb900"],
    "paymentBy": "receiver",
    "to": { "countryCode": "lby", "city": "طرابلس", "area": "الرياضية", "address": "...", "country": "Libya" },
    "from": { "countryCode": "lby", "city": "...", "area": "...", "address": "", "location": { "lat": 17.2283, "long": 26.3351 } },
    "fromBranch": "67c84ccb9ed6c0d5c5bb1d06",
    "fromBranchAccount": "67c84c9c9ed6c0d5c5bb1d04",
    "fromBranchGroup": "KF",
    "toBranch": "67e6f4c4004017487f73a7a5",
    "toBranchAccount": "67e6f3f9004017487f73a7a0",
    "toBranchGroup": "TR",
    "products": [ { "_id": "...", "title": "...", "quantity": 1, "amount": 100, "currency": "lyd", "box": { ... } } ],
    "invoices": [ { "currency": "lyd", "items": [ ... ] } ],
    "timeline": [ { "type": "info", "description": { "en": "Shipment is created", "ar": "تم إنشاء الشحنة" }, "timestamp": "..." } ],
    "createdAt": "...",
    "updatedAt": "...",
    "notes": "..."
  }
}
```

#### Auto-resolved fields (you don't send them)

- **`from`** — origin city, area, geo coordinates. Resolved from your
  account's configured warehouse address. **If `from` is wrong** (points
  to the wrong city), update your account address in the carrier's
  dashboard. The API will not let you override it per-shipment.
- **`fromBranch`, `fromBranchGroup`, `toBranch`, `toBranchGroup`** —
  routing decisions, automatically chosen based on origin and
  destination geography.
- **`reference`** — generated by the server, format `SH<digits>`.
- **`createdAt`, `updatedAt`, `pickupAt`** — server timestamps.
- **`status`** — initial status is always `pending`.
- **`timeline`** — initialized with one entry: "Shipment is created".

### 5.7 Track a shipment (timeline)

```
GET /api/local/shipments/timeline/:reference
```

The `:reference` is the human-readable code (`SH1584689`), **not the
`_id`**. This is the polling endpoint — call it on a schedule to detect
status changes without re-fetching the full shipment.

**Success response:**
```json
{
  "status": true,
  "data": {
    "_id": "69fd0af4889e7a3cd010f1a1",
    "timeline": [
      {
        "type": "info",
        "createdBy": { "_id": "...", "fname": "...", "lname": "..." },
        "account": "...",
        "description": {
          "en": "Shipment is created",
          "ar": "تم إنشاء الشحنة"
        },
        "phone": "+218...",
        "timestamp": "2026-05-07T21:58:12.019Z",
        "metadata": {}
      }
    ]
  }
}
```

Timeline entries are append-only and ordered oldest-first. Each new
event from the carrier (assigned to courier, out for delivery,
delivered, etc.) appears as a new entry with the appropriate
`type` and a bilingual `description`.

The `description` is always bilingual (`en` + `ar`). If you only need
one language, pick a side and stick with it.

### 5.8 Get a full shipment by ID

```
GET /api/local/shipments/:id
```

The `:id` here is the internal ObjectId (`_id`), **not** the human
reference. Returns the same shape as the create response, but wrapped
in a list:

```json
{
  "status": true,
  "data": {
    "results": [
      { "_id": "...", "reference": "SH...", "status": "...", ... }
    ]
  }
}
```

Note the response is `data.results[0]`, not `data` directly — even when
you query a single shipment by ID. This is consistent with their
list-style endpoints. Plan for it.

Use this when you need the full current state, not just the timeline.

### 5.9 Cancel a shipment

```
DELETE /api/local/shipments/:id
```

The `:id` is the internal ObjectId. Returns a minimal success response:

```json
{ "status": true, "metrics": { ... } }
```

**Confirmed behavior:** this is a **hard delete**. After a successful
DELETE, the shipment disappears from the dashboard entirely (Active,
Withdrawable, Archived, and Withdrawn tabs all stop showing it). It does
not soft-delete to an archive.

This is a destructive operation. If your platform has any concept of
"audit trail," log the cancellation on your side before issuing the
DELETE — once it's gone from Darb Assabil, there's no recovery.

You may not be able to delete shipments that have already been picked up
by a courier. Test in your environment to see what error shape comes
back if you try; the contract for that case is not yet documented here.

---

## 6. Status lifecycle

A shipment moves through these statuses over its lifetime:

| Status | Meaning |
|---|---|
| `pending` | Created, not yet booked into the routing system |
| `booked` | Booked, awaiting pickup |
| `processing` | Being prepared for handoff |
| `on-branch` | Arrived at a routing branch, in the network |
| `released` | Out for delivery |
| `completed` | Delivered ✓ (terminal) |
| `cancelled` | Cancelled by the carrier or your DELETE call (terminal) |
| `resent` | Re-attempted delivery after a failed attempt |
| `delayed` | Delayed (transient, will move forward later) |
| `returning` | Failed delivery, returning to sender |
| `returned` | Returned to sender ✓ (terminal) |

Terminal statuses (`completed`, `cancelled`, `returned`) do not change
further. You can safely stop polling once a shipment hits one of them.

### Mapping to your own lifecycle

If your system has its own status model, here's a sensible default
mapping. Adjust to your domain.

| Darb Assabil | Generic OMS |
|---|---|
| `pending`, `booked`, `processing` | `dispatched` |
| `on-branch`, `released`, `resent` | `in_transit` |
| `delayed` | (no change — keep current status, just log) |
| `returning` | `in_transit` (it's still moving, just back to you) |
| `completed` | `delivered` |
| `returned` | `returned` |
| `cancelled` | `returned` or `cancelled` (your call — see below) |

**Decision point — `cancelled`:** Darb Assabil's `cancelled` is a
*post-dispatch* status. If your OMS uses `cancelled` only for
*pre-dispatch* manager cancellations, you have two options:

- Map `cancelled` → `returned` (treat it the same as a return for
  accounting and stock purposes)
- Map `cancelled` → your own `cancelled` (semantic stretch but cleaner
  in dashboards)

If your system deducts inventory at carrier-handoff time, the first
option is safer — only `returned` puts stock back.

---

## 7. Polling strategy

There is no webhook system in Darb Assabil. To detect status changes,
poll the timeline endpoint on a schedule.

Recommended approach:

- **Active shipments** (any non-terminal status): poll every 15–30
  minutes
- **Terminal shipments** (`completed`, `returned`, `cancelled`): stop
  polling
- **Idle hours**: drop polling to once an hour or pause overnight; the
  carrier doesn't move shipments at 3am
- Use `GET /api/local/shipments/timeline/:reference` rather than the
  full shipment endpoint — smaller payload, faster
- Compare the latest timeline event timestamp against the last one you
  saw locally; if they match, no change

If you have many shipments, batch your polling: run them in parallel
with a concurrency cap (5–10 simultaneous requests is usually safe;
back off if you hit rate limits).

---

## 8. Common gotchas — quick reference

A consolidated list of things that will trip you up:

1. **HTTP 200 ≠ success.** Always check `body.status === true`.
2. **`apikey` is the literal prefix**, not `Bearer`.
3. **Three required headers**, not one. Missing `X-API-VERSION` or
   `X-ACCOUNT-ID` produces silent failures, not 401s.
4. **Country and currency codes are lowercase** (`lby`, `lyd`). Uppercase
   passes initial validation but fails the country lookup later.
5. **Reference format is `SH<digits>`**, not `DS-12345` as the docs say.
6. **Timeline endpoint takes `reference`, single-shipment endpoint takes
   `_id`.** Different endpoints, different identifiers.
7. **Single-shipment GET returns a list shape** (`data.results[0]`), not
   a flat object.
8. **`POST /api/contacts/create/public/contact` is idempotent by
   phone.** Same phone returns the same `_id`. Safe to call repeatedly.
9. **Most "list" endpoints have a default `offset` greater than 0** in
   the schema. Always pass `offset=0` explicitly.
10. **`/api/local/branches/public/:id` and
    `/api/local/service/rates/public/:id` work *without* the `:id`** to
    return your account's data. Passing your account ID as the path
    parameter typically returns an empty list.
11. **`from` is auto-resolved** from your account's warehouse address
    and cannot be overridden per-shipment. Configure it correctly in
    the dashboard.
12. **`countryCode` capitalization mismatch** triggers the unhelpful
    error `Cannot read properties of undefined (reading 'name')` — not
    a clear "country not found" message.
13. **The error `messages` array's `stack` field leaks server-side
    paths and library versions.** Don't surface it to end users; log
    it for your own debugging.
14. **Phone numbers are E.164 with a `+` prefix.** `218911234567` is
    not the same as `+218911234567`.
15. **Default box dimensions are 50×40×40 cm at zero cost.** If your
    products are bigger, send dimensions explicitly or you may be
    undercharged for shipping.

---

## 9. End-to-end flow (cURL)

A minimal walkthrough of creating, tracking, and cancelling a shipment.
Replace the placeholders with real values.

```bash
# Set up
HOST="https://v2.sabil.ly"
API_KEY="YOUR_API_KEY"
ACCOUNT_ID="YOUR_ACCOUNT_ID"
HEADERS=(
  -H "Content-Type: application/json"
  -H "Authorization: apikey $API_KEY"
  -H "X-API-VERSION: 1.0.0"
  -H "X-ACCOUNT-ID: $ACCOUNT_ID"
)

# 1. Verify auth
curl "${HEADERS[@]}" "$HOST/api/wallet/metadata"

# 2. Pick a service
curl "${HEADERS[@]}" "$HOST/api/local/service/rates/public"
# → save data.results[*]._id where you want, e.g. SERVICE_ID

# 3. Upsert a contact for the customer
curl -X POST "${HEADERS[@]}" "$HOST/api/contacts/create/public/contact" \
  -d '{
    "account": "'"$ACCOUNT_ID"'",
    "name": "Customer Name",
    "phone": "+218911234567"
  }'
# → save data._id as CONTACT_ID

# 4. (Optional) Preview shipping cost
curl -X POST "${HEADERS[@]}" "$HOST/api/local/shipments/calculate/shipping" \
  -d '{
    "service": "'"$SERVICE_ID"'",
    "paymentBy": "receiver",
    "products": [{"title":"Test","quantity":1,"amount":100,"currency":"lyd","isChargeable":true}],
    "to": {"countryCode":"lby","city":"طرابلس","area":"الرياضية"}
  }'

# 5. Create the shipment
curl -X POST "${HEADERS[@]}" "$HOST/api/local/shipments" \
  -d '{
    "service": "'"$SERVICE_ID"'",
    "contacts": ["'"$CONTACT_ID"'"],
    "paymentBy": "receiver",
    "to": {
      "countryCode": "lby",
      "city": "طرابلس",
      "area": "الرياضية",
      "address": "Building 5, Apt 12"
    },
    "products": [{"title":"Test Product","quantity":1,"amount":100,"currency":"lyd","isChargeable":true}],
    "notes": "Handle with care"
  }'
# → save data._id as SHIPMENT_ID and data.reference as REFERENCE

# 6. Poll status
curl "${HEADERS[@]}" "$HOST/api/local/shipments/timeline/$REFERENCE"

# 7. Get full shipment state
curl "${HEADERS[@]}" "$HOST/api/local/shipments/$SHIPMENT_ID"

# 8. Cancel (hard delete)
curl -X DELETE "${HEADERS[@]}" "$HOST/api/local/shipments/$SHIPMENT_ID"
```

---

## 10. Other endpoints worth knowing

These weren't covered in detail above but are documented in the Postman
collection and may be useful:

- **`GET /api/contacts/trust/score?phone=...`** — Returns a trust score
  and `isTrusted` flag for a phone number. Useful for fraud signals
  before confirming a COD order.
- **`PATCH /api/local/shipments/modify/:id`** — Modify limited fields of
  an existing shipment (notes, contacts, products, payment options).
  Can't change destination.
- **`PATCH /api/local/shipments/resend/:id`** — Re-attempt delivery on
  a failed shipment.
- **`POST /api/local/shipments/request/return/:id`** — Customer-side
  return request.
- **`POST /api/local/shipments/add/comment/:id`** — Add a comment to a
  shipment's conversation thread (visible to the carrier).
- **`POST /api/local/shipments/apply/coupon/:id/:discountCode/:currency`**
  — Apply a discount code to a shipment.
- **`PATCH /api/local/shipments/withdraw/delivery`** — Process delivery
  withdrawals (COD settlement workflow).

For full schemas, refer to the Postman collection. The payload shapes
follow the same patterns shown above.

---

## 11. Versioning

The `X-API-VERSION: 1.0.0` header pins the API version. The carrier may
release newer versions in the future; if they do, expect a notice via
their developer portal. Until then, hard-code `1.0.0`.

---

## 12. Support

Vendor support email (per the Postman collection):
`support@sabil.ly`

Developer portal: `https://app.sabil.ly/developer`

Postman collection download: available on the developer portal.
