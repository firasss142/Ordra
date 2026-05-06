# Add a second carrier (Libya) — handoff brief

This doc is the handoff for an AI agent (Claude Code) to add a Libyan carrier.
Read it top to bottom before touching code. The first half is **context** so you
understand what already exists. The second half is the **task**.

The Tunisia/Navex integration is already live in production. Most plumbing is in
place — the work for Libya is mostly: write an adapter, configure credentials,
add a polling client, and apply a couple of unapplied migrations.

---

## 1. Carrier architecture (read this first)

### 1.1 Adapter pattern

Every carrier implements `CarrierAdapter` ([src/lib/carriers/types.ts](../src/lib/carriers/types.ts)):

```ts
interface CarrierAdapter {
  formatPayload(order, config, extra?) → Record<string, string>
  dispatch(payload, config) → Promise<CarrierRawResponse>
  parseResponse(raw) → CarrierDispatchResult
  voidDispatch(trackingNumber, config) → Promise<CarrierVoidResult>
}
```

`CarrierConfig` is built at runtime from the `carriers` row:

```ts
{
  code: string,                              // "navex", "dexpress", ...
  apiEndpoint: string,                       // base URL
  apiCredentials: Record<string, string>,    // decrypted JSON object
  deliveryFee: number,
  returnFee: number,
}
```

The `apiCredentials` shape is **adapter-specific**. Navex stores
`{ token, sender_name, sender_location }`. Dexpress (existing scaffold) stores
`{ api_base_url, api_key }`. Whatever shape your adapter expects must match the
fields declared in the adapter registry (next section).

### 1.2 Adapter registry

[src/lib/carriers/adapter-registry.ts](../src/lib/carriers/adapter-registry.ts) is the central registry.

Two things live here:

1. **The runtime factory** — `getCarrierAdapter(code)` returns a fresh adapter
   instance. Add your class here:

   ```ts
   const adapters: Record<CarrierCode, () => CarrierAdapter> = {
     navex: () => new NavexAdapter(),
     dexpress: () => new DexpressAdapter(),
     // your_new_code: () => new YourNewAdapter(),
   };
   ```

2. **The descriptor** — `ADAPTER_DESCRIPTORS` declares the adapter's
   user-visible name, description, default endpoint, allowed markets, and
   **credential field schema**. The settings UI introspects this to render the
   right input fields:

   ```ts
   navex: {
     code: "navex",
     label: "Navex",
     description: "Intégration Navex (Tunisie). Dispatch via token + expéditeur.",
     defaultEndpoint: "https://app.navex.tn/api",
     credentialFields: [
       { key: "token", label: "Token API", secret: true },
       { key: "sender_name", label: "Nom expéditeur", secret: false },
       { key: "sender_location", label: "Localité expéditeur", secret: false },
     ],
     markets: ["tn"],   // controls which markets see this carrier in the UI
   }
   ```

   The `markets` field gates the dropdown: a Tunisia-only carrier will not
   appear when the user is scoped to Libya, and `POST /api/carriers` will
   reject creating one in the wrong market.

### 1.3 Settings UI (no changes needed if you follow the registry)

[src/components/settings/CarriersSection.tsx](../src/components/settings/CarriersSection.tsx) renders
the form. It fetches `/api/carriers/adapters?market_id=…` to discover the
descriptors for the active market, then renders the credential fields
dynamically. Secret fields use `<input type="password">` and a "Faire tourner"
flow on edit. Non-secret fields are plain text. **No code change required to
add new fields — just declare them in `ADAPTER_DESCRIPTORS`.**

### 1.4 Dispatch flow (upload to carrier)

```
[Order detail panel] "Envoyer au transporteur" button
        ↓
[Modal] picks active carrier from /api/carriers?market_id=X
        ↓
POST /api/orders/[id]/dispatch  { carrier_id, extra? }
        ↓
src/app/api/orders/[id]/dispatch/route.ts
  - getActor + auth
  - fetch order + check status ∈ ('confirmed', 'dispatch_scheduled')
  - performDispatch(orderId, carrierId, actorId, extra)
        ↓
src/lib/carriers/perform-dispatch.ts
  - admin-client SELECT on orders + carriers (RLS bypass)
  - dispatchToCarrier(...) → adapter.formatPayload → adapter.dispatch → adapter.parseResponse
  - on success: rpc("dispatch_order", { p_order_id, p_carrier_id, p_tracking_number, p_carrier_extra })
        ↓
[Postgres RPC] dispatch_order  (confirmed → dispatched, sets tracking_number + carrier_id)
        ↓
[UI] modal closes, success banner shows tracking, panel revalidates
```

The `extra` object is adapter-specific. For Dexpress, the UI passes
`{ state_id, place_id, women_delivery, shipping_cost_override }` — the adapter
embeds those into the payload. For Navex, no extras are needed.

### 1.5 Status model

Per [CLAUDE.md](../CLAUDE.md), the lifecycle is:

```
pending → attempt_1/2/3 → callback_scheduled → confirmed → uploaded → scanned → dispatched → deposit → in_transit → delivered
                                                                                                                  ↘ returned
```

**Heads-up:** the deployed `dispatch_order` RPC currently lands on
`dispatched` (skipping `uploaded`). A migration that introduces the proper
`confirmed → uploaded` transition exists locally but is unapplied
([20260506000000_uploaded_status_model.sql](../supabase/migrations/20260506000000_uploaded_status_model.sql)).
Don't apply it as part of your task — it has 25+ unapplied dependencies stacked
behind it. Treat the current `dispatched` end-state as the contract.

### 1.6 Credentials encryption

[src/lib/crypto.ts](../src/lib/crypto.ts) provides AES-256-CBC with a hex `ENCRYPTION_KEY`
env var (already set). The route at [src/app/api/carriers/route.ts](../src/app/api/carriers/route.ts)
encrypts `JSON.stringify(credentials)`. Adapters decrypt + `JSON.parse` to
recover the original object.

The DB column `carriers.api_credentials` is REVOKE'd from the `authenticated`
role at the column level. **Never use a user-bound Supabase client to read or
mutate it** — use `createAdminClient()`. All carrier routes already follow this
pattern.

### 1.7 Polling layer

Carriers report status changes back via polling, not webhooks. The poller runs
on a cron and lives in [src/lib/carriers/polling/](../src/lib/carriers/polling/):

- `clients.ts` — per-carrier HTTP clients that fetch carrier-side status. Add a
  `fetchYourCarrierStatus(trackingNumber, row)` here.
- `extractors.ts` — normalize the carrier's response into a status code
  + extra metadata.
- `status-map.ts` — map carrier-side codes to OMS statuses
  (`dispatched`, `in_transit`, `delivered`, `returned`).
- `poller.ts` — orchestrates the loop.

Each adapter's polling client decrypts credentials independently of the
adapter class because the poller doesn't always have the full carrier row.

---

## 2. What was just built (Navex / Tunisia integration)

This is what already works in production today.

### 2.1 Bugs fixed during the Navex onboarding

These are documented because each one is a trap a follow-up agent could hit
again. Read this list before debugging "weird" behavior in the carrier flow.

1. **POST and PATCH on `/api/carriers` were using the user-bound Supabase
   client.** The `.insert(...).select("api_endpoint, ...")` round-trip failed
   silently because `api_endpoint` and `api_credentials` are column-REVOKE'd
   from the `authenticated` role. Fix: use `createAdminClient()` for every
   mutation that returns those columns. ([src/app/api/carriers/route.ts](../src/app/api/carriers/route.ts), [src/app/api/carriers/[id]/route.ts](../src/app/api/carriers/%5Bid%5D/route.ts))

2. **The PATCH handler silently dropped `api_endpoint`** because it wasn't in
   the patch whitelist. Edits looked successful but the column stayed null.
   Fix: include `api_endpoint` in the whitelist.

3. **The "test reachability" route had the same RLS column issue** — it read
   `api_endpoint` via the user client and got back null even when the column
   had data. Fix: same admin-client pattern.

4. **The credentials form only had a single "Clé API" input.** That stored a
   plaintext string under encryption, but adapters expect a JSON object
   (`{ token, sender_name, sender_location }`). The form now renders the
   adapter's `credentialFields` dynamically and submits a `credentials` object;
   the route encrypts `JSON.stringify(credentials)`. Legacy `api_key` is still
   accepted for back-compat (mapped onto the adapter's first secret field).

5. **`/api/carriers` GET was gated by `canReadSettings`** which excluded
   agents. The carrier picker on the agent's order panel returned 403 silently
   → empty list. Fix: gate by market scope only (super_admin = any market,
   everyone else = their own market). Column REVOKE still protects the
   sensitive fields.

6. **Navex returns HTTP 200 with `{ status: 1, status_message: <tracking>,
   lien: <label URL> }`** for success — not HTTP 201 with `colis` as their
   docs claim. The adapter's `parseResponse` was treating 200 as a transient
   error and reporting failure to the OMS, which caused **double-shipments**
   on retry (Navex created the shipment, OMS thought it failed, user clicked
   again, Navex created another). Fix: handle both shapes in
   `parseResponse`. **If a new carrier behaves similarly, expect this trap.**

7. **`orders.customer_whatsapp` column was missing in the deployed DB.** A
   migration to add it existed locally but was unapplied. The
   `performDispatch` SELECT references this column, so every dispatch hit
   `42703: column does not exist`. Fix: ran the ALTER directly via Supabase MCP.

### 2.2 Agent-mode upload

The order detail panel ([src/components/queue/OrderDetailPanel.tsx](../src/components/queue/OrderDetailPanel.tsx))
shows the upload button when:
- the order's status is `confirmed` or `dispatch_scheduled`, AND
- one of:
  - the user is `super_admin` / `market_manager` / `warehouse_agent`, or
  - the user is an `agent` (or in agent-queue context where `role === undefined`)
    AND the order is `assigned_to === userId`.

The dispatch API enforces the same `assigned_to === actor.id` check
server-side, so the UI gate matches the server gate.

### 2.3 Where to find uploaded orders

| Page | Who sees it | Shows |
|---|---|---|
| `/fr/orders` (filter "Livraison") | super_admin, market_manager | All in-flight orders |
| `/fr/in-delivery` | super_admin, market_manager | Per-carrier dashboard |
| `/fr/warehouse/dispatch` | super_admin, market_manager, warehouse_agent | Confirmed → uploaded queue |
| `/fr/warehouse/carrier-tracking` | super_admin, market_manager | Per-carrier tracking |
| `/fr/queue` (Fermées tab) | agent (own orders only, 7-day window) | rejected/uploaded/dispatched |

### 2.4 Debug envelopes (clean up later)

Two dev-only debug envelopes that leak DB error codes were added to help
diagnose issues during the Navex integration:
- [src/app/api/orders/[id]/dispatch/route.ts](../src/app/api/orders/%5Bid%5D/dispatch/route.ts) — adds a `debug` field to the 404 JSON response.
- [src/lib/carriers/perform-dispatch.ts](../src/lib/carriers/perform-dispatch.ts) — embeds DB error codes in the
  `error` string returned to the route.

These should be removed before production. **Don't extend the pattern in your
new code; surface errors via `console.error` and a generic message instead.**

---

## 3. Your task: add a Libyan carrier

The customer's carrier is **Shipping Eyes (Libya)**. There's already a
scaffold called `DexpressAdapter` in [src/lib/carriers/dexpress-adapter.ts](../src/lib/carriers/dexpress-adapter.ts)
that targets the same API (`mutable-order-tracking`, `create-order`). It
appears the system used to call this carrier "Dexpress" internally.

**You need to confirm the relationship:** is "Dexpress" the same product as
Shipping Eyes? Read [delivery_company_docs/libye/Shipping_Eyes_LY_API_V1_(1).pdf](../delivery_company_docs/libye/Shipping_Eyes_LY_API_V1_%281%29.pdf)
first. If they're the same vendor, **extend the existing `DexpressAdapter`
instead of creating a new one.** If they're a different vendor, create a new
adapter following the steps below.

### 3.1 Step-by-step

#### Step A — Read the Shipping Eyes API doc

Open [delivery_company_docs/libye/Shipping_Eyes_LY_API_V1_(1).pdf](../delivery_company_docs/libye/Shipping_Eyes_LY_API_V1_%281%29.pdf).
Note:
- Auth scheme (Bearer token? API key in header? Basic auth?)
- Base URL
- Required fields for create-shipment endpoint
- Response shape on success (status code + body)
- Response shape on validation error
- Response shape on auth error
- Status-tracking endpoint (poll-friendly batch or per-order)
- Whether they support voiding/cancelling a shipment
- Their Libyan governorates / cities — Libya needs a state/place picker, not
  free-text city like Tunisia. The picker should already work via
  [DexpressLocationPicker.tsx](../src/components/queue/DexpressLocationPicker.tsx) reading from `dexpress_states` /
  `dexpress_places` tables. Check whether the existing seed data lines up
  with Shipping Eyes' actual geography.

Also read [delivery_company_docs/libye/delivery_states.sql](../delivery_company_docs/libye/delivery_states.sql) — that's the
state seed data you'll likely need to apply.

#### Step B — Decide adapter strategy

- **If Shipping Eyes IS Dexpress:** verify the existing
  `DexpressAdapter`'s `formatPayload` / `dispatch` / `parseResponse` match the
  PDF. Likely you'll need to update the response-handling shape (the
  `parseResponse` was written speculatively and may not match production —
  same trap as Navex's HTTP 200 / `status: 1` quirk). Fix the adapter to
  match what the carrier actually returns.

- **If Shipping Eyes is a new vendor:** create
  `src/lib/carriers/shipping-eyes-adapter.ts` modeled on `NavexAdapter`. Add
  it to `adapter-registry.ts`:
  ```ts
  type CarrierCode = "navex" | "dexpress" | "shipping_eyes";

  const adapters = {
    navex: () => new NavexAdapter(),
    dexpress: () => new DexpressAdapter(),
    shipping_eyes: () => new ShippingEyesAdapter(),
  };

  // ADAPTER_DESCRIPTORS:
  shipping_eyes: {
    code: "shipping_eyes",
    label: "Shipping Eyes",
    description: "...",
    defaultEndpoint: "<base URL from PDF>",
    credentialFields: [
      { key: "...", label: "...", secret: ... },
    ],
    markets: ["ly"],
  }
  ```

#### Step C — Polling client

Add a `fetchShippingEyesStatus` (or update `fetchDexpressBatch`) in
[src/lib/carriers/polling/clients.ts](../src/lib/carriers/polling/clients.ts). Then wire its response into
[src/lib/carriers/polling/extractors.ts](../src/lib/carriers/polling/extractors.ts) and
[src/lib/carriers/polling/status-map.ts](../src/lib/carriers/polling/status-map.ts).

#### Step D — Tests (TDD — non-negotiable per CLAUDE.md)

Per the project's TDD rule, write the tests first. Mirror the structure of
[src/lib/carriers/navex-adapter.test.ts](../src/lib/carriers/navex-adapter.test.ts):
- formatPayload — covers all payload field mappings, including missing
  optional fields.
- parseResponse — one test per documented status code, **plus a test for
  whatever weird shape the carrier actually returns in production** (always
  add this once you've made one real call).
- dispatch — fetch is mocked; verify URL, method, headers, body, and timeout.

#### Step E — Local migration apply (if needed)

If the Libyan governorates seed isn't in the DB yet, apply it via Supabase MCP:

```sql
-- delivery_states.sql contents
INSERT INTO dexpress_states (...) VALUES (...);
INSERT INTO dexpress_places (...) VALUES (...);
```

**Don't** apply the full backlog of unapplied migrations. Apply only what your
task requires. The current production DB is missing many migrations; touching
them blindly is destabilizing.

#### Step F — Configure the carrier in the UI

After deploy, the user goes to `/fr/settings/carriers`, scopes to Libya, and
clicks "Ajouter". Your descriptor's credential fields will render. They fill
in the values from the Shipping Eyes account, save. Done — agents can now
upload Libyan orders.

#### Step G — Live test

Walk through a single real Libyan order end-to-end. Watch the dev terminal
for the `console.error` lines from your adapter and the dispatch route.
**Expect Navex-style surprises** — the docs probably don't exactly match
production behavior. When you find a mismatch, fix the adapter, not the test.

### 3.2 Pitfalls to avoid

1. **Don't use the user-bound Supabase client to read/write
   `api_endpoint` or `api_credentials`** — column REVOKE will silently fail
   the SELECT round-trip. Use `createAdminClient()`.

2. **Don't store credentials as a plain string** — the carrier dispatch
   layer expects `JSON.parse(decrypt(api_credentials))` to yield an object.
   The route's `encodeCredentials` helper handles this; just make sure your
   form submits a `credentials: { ... }` object, not `api_key: "..."`.

3. **Don't trust the carrier's docs blindly.** Add a `console.error` in
   `dispatch()` for any non-success response and watch the actual payload.
   Navex returned a fundamentally different shape than documented.

4. **Don't apply the backlog of unapplied migrations.** The local
   `supabase/migrations/` folder is far ahead of the deployed DB. Apply
   only what your task strictly requires (likely just the Libyan governorate
   seed if not already present).

5. **Don't break the agent ownership check.** The dispatch API requires
   `actor.id === order.assigned_to` for agents. Don't bypass this.

6. **Don't forget the `markets` field** in the descriptor. Without it,
   Tunisian managers will see Libyan carriers in their carrier list and vice
   versa.

7. **Don't change `dispatch_order` RPC behavior.** It currently lands on
   `dispatched`. Treat that as the contract until the broader migration
   backlog is addressed.

### 3.3 Definition of done

- [ ] Adapter passes its own test suite (formatPayload, parseResponse, dispatch).
- [ ] Adapter is registered in `adapter-registry.ts` with a complete descriptor.
- [ ] Polling client added (or existing one verified to match the PDF).
- [ ] A real Libyan order can be uploaded end-to-end: confirmed → "Envoyer au
      transporteur" → carrier creates shipment → tracking number stored in
      OMS DB → order moves to dispatched.
- [ ] No double-shipments under retry. (Verify: click upload twice fast on a
      single order; second click should be blocked because the order is no
      longer `confirmed`.)
- [ ] No regressions in Navex flow. Run the Tunisian Navex flow once after
      your changes to confirm.
- [ ] `npm run typecheck` passes. `npm run lint` passes. Carrier-related
      tests pass: `npx vitest run src/lib/carriers src/app/api/carriers`.

### 3.4 Reference files

Read in this order:

1. [CLAUDE.md](../CLAUDE.md) — overall project rules (TDD, market isolation, status model).
2. [src/lib/carriers/CLAUDE.md](../src/lib/carriers/CLAUDE.md) — adapter-layer rules.
3. [src/lib/carriers/types.ts](../src/lib/carriers/types.ts) — interface contract.
4. [src/lib/carriers/navex-adapter.ts](../src/lib/carriers/navex-adapter.ts) — reference adapter implementation.
5. [src/lib/carriers/navex-adapter.test.ts](../src/lib/carriers/navex-adapter.test.ts) — reference test structure.
6. [src/lib/carriers/dexpress-adapter.ts](../src/lib/carriers/dexpress-adapter.ts) — existing Libya scaffold.
7. [src/lib/carriers/perform-dispatch.ts](../src/lib/carriers/perform-dispatch.ts) — orchestrator (don't change).
8. [src/lib/carriers/adapter-registry.ts](../src/lib/carriers/adapter-registry.ts) — where you register.
9. [delivery_company_docs/libye/Shipping_Eyes_LY_API_V1_(1).pdf](../delivery_company_docs/libye/Shipping_Eyes_LY_API_V1_%281%29.pdf) — vendor docs.
10. [delivery_company_docs/libye/delivery_states.sql](../delivery_company_docs/libye/delivery_states.sql) — geography seed.

If anything in this brief is contradicted by a file you read, **trust the
file**. This brief is a snapshot.
