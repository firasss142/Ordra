# Display internal catalog product name on orders

## Context

Orders arriving from storefronts — Google Sheets/Converty sync and webhooks alike — store the product name **exactly as the external system wrote it**. The sheets adapter parses the `Products` cell (`"Some Name x 2"`) and keeps the left-hand text ([converty-sheets-adapter.ts:93](Ordra/src/lib/storefronts/sheets/converty-sheets-adapter.ts#L93)); `createOrderFromData` then persists that raw string verbatim to `orders.product_name` ([create-order-from-data.ts:69](Ordra/src/lib/orders/create-order-from-data.ts#L69)).

Meanwhile the resolver *already* figures out which internal catalog product the order belongs to and writes `orders.product_id` ([product-resolver.ts](Ordra/src/lib/storefronts/product-resolver.ts)). That internal name (`products.name`) is simply never read back. The result: the OMS shows storefront marketing names instead of the catalog names the business actually runs on.

**Goal:** everywhere an order is displayed, show `products.name`, falling back to the stored external string when the order has no resolved product.

### Decisions taken

- **Resolve at display time** via the existing `orders.product_id → products.name` join. `orders.product_name` is never overwritten — it stays the audit record of what the external system sent, and it is also the *input* to the mapping engine.
- **All orders, any source** (sheets + webhooks). They share `create-order-from-data.ts`, and the join covers both uniformly.
- **Fallback to the external string** when `product_id IS NULL`. Never blank.
- **No schema migration**, no new columns.

Self-correcting by construction: when someone later adds a mapping, [mappings/products/route.ts:154-173](Ordra/src/app/api/mappings/products/route.ts#L154-L173) already back-fills `product_id` on open orders — so those orders start showing the internal name with no extra work.

### Note on Google Sheets

The sync is **import-only** — read-only OAuth scope and a single `values.get` call ([client.ts:4](Ordra/src/lib/google-sheets/client.ts#L4), [client.ts:26](Ordra/src/lib/google-sheets/client.ts#L26)). Nothing is ever written back to the spreadsheet. This plan changes what the **OMS** displays for sheet-imported orders; it does not modify the sheet. Writing back would be a separate feature needing a read-write scope and new credentials.

---

## Two facts that de-risk this

1. **The `products` join already exists on both hot paths.** `LIST_SELECT` ends with `product:products(image_url)` ([orders/list/route.ts:22](Ordra/src/app/api/orders/list/route.ts#L22)) and the agent queue selects the same at [agent/queue/route.ts:47,52](Ordra/src/app/api/agent/queue/route.ts#L47). Adding `name` widens an existing embed — no new round trip, no new index.
2. **RLS permits it for every role.** [20260421_warehouse_rls.sql:74-80](Ordra/supabase/migrations/20260421_warehouse_rls.sql#L74-L80) allows any authenticated user to read own-market products, with no role branching and no `is_active` predicate — so archived products still resolve.

---

## Stage 1 — Shared pure helper (+ tests first)

New file: `src/lib/orders/display-name.ts`, alongside the existing pure helpers (`queue-sort.ts`, `list-filters.ts`).

PostgREST's to-one embed shape is not stable — it returns an object in some cases and an array in others, which is why [agent/queue/route.ts:74](Ordra/src/app/api/agent/queue/route.ts#L74) already defends with `Array.isArray(product) ? product[0] : product`. The helper absorbs that so call sites don't each reimplement it.

```ts
type Embedded<T> = T | T[] | null | undefined;

export function unwrapEmbed<T>(value: Embedded<T>): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export interface OrderNameSource {
  product_name?: string | null;                    // untouched external string
  product?: Embedded<{ name?: string | null }>;    // present when select included products(name)
}

export function resolveProductDisplayName(row: OrderNameSource): string {
  const internal = unwrapEmbed(row.product)?.name;
  if (typeof internal === "string" && internal.trim() !== "") return internal;
  const external = row.product_name;
  if (typeof external === "string" && external.trim() !== "") return external;
  return "";
}
```

Returns `""` (not `null`) in the worst case, so it stays drop-in compatible with the ~unguarded `{order.product_name}` renders.

A sibling `resolveVariantDisplayLabel` (same shape, `product_variant?.label` → `variant_label`, returning **`null`** when absent because every variant render site is already conditional) is deferred to Stage 5 — variant labels drift far less than product names.

**Vitest** — `src/lib/orders/__tests__/display-name.test.ts`. Pure, so zero mocks (per `testing-anti-patterns.md`):
- internal name wins when present; external returned when `product` is `null` / `undefined` / `[]`
- **single-element array embed unwraps** — the PostgREST shape variance; without this the agent queue silently falls back
- embed present but `name` is `null` / `""` / whitespace-only → external
- both missing → `""`, never `undefined`
- both present and different → asserts internal, explicitly not external
- returned value is not trimmed (trim informs the emptiness decision only)
- `unwrapEmbed` directly: object → itself, `[x]` → `x`, `[]` → `null`, nullish → `null`

---

## Stage 2 — CSV export (highest value, fully isolated)

[orders/export/route.ts:68](Ordra/src/app/api/orders/export/route.ts#L68) — append `, product:products(name)` to the select. Render at [line 140](Ordra/src/app/api/orders/export/route.ts#L140): `escapeCsv(row.product_name)` → `escapeCsv(resolveProductDisplayName(row))`.

Exports leave the building (carriers, accounting), so a wrong name here is externally visible. This is the only route gaining a *brand new* join on a large result set (capped at `MAX_EXPORT_ROWS = 10_000`), but it's a PK lookup against a small catalog table and an infrequent deliberate action.

Expect a small local row-type annotation — adding an embed changes the inferred type while `row.status`/`row.assigned_to` are accessed directly nearby. Mirror the `RawRow` pattern at [list/route.ts:153](Ordra/src/app/api/orders/list/route.ts#L153).

---

## Stage 3 — Orders list (**two queries back one table**)

1. **API:** [list/route.ts:22](Ordra/src/app/api/orders/list/route.ts#L22) `product:products(image_url)` → `product:products(image_url, name)`. Extend the existing flatten at [lines 162-165](Ordra/src/app/api/orders/list/route.ts#L162-L165) to also emit `product_display_name: resolveProductDisplayName(r)` — computed on `r` *before* destructuring strips `product`. Add `name` to the `RawRow` product type.
2. **SSR prefetch — do not miss this:** [orders/page.tsx:12-16](Ordra/src/app/[locale]/(dashboard)/orders/page.tsx#L12-L16) has its own `LIST_COLS` with **no products embed**, feeding `fallbackFirstPage`. Change only the API and the first paint renders external names that visibly swap on SWR revalidation. Add `"product:products(name)"` and map its rows through the same helper.
3. **Render:** `src/components/orders/OrderRow.tsx` lines 213 and 219 → `order.product_display_name ?? order.product_name`. Also the `anchorProductName` props at lines 272/288 (duplicate & repeat-buyer popovers).

Keyset pagination is unaffected — the cursor sorts on `orders.created_at, id` only.

---

## Stage 4 — Agent queue, assign board, team queue

- **Agent queue** (highest traffic): [agent/queue/route.ts:47 and :52](Ordra/src/app/api/agent/queue/route.ts#L47) — both selects gain `name` in the existing embed. Extend `flattenJoins` (lines 88-96) with `product_display_name`, and replace its ad-hoc `Array.isArray` unwrap with `unwrapEmbed`. Render: [queue/OrderCard.tsx:391-394](Ordra/src/components/queue/OrderCard.tsx#L391-L394), plus `alt` at :307 and the two `anchorProductName` at :358/:374.
- **Assign board:** `src/app/api/orders/unassigned/route.ts:34` gains `, product:products(name)`; render at [assign/OrderCard.tsx:114-117](Ordra/src/components/assign/OrderCard.tsx#L114-L117).
- **Team queue:** [team/[agentId]/queue/route.ts:50](Ordra/src/app/api/team/[agentId]/queue/route.ts#L50) gains the embed — so a manager and the agent see the same name for the same order.

---

## Stage 5 — Deferred / needs sign-off

- **Variant-label helper** adoption (`resolveVariantDisplayLabel`).
- **Pick list** — [to-ship/picklist/route.ts:225,240](Ordra/src/app/api/to-ship/picklist/route.ts#L225). Technically a one-line change, and it *improves* grouping (several external strings collapsing into one catalog product now group correctly). But a picklist is a physical warehouse document; staff match its text against boxes on shelves. **Get warehouse sign-off before shipping** rather than bundling it silently.

---

## Deliberately NOT changed

- **Mappings review screen** — [MappingsPageClient.tsx:214](Ordra/src/app/[locale]/(dashboard)/mappings/MappingsPageClient.tsx#L214). Showing the external string *is the point*: the manager reads the unmapped external name to decide which catalog product to bind. These rows have `product_id IS NULL` by definition, so resolving here renders blank or makes mapped and unmapped rows indistinguishable.
- **Search filters** — `product_name.ilike` in [list/route.ts:113](Ordra/src/app/api/orders/list/route.ts#L113) and [export/route.ts:96](Ordra/src/app/api/orders/export/route.ts#L96) must keep targeting the raw column. Known follow-up: a user may search the internal name they now see and get no hit; covering both needs a join-filter that PostgREST handles poorly inside `.or()`. Out of scope.
- **Intake path** — `orders.product_name` keeps receiving the untouched external string.
- **`order_items`** — [OrderItemsCard.tsx:156](Ordra/src/components/queue/OrderDetailPanel/OrderItemsCard.tsx#L156) is `value={item.product_name}`, an editable **input**, not display. UI-written rows already store `products.name`, so the payoff is limited to legacy materialized rows. Separate change, separate analysis.
- **`TopPerformingProducts`** — already correct. Its `product_name` is not `orders.product_name`; [summary.ts:407-441](Ordra/src/lib/dashboard/summary.ts#L407-L441) already reads `o.products?.name` and skips null `product_id`.

---

## Verification

1. `npm test` — helper unit tests green (written first, watched fail).
2. `npm run typecheck` after every file change; `npm run lint` before commit.
3. `npm run dev`, log in as `admin@oms.local / testpass123`:
   - **Mapped order:** find an order with `mapping_status = 'mapped'` whose external string differs from `products.name` → orders list, agent queue, and assign board all show the catalog name.
   - **Unmatched order:** one with `product_id IS NULL` → still shows the external string, never blank.
   - **No flicker:** hard-reload `/orders` and watch the first paint — the SSR name must match the post-revalidation name (this is what Stage 3 step 2 protects).
   - **CSV:** export and confirm the `Produit` column carries catalog names.
   - **Self-correction:** on `/mappings`, bind an unmatched external variant to a product; the previously-unmatched order should flip to the catalog name via the existing back-fill.
   - **Agent RLS:** repeat the queue check as `agent1.tn@oms.local` — names must resolve, not fall back.
4. `npm run build`.
