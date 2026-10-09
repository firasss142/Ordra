# X-Delivery manifests — return lists scanned to the end, pickup on demand

Status: prototype approved in principle 2026-10-08 (`prototypes/xdelivery-manifests-v1.html`);
live test « 5 parcels → one list → remove 2 » confirmed by the owner. **Backend only** in this
round — another session builds the UI. The API contract for that session is
`docs/xdelivery-manifests.md`. Part of `plans/xdelivery-integration.md` (Phase 6).

## Why

- **Returns.** Today returns are scanned in whatever order they turn up, and nothing says
  what is missing (see the memory note *returns-never-scanned-back*). X-Delivery, like most
  Tunisian carriers, hands over a « Manifeste retour » every day: the list of parcels coming
  back. Scanning against that list gives a finish line and a missing-parcels alert.
- **Pickup.** Phase 4 requested pickup automatically on every poll tick while a per-site
  switch was ON. The owner corrected this: in Tunisia the « Demande d'enlèvement » is a
  **batch made on the user's demand**, not Darb's per-parcel pickup.

## What X-Delivery holds (measured 2026-10-08, read-only)

- Portal `GET /manifests?company=&type=RETURN|EXCHANGE|COLLECTED&startDate=&endDate=` →
  `{records, totalDocuments}`; each manifest has `_id`, `code` (13 digits, printed as the
  sheet barcode), `status`, `type`, `createdAt`, and `parcels[]` populated (with `code` =
  our `tracking_number`, `status`).
- RETURN: 52 manifests in 60 days, about one per working day, 2–21 parcels. Status
  `ACCEPTED` while en route (parcels `PENDING_RETURNS`), then `RECEIVED_BY_SENDER` when their
  worker marks it handed over (parcels `RETURNED_TO_SENDER`), usually the next day.
- EXCHANGE: 8 in 60 days (all in August), one parcel each.
- COLLECTED (pickup): about one per day, 2–50 parcels.
- Delete endpoints exist in their web app: `DELETE /manifests/:id`,
  `POST /manifests/remove-many`, `PATCH /manifests/remove-parcels/:id {parcelIds}`.
  **OWNER-role rights not tested by Ordra yet.** Observed: the « test 2 claude » pickup
  list was deleted on the portal and the parcel went back from `PENDING` to `CREATED`.
- ⚠️ Manifest and parcel responses embed the `company` object with our API key in clear.
  Never log or store a raw response.

## Decisions (owner, 2026-10-08)

### Return manifests
1. Ordra fetches the return (and exchange) manifests by itself. The agent opens one
   **by scanning the sheet's barcode or by tapping it** in the list.
2. A scan accepts **either the X-Delivery parcel barcode or the Ordra QR** (order id).
3. Each scan counts as **good condition**: stock +qty at once (`scan_return_in`). An
   « Endommagé » action on the last scanned parcel switches it.
4. A parcel **not on the open manifest is refused**: « mettez-le de côté ». Ordra records it
   as set aside and shows a **De côté** count; when a later manifest lists it, its row says
   « mis de côté le … » and the agent scans it there.
5. « Terminer » with unscanned parcels asks for confirmation, then **alerts the market
   manager** with the list. The parcels stay `to_be_returned` and in the **Manquants** count
   until scanned.
6. **Exchange manifests included** (same screen, « Échange » tag).
7. Desk (PC + USB scanner) **and** phone (camera).
8. Built carrier-agnostic (a manifest source per carrier); X-Delivery is the first.
   Libya (Darb) keeps its current return scan.

### Pickup lists
9. **No automatic pickup request, no switch.** A button « Demande d'enlèvement · N colis »
   (warehouse agent of that site, manager, super admin) opens every `scanned` X-Delivery
   parcel not yet requested, all ticked; the agent may untick; confirm → **one list** at
   X-Delivery.
10. Deleting a pickup list, or removing parcels from it — **in Ordra or on the X-Delivery
    portal** — puts those orders back to **`uploaded`**, with stock restored as a scan
    reversal (`unscan_order`). The packed parcel is scanned out again for a later list.

## Backend design (2026-10-08)

**Tables** (migration `20261008120000_carrier_manifests.sql`):
- `carrier_manifests` — one row per carrier list: `kind` pickup | return | exchange,
  `external_id` (their `_id`, unique per account), `code` (the sheet barcode), carrier status,
  `requested_by` (a pickup made from Ordra), `deleted_at/by/source` (pickup lists only),
  `closed_at/by` (return lists only). Never deleted: a deletion is a stamp.
- `carrier_manifest_parcels` — the lines: `barcode`, their parcel `_id`, `order_id` (NULL when
  the parcel is not an Ordra order — Converty still creates most of them), `state`
  expected | received | damaged | removed.
- `return_set_asides` — a parcel refused because it was not on the open list; resolved when a
  later list's scan receives it.
- Read-only RLS for staff of the market (an unassigned warehouse agent reads nothing); every
  write goes through the RPCs below or the service role.

**RPCs:**
- `scan_manifest_return(manifest, code, actor)` — the code is their barcode or our QR (the
  order id). On the list → the order is brought to `to_be_returned` if the carrier sync is
  behind (the list itself is the carrier's word), then `scan_return_in` runs unchanged. Not on
  the list → set aside, nothing moves. A parcel that is not an Ordra order is ticked with no
  stock movement. Already scanned → said so, nothing moves. `delivered` is refused
  (`DELIVERED_CONFLICT`, decision 7 of the integration plan: a manager decides).
- `mark_manifest_return_damaged(parcel, actor, reason, note)` — the « Endommagé » tap. The scan
  has already put the stock back, so this APPENDS the correction: a `returned` row of −qty
  (cancels the good-condition entry) and a `damaged_writeoff` row of +qty with
  `is_damaged=true` (exactly what a damaged scan writes). Only while the list is open, one
  way only (damaged → good would need a negative damaged row, which the ledger trigger adds
  to the damaged count as ABS — so it is refused rather than half-supported).
- `close_return_manifest(manifest, actor)` — stamps the close and returns the missing lines.
  Missing parcels feed the manager alert `return_missing` (alerts engine, derived, ages to
  critical) and stay scannable on that list until they arrive.
- `release_pickup_parcel(order, actor?, note)` — **service role only**. Puts a `scanned` order
  back to `uploaded`, stock restored with the SAME movement as `unscan_order`
  (`scan_reversal`), slug `CREATED`. Actor NULL = detected from the carrier (system).
  Idempotent: an order no longer `scanned` is reported, never an error.
- `unscan_order` — the stock reversal moved into `_reverse_scan_stock` (shared with
  `release_pickup_parcel`), and an X-Delivery parcel whose slug is `CREATED` (nobody asked
  for it) may now be un-scanned; `PENDING` (on a pickup list) is refused with « retirez-le de
  la liste d'enlèvement ».

**TypeScript:**
- `xdelivery/portal.ts` gains `listManifests`, `removeParcelsFromManifest`, `deleteManifest`.
  Responses are reduced to the fields we use before anything else touches them (the
  `company` object carries our API key).
- `xdelivery/pickup.ts` — `requestPickupBatch` (button) and `releaseFromPickup` (delete a list
  or some lines). After the carrier call, each parcel is RE-READ and only a parcel X-Delivery
  now holds as `CREATED` is released in Ordra (HTTP success is not proof — the Darb lesson).
- `xdelivery/manifest-sync.ts` — in the 10-minute poll: imports pickup, return and exchange
  lists; a pickup line that vanished on the portal and whose parcel is `CREATED` again is
  released (source `carrier`). Replaces the automatic pickup request, which is gone with
  its switch.

## Settled during the build (2026-10-08)

- OWNER accounts may call the delete endpoints: `remove-parcels` answered 200 on the live
  test, and the owner confirmed the result on their portal.
- A parcel on a return list whose order the sync has not moved yet is brought to
  `to_be_returned` by the scan itself (the list is the carrier's word); `delivered` is refused.
- The manager alert is the alerts engine's `return_missing`, not the agent bell. Managers have
  no bell; `agent_notifications` is per agent and unique per (order, kind).
- Go-live: lists created before the account's set-up in Ordra are never imported (found by the
  live probe — the first sync would have shown 11 already-handed-over lists as « to receive »).
- Exchange lists only tick parcels: Ordra never creates exchanges (`exchange: "false"`), so
  their parcels are never Ordra orders.

## Verified

- SQL: `supabase/tests/carrier_manifests_test.sql`, all checks under real JWTs (both codes, set
  aside and resolved, unlinked parcel, delivered refused, damaged correction once and only while
  open, close and missing, actor/site/market refusals, RLS read-only, release idempotent and
  `system` when detected, `unscan_order` CREATED vs PENDING). The rest of the SQL suite: the
  unscan section of `stock_variant_axis_test` passes; four other files fail on objects of other
  sessions' migrations, none touched here.
- Vitest: every new suite; full run = the same 20 pre-existing failures, 9 768 passing.
- Live, read-only: the sync pulled 20 real lists (12 return, 8 pickup, 263 lines) into the local
  DB; a second run changed nothing and released nothing; every new PostgREST select ran for real.

## Open

- The UI: the screens of the prototype. `XDeliveryPickupCard` is a minimal placeholder.
- A return list X-Delivery edits after import (a parcel added) gets the new line; a parcel they
  REMOVE from a return list stays `expected` on ours. Not seen yet; revisit if it happens.

## Not in this round

- Libya, other Tunisian carriers (the abstraction is ready for them).
- Claims to X-Delivery for missing parcels.
