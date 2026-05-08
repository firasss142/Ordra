# Dexpress integration — rewrite against the real Laravel portal

## TL;DR

The existing `DexpressAdapter` (and the `dexpress_states`/`dexpress_places` tables, the price calculator, the polling client, and the `DexpressLocationPicker` UI) were all built against a JSON API that **does not exist**. Dexpress confirmed there is no API and gave permission to find a workaround. Their merchant portal is a server-rendered Laravel 5.x app with cookie sessions, CSRF tokens, and form POSTs.

This plan rewrites the integration end-to-end against the real portal. We keep the `CarrierAdapter` interface and the surrounding plumbing (registry, `performDispatch`, dispatch RPC, agent UI shell). We rewrite everything that talks to the carrier itself, drop the dead price calculator and polling client, and reseed `dexpress_states` from the static `dexpress-states.json` capture.

For v1, fulfillment status updates stay manual (no polling). Sessions cache in Postgres so they survive Vercel cold starts.

---

## 1. Context

### 1.1 What's actually in the codebase today

Found via grep + reads:

- [src/lib/carriers/dexpress-adapter.ts](../src/lib/carriers/dexpress-adapter.ts) — adapter that POSTs JSON to `/create-order` with Bearer auth and parses codes `4000/4011/4012/4010`. **None of that exists at Dexpress.**
- [src/lib/carriers/adapter-registry.ts](../src/lib/carriers/adapter-registry.ts) — declares Dexpress credentials as `{ api_base_url, api_key }`. Also wrong.
- [src/lib/carriers/polling/clients.ts](../src/lib/carriers/polling/clients.ts) — `fetchDexpressBatch` calls `/mutable-order-tracking` with `Authorization: <apiKey>`. Also fictional. `extractors.ts` and `status-map.ts` parse the imagined response.
- [src/app/api/dexpress/price-calculator/route.ts](../src/app/api/dexpress/price-calculator/route.ts) — calls `/price-calculator`. Fictional.
- [src/app/api/dexpress/states/route.ts](../src/app/api/dexpress/states/route.ts) + [src/app/api/dexpress/places/[stateId]/route.ts](../src/app/api/dexpress/places/%5BstateId%5D/route.ts) — read from `dexpress_states`/`dexpress_places` tables. **The table schema is fine; the seed source assumed the API.**
- [src/components/queue/DexpressDispatchModal.tsx](../src/components/queue/DexpressDispatchModal.tsx) + [src/components/queue/DexpressLocationPicker.tsx](../src/components/queue/DexpressLocationPicker.tsx) + `useShippingEyesPrice` hook — UI exists and is wired through `extra: { state_id, place_id, women_delivery, shipping_cost_override }`. The state/place selection part stays usable; `women_delivery`, `place_id`, and live pricing are all dead concepts in the real portal.
- `scripts/seed-dexpress-from-api.ts` — calls fictional `/delivery-states` and `/delivery-places` endpoints to seed the tables.
- Two migrations: `006_dexpress_seed.sql` (Tunisian seed by mistake, already wiped), `20260614000001_libya_dexpress_alignment.sql` (extends `dexpress_states` with `route_id`, `status`, `delivery_days`, `notes`).

### 1.2 What the real Dexpress portal actually is

From [delivery_company_docs/Dexpress/dexpress-integration.md](../delivery_company_docs/Dexpress/dexpress-integration.md):

- Server-rendered Laravel 5.x. No JSON anywhere. No tokens.
- Auth = cookie-based. `laravel_session` cookie valid for 2 hours.
- Every form submission needs a `_token` (CSRF) scraped from the previous HTML page.
- Order creation is a 4-step flow:
  1. `GET /login` → scrape `_token` from form
  2. `POST /login` (urlencoded, with `_token` + `email` + `password`) → 302 to `/merchant`, rotates `laravel_session`
  3. `GET /merchant/add-orders` → scrape fresh `_token`
  4. `POST /merchant/add-orders` (multipart) → 302 to `/merchant/success-added-order/{ORDER_ID}`. Parse the order ID out of the `Location` header.
- On validation failure step 4 returns 200 (not 302) with the form re-rendered and errors in `invalid-feedback` divs.
- 128 destinations captured in [delivery_company_docs/Dexpress/dexpress-states.json](../delivery_company_docs/Dexpress/dexpress-states.json). Each entry has `{ id, name, routeId }`. `route_id` is **bound** to `to_state` — picking the wrong one fails or misroutes. Sub-places (`to_place`) are not used by us — always `0`. `has_places: "no"`.
- Account-level constants for our merchant: `merchant_id: 807`, `from_state: 62` (Tripoli), `from_place: 0`, `cost_type: 1`, `order_type: 2`, `has_places: "no"`.

### 1.3 Decisions made

- **Session cache**: Supabase table holding the cookie + expiry. Reused across dispatches; re-login on expiry or on a 302→`/login` from any merchant request.
- **Destination picker**: agent picks `to_state` from a searchable Arabic-labeled list during the dispatch modal. The existing `DexpressLocationPicker` is the right shell — strip the place picker and women-delivery toggle, since neither concept exists in the real portal.
- **Status v1**: manual only. Drop Dexpress from the poller. Revisit later by reverse-engineering the merchant orders list page.
- **Pricing**: `orders.total_price` is goods-only. `cost = carriers.delivery_fee`, `sub_total = total_price`, `total = total_price + delivery_fee`.
- **Account fields**: stored in `apiCredentials` (`merchant_id`, `from_state`). Other constants stay hardcoded.
- **Validation errors**: per-field structured parsing, surfaced to the agent as a joined human string ("phone: required; address: required"). Cheap to implement — the regex tokenizes both inputs and error divs in one pass.

### 1.4 Decisions confirmed with Firas

1. **Pricing.** `orders.total_price` is **goods-only** (does not include the delivery fee). So:
   - `sub_total = order.total_price`
   - `cost = carriers.delivery_fee`
   - `total = order.total_price + carriers.delivery_fee`
   - `cost_inclusive = "not_inclusive"`
2. **Account fields in credentials.** `merchant_id` and `from_state` live in `apiCredentials` (multi-tenant clean). `from_place: "0"`, `cost_type: "1"`, `order_type: "2"`, `has_places: "no"` stay hardcoded constants in the adapter (their meaning is unknown enum values).
3. **Validation error parsing.** Surface per-field errors. The Laravel form puts each error in a `<div class="invalid-feedback">` immediately following the offending input — so each error has a nearby input `name`. Plan §4.4 + §4.7 updated to extract `{ field, message }[]` and pass the most useful subset back to the agent UI.

---

## 2. Architecture

### 2.1 The `CarrierAdapter` seam stays the same

```ts
formatPayload(order, config, extra) → Record<string, string>
dispatch(payload, config) → Promise<CarrierRawResponse>
parseResponse(raw) → CarrierDispatchResult
voidDispatch(trackingNumber, config) → Promise<CarrierVoidResult>
```

The 4-step Laravel flow is internal plumbing. The `CarrierAdapter` interface stays clean and `performDispatch` doesn't care that the carrier is HTML-form-driven.

`CarrierRawResponse` already is `{ status: number; body: unknown }` — flexible enough to carry whatever shape the adapter wants. The Dexpress adapter will return:

- success case: `{ status: 302, body: { orderId: string } }`
- validation case: `{ status: 200, body: { errors: string[] } }` (parsed from HTML)
- transport / auth case: `{ status: 5xx | 401 | 403, body: { reason: string } }`

`parseResponse` translates that into `CarrierDispatchResult`.

### 2.2 New module: `src/lib/carriers/dexpress/`

The adapter alone won't be small — there's a session client, a CSRF scraper, a form builder, an HTML error parser, and the states data file. Folder structure:

```
src/lib/carriers/dexpress/
  adapter.ts              ← class DexpressAdapter implements CarrierAdapter
  client.ts               ← session-aware HTTP client (login, getForm, submitForm)
  session-store.ts        ← Postgres-backed cookie cache (per market)
  csrf.ts                 ← scrape _token from HTML
  errors.ts               ← parse invalid-feedback divs + recognize 302→/login
  payload.ts              ← build the multipart fields (account + per-order)
  states.ts               ← typed import of dexpress-states.json + resolveDestination()
  states-data.json        ← copy of delivery_company_docs/.../dexpress-states.json
```

Existing [src/lib/carriers/dexpress-adapter.ts](../src/lib/carriers/dexpress-adapter.ts) gets deleted — the new export is `src/lib/carriers/dexpress/adapter.ts`. Registry imports from the new path.

### 2.3 Session lifecycle

New table `dexpress_sessions`:

```sql
CREATE TABLE dexpress_sessions (
  carrier_id      UUID PRIMARY KEY REFERENCES carriers(id) ON DELETE CASCADE,
  laravel_session TEXT NOT NULL,           -- the cookie value, NOT the full Set-Cookie
  xsrf_token      TEXT,                    -- companion XSRF-TOKEN cookie if set
  csrf_token      TEXT,                    -- last-known _token from HTML, for warm reuse
  expires_at      TIMESTAMPTZ NOT NULL,    -- now() + 2h on login, refreshed on each successful merchant request
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Keyed by `carrier_id` (one row per Dexpress carrier; in practice one row total since Libya has one). RLS: REVOKE all from `authenticated`, only `service_role` reads/writes. The adapter uses `createAdminClient()`.

Session client logic (`client.ts`):

```
1. fetch session row by carrier_id
2. if row missing OR expires_at < now() + 60s OR a previous request returned 302→/login:
     a. login: GET /login → scrape _token → POST /login → capture cookies + new _token
     b. UPSERT session row with new cookie + expiry = now() + 2h
3. perform the merchant request with the cached cookie
4. if response is 302 with Location matching /login → invalidate and retry login once
5. on every successful merchant response: extend expires_at = now() + 2h (sliding window)
```

**Concurrency note**: two simultaneous dispatches in the same Vercel region could both decide to log in. The simple fix is to use `SELECT ... FOR UPDATE` inside a single Postgres transaction in `getOrRefreshSession()`, so the second caller blocks until the first finishes the login. v1 accepts this as a small tax (Dexpress allows multiple sessions per account; worst case is two sessions exist briefly). If it ever becomes a problem, switch to a Postgres advisory lock.

### 2.4 Dispatch flow end-to-end

```
[Agent in confirmation queue]
  → opens DexpressDispatchModal
  → picks state from searchable list (Arabic name + transliteration)
  → clicks "Envoyer au transporteur"
        ↓
POST /api/orders/[id]/dispatch  { carrier_id, extra: { state_id } }
        ↓
performDispatch (unchanged)
  → dispatchToCarrier
    → DexpressAdapter.formatPayload(order, config, { state_id })
        - looks up route_id from states.ts via state_id
        - builds the full multipart fieldset (28 fields incl. dimensions[*])
        - leaves _token blank — client will inject after scraping
    → DexpressAdapter.dispatch(payload, config)
        - sessionClient.ensureSession(carrier_id)
        - GET /merchant/add-orders → scrape _token, store on session row
        - inject _token into payload
        - POST /merchant/add-orders (multipart, redirect: 'manual')
        - case A: 302 with Location matching /merchant/success-added-order/(\d+)
                  → return { status: 302, body: { orderId: <match> } }
        - case B: 302 with Location matching /login
                  → invalidate session, login again, retry once
                  → still failing? → throw CarrierDispatchError
        - case C: 200 (form re-rendered with errors)
                  → parse invalid-feedback divs
                  → return { status: 200, body: { errors: [...] } }
        - case D: 5xx / network error
                  → throw CarrierDispatchError (handled upstream)
    → DexpressAdapter.parseResponse(raw)
        - 302 + orderId → { success: true, trackingNumber: orderId }
        - 200 + errors → { success: false, errorCode: 'DEXPRESS_VALIDATION', errorMessage, retryable: false }
        - other → { success: false, errorCode: 'DEXPRESS_UNKNOWN', retryable: false }
        ↓
RPC dispatch_order(orderId, carrierId, trackingNumber, extra, actorId)
        ↓
Modal closes, success banner with tracking, panel revalidates
```

### 2.5 What we're deleting

- [src/app/api/dexpress/price-calculator/route.ts](../src/app/api/dexpress/price-calculator/route.ts) — fictional endpoint. Delete the route file.
- [src/hooks/useShippingEyesPrice.ts](../src/hooks/useShippingEyesPrice.ts) — depends on the above. Delete.
- [src/components/queue/ShippingPricePreview.tsx](../src/components/queue/ShippingPricePreview.tsx) — same. Delete or simplify to a static "Frais: {delivery_fee}" line.
- `scripts/seed-dexpress-from-api.ts` — calls fictional API. Replace with a one-shot SQL/script that loads from `dexpress-states.json`.
- [src/app/api/dexpress/places/[stateId]/route.ts](../src/app/api/dexpress/places/%5BstateId%5D/route.ts) — places aren't used (`has_places: "no"`, always `to_place: 0`). Delete.
- The `dexpress` branch in [src/lib/carriers/polling/clients.ts](../src/lib/carriers/polling/clients.ts), [extractors.ts](../src/lib/carriers/polling/extractors.ts), [status-map.ts](../src/lib/carriers/polling/status-map.ts), and [poller.ts](../src/lib/carriers/polling/poller.ts). The `OPEN_STATUSES` filter and per-carrier dispatch in `runPollCycle` need to drop the `dexpress` case.

For the dispatch modal: keep `DexpressDispatchModal` and `DexpressLocationPicker` but simplify — drop the place picker, drop the women-delivery toggle, drop the live price hook. State picker only.

---

## 3. Data layer

### 3.1 New migration: `dexpress_sessions` table

`supabase/migrations/<timestamp>_dexpress_sessions.sql`:

```sql
CREATE TABLE IF NOT EXISTS dexpress_sessions (
  carrier_id      UUID PRIMARY KEY REFERENCES carriers(id) ON DELETE CASCADE,
  laravel_session TEXT NOT NULL,
  xsrf_token      TEXT,
  csrf_token      TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dexpress_sessions ENABLE ROW LEVEL SECURITY;
-- No policies → only service_role can access (admin client bypass)
REVOKE ALL ON dexpress_sessions FROM authenticated;
REVOKE ALL ON dexpress_sessions FROM anon;

CREATE OR REPLACE FUNCTION dexpress_sessions_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dexpress_sessions_updated_at
  BEFORE UPDATE ON dexpress_sessions
  FOR EACH ROW EXECUTE FUNCTION dexpress_sessions_set_updated_at();
```

### 3.2 Reseed `dexpress_states` from the static JSON

The current `seed-dexpress-from-api.ts` is dead. Replace with `scripts/seed-dexpress-states-from-json.ts`:

- Reads [delivery_company_docs/Dexpress/dexpress-states.json](../delivery_company_docs/Dexpress/dexpress-states.json)
- For each entry: `INSERT ... ON CONFLICT (id) DO UPDATE SET name=..., route_id=..., status=1`
- Marks any pre-existing row not in the JSON as `status=0` (soft-delete) rather than deleting.
- Idempotent — safe to re-run after a quarterly refresh of the JSON.

Also empty `dexpress_places` (`DELETE FROM dexpress_places`) and leave it unused. We don't drop the table — keeps the migration simple, costs nothing.

### 3.3 Adapter descriptor change (registry)

[src/lib/carriers/adapter-registry.ts](../src/lib/carriers/adapter-registry.ts) `dexpress` entry becomes:

```ts
dexpress: {
  code: "dexpress",
  label: "Dexpress",
  description: "Intégration Dexpress (Libye). Authentification par compte marchand.",
  defaultEndpoint: "https://portal.dexpress.ly",
  credentialFields: [
    { key: "email", label: "Email du compte marchand", secret: false },
    { key: "password", label: "Mot de passe", secret: true },
    { key: "merchant_id", label: "ID marchand", secret: false, placeholder: "807" },
    { key: "from_state", label: "État d'origine (ID)", secret: false, placeholder: "62" },
  ],
  markets: ["ly"],
}
```

`from_place`, `cost_type`, `order_type`, `has_places` stay hardcoded constants in the adapter (they're enum values whose meaning we don't know — exposing them as credential fields would be misleading).

**Migration concern**: the existing carrier row in production (if any) has the old credential shape `{ api_base_url, api_key }`. Either:
- Add a one-shot migration that nulls `api_credentials` for the Libya Dexpress row (forces a manager to re-enter credentials), or
- Document the manual step in the rollout section.

Going with the manual step — there's only one row, and the adapter would fail loudly anyway if it tried to use the old creds.

---

## 4. Adapter implementation

### 4.1 `dexpress/states.ts`

```ts
import statesData from "./states-data.json";

export interface DexpressState {
  id: number;
  name: string;
  routeId: number;
}

export const DEXPRESS_STATES: DexpressState[] = statesData;

export function resolveDestination(stateId: number): { to_state: number; route_id: number } {
  const state = DEXPRESS_STATES.find(s => s.id === stateId);
  if (!state) throw new Error(`Unknown Dexpress state_id: ${stateId}`);
  return { to_state: state.id, route_id: state.routeId };
}
```

The static JSON file is the source of truth for code. The DB table is a UI mirror used by the location picker. They get re-aligned by re-running the seed script after refreshing the JSON.

### 4.2 `dexpress/payload.ts`

Pure function. Returns the full set of multipart fields with `_token` left as empty string (the client injects it after scraping). All 28 fields enumerated in [delivery_company_docs/Dexpress/dexpress-integration.md](../delivery_company_docs/Dexpress/dexpress-integration.md), even when empty (the doc explicitly says omitting them causes validation failures).

```ts
export function buildOrderPayload(
  order: CarrierOrderData,
  config: CarrierConfig,
  extra: { state_id: number }
): Record<string, string> {
  const { to_state, route_id } = resolveDestination(extra.state_id);
  const merchantId = config.apiCredentials.merchant_id;
  const fromState  = config.apiCredentials.from_state;
  if (!merchantId || !fromState) {
    throw new CarrierConfigError("DEXPRESS_MISSING_ACCOUNT_FIELDS: merchant_id and from_state required in credentials");
  }
  const deliveryFee = config.deliveryFee;
  const subTotal = order.total_price;                  // total_price is goods-only
  const total    = subTotal + deliveryFee;

  return {
    _token: "",                                        // injected by client
    has_places: "no",
    merchant_id: merchantId,
    from_state: fromState,
    from_place: "0",
    route_id: String(route_id),
    to_state: String(to_state),
    to_place: "0",
    phone: order.customer_phone,
    phone_2: order.customer_phone_2 ?? "",
    name: order.customer_name ?? "",
    address: order.customer_address ?? "",
    info: order.product_name + (order.variant_label ? ` - ${order.variant_label}` : ""),
    notes: order.customer_note ?? "",
    sub_total: String(subTotal),
    cost: String(deliveryFee),
    total: String(total),
    cost_inclusive: "not_inclusive",
    qty: String(order.quantity),
    cost_type: "1",
    order_type: "2",
    breakable: "0",
    packing: "0",
    plus_weight_cost: "",
    "dimensions[weight]": "",
    "dimensions[length]": "",
    "dimensions[width]": "",
    "dimensions[height]": "",
  };
}
```

Note `info` doubles as item description — Dexpress doesn't have a separate product field. We pack `product_name + variant_label` there. `notes` carries `customer_note` for delivery.

### 4.3 `dexpress/csrf.ts`

```ts
const TOKEN_RE = /name="_token"\s+value="([^"]+)"/;
export function scrapeCsrfToken(html: string): string | null {
  return html.match(TOKEN_RE)?.[1] ?? null;
}
```

Trivial. Mirrors the regex used in the Postman collection's pre-request script.

### 4.4 `dexpress/errors.ts`

Goal: extract `{ field, message }` pairs by associating each `<div class="invalid-feedback">` with the nearest preceding `<input|select|textarea name="...">`. Laravel's Bootstrap-style validation puts the error div immediately after the offending input, so the "nearest preceding form control" heuristic works for every field we care about.

```ts
export interface FieldError {
  field: string | null;   // null = error not bound to a specific input (e.g. global alert)
  message: string;
}

export interface ParsedFormErrors {
  errors: FieldError[];
}

// Match either an input/select/textarea (capture name) OR an invalid-feedback div (capture inner text).
// We walk matches in order; whenever we hit an invalid-feedback, we attribute it to the most recent name we saw.
const TOKEN_RE =
  /<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"|<div[^>]*class="[^"]*invalid-feedback[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;

export function parseFormErrors(html: string): ParsedFormErrors {
  const errors: FieldError[] = [];
  let lastFieldName: string | null = null;

  for (const m of html.matchAll(TOKEN_RE)) {
    const [, fieldName, feedbackInner] = m;
    if (fieldName !== undefined) {
      lastFieldName = fieldName;
    } else if (feedbackInner !== undefined) {
      const text = feedbackInner.replace(/<[^>]+>/g, "").trim();
      if (text) errors.push({ field: lastFieldName, message: text });
    }
  }

  return { errors };
}

export function isLogoutRedirect(location: string | null): boolean {
  if (!location) return false;
  return /\/login(\?.*)?$/.test(location);
}
```

This gives us a structured list. The adapter will surface them to the UI as a joined human-readable string for v1 ("phone: numéro requis; address: l'adresse est obligatoire") — the modal can later render them inline next to the corresponding inputs if we want. The structured shape lets us upgrade later without re-parsing.

**Edge cases** the tests must cover:
- Error div with no preceding input (e.g. global alert at the top of the form) → `field: null`, message still surfaced.
- Multiple errors for the same field → multiple entries, all preserved.
- Nested HTML inside the error div (e.g. `<strong>`) → stripped to plain text.
- Empty feedback div (validation rendered the wrapper but had no message) → skipped.

### 4.5 `dexpress/session-store.ts`

```ts
export interface DexpressSession {
  laravelSession: string;
  xsrfToken: string | null;
  csrfToken: string | null;
  expiresAt: Date;
}

export async function loadSession(carrierId: string): Promise<DexpressSession | null>;
export async function saveSession(carrierId: string, s: DexpressSession): Promise<void>;
export async function invalidateSession(carrierId: string): Promise<void>;
export async function refreshExpiry(carrierId: string, until: Date): Promise<void>;
```

Backed by `createAdminClient()` against the `dexpress_sessions` table. All four use upsert/delete on the primary key.

### 4.6 `dexpress/client.ts`

The session-aware HTTP client. Single class, three public methods:

```ts
class DexpressClient {
  constructor(private carrierId: string, private config: CarrierConfig) {}

  async ensureSession(): Promise<DexpressSession>;
  async getMerchantPage(path: string): Promise<{ html: string; status: number; redirectedToLogin: boolean }>;
  async submitMerchantForm(
    path: string,
    fields: Record<string, string>,
  ): Promise<{ status: number; redirectLocation: string | null; html: string }>;
}
```

Implementation notes:
- All `fetch` calls use `redirect: "manual"` so we can read 302 Locations.
- All requests carry `Cookie: laravel_session=<value>` (and `XSRF-TOKEN` if present).
- `submitMerchantForm` for multipart uses `FormData` (built-in to Node 18+ via `undici`).
- Set-Cookie parsing extracts only the cookie value, ignoring `Path`, `HttpOnly`, etc.
- Login: emulate the 2 steps from the Postman collection. `_token` re-scraped from the GET; POST is `application/x-www-form-urlencoded`.
- Logout detection: any 302 whose Location matches `/login` triggers session invalidation + one retry.
- All calls have `AbortSignal.timeout(15000)` to match the existing carriers' budget.

### 4.7 `dexpress/adapter.ts`

```ts
export class DexpressAdapter implements CarrierAdapter {
  formatPayload(order, config, extra) {
    const stateId = Number(extra?.state_id);
    if (!Number.isFinite(stateId)) {
      throw new CarrierDispatchError("DEXPRESS_MISSING_STATE: state_id required in extra");
    }
    return buildOrderPayload(order, config, { state_id: stateId });
  }

  async dispatch(payload, config) {
    // carrier_id is needed for the session store. Read it off config.
    // CarrierConfig doesn't carry id today — see 4.7.1.
    const client = new DexpressClient(config.carrierId, config);

    // Step A: GET /merchant/add-orders → scrape _token
    const formPage = await client.getMerchantPage("/merchant/add-orders");
    const token = scrapeCsrfToken(formPage.html);
    if (!token) throw new CarrierDispatchError("DEXPRESS_NO_TOKEN");

    // Step B: POST /merchant/add-orders with token injected
    const submission = await client.submitMerchantForm("/merchant/add-orders", {
      ...payload,
      _token: token,
    });

    // Success: 302 → /merchant/success-added-order/{id}
    const successMatch = submission.redirectLocation?.match(/\/merchant\/success-added-order\/(\d+)/);
    if (submission.status === 302 && successMatch) {
      return { status: 302, body: { orderId: successMatch[1] } };
    }

    // Validation: 200 with form re-rendered
    if (submission.status === 200) {
      const { errors } = parseFormErrors(submission.html);
      return { status: 200, body: { errors } };
    }

    // Anything else
    return { status: submission.status, body: { html: submission.html.slice(0, 500) } };
  }

  parseResponse(raw): CarrierDispatchResult {
    if (raw.status === 302) {
      const body = raw.body as { orderId?: string };
      if (body.orderId) return { success: true, trackingNumber: body.orderId };
    }
    if (raw.status === 200) {
      const body = raw.body as { errors?: FieldError[] };
      const list = body.errors ?? [];
      // Format: "field: message; field: message" — or just "message" when no field bound.
      const formatted = list.length > 0
        ? list.map(e => e.field ? `${e.field}: ${e.message}` : e.message).join("; ")
        : "Validation error";
      return {
        success: false,
        errorCode: "DEXPRESS_VALIDATION",
        errorMessage: formatted,
        retryable: false,
      };
    }
    return {
      success: false,
      errorCode: "DEXPRESS_UNKNOWN",
      errorMessage: `Unexpected response (HTTP ${raw.status})`,
      retryable: raw.status >= 500,
    };
  }

  async voidDispatch(): Promise<CarrierVoidResult> {
    return { success: false, supported: false };
  }
}
```

#### 4.7.1 Carrying `carrier_id` into the adapter

The `CarrierConfig` type currently has `code` but not `id`. The session store needs the carrier UUID. Two options:
- **Add `id` to `CarrierConfig`.** Touches every adapter constructor path. Cleaner long-term.
- **Pass `carrier_id` as part of `extra`.** Avoids interface changes but is hacky.

Going with option 1 — extend `CarrierConfig` with `id: string`. Update `dispatch.ts` `buildConfig` to copy `carrier.id` through. Existing `NavexAdapter` ignores it. One test update.

---

## 5. UI changes

### 5.1 `DexpressDispatchModal` — simplified

Strip:
- `<DexpressLocationPicker>`'s place dropdown (delete the place picker block; the `state_id` is enough).
- The women-delivery checkbox.
- The live `useShippingEyesPrice` hook + `<ShippingPricePreview>`. Replace with a static row showing `Frais: {carrier.delivery_fee} LYD`, `Marchandise: {orderTotal} LYD`, and `Total dû à la livraison: {orderTotal + delivery_fee} LYD` (since `total_price` is goods-only).

Keep:
- The state list + Arabic labels (already wired to `/api/dexpress/states`).
- The dispatch POST with `extra: { state_id }` only.

#### 5.1.1 Validation error rendering

The dispatch route forwards the adapter's `errorMessage` string in the JSON response. For Dexpress validation failures the string is shaped like `"phone: numéro requis; address: l'adresse est obligatoire"`. v1 renders it verbatim in the modal's error banner — the agent gets the per-field info without us needing field-aware UI yet.

A future improvement (out of scope for v1): the dispatch API can also forward a structured `errorDetails: FieldError[]` field from the adapter, and the modal can render each error inline next to a representation of the field. Mentioning this so we don't paint ourselves into a corner — keep `errorMessage` as the authoritative human string and add `errorDetails` as opt-in metadata when we need it.

### 5.2 `DexpressLocationPicker` — strip to state-only

The component becomes a single searchable list. Files to touch:
- [src/components/queue/DexpressLocationPicker.tsx](../src/components/queue/DexpressLocationPicker.tsx) — remove place picker + women-delivery sections.
- The `DexpressSelection` interface narrows to `{ stateId: number | null; stateName: string }`.

### 5.3 i18n strings

Drop translations for `searchPlace`, `loadingPlaces`, `noPlace`, `womenDelivery`. Keep `searchState`, `loadingStates`, `confirmDispatch`, etc. Two files: [messages/fr.json](../messages/fr.json), [messages/ar.json](../messages/ar.json).

### 5.4 Search UX

The list of 128 destinations needs a search input — scrolling 128 Arabic names is painful. Add a search box that filters by:
- Arabic name (prefix and substring match)
- Latin transliteration (we'll build a static map for the top 20 cities; unmapped just don't transliterate)

For v1, substring match on the Arabic name only is fine. Transliteration is a follow-up.

---

## 6. Polling cleanup

Goal: stop the cron from trying to poll Dexpress, without breaking Navex polling.

[src/lib/carriers/polling/poller.ts](../src/lib/carriers/polling/poller.ts):
- Drop `pollDexpress` call inside `runPollCycle`.
- Type `OpenOrderForPoll.carrier_code` becomes `"navex"` only.
- `DEXPRESS_BATCH_SIZE` constant deleted.

[src/lib/carriers/polling/clients.ts](../src/lib/carriers/polling/clients.ts):
- Delete `fetchDexpressBatch`.

[src/lib/carriers/polling/extractors.ts](../src/lib/carriers/polling/extractors.ts):
- Delete `parseDexpressBatchResponse` and tests.

[src/lib/carriers/polling/status-map.ts](../src/lib/carriers/polling/status-map.ts):
- Delete `mapDexpressStatus` and tests.

The poller's "fetch open orders" SQL query already filters by `carriers.code IN ('navex', 'dexpress')` somewhere — that needs to become navex-only too. (Find the query during implementation; not in the files I read for this plan.)

Knock-on: the in-delivery dashboard (`/fr/in-delivery`) and per-carrier tracking page may render carrier-specific status widgets — those just stop receiving updates for Dexpress. Manager can still set status manually via the order detail panel. For v1, accept this as a known gap and add a small banner on Dexpress orders: "Statut mis à jour manuellement — pas de suivi automatique avec Dexpress".

---

## 7. Tests (TDD — write these first, per CLAUDE.md)

All new code lands behind a failing test. Mock `fetch` at the adapter boundary. Don't mock the adapter internally — test through `DexpressAdapter.dispatch()` end-to-end with a fetch mock.

### 7.1 `dexpress/csrf.test.ts`
- Extracts `_token` from realistic Laravel HTML.
- Returns null on missing token.

### 7.2 `dexpress/errors.test.ts`
- Single field: `<input name="phone"><div class="invalid-feedback">required</div>` → `[{ field: "phone", message: "required" }]`.
- Multiple distinct fields → preserved with correct field bindings.
- Multiple errors on the same field → multiple entries with the same `field`.
- Error div with no preceding input → `{ field: null, message }`.
- Inner HTML (`<strong>`, `<br>`) inside the error div → stripped to plain text.
- Empty `<div class="invalid-feedback"></div>` → skipped.
- `isLogoutRedirect` matches `/login` and `/login?expired=1`, doesn't match `/merchant/login-history`.

### 7.3 `dexpress/states.test.ts`
- `resolveDestination(62)` → `{ to_state: 62, route_id: 12 }` (Tripoli).
- `resolveDestination(10)` → `{ to_state: 10, route_id: 15 }` (Benghazi).
- Throws on unknown id.

### 7.4 `dexpress/payload.test.ts`
- Builds all 28 fields including empty ones.
- Pricing (goods-only `total_price`): `sub_total = total_price`, `cost = delivery_fee`, `total = total_price + delivery_fee`.
- Throws `CarrierConfigError` when `merchant_id` missing from credentials.
- Throws `CarrierConfigError` when `from_state` missing from credentials.
- Concatenates product_name + variant_label into `info`; uses just product_name when variant_label is null.
- Quantity stringified.
- `route_id` resolved from `extra.state_id` matches the JSON entry.
- Hardcoded constants present: `has_places: "no"`, `from_place: "0"`, `to_place: "0"`, `cost_type: "1"`, `order_type: "2"`, `cost_inclusive: "not_inclusive"`, `breakable: "0"`, `packing: "0"`.

### 7.5 `dexpress/session-store.test.ts`
- Round-trips a session (save → load).
- `expiresAt` returned as Date.
- `invalidate` deletes the row.
- Uses Supabase test setup (in-memory or test schema — check what `dispatch.test.ts` does).

### 7.6 `dexpress/client.test.ts`
Mock `fetch`. Cover:
- `ensureSession` skips login when row is fresh.
- `ensureSession` performs GET-then-POST-login when no row.
- `ensureSession` performs login when expired.
- `getMerchantPage` includes the cookie in the request.
- `submitMerchantForm` sends multipart with all keys.
- `submitMerchantForm` doesn't follow 302.
- 302→/login from a merchant call triggers re-login + retry once.
- Two consecutive 302→/login responses bubble up as error.

### 7.7 `dexpress/adapter.test.ts`
End-to-end through the adapter with `fetch` mocked.
- Happy path: login, GET form, POST form → 302 with `Location: /merchant/success-added-order/123` → `parseResponse` returns `{ success: true, trackingNumber: "123" }`.
- Validation failure (single field): 200 with `<input name="phone"><div class="invalid-feedback">required</div>` → returns `{ success: false, errorCode: "DEXPRESS_VALIDATION", errorMessage: "phone: required" }`.
- Validation failure (multiple fields): joined as `"phone: required; address: required"`.
- Validation failure with no fields parseable → falls back to `errorMessage: "Validation error"`.
- Stale session: first POST returns 302→/login, second login + retry succeeds.
- Missing `extra.state_id` → throws `DEXPRESS_MISSING_STATE`.
- 5xx response → returns `{ success: false, retryable: true }`.

### 7.8 Existing tests to update
- [src/lib/carriers/__tests__/dexpress-adapter.test.ts](../src/lib/carriers/__tests__/dexpress-adapter.test.ts) — entire file targets the fictional API. **Delete it; the new tests in `src/lib/carriers/dexpress/` replace it.**
- [src/lib/carriers/adapter-registry.test.ts](../src/lib/carriers/adapter-registry.test.ts) — update the descriptor expectations (new credential shape).
- [src/lib/carriers/polling/clients.test.ts](../src/lib/carriers/polling/clients.test.ts), [extractors.test.ts](../src/lib/carriers/polling/extractors.test.ts), [status-map.test.ts](../src/lib/carriers/polling/status-map.test.ts), [poller.test.ts](../src/lib/carriers/polling/poller.test.ts) — drop the Dexpress test cases.
- [src/lib/carriers/__tests__/perform-dispatch.test.ts](../src/lib/carriers/__tests__/perform-dispatch.test.ts) — if it covers Dexpress, repoint to the new adapter.

---

## 8. Implementation order

Each step is independently testable and leaves the system in a working state.

1. **DB migration**: `dexpress_sessions` table.
2. **`dexpress/states.ts` + `states-data.json`** + tests. No app integration yet.
3. **`dexpress/csrf.ts`** + **`dexpress/errors.ts`** + tests. Pure functions.
4. **`dexpress/payload.ts`** + tests.
5. **`dexpress/session-store.ts`** + tests against Supabase.
6. **`dexpress/client.ts`** + tests with fetch mocks. This is the riskiest piece — invest in good tests.
7. **`dexpress/adapter.ts`** + tests. Integration through the full flow.
8. **Wire into registry**: update `adapter-registry.ts`, delete old `dexpress-adapter.ts`, add `id: string` to `CarrierConfig`, copy `id` through `buildConfig`. Run `npm test` — Navex tests must still pass.
9. **Rebuild seed**: replace `seed-dexpress-from-api.ts` with `seed-dexpress-states-from-json.ts`. Run it locally, verify the table.
10. **UI cleanup**: simplify `DexpressLocationPicker`, simplify `DexpressDispatchModal`, delete `useShippingEyesPrice` + `ShippingPricePreview` + price-calculator route + places route. Drop translations.
11. **Add destination search** to the location picker (substring match).
12. **Polling cleanup**: strip Dexpress from poller, clients, extractors, status-map. Update poll query.
13. **Manual ops**: deploy migration, re-enter Dexpress carrier credentials in settings UI (the old `api_key` value is now invalid), seed states.
14. **Smoke test in production** with a tiny test order. Verify the order shows up in the Dexpress dashboard. Tear down.
15. **Manager banner**: "Statut mis à jour manuellement" on Dexpress orders in the in-delivery views.

Step 14 is the only step that touches the real Dexpress account. Everything before it is local.

---

## 9. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Dexpress changes a form field name | Medium | Hard fail on next dispatch | Log full request HTML on unexpected outcomes; alert on errorCode `DEXPRESS_UNKNOWN` |
| `_token` rotation logic changes | Low | Hard fail | Re-scrape per submission already; if rotation tightens, sessions get rotated and we re-login — same fallback path |
| Concurrent dispatches both trigger login | Low | Two sessions exist briefly | `SELECT ... FOR UPDATE` in `ensureSession`. If still racy, advisory lock. |
| State JSON drifts (new destinations, renames) | Medium | Order rejected with `DEXPRESS_VALIDATION` | Quarterly refresh of `states-data.json` + `npm run seed:dexpress`; the failure is loud and addressable. |
| Session table grows unbounded | Low | None really (one row) | Single-row by design (PK = carrier_id). Cap at <10 rows even with multiple Dexpress carriers. |
| Vercel cold start latency on session refresh | Low | First dispatch after 2h takes ~3s instead of ~1s | Acceptable. Only first call after expiry pays the cost. |
| Dexpress flags us for scraping | Low | Account suspended | Cache session, pace batch operations (300ms between calls), keep ToS conversation in writing. |
| Validation error parsing brittle (HTML changes) | Medium | We mis-report success on a real failure | Defense in depth: only treat 302→success-added-order as success; everything else is failure. We may surface a vague message ("Validation error") instead of the carrier's exact wording — acceptable. |
| `total_price` semantics wrong | Medium | Wrong COD amount on the package | Confirm with Firas before step 14. Ten-minute conversation. |

---

## 10. What's out of scope (and why)

- **Status polling.** No Dexpress API. Re-engineering the orders list page is its own project.
- **Cancellation.** `voidDispatch` returns `{ supported: false }`. Dexpress cancellations are manual via the portal for v1.
- **Live shipping price quotes.** No price API. We use the configured `delivery_fee` from the carriers row.
- **Sub-place (`to_place`) selection.** Always 0. The portal supports it but it's optional and we never use it.
- **Multi-merchant / multi-pickup.** `merchant_id` and `from_state` come from credentials and stay constant per carrier row. If we onboard a second Dexpress merchant, no code changes needed — just a second `carriers` row.
- **Webhooks.** Dexpress doesn't have any.

---

## 11. File index

**New files**
- `supabase/migrations/<ts>_dexpress_sessions.sql`
- `scripts/seed-dexpress-states-from-json.ts`
- `src/lib/carriers/dexpress/adapter.ts`
- `src/lib/carriers/dexpress/client.ts`
- `src/lib/carriers/dexpress/session-store.ts`
- `src/lib/carriers/dexpress/csrf.ts`
- `src/lib/carriers/dexpress/errors.ts`
- `src/lib/carriers/dexpress/payload.ts`
- `src/lib/carriers/dexpress/states.ts`
- `src/lib/carriers/dexpress/states-data.json`
- 7 test files mirroring the above

**Edited files**
- `src/lib/carriers/adapter-registry.ts` (descriptor + import path)
- `src/lib/carriers/types.ts` (add `id` to `CarrierConfig`)
- `src/lib/carriers/dispatch.ts` (copy `id` through `buildConfig`)
- `src/lib/carriers/polling/poller.ts` (drop Dexpress branch)
- `src/lib/carriers/polling/clients.ts` (delete `fetchDexpressBatch`)
- `src/lib/carriers/polling/extractors.ts` (delete Dexpress parser)
- `src/lib/carriers/polling/status-map.ts` (delete `mapDexpressStatus`)
- `src/components/queue/DexpressDispatchModal.tsx` (strip place / women / live price)
- `src/components/queue/DexpressLocationPicker.tsx` (state-only, with search)
- `messages/fr.json`, `messages/ar.json` (drop unused keys)
- `src/lib/carriers/__tests__/perform-dispatch.test.ts` (if it touches Dexpress)
- `src/lib/carriers/adapter-registry.test.ts`
- `src/lib/carriers/polling/{clients,extractors,status-map,poller}.test.ts`

**Deleted files**
- `src/lib/carriers/dexpress-adapter.ts`
- `src/lib/carriers/__tests__/dexpress-adapter.test.ts`
- `src/app/api/dexpress/price-calculator/route.ts`
- `src/app/api/dexpress/places/[stateId]/route.ts`
- `src/hooks/useShippingEyesPrice.ts`
- `src/components/queue/ShippingPricePreview.tsx`
- `scripts/seed-dexpress-from-api.ts`
