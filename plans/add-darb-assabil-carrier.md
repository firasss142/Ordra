# Add Darb Assabil carrier (Libya) — implementation plan

Replaces all prior briefs. Vendor is **Darb Assabil** (`v2.sabil.ly`), Libyan COD logistics platform.
The full vendor API surface is documented in [`delivery_company_docs/Darb Assabil/INTEGRATION_GUIDE.md`](../delivery_company_docs/Darb%20Assabil/INTEGRATION_GUIDE.md). That guide is the source of truth — read it first.

The existing `DexpressAdapter` is unrelated and stays untouched.

---

## Locked decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Service plan selection | **Per-shipment.** Agent picks at upload time via dropdown in the dispatch modal. Default pre-selection comes from `carriers.api_credentials.default_service_id`. |
| 2 | `paymentBy` | Hardcoded `receiver`. App is COD-only by design. |
| 3 | Cancellation | **Unsupported.** `voidDispatch` returns `supported: false`. No DELETE call ever made. |
| 4 | Vendor `cancelled` → OMS | Map to `returned` (preserves stock-integrity invariants). |
| 5 | Two-call flow (contact + shipment) | Both calls inside `dispatch()`. No new interface method. |
| 6 | Contact caching | None for v1. Contact upsert called every dispatch (idempotent by phone, vendor-confirmed). |
| 7 | `customer_area` source | Storefront/webhook sends it at intake. Adapter validates as defense-in-depth. |
| 8 | Currency | Hardcoded `lyd` (lowercase). |
| 9 | Polling endpoint | `GET /api/local/shipments/:id` (returns top-level `status` field). Timeline endpoint is richer but requires event-type reverse engineering — deferred. |
| 10 | Polling cadence | Match existing Dexpress cadence (whatever the cron is configured for). |
| 11 | Internal `_id` storage | `orders.carrier_extra` JSONB under key `darb_assabil_id`. No new column. |
| 12 | Webhook intake validation | **Strict.** Libyan-market intake without `customer_area` is rejected at the storefront/webhook layer. Adapter validation is the safety net. |
| 13 | Per-unit pricing | Send `amount: total_price, quantity: 1` as a single line item. Avoids float-precision risk from `total_price / quantity`. |
| 14 | Phone normalization | Adapter prepends `+218` if `customer_phone` doesn't start with `+`. Defensive normalization, prevents intake failures. |
| 15 | `formatPayload` interface | Widen return type from `Record<string, string>` to `unknown`. Navex's existing flat object passes through unchanged. Cleaner than the snapshot-and-rebuild dance. |
| 16 | `dispatch_order` RPC end status | Open question — see §10. |

---

## Constraints inherited from CLAUDE.md

- **TDD non-negotiable.** Tests fail first, then implementation passes.
- **Market isolation:** descriptor `markets: ["ly"]`. Tunisian managers must not see this carrier.
- **Service-role Supabase client** server-only (route handlers, polling cron). Never in browser.
- **Adapter pattern:** new adapter file + small surgical edits to shared types and the dispatch orchestrator. No edits to ownership, queue, or RPC contracts.
- **Append-only tables** (`order_history`, `inventory_log`) untouched.
- **Encrypted credentials** stored in `carriers.api_credentials` JSONB.

---

## Architecture overview

```
Agent clicks "Upload to Carrier"
   │
   ▼
Dispatch modal (Libyan order)
   │  1. Fetches /api/carriers/[id]/service-plans → Darb's GET /api/local/service/rates/public
   │  2. Renders dropdown, defaults to credentials.default_service_id
   │
   ▼
POST /api/orders/[id]/dispatch  body: { carrier_id, extra: { service_id } }
   │
   ▼
performDispatch → dispatchToCarrier → adapter.formatPayload (validates) → adapter.dispatch (2 HTTP calls) → adapter.parseResponse
                                                                            │
                                                                            ├─ POST /api/contacts/create/public/contact   (upsert by phone, returns contact._id)
                                                                            └─ POST /api/local/shipments                  (returns reference + _id)
   │
   ▼
RPC dispatch_order(p_carrier_extra: { ...callerExtra, darb_assabil_id })
   │
   ▼
order.tracking_number = SH<digits>, order.carrier_extra.darb_assabil_id = <ObjectId>
```

Polling cron (separate process):
```
runPollCycle → for orders with carrier_code='darb_assabil' →
  pollDarbAssabil → for each: fetch GET /api/local/shipments/:darb_assabil_id →
    extract data.results[0].status → mapDarbAssabilStatus → applyFulfillmentTransition
```

---

## Schema changes

### Migration: `add_customer_area_to_orders`
```sql
ALTER TABLE public.orders ADD COLUMN customer_area text;
```
Nullable. Tunisia orders leave it null. Libya orders must populate (enforced at webhook intake — separate work, see §11).

File: `supabase/migrations/<TS>_add_customer_area_to_orders.sql`.
Apply via Supabase MCP `apply_migration` only when the rest of the work is reviewed and ready. Not part of plan review.

No other schema changes. `orders.carrier_extra` already exists (migration `005_carrier_dispatch.sql`).

---

## Type changes

### `src/lib/carriers/types.ts`

```diff
 export interface CarrierOrderData {
   customer_name: string;
   customer_phone: string;
   customer_phone_2: string | null;
   customer_whatsapp: string | null;
   customer_address: string | null;
   customer_city: string | null;
+  customer_area: string | null;
   customer_note: string | null;
   product_name: string;
   variant_label: string | null;
   quantity: number;
   total_price: number;
 }

 export type CarrierDispatchResult =
-  | { success: true; trackingNumber: string }
+  | { success: true; trackingNumber: string; extra?: Record<string, unknown> }
   | {
       success: false;
       errorCode: string;
       errorMessage: string;
       retryable: boolean;
     };

 export interface CarrierAdapter {
   formatPayload(
     order: CarrierOrderData,
     config: CarrierConfig,
     extra?: Record<string, unknown>
-  ): Record<string, string>;
+  ): unknown;

   dispatch(
-    payload: Record<string, string>,
+    payload: unknown,
     config: CarrierConfig
   ): Promise<CarrierRawResponse>;
   ...
 }
```

Navex's flat `Record<string, string>` is still valid `unknown`, no behavioral change. NavexAdapter's signatures get widened to match the interface; its implementation stays identical.

### `src/lib/carriers/perform-dispatch.ts`

```diff
 type OrderRow = {
   ...
   customer_city: string | null;
+  customer_area: string | null;
   ...
 };

 const ORDER_COLUMNS =
-  "id, status, market_id, customer_name, customer_phone, customer_phone_2, customer_whatsapp, customer_address, customer_city, customer_note, product_name, variant_label, quantity, total_price";
+  "id, status, market_id, customer_name, customer_phone, customer_phone_2, customer_whatsapp, customer_address, customer_city, customer_area, customer_note, product_name, variant_label, quantity, total_price";

 const orderData: CarrierOrderData = {
   ...
   customer_city: order.customer_city,
+  customer_area: order.customer_area,
   ...
 };
```

And merge `result.extra` into `p_carrier_extra`:
```diff
+  const mergedExtra = { ...(extra ?? {}), ...(result.extra ?? {}) };
+  const carrierExtra = Object.keys(mergedExtra).length > 0 ? mergedExtra : null;

   const { data: dispatchData, error: dispatchError } = await admin.rpc(
     "dispatch_order",
     {
       p_order_id: orderId,
       p_carrier_id: carrierId,
       p_tracking_number: result.trackingNumber,
-      p_carrier_extra: extra ?? null,
+      p_carrier_extra: carrierExtra,
       p_actor_id: actorId,
     }
   );
```

Navex returns no `extra` so its behavior is identical.

---

## Adapter implementation

### File: `src/lib/carriers/darb-assabil-adapter.ts`

#### Credentials shape
```ts
config.apiCredentials = {
  api_key: string;              // secret — value passed after literal "apikey "
  account_id: string;           // 24-char ObjectId, used in X-ACCOUNT-ID
  default_service_id?: string;  // optional; pre-selects in agent UI
};
```
`config.apiEndpoint` defaults to `"https://v2.sabil.ly"` from the descriptor.

#### Helper: `buildHeaders(config)`
```ts
{
  "Content-Type": "application/json",
  "Authorization": `apikey ${config.apiCredentials.api_key}`,
  "X-API-VERSION": "1.0.0",
  "X-ACCOUNT-ID": config.apiCredentials.account_id,
}
```
The literal word `apikey` (lowercase, single space) is mandatory per vendor docs §2.

#### Helper: `normalizePhone(phone)`
```ts
phone.startsWith("+") ? phone : `+218${phone.replace(/^0+/, "")}`
```
Strips leading zeros (Libyan local format like `0911234567` → `+218911234567`).

#### `formatPayload(order, config, extra?)` — validates only

This adapter's `formatPayload` does **not** build the wire payload (that's done in `dispatch()` because there are two different bodies). Instead it validates and returns a structured snapshot:

```ts
type DarbPayload = {
  serviceId: string;
  contactName: string;
  contactPhone: string;       // E.164
  to: { city: string; area: string; address: string };
  productTitle: string;
  totalPrice: number;
  notes: string;
};
```

Validation throws `CarrierDispatchError` (caught by the dispatch route, surfaced to the agent's modal):
- `customer_name`, `customer_phone`, `customer_city`, `customer_area`, `customer_address` all non-empty.
- `api_key`, `account_id` present in credentials.
- `service_id` resolved from `extra.service_id` first, falling back to `config.apiCredentials.default_service_id`. If neither, throw "Service plan is required for Darb Assabil dispatch."

These errors fire **before** any network call.

#### `dispatch(payload, config)` — two HTTP calls

```
1. POST {endpoint}/api/contacts/create/public/contact
   body: { account: config.apiCredentials.account_id, name: contactName, phone: contactPhone }
   timeout: 15s
   On HTTP 5xx or fetch throw → wrap as CarrierRawResponse with status, body={ _step: "contact", ... }
   On HTTP 200: read body. If body.status !== true → return raw with body={ _step: "contact", ...body }
   Otherwise extract contactId = body.data._id and proceed.

2. POST {endpoint}/api/local/shipments
   body: {
     service: serviceId,
     contacts: [contactId],
     paymentBy: "receiver",
     to: { countryCode: "lby", city, area, address },
     products: [{
       title: productTitle,
       quantity: 1,
       amount: totalPrice,
       currency: "lyd",
       isChargeable: true,
     }],
     notes,
   }
   timeout: 15s
   Return CarrierRawResponse { status, body: { _step: "shipment", ...body } }
```

The `_step` sentinel rides on the body object so `parseResponse` knows which call's body it's seeing.

`productTitle = order.variant_label ? `${order.product_name} - ${order.variant_label}` : order.product_name`.

`notes = order.customer_note ?? ""`.

#### `parseResponse(raw)`

```ts
parseResponse(raw: CarrierRawResponse): CarrierDispatchResult {
  // Transport-level failure (5xx, network error wrapped as 0)
  if (raw.status >= 500 || raw.status === 0) {
    return { success: false, errorCode: "DARB_TRANSIENT", errorMessage: `Carrier temporarily unavailable (HTTP ${raw.status})`, retryable: true };
  }

  const body = (raw.body ?? {}) as Record<string, unknown>;
  const step = body._step as "contact" | "shipment" | undefined;

  // Vendor's HTTP 200 with body.status === false
  if (body.status === false) {
    const messages = body.messages as Array<{ message?: string }> | undefined;
    const firstMessage = messages?.[0]?.message ?? "Carrier rejected the request";
    const errorCode = step === "contact" ? "DARB_CONTACT_FAILED" : "DARB_VALIDATION";
    return { success: false, errorCode, errorMessage: firstMessage, retryable: false };
  }

  // Success path — must be the shipment step
  if (body.status === true && step === "shipment") {
    const data = body.data as Record<string, unknown> | undefined;
    const reference = typeof data?.reference === "string" ? data.reference : null;
    const internalId = typeof data?._id === "string" ? data._id : null;
    if (!reference || !internalId) {
      return { success: false, errorCode: "DARB_MALFORMED", errorMessage: "Carrier returned success but no reference/_id", retryable: false };
    }
    return {
      success: true,
      trackingNumber: reference,
      extra: { darb_assabil_id: internalId },
    };
  }

  return { success: false, errorCode: "DARB_UNKNOWN", errorMessage: "Unexpected response shape from carrier", retryable: false };
}
```

#### `voidDispatch(_, _)` — unsupported

```ts
async voidDispatch(): Promise<CarrierVoidResult> {
  return {
    success: false,
    supported: false,
    reason: "Cancellation is not supported by the Darb Assabil integration.",
  };
}
```
No DELETE call. No lookup. Simple.

---

## Service-plan API route (new)

### File: `src/app/api/carriers/[id]/service-plans/route.ts`

The agent's dispatch modal needs the list of service plans to render the dropdown. Vendor endpoint: `GET /api/local/service/rates/public`. Headers identical to dispatch.

```ts
GET /api/carriers/[id]/service-plans
  → loads carrier row, decrypts credentials
  → calls GET {endpoint}/api/local/service/rates/public
  → returns { data: { plans: [{ _id, title, currency, amount, attributes, isPrimary }] } }
  → 4xx if carrier doesn't belong to the calling user's market or isn't darb_assabil
```

Authorization: same as the dispatch route (must be `agent`/`market_manager`/`super_admin`, must own the carrier's market).

Caching: none for v1. List is small (~5 plans), agents rarely open the modal.

---

## Adapter registration

### File: `src/lib/carriers/adapter-registry.ts`

```diff
-export type CarrierCode = "navex" | "dexpress";
+export type CarrierCode = "navex" | "dexpress" | "darb_assabil";

 const adapters: Record<CarrierCode, () => CarrierAdapter> = {
   navex: () => new NavexAdapter(),
   dexpress: () => new DexpressAdapter(),
+  darb_assabil: () => new DarbAssabilAdapter(),
 };

 const ADAPTER_DESCRIPTORS: Record<string, AdapterDescriptor> = {
   ...
+  darb_assabil: {
+    code: "darb_assabil",
+    label: "Darb Assabil",
+    description: "Intégration Darb Assabil (Libye). Authentification clé API + ID de compte.",
+    defaultEndpoint: "https://v2.sabil.ly",
+    credentialFields: [
+      { key: "api_key", label: "Clé API", secret: true },
+      { key: "account_id", label: "ID de compte (X-ACCOUNT-ID)", secret: false, placeholder: "692637b4..." },
+      { key: "default_service_id", label: "ID de service par défaut (optionnel)", secret: false, placeholder: "6783c612..." },
+    ],
+    markets: ["ly"],
+  },
 };
```

The settings UI introspects this descriptor and renders the three input fields automatically. No settings-UI change needed.

---

## Polling layer

### File: `src/lib/carriers/polling/clients.ts` — add `fetchDarbAssabilStatus`

```ts
export async function fetchDarbAssabilStatus(
  internalId: string,
  row: CarrierRowForPoll
): Promise<unknown> {
  const creds = decodeCredentials(row);
  const apiKey = creds.api_key;
  const accountId = creds.account_id;
  if (!apiKey) throw new Error("DarbAssabil: api_key missing from credentials");
  if (!accountId) throw new Error("DarbAssabil: account_id missing from credentials");

  const base = row.api_endpoint || "https://v2.sabil.ly";
  const url = `${base.replace(/\/$/, "")}/api/local/shipments/${encodeURIComponent(internalId)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `apikey ${apiKey}`,
      "X-API-VERSION": "1.0.0",
      "X-ACCOUNT-ID": accountId,
    },
    signal: AbortSignal.timeout(15000),
  });
  try { return await response.json(); } catch { return await response.text(); }
}
```

Note this takes the **internal `_id`** (from `carrier_extra.darb_assabil_id`), not the human reference. Per vendor docs §5.8, the response is `data.results[0]`.

### File: `src/lib/carriers/polling/extractors.ts` — add `parseDarbAssabilResponse`

```ts
export interface DarbAssabilParsed {
  status: string | null;
  reference: string | null;
}
export function parseDarbAssabilResponse(raw: unknown): DarbAssabilParsed {
  if (!raw || typeof raw !== "object") return { status: null, reference: null };
  const body = raw as Record<string, unknown>;
  if (body.status !== true) return { status: null, reference: null };
  const data = body.data as Record<string, unknown> | undefined;
  const results = data?.results as Array<Record<string, unknown>> | undefined;
  const first = results?.[0];
  if (!first) return { status: null, reference: null };
  return {
    status: typeof first.status === "string" ? first.status : null,
    reference: typeof first.reference === "string" ? first.reference : null,
  };
}
```

### File: `src/lib/carriers/polling/status-map.ts` — add `mapDarbAssabilStatus`

```ts
const DARB_MAP: Record<string, OrderStatus> = {
  // pending/booked/processing — already at 'dispatched'; no transition.
  // (omitting them returns null → ignored)
  "on-branch": "in_transit",
  "released": "in_transit",
  "resent": "in_transit",
  "returning": "in_transit",
  "completed": "delivered",
  "returned": "returned",
  "cancelled": "returned",   // decision 4
};

const DARB_IGNORED = new Set(["pending", "booked", "processing", "delayed"]);

export function mapDarbAssabilStatus(vendorStatus: string): CarrierStatusMapping | null {
  if (DARB_IGNORED.has(vendorStatus)) return null;
  const statusTo = DARB_MAP[vendorStatus];
  if (!statusTo) return null;
  return { statusTo, note: `Darb Assabil: ${vendorStatus}`, isDamaged: false };
}
```

### File: `src/lib/carriers/polling/poller.ts` — wire `darb_assabil`

This is the biggest poller diff. Four things change:

1. **Type union extension:** `carrier_code: "navex" | "dexpress" | "darb_assabil"` everywhere it appears (`OpenOrderForPoll`, `LogEntry`, `PollRunResult`, `PollerDeps`).
2. **`OpenOrderForPoll` gets `carrier_extra`:** the poller reads `darb_assabil_id` from it.
3. **New per-carrier dep:** `fetchDarbAssabilStatus(internalId: string, row: CarrierRowForPoll)`.
4. **New branch in `runPollCycle` + new helper `pollDarbAssabil`** — mirrors `pollNavex` (one-by-one, no batch endpoint).

```ts
export interface OpenOrderForPoll {
  order_id: string;
  tracking_number: string;
  status: OrderStatus;
  carrier_code: "navex" | "dexpress" | "darb_assabil";
  api_credentials: string | null;
  api_endpoint: string | null;
  carrier_extra: Record<string, unknown> | null;  // NEW
}
```

```ts
async function pollDarbAssabil(orders: OpenOrderForPoll[], deps: PollerDeps): Promise<PollRunResult> {
  let processed = 0, ignored = 0, errored = 0;
  for (const order of orders) {
    const internalId = order.carrier_extra?.darb_assabil_id as string | undefined;
    if (!internalId) {
      await deps.writeLog({ ...baseLogFields, outcome: "error", outcome_reason: "missing_darb_assabil_id" });
      errored++; continue;
    }
    try {
      const raw = await deps.fetchDarbAssabilStatus(internalId, { api_credentials: order.api_credentials, api_endpoint: order.api_endpoint });
      const parsed = parseDarbAssabilResponse(raw);
      if (parsed.status === null) { /* ignored:empty_status */ ignored++; continue; }
      const mapping = mapDarbAssabilStatus(parsed.status);
      if (!mapping) { /* ignored:unknown_status */ ignored++; continue; }
      await deps.applyFulfillment({ orderId: order.order_id, newStatus: mapping.statusTo, isDamaged: false, note: mapping.note });
      processed++;
    } catch (err) { /* error log */ errored++; }
  }
  return { carrierCode: "darb_assabil", polled: orders.length, processed, ignored, errored };
}
```

5. **`buildProductionDeps` SQL update** — add `carrier_extra` to the orders projection and admit `carrier_code === "darb_assabil"` in the filter.

---

## Tests (TDD)

### File: `src/lib/carriers/darb-assabil-adapter.test.ts` (new)

Mirrors Navex test structure. **No fixture files** — inline mock responses (matches Navex pattern; simpler than the previous plan's 9-JSON-file approach).

```
describe("DarbAssabilAdapter", () => {
  describe("formatPayload — validation", () => {
    test("throws when customer_phone is empty");
    test("throws when customer_city is empty");
    test("throws when customer_area is empty");      // decision 7 safety net
    test("throws when customer_address is empty");
    test("throws when api_key missing");
    test("throws when account_id missing");
    test("throws when neither extra.service_id nor default_service_id is set");
    test("uses extra.service_id when provided (overrides default)");
    test("falls back to default_service_id when extra.service_id missing");
    test("returns structured snapshot for valid input");
  });

  describe("dispatch — happy path", () => {
    test("calls contact endpoint then shipment endpoint with correct headers");
    test("authorization header uses 'apikey' literal prefix (not 'Bearer')");
    test("uses lowercase 'lby' for countryCode");
    test("uses lowercase 'lyd' for currency");
    test("sends amount=total_price, quantity=1 (single line item)");      // decision 13
    test("appends variant_label to product title when present");
    test("normalizes phone: prepends +218 when no plus prefix");           // decision 14
    test("normalizes phone: strips leading zeros before prepending");
    test("passes phone through unchanged when already E.164");
    test("uses customer_note as notes when present, empty string otherwise");
    test("respects 15s timeout per call (AbortSignal.timeout)");
  });

  describe("dispatch — error handling", () => {
    test("aborts after contact-create fails (does NOT call shipment endpoint)");
    test("tags response body with _step='contact' on contact-step failure");
    test("tags response body with _step='shipment' on shipment-step response");
    test("wraps fetch throw as status=0 raw response");
  });

  describe("parseResponse", () => {
    test("vendor 200 + body.status===true on shipment step → success with reference + extra.darb_assabil_id");
    test("vendor 200 + body.status===false on shipment step → DARB_VALIDATION with first message");
    test("vendor 200 + body.status===false on contact step → DARB_CONTACT_FAILED");
    test("HTTP 200 + body.status===true but missing reference → DARB_MALFORMED");
    test("HTTP 200 + body.status===true but missing _id → DARB_MALFORMED");
    test("HTTP 5xx → DARB_TRANSIENT, retryable=true");
    test("HTTP 0 (network throw) → DARB_TRANSIENT, retryable=true");
    test("unexpected shape → DARB_UNKNOWN");
  });

  describe("voidDispatch", () => {
    test("returns supported=false without making any HTTP call");
  });
});
```

### Polling tests

Add `mapDarbAssabilStatus` and `parseDarbAssabilResponse` cases to existing test files for `status-map.ts` and `extractors.ts` (matching how Navex/Dexpress are tested there).

For `poller.ts`, extend the existing test suite with a Darb Assabil branch covering:
- Happy path (one order, status `on-branch` → transitions to `in_transit`)
- Missing `carrier_extra.darb_assabil_id` → error log
- Vendor returns `status: false` → ignored with reason
- Terminal status `completed` → transitions to `delivered`

### Type changes — Navex regression
After widening `formatPayload` return type to `unknown`, run `npm run typecheck` and `npx vitest run src/lib/carriers/navex-adapter.test.ts`. Expected: zero changes. Navex tests that assert on payload key shape (`expect(payload.prix).toBe(...)`) still work because `payload` is narrowed by the test's local types.

---

## File-by-file change inventory

| File | Type | Change |
|---|---|---|
| `supabase/migrations/<TS>_add_customer_area_to_orders.sql` | new | `ADD COLUMN customer_area text` |
| `src/lib/carriers/types.ts` | modify | `customer_area` field; `extra?` on success result; `formatPayload` returns `unknown`; `dispatch` accepts `unknown` |
| `src/lib/carriers/perform-dispatch.ts` | modify | Project `customer_area`; pass it through; merge `result.extra` into `p_carrier_extra` |
| `src/lib/carriers/darb-assabil-adapter.ts` | new | Full adapter implementation |
| `src/lib/carriers/darb-assabil-adapter.test.ts` | new | TDD test suite |
| `src/lib/carriers/adapter-registry.ts` | modify | Type union, factory entry, descriptor (`markets: ["ly"]`) |
| `src/app/api/carriers/[id]/service-plans/route.ts` | new | GET endpoint backing the dispatch-modal dropdown |
| `src/lib/carriers/polling/clients.ts` | modify | Add `fetchDarbAssabilStatus` |
| `src/lib/carriers/polling/extractors.ts` | modify | Add `parseDarbAssabilResponse` |
| `src/lib/carriers/polling/status-map.ts` | modify | Add `mapDarbAssabilStatus` + tests |
| `src/lib/carriers/polling/poller.ts` | modify | Type union, `pollDarbAssabil` helper, `runPollCycle` branch, `buildProductionDeps` SQL projection |
| `src/lib/carriers/CLAUDE.md` | modify | Update adapter list (replace stale `LibyanCarrierAdapter` reference) |
| **Dispatch modal UI** (Libyan path) | modify | Add service-plan dropdown for `carrier.code === "darb_assabil"`. Calls `/api/carriers/[id]/service-plans`, passes selected ID as `extra.service_id`. Path TBD during implementation — likely `src/components/agent/DispatchModal.tsx` or equivalent. |

**No changes to:**
- The dispatch route handler (`extra` already flows through verbatim)
- The agent queue UI / ownership rules
- The order detail panel
- The `dispatch_order` RPC
- Any existing adapter (Navex, Dexpress)
- The settings UI component (descriptor handles rendering)
- Append-only history/inventory tables

---

## Webhook intake validation (out of scope, but blocking)

Per decision 12, the storefront/webhook layer must reject Libyan-market intake without `customer_area`. This is **not part of this plan** — it lives in `src/app/api/webhooks/` and the storefront adapters (`src/lib/storefronts/`).

**Action:** open a follow-up task to:
1. Add `customer_area` validation to the Libyan storefront adapter's intake mapping.
2. Reject intake (or surface an alert) when missing.

Until that lands, the adapter's `formatPayload` validation prevents bad orders from reaching the carrier — so this work is unblocked, but Libyan intake will be brittle until webhook validation catches up.

---

## Open question: `dispatch_order` end status (`uploaded` vs `dispatched`)

The deployed `dispatch_order` RPC currently lands orders on `dispatched`, but CLAUDE.md's status model defines a distinct `uploaded` boundary (carrier API succeeded, awaiting warehouse scan) that comes **before** `dispatched` (carrier acknowledged receipt, post-scan).

Two interpretations:
- **(A)** The deployed RPC is correct; `uploaded` is aspirational and we treat `dispatched` as the post-upload landing state.
- **(B)** The deployed RPC is a known shortcut and there's an unapplied migration (`20260506000000_uploaded_status_model.sql`) to fix it.

This plan **does not depend on the answer**. The adapter sets `tracking_number` and `extra.darb_assabil_id`; whichever status the RPC writes is what we get. But it's worth resolving before the Libyan polling layer goes live, because:
- If orders land at `uploaded`, the poller's `OPEN_STATUSES` filter (`["dispatched", "deposit", "in_transit", "unverified", "to_be_returned"]`) will skip them until warehouse scan moves them to `dispatched` — meaning we never poll Libyan orders waiting at the warehouse. That's fine for COD where stock isn't deducted yet, but worth a confirmed decision.

**Action:** confirm which interpretation is correct before implementing. Default assumption: (A) — orders land at `dispatched`, polling picks up immediately. If (B), we apply the unapplied migration and update `OPEN_STATUSES` accordingly. **No code path in this plan changes regardless.**

---

## Risks & gotchas (consolidated from vendor doc + our discussion)

1. **HTTP 200 ≠ success.** Always check `body.status === true`. Encoded in `parseResponse`.
2. **Three required headers**, `apikey` literal prefix, lowercase country/currency. Encoded in `buildHeaders`.
3. **Two-call dispatch** — contact upsert before shipment create. If contact-step fails, do NOT call shipment-create. Encoded in `dispatch`.
4. **Idempotent contact upsert** — safe to call every time, no caching needed.
5. **Reference vs. `_id`** — `tracking_number` = reference (human, `SH<digits>`); `carrier_extra.darb_assabil_id` = `_id` (24-char ObjectId). Polling uses `_id`.
6. **Single-shipment GET returns `data.results[0]`**, not `data` directly. Encoded in `parseDarbAssabilResponse`.
7. **Cancellation is a hard delete** (vendor side) — we sidestep by not supporting it.
8. **`customer_area` and `customer_city` must be Arabic UTF-8.** No transliteration. Storefront/webhook responsibility.
9. **`from` (origin) is auto-resolved** from the account's warehouse address in the vendor dashboard. Cannot override per-shipment. Configure once.
10. **Phone E.164** — `+218` prefix. Adapter-side normalization for safety.
11. **Default box dimensions** — vendor applies 50×40×40 cm at zero cost when we don't send dimensions. Acceptable for v1.
12. **Polling uses `_id`, not `reference`.** If `carrier_extra` is somehow null on a Libyan order, polling logs an error and skips it.

---

## Definition of done

- [ ] Migration `add_customer_area_to_orders.sql` applied via Supabase MCP `apply_migration`
- [ ] All adapter tests green (`npx vitest run src/lib/carriers/darb-assabil-adapter`)
- [ ] Polling tests green (status-map + extractors + poller integration)
- [ ] Navex regression check: `npx vitest run src/lib/carriers/navex-adapter` unchanged
- [ ] `npm run typecheck` and `npm run lint` clean
- [ ] Real end-to-end test against vendor staging (or sandbox account):
  - [ ] Libyan order moves `confirmed → uploaded/dispatched` with `tracking_number=SH<digits>` and `carrier_extra.darb_assabil_id` set
  - [ ] Service-plan dropdown loads in the dispatch modal and pre-selects the default
  - [ ] Polling picks up the order and transitions on a vendor status change
- [ ] Tunisian Navex flow regressions tested manually (Tunisian managers do **not** see Darb Assabil in the dropdown)
- [ ] Stale `src/lib/carriers/CLAUDE.md` reference list updated
- [ ] Open question §10 (`uploaded` vs `dispatched`) resolved

---

## Out of scope (explicitly)

- Removing `DexpressAdapter`. Untouched.
- Webhook-layer `customer_area` enforcement (separate task — see §11).
- Timeline-endpoint polling for richer milestone events. Future enhancement; v1 polls top-level status only.
- Cancellation via vendor DELETE. Decision 3.
- Trust-score integration (`/api/contacts/trust/score?phone=...`) for fraud signals at confirmation. Future enhancement.
- The unapplied `20260506000000_uploaded_status_model.sql` migration. Untouched until §10 resolves.
- Removing dev-only `debug` envelopes from the dispatch route. Separate cleanup.
- Per-shipment service plan stored on the order row for audit. Lives in `carrier_extra` only — not surfaced as a column.

---

## References

1. [`delivery_company_docs/Darb Assabil/INTEGRATION_GUIDE.md`](../delivery_company_docs/Darb%20Assabil/INTEGRATION_GUIDE.md) — vendor API truth
2. [`src/lib/carriers/CLAUDE.md`](../src/lib/carriers/CLAUDE.md) — adapter-layer rules (currently stale; updated as part of this work)
3. [`src/lib/carriers/types.ts`](../src/lib/carriers/types.ts) — interface contract
4. [`src/lib/carriers/navex-adapter.ts`](../src/lib/carriers/navex-adapter.ts) — reference implementation
5. [`src/lib/carriers/navex-adapter.test.ts`](../src/lib/carriers/navex-adapter.test.ts) — test pattern (inline mocks, no fixtures)
6. [`src/lib/carriers/perform-dispatch.ts`](../src/lib/carriers/perform-dispatch.ts) — dispatch orchestrator
7. [`src/lib/carriers/dispatch.ts`](../src/lib/carriers/dispatch.ts) — adapter pipeline (`formatPayload → dispatch → parseResponse`)
8. [`src/lib/carriers/adapter-registry.ts`](../src/lib/carriers/adapter-registry.ts) — registry + descriptors
9. [`src/lib/carriers/polling/poller.ts`](../src/lib/carriers/polling/poller.ts) — polling orchestrator (extends here)
10. [`src/app/api/orders/[id]/dispatch/route.ts`](../src/app/api/orders/[id]/dispatch/route.ts) — dispatch route (no changes — `extra` already wired)
