# X-Delivery manifests — return lists scanned to the end, pickup on demand

The backend contract for the warehouse screens. Decisions and history:
`plans/xdelivery-manifests.md`. Screens to build from: `prototypes/xdelivery-manifests-v1.html`.
Backend built 2026-10-08. The screens are built by a separate session on top of this doc.

## 1. The two flows

**Pickup (« Demande d'enlèvement »).** In Tunisia a pickup is asked for a *batch* of parcels when
someone decides to. A button sends the scanned parcels (all ticked by default, the agent may
untick some) as **one list** at X-Delivery. Deleting the list, or taking parcels off it, puts
those orders back to **`uploaded`** with their stock restored. This works whether it is done in
Ordra or on X-Delivery's portal. The packed box is scanned out again for a later list.
There is **no automatic request and no ON/OFF switch any more**. The Phase 4 tick and its switch
are gone.

**Returns (« Manifeste retour »).** X-Delivery hands over a list of returned parcels each day
(about one per working day, 2–21 parcels). The agent opens it by scanning the sheet's barcode (or
any parcel on it, or by tapping it) and scans until the list is done:

- each scan counts as good condition;
- « Endommagé » corrects the last parcel scanned;
- a parcel that is not on the list is refused and counted « de côté »;
- « Terminer » with parcels left alerts the manager.

Both work on a PC with a USB scanner and on a phone camera. Every scan accepts **their
barcode (15 digits) or our QR (the order id)**.

## 2. Data

| Table | What | Written by |
|---|---|---|
| `carrier_manifests` | One row per carrier list. `kind` = `pickup` · `return` · `exchange`; `external_id` = their `_id`; `code` = the sheet barcode. Pickup lists use `requested_by` (NULL = made on their portal) and `deleted_at/by/source`; return lists use `closed_at/by`. Never deleted. | sync, pickup routes (service role), `close_return_manifest` |
| `carrier_manifest_parcels` | The lines. `order_id` is NULL when the parcel is not an Ordra order (Converty still creates most). `state` = `expected` · `received` · `damaged` (return lists) · `removed` (pickup lists). | sync (insert only), RPCs, pickup routes |
| `return_set_asides` | A parcel refused because it was not on the open list. One open row per order; resolved when a later list's scan receives it. | `scan_manifest_return` |

RLS is **read-only**: super_admin everywhere, a market manager in their market, a warehouse agent
in their market **and** building (a list with no building is visible to the whole market). An
agent with no building reads nothing. No role can write these tables directly; writes go through the RPCs below or the service role.

**Import window.** The 10-minute poll (`/api/cron/poll-carriers`) imports:

- pickup lists of the last 8 days and return/exchange lists of the last 14;
- **never** a list created before the X-Delivery account was set up in Ordra (`carriers.created_at`), so go-live does not dump a fortnight of already-handed-over lists on the warehouse.

## 3. Endpoints

Every refusal is `{ error_code, message }`. Every route rejects a role that cannot scan
(`agent`, `investor`) with 403.

### Pickup

**`GET /api/warehouse/xdelivery-pickup`** → `{ sites: XDeliveryPickupSite[] }`, one per building
that ships X-Delivery (the agent's own only; `[]` for Libya or an unassigned agent).

```ts
XDeliveryPickupSite {
  warehouseId, code, name, carrierId,
  canManage: boolean,        // may press the button / undo (agent: own building only)
  hasPortalLogin: boolean,   // false → nothing can be asked: show « Connexions › Transporteurs »
  awaiting: { orderId, tracking, city, product, quantity }[],  // scanned, on no open list
  lists: {                   // last 3 days, not deleted, newest first
    id, createdAt, requestedFromOrdra, carrierStatus,
    collected: boolean,      // the driver came: nothing can be undone any more
    open: number,            // lines still on the list
    lines: { lineId, orderId|null, barcode, state, city, product, quantity }[]
  }[],
  undone: { manifestId, at, source: "ordra"|"carrier", count }[]  // deleted lists → orders back to uploaded
}
```

**`POST /api/warehouse/xdelivery-pickup`** `{ warehouse_id, order_ids: string[] }` (≤ 500) →

```ts
{ requested: { orderId, barcode }[],
  skipped:   { orderId, reason }[],   // see below
  manifestId: string | null }         // null = list not visible yet; the poll imports it
```

`skipped.reason`:

| Reason | Meaning |
|---|---|
| `not_eligible` | Not `scanned`, another account, or already on an open list. |
| `unknown_at_carrier` | X-Delivery doesn't know this parcel. |
| `already_requested` | Already asked for on their portal; Ordra caught up. |
| `carrier_status:<STATUS>` | X-Delivery already holds it further along. |
| `not_confirmed` | Their call returned, but the parcel is still CREATED. |

**`DELETE /api/warehouse/xdelivery-pickup/{manifestId}`** deletes the whole list.
**`PATCH /api/warehouse/xdelivery-pickup/{manifestId}`** `{ order_ids }` takes only those parcels off.
Both return:

```ts
{ released: { orderId|null, barcode }[],  // back to uploaded, stock restored
  skipped:  { orderId|null, barcode|null, reason }[],
  manifestDeleted: boolean }
```

`skipped.reason`:

| Reason | Meaning |
|---|---|
| `not_on_list` | That order isn't on this list. |
| `carrier_status:COLLECTED` (etc.) | The driver already took it; it cannot come back. |
| `not_confirmed` | Still PENDING at X-Delivery after the call. |

Ticking every remaining parcel deletes the list. A list holding a parcel the driver already took
is never deleted whole: only the others are removed.

Pickup error codes:

| Code | Status | Meaning |
|---|---|---|
| `NO_PORTAL_LOGIN` | 409 | The account has no portal email/password. |
| `PORTAL_LOGIN_REFUSED` | 502 | X-Delivery refused the login. |
| `CARRIER_UNAVAILABLE` | 502 | Their portal failed; retry. |
| `NOTHING_TO_REQUEST` | 409 | None of the orders may be sent. |
| `WRONG_SITE` | 403 | Another building. |
| `NO_XDELIVERY_ACCOUNT` | 404 | No X-Delivery account for that building. |
| `MANIFEST_NOT_FOUND` | 404 | No such list. |
| `NOT_A_PICKUP_LIST` | 409 | The list is not a pickup list. |
| `LIST_DELETED` | 409 | The list is already deleted. |
| `BAD_REQUEST` · `TOO_MANY` | 400 | Invalid request body. |

### Return lists

| Call | Body | Answer |
|---|---|---|
| `GET /api/warehouse/return-manifests` (`?warehouse_id=` for a manager) | — | `{ manifests: ReturnManifestSummary[], totals: { toReceive, missing, setAside, openLists } }`, last 30 days |
| `GET /api/warehouse/return-manifests/{id}` | — | `{ manifest: ReturnManifestSummary & { warehouseId, closedBy }, lines: Line[] }` |
| `POST /api/warehouse/return-manifests/open` | `{ code }` | `{ manifest_id, matched: "sheet" \| "parcel" }`. On a miss it fetches the lists from X-Delivery and tries once more, then answers 404 `MANIFEST_NOT_FOUND`. |
| `POST /api/warehouse/return-manifests/refresh` | — | Sync now: `{ accounts, lists, released, errors }` |
| `POST /api/warehouse/return-manifests/{id}/scan` | `{ code }` | Scan result, see below |
| `POST /api/warehouse/return-manifests/{id}/damaged` | `{ parcel_id, return_reason, note? }` | `{ result: "damaged", parcel_id, order_id, lines, received, expected, set_aside }` |
| `POST /api/warehouse/return-manifests/{id}/close` | — | `{ missing: { parcel_id, order_id, barcode }[], missing_count, received, expected, set_aside }` (idempotent) |

```ts
ReturnManifestSummary { id, kind: "return"|"exchange", carrierId, code, createdAt, carrierStatus,
  closedAt, expected, received, damaged, remaining, missing,
  state: "new" | "in_progress" | "complete" | "closed_missing" }
Line { parcelId, barcode, orderId|null, state, receivedAt, setAsideAt|null,
  order: { externalId, customerName, city, product, quantity, status } | null }
```

A line counts as `missing` only once its list is closed. Damaged parcels count as received.

**Scan answer** — `{ result, … , received, expected, set_aside }` (the counters refresh the progress
bar and the « De côté » figure on every scan):

| `result` | What happened |
|---|---|
| `received` | On the list, an Ordra order. Stock went back (good condition). If the carrier sync was behind, the order was moved to `to_be_returned` first; the list is the carrier's word. |
| `received_unlinked` | On the list, not an Ordra order: ticked, no stock movement. |
| `already_received` | Scanned on this list before; nothing moved. |
| `already_returned` | On the list, but already returned through the old Retours screen: ticked, no second movement. |
| `not_on_manifest` | An Ordra order, not on this list. Set aside; nothing moved. Say « mettez-le de côté ». |
| `unknown_code` | Nothing matches (a misread?). Nothing written. Say « rescannez ». |

`return_reason` ∈ `packaging · product_defect · customer_damage · carrier_damage · other`
(`other` needs a `note`).

Scan / damaged / close error codes (from the RPC `DETAIL`):

| Code | Status | Meaning |
|---|---|---|
| `DELIVERED_CONFLICT` | 409 | The order is `delivered` in Ordra; a manager decides (decision 7). |
| `INVALID_STATUS` | 409 | e.g. still `uploaded`: it never left. |
| `MANIFEST_CLOSED` | 409 | « Endommagé » after « Terminer ». |
| `ALREADY_DAMAGED` | 409 | Already marked damaged. |
| `NOT_RECEIVED` | 409 | Only a received Ordra parcel can be marked damaged. |
| `STOCK_MOVED` | 409 | The correction would make stock negative. |
| `NOT_A_RETURN_MANIFEST` | 409 | The list is a pickup list. |
| `BAD_CODE` · `REASON_REQUIRED` · `NOTE_REQUIRED` | 400 | Invalid input. |
| `MANIFEST_NOT_FOUND` · `PARCEL_NOT_FOUND` | 404 | No such list or line. |
| `NO_SITE_ASSIGNED` · `WRONG_SITE` · `MARKET_MISMATCH` · `ACTOR_MISMATCH` | 403 | Not this user's market or building. |

## 4. Rules worth knowing

- **Stock paths.** Nothing new bypasses the ledger.
  - A return scan calls the existing `scan_return_in`.
  - « Endommagé » APPENDS a correction: a `returned` row of −qty, then a `damaged_writeoff` row of +qty with `is_damaged`, exactly what a damaged scan writes.
  - Undoing a pickup writes `scan_reversal` through the same core as `unscan_order` (`_reverse_scan_stock`).
- **« Endommagé » is one way and only while the list is open.** Going back to good would need a negative damaged row, which the ledger trigger counts as more damage (it uses ABS), so it is refused.
- **HTTP success is not proof.** After asking for a pickup, or undoing one, every parcel is read again at X-Delivery. Ordra moves an order only when X-Delivery now holds the expected status (`PENDING` after a request, `CREATED` after an undo).
- **An undo on their portal is followed, carefully.**
  - A pickup line that vanished from their list is released only when X-Delivery says the parcel is `CREATED` again.
  - A list that aged out of the window, or a parcel the driver took, never moves stock. These are logged as `vanished_not_created`.
- **`unscan_order`.** An X-Delivery parcel nobody asked for (slug `CREATED`) can now be un-scanned (before, only Darb's `pending` could). A parcel on a pickup list (`PENDING`) is refused with `ON_PICKUP_LIST`: undo the list first.
- **Manager alert `return_missing`.**
  - One alert per closed return list that still has Ordra parcels not scanned in.
  - High severity, critical after 3 days; it leaves the list after 30 days.
  - It sits in the alerts engine (`/api/alerts/summary`, family `stock`) and links to `/warehouse/returns?manifest={id}`.
- **Logs.** `carrier_event_log` with `raw_body.kind` = `pickup_request` (button, source `manual`) or `manifest_sync` (poll, source `cron`).
- **Secrets.** Portal answers embed our company with the API key in clear. `portal.ts` reduces every manifest to `{ id, code, status, type, createdAt, parcels[{ barcode, id, status }] }` on arrival; nothing else is kept or logged.

## 5. Code map

| Piece | File |
|---|---|
| Migration (tables, RLS, RPCs, `unscan_order`) | `supabase/migrations/20261008120000_carrier_manifests.sql` |
| SQL proof under real JWTs | `supabase/tests/carrier_manifests_test.sql` |
| Portal client (list / remove / delete) | `src/lib/carriers/xdelivery/portal.ts` |
| Button + undo | `src/lib/carriers/xdelivery/pickup.ts` |
| Poll sync + portal-undo detection | `src/lib/carriers/xdelivery/manifest-sync.ts` |
| Supabase wiring | `src/lib/carriers/xdelivery/production.ts` |
| Pickup view builder | `src/lib/carriers/xdelivery/pickup-view.ts` |
| Return summary, route helpers, refresh | `src/lib/carriers/manifests/{return-view,api,refresh}.ts` |
| Routes | `src/app/api/warehouse/xdelivery-pickup/**`, `src/app/api/warehouse/return-manifests/**` |
| Alert | `src/lib/alerts/catalogue.ts` (`return_missing`), `src/app/api/alerts/summary/route.ts` |

The bench card `XDeliveryPickupCard` is a **minimal placeholder** (count + one button). The
screens of the prototype (untick, sent lists, delete, the return lists) are yet to be built.
