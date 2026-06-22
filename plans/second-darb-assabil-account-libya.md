# Add a second Darb Assabil account in the Libya market

> On implementation, first copy this plan to the project at
> `plans/second-darb-assabil-account-libya.md` (per the user's plan-storage convention).

## Context

The Libya market currently supports **one** Darb Assabil carrier configuration. The
user wants a **second Darb Assabil account** in Libya — a different login at the same
carrier, differing by credentials (`api_key` + `account_id`). Both accounts must be
**active at the same time**, so an agent can choose which account an order ships with.

Decisions confirmed with the user:
- **Scope:** both accounts active (true multi-account), not a key swap.
- **Selection:** **manual** per-order pick for now, but the **end goal is automatic
  routing by city** — the design must not block that later.
- **Live verification:** dispatch a **real test order, then void it** (a real dispatch
  is the only thing that actually exercises the new `api_key`).

"Just change the api_key" does not achieve the goal: editing the existing row *replaces*
the account. Adding a *second* row is blocked today by a DB constraint and one
single-carrier assumption in the UI. The fix is small and contained because most of the
system is already account-aware.

## What already works (no change needed)

- **Credentials are per row.** `carriers.api_credentials` (encrypted JSONB) holds
  `{ api_key, account_id, default_service_id }` per carrier. Two rows = two independent
  accounts. Decrypted in `buildConfig()` ([src/lib/carriers/dispatch.ts](src/lib/carriers/dispatch.ts)).
- **Adapter is chosen by `code`.** `getCarrierAdapter("darb_assabil")`
  ([src/lib/carriers/adapter-registry.ts:14](src/lib/carriers/adapter-registry.ts#L14)).
  Keeping the **same `code`** for both accounts means **all** Darb logic keeps working
  for both automatically — status sync (`/api/darb-assabil/sync-batch`), destinations
  (`/api/darb/destinations`), services (`/api/darb/services`), coverage
  ([src/lib/carriers/coverage.ts](src/lib/carriers/coverage.ts)), buckets, and the cron
  dispatcher all branch on `code === "darb_assabil"`, never on a single carrier id.
- **Dispatch already targets a specific `carrier_id`.** The upload picker lists every
  active carrier by **name** and posts the chosen `carrier_id`
  ([PostCallActionSheet.tsx:482-490](src/components/queue/PostCallActionSheet.tsx#L482-L490),
  [OrderDetailPanel/index.tsx:1270-1293](src/components/queue/OrderDetailPanel/index.tsx#L1270-L1293)).
  Two named accounts will simply appear as two options.
- **Settings UI already allows it.** `CarriersSection` lets you pick the "Darb Assabil"
  adapter again and give it a distinct display name; `POST /api/carriers` encrypts and
  inserts. Only the DB constraint stops the second insert.
- **Scheduled/cron dispatch** stores `carrier_id` per order, so it auto-targets the
  right account.

## The two blockers

1. **DB unique constraint** `UNIQUE (market_id, code)`
   ([supabase/migrations/001_initial_schema.sql:151](supabase/migrations/001_initial_schema.sql#L151))
   rejects a second `darb_assabil` row in Libya → `POST /api/carriers` returns 409.
2. **The Darb dispatch modal re-resolves the carrier by `code`, ignoring the agent's
   pick.** `DarbAssabilDispatchModal` fetches
   `/api/carriers/active?code=darb_assabil&market_id=…`
   ([DarbAssabilDispatchModal.tsx:106](src/components/queue/DarbAssabilDispatchModal.tsx#L106)),
   and that route uses `.maybeSingle()` on `(code, market_id)`
   ([src/app/api/carriers/active/route.ts:50-55](src/app/api/carriers/active/route.ts#L50-L55)).
   With two rows this **throws**, and even if it didn't, it would pick an ambiguous
   account. The modal then dispatches against that resolved `carrier.id`
   ([DarbAssabilDispatchModal.tsx:166](src/components/queue/DarbAssabilDispatchModal.tsx#L166)).

Everything else (15+ `code === "darb_assabil"` branches) is account-agnostic and stays
as-is.

## Approach

Two coexisting `carriers` rows, **same `code` `darb_assabil`**, distinguished by **name +
credentials**. Relax the DB constraint, and make the Darb modal dispatch against the
**carrier id the agent picked** (pass it in as a prop) instead of re-resolving by code.

This is the minimal change and keeps the door open for city-based auto-routing later
(that becomes a mapping keyed on `carrier_id`, layered on top — see Forward-compat).

## Implementation (TDD — failing test first for each step)

### 1. DB migration — relax the unique constraint
New file `supabase/migrations/<next-timestamp>_carriers_unique_per_account.sql`
(use the next sequential timestamp after the current latest `20260816000002`).
- Drop `carriers_market_id_code_key` and add `UNIQUE (market_id, code, name)` so multiple
  accounts of the same carrier coexist in a market, each with a distinct display name
  (which is exactly what agents need to tell them apart). Make it idempotent
  (`DROP CONSTRAINT IF EXISTS` + guarded `ADD CONSTRAINT`); verify the auto-generated
  constraint name against `information_schema` first.

### 2. Darb modal — dispatch against the picked account
[src/components/queue/DarbAssabilDispatchModal.tsx](src/components/queue/DarbAssabilDispatchModal.tsx)
- Replace the `marketId` prop with **`carrierId: string`** (the agent's pick).
- **Delete** the `/api/carriers/active?code=darb_assabil` SWR fetch (lines 104-109) and use
  `carrierId` directly in the dispatch POST body. The picker only offers active carriers,
  and `performDispatch` is the server-side authority (validates existence + market), so the
  client-side `is_active`/lookup round-trip is redundant. Keep the existing service +
  destination logic untouched.

### 3. Pass the picked carrier id from both call sites
- [PostCallActionSheet.tsx](src/components/queue/PostCallActionSheet.tsx): at the render
  site (~line 998) pass `carrierId={selectedCarrier!.id}` and gate render on
  `darbModalOpen && selectedCarrier`. `selectedCarrier` is already set before the
  `code === "darb_assabil"` branch opens the modal (line 469).
- [OrderDetailPanel/index.tsx](src/components/queue/OrderDetailPanel/index.tsx): add a
  `selectedDarbCarrierId` state; set it to `c.id` where the picker opens the modal
  (~line 1287-1290); pass `carrierId={selectedDarbCarrierId}` at the render site
  (~line 1358) and gate on it.

### 4. Update the create-conflict message
[src/app/api/carriers/route.ts](src/app/api/carriers/route.ts) — the `23505` handler now
fires on a duplicate `(market, code, name)`; reword the message accordingly
(e.g. "Un transporteur nommé « … » avec ce code existe déjà pour ce marché."). The insert
path itself needs no change — it succeeds once the constraint allows the second row.

### 5. Tests
- **Update** `src/components/queue/__tests__/DarbAssabilDispatchModal.test.tsx`: drop the
  `code=darb_assabil` active-fetch mock, render with the new `carrierId` prop, assert the
  dispatch POST carries that exact id.
- **Add** a carriers-API test: a second `darb_assabil` insert in the same market with a
  **different name** succeeds (no 23505); same name still conflicts.
- Run the existing carrier/dispatch suites to confirm Dexpress (unchanged, still
  single-account via `/api/carriers/active?code=dexpress`) is unaffected.

### Not changing
`/api/carriers/active` keeps its code-based `.maybeSingle()` for Dexpress. The Darb modal
stops calling it, so the multi-row throw is moot. `CarriersSection` needs no change — it
already supports re-picking the adapter and naming distinctly.

## Forward-compat: automatic routing by city (future, not built now)

Manual selection now; city-based auto-routing later layers cleanly on this model:
- Both accounts are plain `carriers` rows keyed by `id`.
- A future mapping (e.g. a `carrier_city_routes` table: `market_id, carrier_id, city/area`,
  reusing the existing `darb_destinations` city/area vocabulary) resolves order city →
  `carrier_id`, then the **same** dispatch path runs. No adapter or schema rework needed.
- Keeping a single shared `code` is what makes this possible — don't fork the code per
  account.

## Credentials handling (account 2)

- The second account's **`api_key`** has been supplied out-of-band (in chat). It must
  **never** be written to any file or migration — it goes only into the encrypted
  `carriers.api_credentials` blob, entered via Settings → Transporteurs (or a one-off
  admin DB insert) at verification time. Recommend **rotating** this key afterward since
  it was shared in plaintext.
- Still required before the live test: the account 2 **`account_id` (X-ACCOUNT-ID)** —
  the adapter sends both `Authorization: apikey <key>` and `X-ACCOUNT-ID: <account_id>`
  ([darb-assabil-adapter.ts:783-791](src/lib/carriers/darb-assabil-adapter.ts#L783-L791)),
  so the key alone cannot authenticate. (`default_service_id` is optional — reuse the
  men's-courier default.)

## Verification

1. `npm run typecheck`, `npm run lint`, `npm run test:run` (TDD suites green).
2. **Apply the migration** to the Supabase project (MCP `apply_migration` or local stack),
   then confirm two `darb_assabil` rows can coexist in Libya.
3. **Manual / Playwright E2E** (real-order-then-void, per the user's choice):
   - Log in as the **Libya manager** → Settings → Transporteurs → "Ajouter" → pick
     **Darb Assabil**, give it a distinct name (e.g. "Darb Assabil — Compte 2"), enter the
     **new** `api_key` + `account_id`, save. Two Darb cards now show.
   - As a **Libya agent**, take a low-value test order to `confirmed`, open the upload
     picker — **both** Darb accounts appear by name. Pick **Compte 2**, choose
     destination/service, dispatch.
   - Assert a **tracking number** is returned (proves the new `api_key` authenticated
     against the live Darb API) — or a clean carrier error if the key is wrong.
   - **Void the test shipment**: via the order cancel flow if it invokes the adapter's
     `voidDispatch` ([darb-assabil-adapter.ts](src/lib/carriers/darb-assabil-adapter.ts)),
     otherwise cancel it directly in the Darb portal. Confirm which path triggers
     `voidDispatch` during implementation.
   - Caveat: the Settings "Ping" (HEAD to endpoint) and "Test dispatch" (dry-run with
     **empty** credentials, [test/route.ts:94](src/app/api/carriers/[id]/test/route.ts#L94))
     do **not** validate the key — only the live dispatch above does.

## Risks / notes

- A live dispatch creates a **real shipment** at Darb — use a low-value order and void it.
- Market isolation holds: a Libya carrier can only dispatch Libya orders (`performDispatch`
  checks `carrier.market_id === order.market_id`).
- Both accounts share the Darb logo/adapter badge (keyed by `code`); the **name**
  distinguishes them in every list.
- If desired later, apply the same `carrierId`-prop pattern to `DexpressDispatchModal` for
  Dexpress multi-account — out of scope here.
