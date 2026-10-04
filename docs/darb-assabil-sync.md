# Darb Assabil — status sync reference

Live-probed facts for the Libya carrier (`darb_assabil`, `https://v2.sabil.ly`), two accounts:
**Tripoli** `4f1271c8-b1f2-4836-9293-8ab3d0b18e69` · **Benghazi** `43077d36-3d61-40d6-ae35-59ed15cec8f7`.

Probed 2026-08-17 with `scripts/probe-darb-shipments-list.ts` (read-only, GET only).
Re-run that script before trusting anything here — it is the source, this file is the summary.

---

## 1. The list endpoint (the thing that makes bulk sync possible)

`GET /api/local/shipments` — **the `:id` path segment is optional**. Without it you get a
filterable, paginated list.

```
GET /api/local/shipments?offset=0&limit=500&includeTotalCount=true&sort={"updatedAt":-1}
```

| Fact | Value |
|---|---|
| `data.totalCount` (with `includeTotalCount=true`) | Tripoli **710**, Benghazi **118** |
| `limit` ceiling | **500 confirmed** (500 rows in ~716 ms) |
| Pagination | `offset` works |
| `sort` | `{"updatedAt":-1}` works → **delta sync is possible** |
| Full mirror cost | **3 HTTP calls total** (Tripoli 2 × 500, Benghazi 1) |

Compare: the current per-order path is **1 call per order**, 150 calls per sweep at concurrency 3.

### Multi-value filters are NOT supported — this is a trap

| Attempt | Result |
|---|---|
| `negateStatus=completed,cancelled,returned` (CSV) | **HTTP 400 `Invalid choice!`** |
| `negateStatus=a&negateStatus=b&negateStatus=c` (repeated) | HTTP 200 but **only the LAST value applies** — terminal statuses leak into the result |
| `status=released` (single) | ✅ filters correctly, `totalCount` respects it |

**Therefore: page the whole account and filter locally.** Do not build on `negateStatus`.
A repeated param silently returns wrong data — it does not error.

---

## 2. What a shipment record actually contains

48 top-level keys, 153 distinct field paths. Confirmed present on live records:

| Field | Example | Note |
|---|---|---|
| `handler.fname` / `.lname` / `.phone` | `ايوب` / `مندوب البيضاء` / `+218915094841` | **The courier currently holding the shipment** |
| `handlerAccount.name` / `.phone` / `.email` | `مكتب البيضاء` / `+218918446655` | **The branch office handling it** |
| `initialHandler`, `initialHandleAt` | ObjectId, ISO ts | First assignment |
| `timeline[]` | 16 events on a live order | See below — the richest source |
| `attachments[]` | 2 × S3 JPEG, `mimeType`, `sizeInBytes` | Courier photos / proof |
| `invoices[].items[]` | `shipping` 35 LYD, `breakdown {branchToBranch:30, pickFromDoor:0, dropToDoor:5}` | **Actually billed** — vs our flat `carriers.delivery_fee` of 10 |
| `cancellationCause` | `3-days-no-response`, `other` | Enum; present on cancelled/returned/released |
| `cancelCount`, `resendCount` | number | Real attempt counts |
| `completedAt` | ISO ts | True delivery time (OMS has no `delivered_at`) |
| `deliveryWithdrawalAt` + `…References` | ISO ts | **COD settlement — when the money landed** |
| `salesWithdrawalAt` + `…References` | ISO ts | Sales-side settlement |
| `delayedUntil` | ISO ts | When a delayed shipment resumes |
| `priority`, `notes`, `toBranchGroup`, `toZoneCode` | `4`, ``, `BYD`, `BN` | Routing |

### The two payload depths — the thing that will mislead you

Darb serves **different amounts of data from the list and single endpoints**, and nothing
documents this:

| Field | `GET /shipments` (list) | `GET /shipments/:id` (single) |
|---|---|---|
| `handler` (current courier) | ✅ full object | ✅ full object |
| `timeline[].createdBy` | ❌ bare ObjectId string | ✅ `{_id, fname, lname, phone}` |
| everything else | same | same |

So a bulk sweep can tell you **who is holding the parcel now** but not **who did each step**.
`scripts/enrich-darb-timeline-actors.ts` fills the gap with one single-GET per in-flight
shipment.

**`timeline[].phone` is NOT the actor's phone — it is the branch line.** One value appeared on
10,702 of 19,407 live events. Storing it as the actor's number would credit an entire office's
work to one courier. It is kept as `account_phone`; `actor_phone` stays NULL until enriched.

### `conversation[]` exists, but it is rare

Present on only **64 of 828 shipments (7.7%)** — so a single sampled record shows nothing and
it is easy to conclude the field is unused. It is not. It carries the customer-contact notes:
«مقفل اوخارج نطاق التغطية» (phone off / out of coverage), «مردش» (no answer),
«الزبون اجل الاستلام لي يوم الخميس» (customer postponed to Thursday).

`createdBy` there is **always** a bare ObjectId — the author name is never resolvable from this
endpoint, so `darb_conversation.author_name` is legitimately NULL on every row.

Distinct from `timeline[].remarks` (1,644 notes across 649 shipments), which is the courier's
note attached to a status change. Keep both: remarks explain the status, conversation explains
the customer.

### `timeline[]` is the real payload

Each event carries `type`, bilingual `description {en, ar}`, `timestamp`, **`createdBy {fname, lname, phone}`**,
and **`remarks`**. A real Tripoli order (`1511544`):

```
14:12 info       تم إنشاء الشحنة                    by firas kr +218942050182
14:39 booked     تم قبول طلبك من قبل محمد العجيلي     by محمد العجيلي +218943090419
14:41 referenced تم إحالة الطلب بالرقم 1511544        ← the plain-digit reference is assigned HERE
15:33 assigned   هبة موظفة استقبال Tj ألتقطَ الشحنة    by هبة +218944770488
18:31 referenced تم إحالة الطلب إلى صندوق برقم BX26741BN
17:49 accepted   تم قبول الحجز من قبل ...المنطقة الشرقية
12:57 assigned   ايهاب الحاسي مكتب البيضاء ألتقطَ الشحنة
14:15 rejected   تم رفض التحويل من قبل حسين بومعيوف    ← a courier refused the handoff
15:32 delayed    The order is delayed.               remarks: لايرد ودزيت رساله
20:37 delayed    The order is delayed.               remarks: يسكن في مراوه سيتم تحويلها إلى مندوب المناطق
```

`remarks` on `delayed` / `rejected` events is the courier's own note — the closest thing to
"why isn't this delivered yet", and today we discard it entirely.

Event types seen live: `info`, `booked`, `referenced`, `assigned`, `accepted`, `rejected`, `delayed`.
Schema also declares: `warning`, `danger`, `waiting`, `shipped`, `arrived`, `disengaged`,
`payment-required`, `payment-received`, `payment-refunded`, `completed`, `partially-completed`,
`cancelled`, `cancel-confirmed`, `returning`, `returned`, `released`.

---

## 3. The reference format tells you the sync state

Darb assigns the human reference **at booking**, not at creation (the `referenced` timeline event).

| `orders.tracking_number` | Meaning |
|---|---|
| `SH…` (creation-time value) | The shipment has **not been re-read since booking** — either not yet booked, or our copy is stale |
| plain digits (`1511544`) | Successfully re-read; `promote_darb_status` repaired the reference |

Live split across all 862 Darb orders — the correlation is total:

| Reference format | n | `carrier_status_slug` values |
|---|---|---|
| plain digits | 788 | completed, cancelled, returned, processing, delayed, released, returning, on-branch |
| `SH…` | **74** | **only `pending` (57) or `NULL` (17)** — nothing else, ever |

So `tracking_number LIKE 'SH%'` is the reliable predicate for "the OMS has never caught up with
this shipment", and it is 4× larger than the `slug IS NULL` population it is easy to mistake it for.

Sampling 8 of those 74 against the live API:

| Outcome | n | Meaning |
|---|---|---|
| found, Darb says `processing` + real reference | 3 | **Our data is stale** — resolvable right now |
| found, Darb says `pending` | 3 | Legitimately not yet booked |
| gone (`_id`, `reference`, and `search` all empty) | 2 | Hard-deleted at Darb (older orders) |

**The orphans are overwhelmingly recoverable.** They are not an API problem — the sweep simply
never reaches them before the serverless function is killed.

---

## 4. Gotchas that cost time

1. **HTTP 200 ≠ success** — always check `body.status === true`.
2. **`Authorization: apikey <key>`** — literal `apikey` prefix, not `Bearer`. Plus `X-API-VERSION: 1.0.0`
   and `X-ACCOUNT-ID`; a missing header fails silently rather than 401ing.
3. **Single-shipment GET returns a list shape** — `data.results[0]`, not `data`.
4. **Repeated query params silently take the last value.** Wrong data, no error. See §1.
5. **The two accounts are self-consistent** — a Benghazi-assigned order's shipment does not live in
   the Tripoli account. Cross-account lookup is not needed (verified 2026-08-17).
6. **DELETE is a hard delete** (guide §5.9). A missing shipment is unrecoverable — never
   auto-cancel an OMS order because the carrier lookup came back empty.
7. Reference formats differ per account age: both plain-digit (`1609486`) and `SH…` (`SH2057634`)
   are valid live values. Don't validate on the `SH` prefix.

---

## 5. Related

- Vendor contract: `delivery_company_docs/Darb Assabil/INTEGRATION_GUIDE.md`
- Full request/response schemas: `delivery_company_docs/Darb Assabil/postman_collection.json`
- Probe script: `scripts/probe-darb-shipments-list.ts`
- Status taxonomy: `src/lib/carriers/darb-assabil-statuses.ts`
- Order-panel detail (courier, notes, cost): `src/components/queue/DarbStatusSection.tsx`
  reading `GET /api/orders/[id]/darb-shipment` — a LOCAL MIRROR read, no carrier call.
  Rendered on the order surfaces: agent queue and orders console (the in-delivery detail was retired 2026-10-03).
- Panel display rules (which events to hide, who to call): `src/lib/carriers/darb-shipment-display.ts`
- Schema/coverage check: `scripts/verify-darb-panel.ts`
- Read path: `src/lib/carriers/darb-assabil-tracking.ts`
- Write path: `supabase/migrations/20260817000001_promote_darb_status.sql`

---

## 6. What Darb costs, and following a parcel after Darb cancels it (2026-10-03)

Owner's rules (plans/products-redesign-v6.md §3): no flat fee for Darb anywhere — each delivered
parcel costs what Darb **invoiced** it; a **failed** Darb parcel costs **nothing** (Darb takes its fee
out of delivered cash only); Tunisia keeps its carriers' flat fees until they send invoices; settled
investor statements do not move.

**Cost.** `order_delivery_cost` (`20261004100000`) — ONE row per order: Darb = the completed
shipment's `billed_shipping_amount`, else `orders.delivery_cost_quoted`, else NULL (the reader applies
`market_avg_delivery_cost(market)`, Darb's 30-day average invoice, and labels it an estimate); return
cost 0 for Darb. `order_carrier_cost` (`20261004100200`) keeps its columns but is rebuilt on it: one
row per order (it used to LEFT JOIN every shipment, so a re-sent parcel counted twice), `cost_source`
billed / quote / average / flat, `security_invoker`. Readers: `get_dashboard_health`,
`get_carrier_true_cost`, `get_profitability_summary` / `_daily` (repointed in the same migration),
`/api/ad-spend/economics`, the products pages. Investor accrual already took the invoice for
deliveries; a failed Darb parcel is now 0 and final there too (`order-facts.ts`). Réglages no longer
asks a fee for a Darb account.

**Sync.** Darb « cancelled » used to close the order for good; Darb kept working the parcel — 445
handed back through its returns desk (`released`), 37 delivered (32 paid out). Since `20261004100300`,
`promote_darb_status` maps a cancel AFTER pickup to `returning` (not terminal), a `released` behind a
cancel or a return to `to_be_returned` (the bench can scan it), and keeps `completed` → `delivered`
reachable. `/api/darb-assabil/sync-market` keeps polling a parcel whose last Darb word is `cancelled`
and stops on orders closed in Ordra.

**History.** Not touched by the fix. `supabase/scripts/darb-cancelled-history-dry-run.sql` (one
SELECT) shows what would move — 2026-10-03 on prod: 476 → to_be_returned (485 units), 38 → delivered
(7 770 LYD, 32 already paid out), 40 → returning, 2 → delivery_delayed, 39 stay cancelled; three
settled investor statements (20 May → 31 Jul) cover some of them. `…-apply.sql` writes it in one
transaction, appends history rows, deletes the WhatsApp messages the status change would queue —
run it only once the owner has read the dry run.
