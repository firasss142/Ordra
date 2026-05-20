# Name-only city resolution

## Context
Storefront webhook orders carry a `customer_city` that the customer picked from a
**predefined dropdown** (constrained list), plus a free-text `customer_address`.

- For **Libya Shopify**, the city dropdown IS the `dexpress_states` list.
- For **Tunisia** (BuyBox / EasyOrders), the city dropdown maps onto the `cities` table.
- The free-text `customer_address` is courier instructions only — never matched, stored raw.

Because the city always comes from a constrained list whose values mirror our
destination tables, an exact normalized name match is **authoritative**. There is no
fuzzy/typo middle ground. So:

- City resolution becomes **name-only** — the `external_city_id` path is removed.
- A successful normalized name match → `mapped` (previously `needs_review`).
- No match → `unmatched` (a flag; means the storefront dropdown drifted from our table).
- The `external_city_mappings` alias table is no longer needed.

## Decisions (confirmed with user)
- **Name-only, deprecate `external_city_id`** — drop the ID lookup path entirely.
- **No seed migration / no alias table** — destination tables (`cities`,
  `dexpress_states`) are the source of truth.
- **Flag resolution = admin picks from existing list** — a flagged order is bound
  directly on that one order row (`city_id` / `dexpress_state_id`). No table edits.
- `external_city_mappings` table left in place but dead; dropped in a later cleanup
  migration to keep this change reversible.

## Changes

### `src/lib/storefronts/resolver-types.ts`
- `CityMatchMethod = "name" | "none"` (remove `"external_id"`, `"market_mismatch"`).
- `cityMatchStatus()`: `"name"` → `"mapped"`, `"none"` → `"unmatched"`.

### `src/lib/storefronts/city-resolver.ts`
- Remove the `external_city_id` lookup branch from `resolveCity()` and
  `decideCityResolution()`. Drop `external_city_id` from `ResolveCityParams` /
  `CityResolverInput`.
- Single-stage resolution: `normalizeCityName(customer_city)` → exact match against
  the market destination table (`dexpress_states.name` for LY; `cities.name` /
  `cities.name_ar` for TN, scoped to market).
- `normalizeCityName()` unchanged.

### `src/lib/orders/webhook-handler.ts`
- Drop `external_city_id` from the `resolveCity()` call args.
- Stop writing `external_city_id` to the order insert.
- Keep writing `customer_city` (raw) and `customer_address` (raw, untouched).

### `src/app/api/mappings/unmatched/route.ts`
- Cities tab candidates = orders with `mapping_status != 'mapped'`, pre-confirmation
  status, and a non-null `customer_city`.
- Remove the "drop already-mapped" filter that queried `external_city_mappings` —
  `mapping_status` is the only signal now.

### `src/app/api/mappings/cities/route.ts` — repurpose to per-order bind
- `GET`: return the destination list for a market (existing `dexpress_states` /
  `cities` rows) to populate the admin's dropdown.
- `POST`: body `{ order_id, city_id | dexpress_state_id }`. Validate the destination
  exists and is in the order's market, write it on that one order, recompute
  `mapping_status` (`mapped` if product also resolved, else `needs_review`).
  No back-fill loop, no `external_city_mappings` write.

### `external_city_mappings` table
- Left in place, dead. Dropped in a later cleanup migration.

## TDD order
1. `city-resolver.test.ts` — rewrite expectations (name → mapped, no `external_id`),
   watch fail → change `city-resolver.ts` + `resolver-types.ts` to pass.
2. `webhook-handler` test → change.
3. `unmatched` route test → change.
4. `cities` route test → repurpose to per-order bind.
5. `npm run typecheck` + `npm run build`.
