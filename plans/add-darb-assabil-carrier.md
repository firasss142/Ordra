# Add Darb Assabil carrier (Libya) — implementation plan

Replaces the older `add-libya-carrier.md` brief (which targeted Shipping Eyes).
Vendor pivoted to **Darb Assabil** (`v2.sabil.ly`). The existing `DexpressAdapter`
scaffold is unrelated and will not be touched in this change.

The full vendor API surface is documented in
[`delivery_company_docs/Darb Assabil/INTEGRATION_GUIDE.md`](../delivery_company_docs/Darb%20Assabil/INTEGRATION_GUIDE.md).
This plan assumes that guide is the source of truth — read it first.

## Decisions locked

| # | Topic | Decision |
|---|---|---|
| 1 | Internal `_id` storage | `orders.carrier_extra` JSONB (existing column) under key `darb_assabil_id`. No new column. |
| 2 | Service ID source | Stored in encrypted `carriers.api_credentials` alongside `api_key` and `account_id` |
| 3 | Service ID UI | Manual text input in settings UI; manager looks up the ObjectId from the Darb Assabil dashboard |
| 4 | Polling | Add Darb Assabil to the existing polling cron alongside Navex |
| 5 | Carrier `cancelled` mapping | → OMS `returned` (preserves stock-integrity invariants) |
| 6 | Missing `customer_area` | Block dispatch with a clear error; do not prompt agent |
| 7 | Test fixtures | Use real captured Postman responses verbatim, sanitized |

## Constraints inherited from CLAUDE.md

- TDD non-negotiable. Write the failing test first; implementation follows.
- Market isolation: `markets: ["ly"]` in the descriptor. Tunisian managers must not see this carrier.
- Service-role Supabase client only on server. Never in browser.
- Adapter pattern: new adapter file only. No edits to `perform-dispatch.ts`, the dispatch route, or the agent queue ownership rules.
- The deployed `dispatch_order` RPC currently lands on `dispatched` (skipping `uploaded`). Treat that as the contract. Do not apply the unapplied `20260506000000_uploaded_status_model.sql` migration.
- Append-only tables (`order_history`, `inventory_log`) are not touched by this change.

## Required infrastructure changes (small)

### 1. New column on `orders`
```sql
ALTER TABLE public.orders
  ADD COLUMN customer_area text;
```
Nullable. Tunisia orders leave it null. Libya orders must populate it (enforced at webhook intake — out of scope of this plan, since webhooks are flexible).

Captured as a new migration: `supabase/migrations/<TIMESTAMP>_add_customer_area_column.sql`.
**Apply via Supabase MCP `apply_migration` only when ready to ship — not as part of plan review.**

### 2. Extend `CarrierOrderData`
File: [src/lib/carriers/types.ts](../src/lib/carriers/types.ts).
Add `customer_area: string | null` to the interface. Tunisia adapters ignore it.

### 3. Extend `perform-dispatch.ts` projection
File: [src/lib/carriers/perform-dispatch.ts](../src/lib/carriers/perform-dispatch.ts).
- Add `customer_area` to `OrderRow` type.
- Add `customer_area` to the `ORDER_COLUMNS` SELECT projection.
- Pass `customer_area: order.customer_area` into the `orderData` object.

These three places must change in lockstep, otherwise the new column never reaches the adapter. There is **no** functional change for Navex — Navex's `formatPayload` doesn't touch `customer_area`.

## New adapter implementation

### File: `src/lib/carriers/darb-assabil-adapter.ts`

This is the bulk of the work. Implements `CarrierAdapter`.

#### Credential shape

```ts
config.apiCredentials = {
  api_key: string,        // secret, the apikey value
  account_id: string,     // 24-char hex ObjectId
  service_id: string,     // 24-char hex ObjectId of default service plan
}
```

`config.apiEndpoint` defaults to `https://v2.sabil.ly` from the descriptor's `defaultEndpoint`.

#### `formatPayload(order, config, _extra?)` — return shape exception

Darb Assabil takes nested JSON. `CarrierAdapter.formatPayload` is typed as `Record<string, string>` for Navex's flat URL-encoded form. Two ways to handle this:

**Choice A (recommended):** Adapter doesn't construct the wire payload in `formatPayload`. It instead returns a flat snapshot of the fields it needs (string-coerced where possible), then `dispatch()` reads `config.apiCredentials` and the order data fresh, builds the JSON object, and POSTs. `formatPayload` becomes a no-op or just validates.

**Choice B:** Stringify the JSON object and return it under a single key like `_jsonBody`. Hacky.

Going with **A**: validate in `formatPayload`, build payload inside `dispatch()`. Same pattern Dexpress would have used if it were finished.

`formatPayload` checks:
- `order.customer_phone` is non-empty → otherwise throw `CarrierDispatchError("Customer phone is required for Darb Assabil dispatch")`
- `order.customer_city` is non-empty → otherwise throw `CarrierDispatchError("Customer city is required (...)")`
- `order.customer_area` is non-empty → otherwise throw `CarrierDispatchError("Customer area is required (...)")` ← **the missing-area gate per decision 6**
- `order.customer_address` is non-empty → otherwise throw with same shape
- `config.apiCredentials.api_key`, `account_id`, `service_id` all present → otherwise `CarrierDispatchError("Darb Assabil credentials are incomplete: missing X")`

These throw before any network call. The dispatch route surfaces the message back to the agent in the modal.

#### `dispatch(payload, config)` — two API calls

Darb Assabil requires a contact ID. Per [INTEGRATION_GUIDE.md §5.4](../delivery_company_docs/Darb%20Assabil/INTEGRATION_GUIDE.md), the contact-create endpoint is idempotent by phone — same phone returns the same `_id`. So we always call it; no caching, no DB state.

```
1. POST /api/contacts/create/public/contact
     body: { account, name, phone }
     → returns data._id (the contact's stable ObjectId)
   On any error: return CarrierRawResponse marked failed; parseResponse handles it.

2. POST /api/local/shipments
     body: { service, contacts: [contactId], paymentBy: "receiver",
             to: { countryCode: "lby", city, area, address },
             products: [{ title, quantity, amount, currency: "lyd", isChargeable: true }],
             notes }
     → returns the full shipment object
```

Both calls use the same three-header auth: `Authorization: apikey <key>`, `X-API-VERSION: 1.0.0`, `X-ACCOUNT-ID: <accountId>`, plus `Content-Type: application/json`.

`dispatch()` wraps both calls in a single try/catch, with `AbortSignal.timeout(15000)` per call (Navex pattern). If contact-create fails, do NOT call shipment-create — return the contact-create error wrapped as a `CarrierRawResponse`.

The returned `CarrierRawResponse.body` from `dispatch()` is the **shipment-create response body** (or the contact-create error body if that step failed). We add a sentinel field `_step: "contact" | "shipment"` so `parseResponse` knows which call's body it's looking at.

`product_name` and `quantity` come from the order:
```ts
products: [{
  title: order.variant_label
    ? `${order.product_name} - ${order.variant_label}`
    : order.product_name,
  quantity: order.quantity,
  amount: order.total_price / order.quantity, // per-unit price; Darb sums it
  currency: "lyd",
  isChargeable: true,
}]
```
Verify with Postman first whether they want unit price or line total — the calculate-shipping test we ran sent a line `amount: 100, quantity: 1` and got `100 LYD product + 5 LYD shipping = 105`, so `amount` was the per-unit price. **Adapter sends `total_price / quantity` as `amount`.**

`notes` defaults to `order.customer_note ?? ""`.

`name` for the contact is `order.customer_name`.

`phone` for the contact must be E.164. Storefront should send it that way; if not, it's a data-quality issue out of scope for this plan. Adapter passes it through as-is.

#### `parseResponse(raw)` — Navex-style trap awareness

The HTTP status is **always 200**. Success vs. failure lives in `body.status`. From the captured fixture:

- Success: `{ status: true, data: { _id, reference, status: "pending", ... } }`
- Failure: `{ status: false, messages: [{ message, name, location, stack }] }`

Logic:
```ts
parseResponse(raw) {
  const body = raw.body as Record<string, unknown>;

  // Network/transport failure surfaced from dispatch()
  if (raw.status >= 500) {
    return { success: false, errorCode: "DARB_ASSABIL_TRANSIENT", retryable: true, ... };
  }

  // body.status: false → carrier-side validation/auth error
  if (body?.status === false) {
    const firstMessage = (body.messages as Array<{message: string}> | undefined)?.[0]?.message ?? "Unknown carrier error";
    const errorCode = body._step === "contact"
      ? "DARB_ASSABIL_CONTACT_FAILED"
      : "DARB_ASSABIL_VALIDATION";
    return { success: false, errorCode, errorMessage: firstMessage, retryable: false };
  }

  // body.status: true on the shipment step → success
  if (body?.status === true && body._step === "shipment") {
    const data = body.data as Record<string, unknown>;
    const reference = data?.reference as string | undefined;
    const internalId = data?._id as string | undefined;
    if (!reference || !internalId) {
      return { success: false, errorCode: "DARB_ASSABIL_MALFORMED", errorMessage: "Carrier returned 200 but no reference/_id", retryable: false };
    }
    return {
      success: true,
      trackingNumber: reference,
      // EXTENSION: also need to surface internalId for carrier_extra storage.
      // See "Required type extension" below.
    };
  }

  return { success: false, errorCode: "DARB_ASSABIL_UNKNOWN", errorMessage: "Unexpected response shape", retryable: false };
}
```

#### Required type extension — `CarrierDispatchResult.extra`

Currently:
```ts
type CarrierDispatchResult =
  | { success: true; trackingNumber: string }
  | { success: false; errorCode; errorMessage; retryable };
```

We need to surface `darb_assabil_id` to be persisted in `orders.carrier_extra`. Add an optional `extra` field:

```ts
type CarrierDispatchResult =
  | { success: true; trackingNumber: string; extra?: Record<string, unknown> }
  | ...
```

Then in `perform-dispatch.ts`, when calling `rpc("dispatch_order", ...)`, merge `result.extra` into the `p_carrier_extra` parameter:

```ts
const mergedExtra = {
  ...(extra ?? {}),
  ...(result.extra ?? {}),
};
const { data: dispatchData, error } = await admin.rpc("dispatch_order", {
  ...
  p_carrier_extra: Object.keys(mergedExtra).length > 0 ? mergedExtra : null,
  ...
});
```

This is a small, generic change that benefits any future carrier with a similar dual-ID need. Navex doesn't set `extra`, so its behavior is unchanged.

**Adapter usage:**
```ts
return { success: true, trackingNumber: reference, extra: { darb_assabil_id: internalId } };
```

#### `voidDispatch(trackingNumber, config)` — read internal ID from where?

Problem: `voidDispatch` only receives the tracking number (the `SH<digits>` reference). The DELETE endpoint requires the internal `_id`, which lives in `orders.carrier_extra.darb_assabil_id`.

Two options:

**Option A:** Adapter calls `GET /api/local/shipments/timeline/:reference` to discover the `_id`, then DELETEs by it. One extra round trip per cancel.

**Option B:** Extend `voidDispatch` to receive `extra` from the caller (perform-dispatch passes `order.carrier_extra` in). Cleaner but requires editing the `voidDispatch` signature on the interface and Navex's implementation.

Going with **A** — keeps the interface stable, no Navex changes, and `voidDispatch` is a rare path. The double-round-trip is acceptable.

```ts
async voidDispatch(trackingNumber, config) {
  // 1. Look up _id by reference
  const lookupRes = await fetch(`${config.apiEndpoint}/api/local/shipments/timeline/${encodeURIComponent(trackingNumber)}`, { headers, signal: AbortSignal.timeout(10000) });
  const lookupBody = await lookupRes.json();
  if (lookupBody?.status !== true || !lookupBody?.data?._id) {
    return { success: false, supported: true, reason: "Shipment not found in carrier system" };
  }
  const internalId = lookupBody.data._id as string;

  // 2. Delete
  const delRes = await fetch(`${config.apiEndpoint}/api/local/shipments/${encodeURIComponent(internalId)}`, {
    method: "DELETE", headers, signal: AbortSignal.timeout(10000),
  });
  const delBody = await delRes.json().catch(() => ({}));
  if (delBody?.status === true) return { success: true, supported: true };
  return { success: false, supported: true, reason: `Cancellation rejected by carrier` };
}
```

Notes:
- Cancellation may not be allowed once the shipment has been picked up by a courier — the carrier rejects with `status: false`. We return `supported: true` so the caller knows the operation was attempted; the order stays in OMS but cancellation didn't take effect carrier-side.
- This is a hard delete (per integration guide). Order operators must be made aware of this before triggering it. UI side of that is out of scope — this plan covers the adapter only.

## Adapter registration

### File: [src/lib/carriers/adapter-registry.ts](../src/lib/carriers/adapter-registry.ts)

```ts
// 1. Type extension
export type CarrierCode = "navex" | "dexpress" | "darb_assabil";

// 2. Factory entry
const adapters: Record<CarrierCode, () => CarrierAdapter> = {
  navex: () => new NavexAdapter(),
  dexpress: () => new DexpressAdapter(),
  darb_assabil: () => new DarbAssabilAdapter(),
};

// 3. Descriptor entry
darb_assabil: {
  code: "darb_assabil",
  label: "Darb Assabil",
  description: "Intégration Darb Assabil (Libye). Authentification par clé API + ID de compte.",
  defaultEndpoint: "https://v2.sabil.ly",
  credentialFields: [
    { key: "api_key", label: "Clé API", secret: true },
    { key: "account_id", label: "ID de compte (X-ACCOUNT-ID)", secret: false, placeholder: "692637b4..." },
    { key: "service_id", label: "ID de service par défaut", secret: false, placeholder: "6783c612..." },
  ],
  markets: ["ly"],
}
```

The settings UI ([src/components/settings/CarriersSection.tsx](../src/components/settings/CarriersSection.tsx)) introspects this descriptor and renders three input fields automatically. No UI code change required.

## Polling layer

### Files: [src/lib/carriers/polling/](../src/lib/carriers/polling/)

Per decision 4 — add Darb Assabil to the existing polling cron. Three files to touch (per the older handoff doc's mapping):

1. **`clients.ts`** — add `fetchDarbAssabilStatus(reference: string, carrierRow)` that hits `GET /api/local/shipments/timeline/:reference`. Returns the latest timeline entry's status (or rather, the most recent timeline event maps to a status — see status-map below).
2. **`extractors.ts`** — extract from the timeline response the most recent meaningful event. The Darb Assabil shipment's overall status lives in `data.status` if you call `GET /api/local/shipments/:id` instead, but the timeline endpoint only returns `data.timeline[]` — no top-level status. So we either:
   - **Use timeline events:** infer status from event types/descriptions. Brittle.
   - **Switch polling to `GET /api/local/shipments/:id`** which requires the internal `_id` from `carrier_extra`. More reliable but couples polling to internal ID storage.

   **Going with the second.** The poller looks up `order.carrier_extra.darb_assabil_id`, calls `GET /api/local/shipments/:id`, extracts `data.results[0].status`. Verified by our Postman test that this endpoint returns the shipment with its current top-level status field.

3. **`status-map.ts`** — the mapping table. Per decision 5:

| Darb Assabil status | OMS status |
|---|---|
| `pending`, `booked`, `processing` | `dispatched` (no change from initial) |
| `on-branch`, `released`, `resent` | `in_transit` |
| `delayed` | (no transition; just log) |
| `returning` | `in_transit` |
| `completed` | `delivered` |
| `returned` | `returned` |
| `cancelled` | `returned` |

Once a Darb Assabil order reaches a terminal OMS status (`delivered`, `returned`), the poller stops including it in the next batch (existing pattern, presumably).

I have not read `polling/poller.ts` yet — implementation phase will start by reading the three files top-to-bottom and adding `darb_assabil` alongside the Navex paths. If the poller has a hardcoded `if (carrier.code === 'navex')` style switch, this plan extends it; if it dispatches polymorphically by `carrier.code`, we just add a registry entry.

## Tests (TDD)

Per CLAUDE.md, tests are written first. New file:

### `src/lib/carriers/darb-assabil-adapter.test.ts`

Mirrors `navex-adapter.test.ts` structure. Real fixtures captured from Postman live in `src/lib/carriers/__fixtures__/darb-assabil/`:

- `shipment-create-success.json` — the response we got for `SH1584689`, sanitized
- `shipment-create-validation-error.json` — the `service: ObjectId` error from Step 4
- `shipment-create-country-error.json` — the country-not-found error from Step 4 (uppercase `LBY`)
- `contact-upsert-success.json` — the response from Step 7
- `timeline-success.json` — the response from Step 9
- `get-by-id-success.json` — the response from Step 10
- `delete-success.json` — the response from Step 11
- `service-rates-list.json` — the response from Step 5
- `wallet-metadata.json` — the response from Step 1

These get sanitized (replace real account ID with `<ACCOUNT_ID>` placeholder, real API token never present, etc.).

#### Test cases

```
describe("DarbAssabilAdapter", () => {
  describe("formatPayload", () => {
    it("validates customer_phone is required");
    it("validates customer_city is required");
    it("validates customer_area is required");      // ← decision 6
    it("validates customer_address is required");
    it("validates api_key is required");
    it("validates account_id is required");
    it("validates service_id is required");
    it("returns a snapshot of order fields when valid");
  });

  describe("dispatch", () => {
    it("calls contact-create then shipment-create with correct headers");
    it("uses lowercase 'lby' for countryCode");      // ← regression test for the docs trap
    it("uses lowercase 'lyd' for currency");
    it("computes per-unit amount from total_price / quantity");
    it("appends variant_label to product title when present");
    it("aborts on contact-create failure (does not call shipment-create)");
    it("times out at 15s per call");
    it("uses customer_note as notes when present");
  });

  describe("parseResponse", () => {
    it("treats body.status===true on shipment step as success");
    it("returns trackingNumber=reference and extra.darb_assabil_id=_id on success");
    it("treats body.status===false as failure with first message");
    it("differentiates contact-step failures from shipment-step failures");
    it("treats malformed success (missing reference) as failure");
    it("treats HTTP 5xx as retryable transient error");
  });

  describe("voidDispatch", () => {
    it("looks up _id by reference, then deletes by _id");
    it("reports unsupported when timeline lookup returns no _id");
    it("propagates carrier rejection with status: false");
  });
});
```

All HTTP calls are mocked via `vi.spyOn(global, 'fetch')` per existing pattern. Fixtures loaded with `import fixture from "./__fixtures__/...json"` per existing pattern.

## File-by-file change inventory

| File | Type | Change |
|---|---|---|
| `supabase/migrations/<TS>_add_customer_area_column.sql` | new | Adds `customer_area text` column |
| `src/lib/carriers/types.ts` | modify | `CarrierOrderData.customer_area: string \| null`; `CarrierDispatchResult` success variant gains optional `extra?` |
| `src/lib/carriers/perform-dispatch.ts` | modify | Add `customer_area` to projection, OrderRow, orderData; merge `result.extra` into `p_carrier_extra` |
| `src/lib/carriers/darb-assabil-adapter.ts` | new | Adapter implementation |
| `src/lib/carriers/darb-assabil-adapter.test.ts` | new | TDD tests |
| `src/lib/carriers/__fixtures__/darb-assabil/*.json` | new | Sanitized real responses (9 files) |
| `src/lib/carriers/adapter-registry.ts` | modify | Register `darb_assabil`: type, factory, descriptor |
| `src/lib/carriers/polling/clients.ts` | modify | Add `fetchDarbAssabilStatus` (uses internal `_id` from carrier_extra) |
| `src/lib/carriers/polling/extractors.ts` | modify | Add Darb Assabil status extractor |
| `src/lib/carriers/polling/status-map.ts` | modify | Add Darb Assabil → OMS status mapping (decision 5) |
| `src/lib/carriers/polling/poller.ts` | modify | Wire `darb_assabil` into the polling loop (extent depends on existing structure) |

No changes to:
- The dispatch API route
- The agent queue UI
- The order detail panel
- The `dispatch_order` RPC
- Any existing adapter (Navex, Dexpress)
- The settings UI component (descriptor handles rendering)

## Definition of done

- [ ] Migration `add_customer_area_column.sql` applied to remote DB via MCP `apply_migration`
- [ ] Adapter passes its own test suite (formatPayload, dispatch, parseResponse, voidDispatch)
- [ ] Adapter is registered in `adapter-registry.ts` with correct descriptor scoped to `markets: ["ly"]`
- [ ] Polling client added; verified to detect `pending → completed` transition on a real test shipment
- [ ] A real Libyan order can be uploaded end-to-end: confirmed → "Envoyer au transporteur" → carrier creates shipment → reference stored as `tracking_number`, `_id` stored in `carrier_extra.darb_assabil_id` → order moves to `dispatched`
- [ ] Cancellation works: cancelling the order in OMS triggers `voidDispatch` which DELETEs the shipment in Darb Assabil's dashboard
- [ ] Missing `customer_area` blocks dispatch with a clear error message in the agent's modal (decision 6)
- [ ] No regressions in Navex flow — run the Tunisian Navex flow once after these changes
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npx vitest run src/lib/carriers` passes
- [ ] Tunisian managers (scoped to `tn`) do not see Darb Assabil in the carrier dropdown

## Out of scope (explicitly)

- Removing `DexpressAdapter` and its scaffold. Leaves it untouched.
- Removing the dev-only `debug` envelopes from the dispatch route or `perform-dispatch.ts` (called out as cleanup in the previous handoff). Separate task.
- Per-order service selection in the dispatch modal (single primary service hardcoded — decision 2). Future enhancement.
- Webhook intake validation that `customer_area` is non-empty for Libya. The webhook layer is flexible per the user — the adapter's `formatPayload` enforces it at dispatch time, which is sufficient for V1.
- The `getTrustScore` integration (could be useful for fraud signals at confirmation time, but not on the path).
- Migrating Tunisia/Navex to the new `extra` field on `CarrierDispatchResult`. Navex doesn't need it.
- The unapplied `uploaded` status migration. Untouched, as instructed.

## References

1. [delivery_company_docs/Darb Assabil/INTEGRATION_GUIDE.md](../delivery_company_docs/Darb%20Assabil/INTEGRATION_GUIDE.md) — vendor API truth
2. [src/lib/carriers/CLAUDE.md](../src/lib/carriers/CLAUDE.md) — adapter-layer rules
3. [src/lib/carriers/types.ts](../src/lib/carriers/types.ts) — interface contract
4. [src/lib/carriers/navex-adapter.ts](../src/lib/carriers/navex-adapter.ts) — reference implementation
5. [src/lib/carriers/navex-adapter.test.ts](../src/lib/carriers/navex-adapter.test.ts) — reference test structure
6. [src/lib/carriers/perform-dispatch.ts](../src/lib/carriers/perform-dispatch.ts) — orchestrator (one small surgical edit)
7. [src/lib/carriers/adapter-registry.ts](../src/lib/carriers/adapter-registry.ts) — registry
8. [plans/add-libya-carrier.md](./add-libya-carrier.md) — superseded brief; kept for archaeological context
