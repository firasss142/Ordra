# X-Delivery integration (Tunisia) — plan

Status (2026-10-06): Phases 1–5 built and tested, screens included (prototypes
`xdelivery-v1.html` and `xdelivery-label-v1.html` approved 2026-10-06). Migration 20261005160000 handed to the owner to paste. Source research, kept OUT of the repo because it
maps a partner's internal API and the repo is public: `delivery_company_docs/xdelivery/`
in the main checkout (`ordra-gap-analysis.md`, `portal-api.md`, catalogue JSONs).
Owner decisions 1–8 are in `ordra-gap-analysis.md` §0.

## The idea: status vocabulary belongs to the carrier, not the market

Tunisia's chain (`scanned → dispatched → deposit → in_transit → delivered | returned`) was
built for Navex. Navex returns land on `returned` **from the carrier**, stock included, with
no warehouse scan. That is why Tunisia has never scanned a return.

X-Delivery's real lifecycle (221 parcel histories) is Darb's almost step for step. So its
Tunisian parcels use the statuses Ordra already has. **Nothing shared changes**: not the
`order_status` enum, not `order_status_rank`, not `promote_darb_status`,
`fulfill_order_transition`, `scan_return_in`, `find_return_by_code`,
`get_to_be_returned_orders` or `get_delivery_worklist`, and not the presentation, labels or
status lists. Libya cannot be affected, because nothing it runs is edited.

| X-Delivery | Ordra | What existing machinery then does |
|---|---|---|
| `CREATED`, `PENDING` | no change (slug recorded) | — |
| `COLLECTED` | `dispatched` | (never observed; kept for completeness) |
| `ARRIVED_AT_DEPOT` | `deposit` | carrier fees begin (rank allows scanned → deposit) |
| `OUT_FOR_DELIVERY` | `out_for_delivery` | same rank as `delivery_delayed`, so the retry ⇄ out cycle is legal |
| `RETURNED_AT_DEPOT` (retry, "Report", unreachable) | `delivery_delayed` | worklist `delay_unanswered` → **act now**: call the customer |
| `RETURNED_TO_DEPOT_CLIENT` / `_SENDER` (refused) | `returning` | worklist **"Retours à sauver"** bucket |
| `PENDING_RETURNS` (sent to us) | `to_be_returned` | **Retours** screen; the bench scan does +stock |
| `RETURNED_TO_SENDER` (handed to us) | `to_be_returned` (no change) | same; only our scan makes it `returned` |
| `DELIVERED`, `DELIVERED_PAID` | `delivered` | revenue, commissions |
| `ARCHIVED` | none (our own void already cancels) | — |
| `DELIVERED` → `RETURNED_*` | **blocked by rank** (90 > 70); reported as a conflict | decision 7: stays delivered, flagged |

Why `out_for_delivery` rather than `in_transit`: X-Delivery alternates OUT ⇄ RETURNED_AT_DEPOT,
and with `in_transit` (50) below `delivery_delayed` (60) every second trip out would count as
walking backwards. All shared status lists, labels and the worklist already know `out_for_delivery`.

## Phases

1. **Status layer** (this PR)
   - Migration: `promote_carrier_status(...)`, a generic rank-guarded promoter. It refuses
     Darb (which keeps its own promoter), refuses `returned`/`received` (stock moves only by
     scan), runs on the service role only, and reports `conflict` on delivered-then-returned.
   - The migration also adds `xdelivery` to the `carrier_event_log.carrier_code` CHECK.
   - `src/lib/carriers/xdelivery-statuses.ts`: maps a status to an Ordra target, plus the
     history note.
   - SQL test plus Vitest.
2. **Adapter and upload**
   - `XDeliveryAdapter`: `add-parcel`, `delete-parcel` as the void, and the descriptor.
   - Delegation fallback table (decision 1), phone normalisation to 8 digits, and governorate
     spelling to their catalogue.
   - Barcodes are strings, 15 digits, with no length check.
3. **Sync**
   - Webhook route: Bearer = the API key, `barcode` arrives as a number, so it is stringified at once.
   - 10-minute poll through `POST /parcels/status` in batches; unknown barcodes are silently
     dropped by them, so we log them ourselves.
4. **Pickup switch** (decision 6)
   - A portal-login client (JWT 8 h, credentials in `carriers.api_credentials`), and
     `POST /manifests/collectParcels` in ONE batch per sync tick for scanned parcels still `CREATED`.
   - The per-site switch reuses the stamp mechanism of `pickup-window.ts` under its own key and
     rule: a warehouse agent may turn it OFF **and** ON (Darb's rule is untouched).
   - Prototype first.
   - Screens (2026-10-06): `XDeliveryPickupCard` on the TN bench (« Sortir », under the figure,
     with the parcel list) and on « Aujourd'hui » (card only), fed by
     `/api/warehouse/xdelivery-pickup`; `XDeliveryDispatchModal` opens from the agent's and the
     manager's « Envoyer maintenant » (`carrierFormFor`). The delegation search reaches X-Delivery's
     4 901 localities (`localities.ts`, lazy-loaded) and selects the delegation they belong to.
   - `settings` is readable by managers only, so the route reads the switch with the service
     role after its own permission check — otherwise an agent never sees their own press.
5. **Label**
   - Our label carries their Code-128 of the barcode; scan-out for a non-sticker carrier (G4).
   - Built 2026-10-06 from `prototypes/xdelivery-label-v1.html`. Two codes (owner): their Code-128
     on top for their drivers, our QR at the bottom so TN scan-out is unchanged. Depot code big
     (`XDELIVERY_DEPOT`, 9 depots, checked against all 4 936 catalogue rows). Two formats kept by the
     owner: A4 ×2 and thermal 10×15, chosen at print time and remembered per computer.
   - `/api/warehouse/xdelivery-labels`: GET = to print / printed / last batch; POST = the PDF. Uploaded
     parcels only (the label needs their number). The PDF is rendered BEFORE `label_prints` is
     written, so a failed render never unlocks scan-out. `bl_number` stays null.
   - The Arabic notice needs a font with whole dotted glyphs: Noto Naskh renders without dots under
     @react-pdf; Tajawal (OFL) is inlined as a data URL so the serverless bundle cannot miss it.
   - The old `/api/warehouse/label-prints` (confirmed orders only, BL number) is untouched.
   **Superseded 2026-10-08 by phase 6:** the automatic request and the switch are gone (owner: a
   pickup is a batch asked on demand). The card is a minimal button until the UI session rebuilds it.
6. **Manifests** (2026-10-08) — return lists scanned to the end, pickup on demand and undoable.
   Plan: `plans/xdelivery-manifests.md`; contract: `docs/xdelivery-manifests.md`. Backend built
   and proven live (read-only sync of 20 real lists into the local DB, idempotent re-run); the
   owner confirmed « 5 parcels → one list → remove 2 → back to CREATED » on their portal.
7. **Before go-live**
   - Paste `20261005160000_promote_carrier_status.sql` then `20261008120000_carrier_manifests.sql`.
   - Configure the X-Delivery carrier row WITH `portal_email` / `portal_password` (pickup and lists need them).
   - Assign a warehouse agent to the Tunis site; today none is assigned, and an unassigned agent sees nothing.

## Verified
- SQL: `supabase/tests/promote_carrier_status_test.sql`, 24/24 checks.
- Vitest: every `xdelivery*` suite, plus the registry, logos and poll run-all tests.
- Real local DB, sync: an upload goes through each status, the poll answers, and the
  parcel lands in the Retours inbox, where `find_return_by_code` finds it.
- Real local DB, pickup: switch ON requests only scanned + CREATED parcels in one
  batch and marks them PENDING; a re-run asks for nothing; OFF sends nothing; the
  Darb keys are untouched.
- Real local DB + browser (2026-10-06, installed Chrome, app on :3107, fake X-Delivery):
  a warehouse agent of Tunis sees the card ON with « 1 colis part au prochain passage » and
  « 14:27 dernière demande · 2 colis », the four parcels tagged « À demander » / « Demandé 14:27 »;
  turns it OFF (« Coupé depuis 14:33 », the waiting warning) and back ON; a refused portal
  login shows the Connexions › Transporteurs banner. An agent uploads a Sousse order: the form
  opens on Sousse, Sousse Ville PAR DÉFAUT; typing « sahloul » selects Sousse Jaouhara, which is
  what X-Delivery received and what `carrier_extra` keeps; the order lands on `uploaded`.
- Real local DB + browser, labels (2026-10-06): scan-out refused `NO_LABEL_PRINTED` before printing;
  the TN manager's desk showed « 2 étiquettes à imprimer », printed them as one A4 PDF in a new tab,
  reprinted one parcel in 10×15; scan-out then passed the label gate; the agent's bench showed
  « Étiquette prête ». Both PDFs were rendered from the database rows and read back as images.
- Live X-Delivery, read-only or non-creating calls only: empty-body validation,
  bad-key 401, deleting an unknown barcode (404), and the status read.

## Known follow-ups (not in scope)
- Their label shows a depot NUMBER; ours prints their 2-letter depot CODE. Ask their support which
  one their sorters read.
- `scan-out` reports a parcel with no linked product as `ORDER_NOT_FOUND` (prose fallback in
  `classifyRpcError`), so the bench names the wrong refusal. Pre-existing.
- **Darb's switch has the same RLS blind spot (pre-existing, Libya).** `/api/warehouse/pickup`
  reads `settings` with the caller's client; RLS lets only managers read it, so a warehouse
  agent who presses « Le chauffeur est passé » still sees « pas encore passé ». Display only:
  `performDispatch` enforces with the service role. Not changed here (Libya untouched).
- The TN « Aujourd'hui » returns tile says « chez Darb pour nous »; wrong once X-Delivery
  returns arrive in Tunis.
- `OrderDetailPanel`'s own carrier picker (`uploadOpen`) is unreachable: both endings take
  « Envoyer » first. Left as is.
- Navex still writes `returned` from the carrier with stock and no scan. Moving it onto
  `promote_carrier_status` would give Tunisia scanned returns for every carrier; that is a
  separate decision.
- The motif ("Client ne répond pas", "Report 06/10") lives in the history note. The worklist
  reads remarks only from `darb_shipments`; showing X-Delivery's on the row means touching that RPC.
