# Market-aware city mapping (Libya → Dexpress, Tunisia → cities)

## Context

The `/mappings` city bind wrote `orders.city_id` (FK → `cities`). But the
Libya carrier (Dexpress) upload flow in the agent confirmation UI
(`PostCallActionSheet.tsx`) reads `orders.dexpress_state_id` (FK →
`dexpress_states`). So an admin would "map" a Libya order's city in
`/mappings`, the order would flip to `mapping_status='mapped'` — and the
agent would *still* be forced to re-pick the city when uploading to Dexpress,
because `dexpress_state_id` stayed null.

Root cause: the storefront→OMS mapping layer was built `cities`-only, but
Libya's destination catalogue is `dexpress_states`, not `cities`. Every other
part of the Libya order pipeline (agent CreateOrderModal, OrderDetailPanel,
the upload flow, the `orders` schema) already runs on `dexpress_state_id` —
the mapping layer was the lone outlier.

## The fix — make the city mapping market-aware

`marketIdToCode(market_id)` from `src/lib/markets.ts` is the market signal
(`"ly"` → Dexpress path, else cities path). Every layer already receives a
`market_id`, so the branch is consistent everywhere.

- **Tunisia**: destination is an OMS city → `external_city_mappings.city_id`,
  back-fill sets `orders.city_id`. Unchanged behaviour.
- **Libya**: destination is a Dexpress state → `external_city_mappings.dexpress_state_id`,
  back-fill sets `orders.dexpress_state_id`, `city_id` stays null.

The two are mutually exclusive — matches the `orders` PATCH contract.

## What changed

### Migration (applied to the OMS Supabase project)
- `20260625000002_external_city_mappings_dexpress_destination.sql` —
  `external_city_mappings.city_id` was `NOT NULL`, which made the Libya design
  (city_id null, dexpress_state_id set) impossible to store. Migration drops
  the NOT NULL and adds a CHECK: exactly one of `city_id` / `dexpress_state_id`
  is set (XOR).

### Code (TDD)
- `src/lib/storefronts/city-resolver.ts` — `decideCityResolution` +
  `resolveCity` are now market-aware. `CityResolverInput` gained
  `isDexpressMarket`; `nameMatch` became a discriminated union
  (`{kind:"city"}` | `{kind:"dexpress"}`). Libya resolves the external city id
  → a `dexpress_states` row; an `external_city_mappings` row with a null
  `dexpress_state_id` is treated as INCOMPLETE and falls through to the name
  match (this was exactly the #AC3FDD16 failure mode).
- `src/app/api/mappings/cities/route.ts` — POST accepts `city_id` (TN) or
  `dexpress_state_id` (LY) per market, validates the right one, back-fills the
  right order column. GET lists Dexpress-bound mappings for Libya
  (`dexpress_state_id IS NOT NULL`, embeds `dexpress_states`), cities-scoped
  for Tunisia. super_admin POST must pass `market_id` in the body.
- `src/app/api/mappings/unmatched/route.ts` — **no change**. It keys the city
  dedup on `(platform, external_city_id)`, agnostic to which destination the
  mapping resolves to. A regression test was added to lock that in.
- `src/app/[locale]/(dashboard)/mappings/MappingsPageClient.tsx` — `CityTab`
  computes `isDexpress`; for Libya the bind modal fetches `/api/dexpress/states`
  and submits `dexpress_state_id`, for Tunisia `/api/cities` + `city_id`. The
  mappings list column renders the Dexpress state name or the city name.

### Tests
- `city-resolver.test.ts` — split into Tunisia / Libya describe blocks; new
  cases for the Dexpress path incl. the incomplete-mapping fall-through.
- `app/api/mappings/cities/route.test.ts` — **created** (did not exist):
  TN + LY POST/GET, validation, back-fill column correctness, 404/409.
- `app/api/mappings/unmatched/route.test.ts` — regression: a Libya order with
  a `city_id`-null mapping row still drops off the unmatched list.
- `webhook-handler.test.ts` — the mapping-resolution block now uses
  `LY_MARKET_ID` (Buybox is a Libya storefront) + a `dexpress_states` mock
  table; the "different market" case was replaced with an
  "incomplete mapping" case.

## One-off data fix — order #AC3FDD16 (DONE)

This order was bound before the fix, so its `external_city_mappings` row had
`city_id` set and `dexpress_state_id` null — unusable for Dexpress upload.
Corrected directly (the order is `confirmed`, past the normal back-fill
window, but was actively blocked):

```sql
UPDATE external_city_mappings
  SET dexpress_state_id = 51, city_id = NULL, updated_at = now()
  WHERE platform = 'buybox' AND external_city_id = '51';

UPDATE orders
  SET dexpress_state_id = 51, city_id = NULL
  WHERE id = 'ac3fdd16-9d97-4c7b-a6c4-64f026d22bed';
```

`dexpress_states.id = 51` is "اجدابيا" (Ajdabiya) — matches the order's
`external_city_id` and `external_route_id`.

## Known sharp edge (not fixed here)

`external_city_mappings` has `UNIQUE(platform, external_city_id)`. If a
mapping row already exists but is incomplete (e.g. an old null-destination
row), the new POST flow hits a 409 — it cannot repair it. Repair is a manual
`UPDATE` as above. A future improvement: make POST upsert when the existing
row has a null destination. Deferred — out of scope for this fix.

## Verification

- `npm run typecheck`, `npm test` (mappings + storefronts + webhook suites),
  `npm run build`.
- Browser: `/fr/mappings`, Libya market → Cities tab → bind a Buybox city →
  the modal lists Dexpress states → save → the order's
  `orders.dexpress_state_id` is set → the agent Dexpress upload no longer
  forces a city re-pick.
