# Storefront-Webhook → OMS Mapping Layer

## Context

Storefront webhooks (Buybox, Shopify, WooCommerce, EasyOrders, Lightfunnels) currently map to
OMS orders with **best-effort string matching**: SKU exact → product name `ILIKE` → else
`product_id = NULL`. Cities are stored as raw strings and `orders.city_id` is never populated.
The Buybox adapter even feeds the storefront product id (`product.id`, e.g. `8123456789`) into
the `sku` field — semantically wrong.

This silently corrupts P&L. Profitability math depends on `orders.product_id`
(`products.unit_cost × quantity` for COGS, plus `packing_cost`, `confirmation_processing_cost`)
and on `orders.city_id` for carrier dispatch / region-based assignment. A `product_id = NULL`
order just sits in the queue with no review signal and no cost attribution.

The real Buybox payload now carries strong identifiers we currently ignore — a stable numeric
`customer.city_id` (80) and `route_id` (10), and a `product.variant_id` (47259433337054)
distinct from `product.id`. These are far more reliable join keys than free-text strings.

**Goal:** a robust, auditable mapping layer — explicit mapping tables keyed on external
identifiers, deterministic resolution with a clear fallback chain, an explicit
`mapping_status` on every order, and an admin surface to resolve the unmatched ones — so
downstream statistics and P&L can trust `product_id` and `city_id`.

### Decisions locked in
- **Market = storefront.** One storefront = one market (confirmed with user). The webhook URL
  (`/api/webhooks/[storefrontId]`) pins `market_id`; no payload field decides the market.
  All resolution happens *inside* that market.
- **Unmatched signal:** new `orders.mapping_status` column (`mapped` / `needs_review` /
  `unmatched`) — separate from lifecycle `status`, so queue/transition logic is untouched.
  The order is still created as `pending` regardless.
- **Scope:** full plan — mapping tables + resolvers + webhook handler + admin UI + TDD.
- **Price scale — resolve in Phase 0.** Buybox sends `total_price: 70000`, `currency: "TND"`.
  TND is 3-decimal; this is almost certainly 70.000 TND in millimes. But OMS money columns are
  `NUMERIC(10,3)` (`orders.total_price`, `products.unit_cost`, `carriers.delivery_fee`) — the
  `,3)` scale strongly implies **major units** (70.000 = 70 TND). Phase 0 confirms this against
  live rows; if confirmed, the Buybox adapter divides incoming price by 1000 with a test
  locking the conversion. **Do not rescale anything until confirmed.** Store `currency` raw on
  the order regardless.

## Phase 0 — Confirm price scale + schema (DONE)

Findings against the live `OMS` Supabase project (`vshynigvgrlihngozuwb`):

- **DB money columns are major units.** `products.unit_cogs` for "Quran" = `40.000` (40 LYD),
  `carriers.delivery_fee` = `6.000` / `15.000`, manual orders `total_price` = `60`–`200`.
  All `NUMERIC(10,3)` storing major units.
- **Buybox webhook is on a different scale.** Buybox orders for the same Quran have
  `total_price = 7000.000`; the raw payload has `unit_price: 7000`, `total_price: 7000`,
  `currency: "TND"`. So **the price-scale bug already exists in production** — Buybox-sourced
  P&L is off by ~100×. The Buybox adapter must normalize. **Pending one confirmation with the
  user**: is Buybox sending millimes (÷1000) or is `7000` a deliberate raw price? Treat as
  ÷1000 by default, lock with a test, but flag for user sign-off.
- **Schema drift from the exploration report — corrected names below:**
  - `products` cost column is **`unit_cogs`**, not `unit_cost`. Also has `default_price NUMERIC(12,3)`.
  - `orders` has **no `sku` column**. Has `city_id UUID`, `dexpress_state_id INTEGER` (not UUID),
    `delivery_fee NUMERIC`, `customer_phone_2`, `customer_whatsapp`.
  - `dexpress_states` PK `id` is **`INTEGER`**, `route_id` is `INTEGER`.
  - `cities`: `id, market_id, name, name_ar, is_active, created_at` — no external id column.
  - `product_variants`: `id, product_id, label, quantity, is_active, display_price` — empty table, no rows yet.
  - `storefronts`: `id, market_id, platform, name, config jsonb, webhook_secret, is_active, auth_mode`.
  - Mapping tables do **not** exist yet — clean slate.
  - There is also a `converty` platform storefront (no adapter file noted) — out of scope here.
- **Real Buybox payload** (from `orders.raw_payload`): `customer.city_id` and `route_id` are
  small integers (`3`, `2`); `product.variant_id` is a big integer; `unit_price`/`total_price`
  are JSON **numbers** (not strings); `bundle_label` present; `customer.address` sometimes
  holds a city-ish value ("Sousse"). Buybox storefront row:
  `3f23ba62-7f66-40d0-ba86-b3bc75f62d12` ("MyStore", Libya market `...0002`).

## Phase 1 — Migrations

Three timestamped files under `supabase/migrations/` (follow existing `YYYYMMDDHHMMSS_name.sql`
convention). RLS mirrors the existing market-isolation pattern on `products` / `cities`.

### 1a. `storefront_product_mappings`
```sql
CREATE TABLE storefront_product_mappings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storefront_id        UUID NOT NULL REFERENCES storefronts(id) ON DELETE CASCADE,
  external_variant_id  TEXT NOT NULL,          -- Buybox product.variant_id, Shopify variant id, etc.
  external_product_id  TEXT,                   -- storefront product id, for reference/UI
  product_id           UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_variant_id   UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (storefront_id, external_variant_id)
);
```
Keyed on `storefront_id` (which implies market) — prevents cross-market bleed by construction,
and lets two storefronts in the same market reuse a variant id independently.

### 1b. `external_city_mappings`
```sql
CREATE TABLE external_city_mappings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform           TEXT NOT NULL,            -- 'buybox' | 'shopify' | ...
  external_city_id   TEXT NOT NULL,            -- Buybox numeric city_id as text
  external_city_name TEXT,                     -- for UI / disambiguation
  city_id            UUID NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  dexpress_state_id  UUID REFERENCES dexpress_states(id) ON DELETE SET NULL,
  external_route_id  TEXT,                     -- Buybox route_id, for carrier dispatch
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, external_city_id)
);
```
Buybox's city catalog is platform-wide, so the key is `(platform, external_city_id)`, not
storefront. **Validation rule:** the resolved `cities.market_id` must equal the storefront's
`market_id`; mismatch → `needs_review`, never a silent accept.

### 1c. `orders` column additions
```sql
ALTER TABLE orders
  ADD COLUMN mapping_status        TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (mapping_status IN ('mapped','needs_review','unmatched')),
  ADD COLUMN product_variant_id    UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  ADD COLUMN external_product_id   TEXT,
  ADD COLUMN external_variant_id   TEXT,
  ADD COLUMN external_city_id      TEXT,
  ADD COLUMN external_route_id     TEXT,
  ADD COLUMN currency              TEXT;
```
`mapping_status` default `unmatched` is the safe default — anything inserted without going
through the resolver shows as needing attention. Partial index for the review surface:
`CREATE INDEX idx_orders_mapping_review ON orders (market_id) WHERE mapping_status <> 'mapped';`

## Phase 2 — Adapter contract

### `src/lib/storefronts/types.ts`
Extend `InternalOrderData` with optional fields (optional so existing adapters compile
unchanged, each populates only what its platform sends):
```ts
external_product_id?: string | null;
external_variant_id?: string | null;
external_city_id?: string | null;
external_route_id?: string | null;
bundle_label?: string | null;     // structured, not folded into customer_note
currency?: string | null;
```

### `src/lib/storefronts/buybox-adapter.ts`
- Emit `external_product_id` (`product.id`), `external_variant_id` (`product.variant_id`),
  `external_city_id` (`customer.city_id`), `external_route_id` (`customer.route_id`),
  `bundle_label`, `currency`.
- **Stop overloading `sku`** with `product.id` — leave `sku` null for Buybox (it has no SKU).
- Keep `upsells` folded into `customer_note` (display-only, no structured need yet).
- Apply the Phase 0 price-scale conversion here if confirmed as major units.

### `src/lib/storefronts/uuid-only-payload.ts`
Add tolerant type checks for `customer.city_id` / `customer.route_id` / `product.variant_id`
(numeric or numeric-string). Keep `customer.city` string check as-is — it's still present in
the payload and is the Shopify-style fallback.

### Other adapters (`shopify-adapter.ts`, `woocommerce-adapter.ts`, etc.)
Populate `external_variant_id` where the platform provides one (Shopify line item variant id).
Where the platform only sends a city string, leave `external_city_id` null — the city resolver
falls back to string normalization.

## Phase 3 — Resolvers

Two new modules, each split into a **pure decision helper** (DB-free, unit-testable) + a
**thin IO wrapper** — mirroring the existing `auto-assignment.ts` /
`auto-assignment-orchestrator.ts` split. Reuse `src/lib/storefronts/payload-guards.ts` helpers.

### `src/lib/storefronts/product-resolver.ts`
Resolution order:
1. **Explicit mapping** — `storefront_product_mappings` on `(storefront_id, external_variant_id)`.
2. **SKU** — `products.sku` exact, market-scoped (for adapters that send a real SKU).
3. **Name** — `products.name ILIKE`, market-scoped (last-resort, fragile).
4. **Unmatched** — `product_id = null`.

Returns `{ product_id, product_variant_id, match_method }`. `match_method` of `mapping` or
`sku` → contributes `mapped`; `name` → `needs_review`; none → `unmatched`.

### `src/lib/storefronts/city-resolver.ts`
Resolution order:
1. **External id mapping** — `external_city_mappings` on `(platform, external_city_id)`.
   Then assert resolved `cities.market_id === storefront.market_id`.
2. **String normalization** — case-insensitive / trimmed match against `cities.name` and
   `cities.name_ar`, market-scoped (Shopify path).
3. **Unmatched** — `city_id = null`.

Market mismatch on step 1 → `needs_review` (keep raw, don't accept the wrong-market city).

## Phase 4 — Webhook handler

### `src/lib/orders/webhook-handler.ts`
- Replace the inline matching block (~lines 428-451) with `resolveProduct(...)` +
  `resolveCity(...)` calls.
- Compute `mapping_status` = worst of the two resolutions (`unmatched` > `needs_review` > `mapped`).
- Persist new columns: `product_variant_id`, `external_*`, `currency`, `mapping_status`,
  and `city_id` from the city resolver.
- When `mapping_status !== 'mapped'`, append an `order_history` row
  (`actor_type='system'`, note describing what failed) — append-only preserved.
- Idempotency unchanged (`UNIQUE(storefront_id, external_id)` + delivery-id dedup).

### `src/lib/orders/auto-assignment-orchestrator.ts`
- Extend `AssignableOrder` with `city_id: string | null`.
- Keep passing `customer_city` string too — region-rule matching still uses the string for
  now; switching `region_rules` to `city_id` UUIDs is a deferred follow-up so nothing breaks.

## Phase 5 — Admin UI

Run the `design` skill first (dark sidebar / light content / zero decoration).

- New route group `src/app/[locale]/(dashboard)/mappings/` with two tabs:
  - **Products** — list `storefront_product_mappings` + an "unmatched / needs-review orders"
    panel; inline action to bind an order's `external_variant_id` to an OMS product (+ variant),
    which creates the mapping row and back-fills matching open orders.
  - **Cities** — same shape for `external_city_mappings`.
- API routes under `src/app/api/mappings/products/` and `src/app/api/mappings/cities/` using
  the **RLS-scoped server client** (not service role) — market isolation enforced at DB layer.
- i18n: add keys to `messages/fr.json` + `messages/ar.json`; verify RTL.

## Phase 6 — TDD (write red first, per file)

| Test file | Key cases |
|---|---|
| `buybox-adapter.test.ts` (extend) | emits `external_variant_id`/`external_city_id`/`external_route_id`/`bundle_label`/`currency`; `sku` is null; price-scale conversion locked |
| `uuid-only-payload.test.ts` (extend) | accepts numeric & numeric-string `city_id`/`route_id`/`variant_id`; still rejects missing required fields |
| `product-resolver.test.ts` (new) | mapping hit; SKU fallback; name fallback → `needs_review`; no match → `unmatched`; market-scoped (won't match other market's product) |
| `city-resolver.test.ts` (new) | external-id hit; market-mismatch → `needs_review`; string-normalization fallback (`name` + `name_ar`); no match → `unmatched` |
| `webhook-handler.test.ts` (extend) | persists new columns; `mapping_status` = worst-of-two; `order_history` row appended when not `mapped`; still idempotent on duplicate |
| `auto-assignment-orchestrator.test.ts` (extend) | `AssignableOrder` carries `city_id`; assignment still works with string `customer_city` |
| `api/mappings/*/route.test.ts` (new) | RLS scoping; creating a mapping back-fills open orders; cross-market write rejected |

Shared mock Supabase clients go in `src/test/helpers/` — never test-only methods in production code.

## Critical files

**Create:**
- `supabase/migrations/<ts>_storefront_product_mappings.sql`
- `supabase/migrations/<ts>_external_city_mappings.sql`
- `supabase/migrations/<ts>_orders_mapping_columns.sql`
- `src/lib/storefronts/product-resolver.ts` + `.test.ts`
- `src/lib/storefronts/city-resolver.ts` + `.test.ts`
- `src/app/[locale]/(dashboard)/mappings/` (page + client components)
- `src/app/api/mappings/products/route.ts` + `src/app/api/mappings/cities/route.ts` + tests

**Modify:**
- `src/lib/storefronts/types.ts` — extend `InternalOrderData`
- `src/lib/storefronts/buybox-adapter.ts` — emit external ids, stop overloading `sku`, price scale
- `src/lib/storefronts/uuid-only-payload.ts` — tolerant `city_id`/`route_id` checks
- `src/lib/orders/webhook-handler.ts` — call resolvers, persist columns, `mapping_status`, history row
- `src/lib/orders/auto-assignment-orchestrator.ts` — `AssignableOrder.city_id`
- `src/messages/fr.json`, `src/messages/ar.json` — mapping UI strings

## Verification (end-to-end)

1. `npm test` — all new + extended suites green; `npm run typecheck`; `npm run lint`.
2. Apply the three migrations to a Supabase branch; `list_tables` to confirm shape + RLS.
3. POST the real Buybox payload to `/api/webhooks/[buybox-storefront-id]` (Libya storefront):
   - With **no** mapping rows → order created `pending`, `mapping_status='unmatched'`,
     `external_variant_id`/`external_city_id` persisted, `order_history` row appended.
   - Seed a `storefront_product_mappings` row + `external_city_mappings` row, POST again
     (new `external_id`) → `mapping_status='mapped'`, `product_id`/`city_id`/`product_variant_id` set.
   - Seed a city mapping pointing at a **Tunisia** city, POST via the Libya storefront →
     `mapping_status='needs_review'`, `city_id` left null.
4. Open `/mappings` admin UI → unmatched order from step 3 appears; bind it to an OMS product →
   mapping row created, order flips to `mapped`.
5. Re-run a P&L calculation over the now-mapped delivered orders → COGS / packing / processing
   costs attributed (non-zero, correct `product_id`).
6. `npm run build`.
