# Darb Assabil — Step 2: working dispatch from the confirm popup

Builds on Step 1 (carrier registered + configurable in settings; adapter `formatPayload` done, `dispatch`/`parseResponse` are stubs). Goal: clicking **Darb Assabil** in the post-confirm carrier picker actually creates a shipment and lands the order on `uploaded`.

Vendor API truth: `delivery_company_docs/Darb Assabil/INTEGRATION_GUIDE.md`. Live facts (service IDs, area data): memory `darb-assabil-api-facts`.

## Locked decisions
1. **Area source:** agent picks city/area in the popup (no schema/webhook change). Flows via `extra.customer_area` (+ `extra.city`).
2. **Picker data:** bundled static JSON of the 37 city/area pairs from the branches probe (25 single-area cities + Tripoli's 4 areas). No runtime API call.
3. **Service plan:** always the configured `default_service_id` (male courier `6783c612dcf305c9e775c987`). No dropdown yet.
4. **Both entry points:** `PostCallActionSheet` (confirm popup) AND `OrderDetailPanel` carrier picker.
5. **`darb_assabil_id`** (internal `_id`) stored in `orders.carrier_extra`; `tracking_number` = the `SH<digits>` reference.
6. **No cancellation** (voidDispatch stays unsupported). **No polling** (deferred — separate step).

## Changes
- `src/lib/carriers/darb-assabil-areas.ts` (new) — the 37 `{ city, area }` pairs as a typed const.
- `src/lib/carriers/types.ts` — `dispatch(payload: unknown)`; success result gains `extra?: Record<string,unknown>`. `formatPayload` stays `Record<string,string>`.
- `src/lib/carriers/perform-dispatch.ts` — merge `result.extra` into `p_carrier_extra`.
- `src/lib/carriers/darb-assabil-adapter.ts` — real `dispatch` (two calls: contact upsert → shipment create, `_step` tagging, 15s timeout, abort-if-contact-fails) + `parseResponse` (`body.status===true` checks; `DARB_CONTACT_FAILED`/`DARB_VALIDATION`/`DARB_TRANSIENT`/`DARB_MALFORMED`; returns `trackingNumber` + `extra.darb_assabil_id`).
- `src/components/queue/DarbAssabilLocationPicker.tsx` (new) — searchable city/area list from the bundled data.
- `src/components/queue/PostCallActionSheet.tsx` — `upload_pick_area` flow branch; when carrier code is `darb_assabil`, route to picker, send `extra: { customer_area, city }`.
- `src/components/queue/OrderDetailPanel/index.tsx` — branch on `darb_assabil` to open the same picker before dispatch.

## TDD order
1. Area data + adapter `dispatch`/`parseResponse` tests (mock fetch, both steps, all error paths) → implement.
2. `perform-dispatch` extra-merge test → implement.
3. Picker component test → implement.
4. Wire both entry points; manual e2e against the live account (one real shipment, then verify).

## Risks (from vendor doc + probe)
- HTTP 200 ≠ success → `parseResponse` checks `body.status===true`.
- Unknown city/area → obscure `reading 'name'` error → picker only emits known pairs.
- `apikey` literal prefix, lowercase `lby`/`lyd` → in `buildHeaders`/payload.
- Contact upsert idempotent by phone → safe to call every dispatch, no caching.
- `from` (origin) auto-resolved from the account's dashboard warehouse address — configure once on vendor side.

## Out of scope
- Status polling/timeline. Cancellation. Per-shipment service-plan dropdown. `orders.customer_area` durable column (area lives in `carrier_extra` for now).
