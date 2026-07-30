# Plan: Fix & modernize the Create Order modal (all interfaces)

## Context

**Why this change exists.** Creating a new order fails (or produces wrong totals) from every
interface — super_admin/manager (Orders page) and agent (Queue) — because the single shared
`CreateOrderModal` was never updated after the **variant pack-pricing** refactor (see
[plans/variant-pack-pricing.md](variant-pack-pricing.md)). The backend (orders POST, items POST,
webhook, variant APIs, `computeVariantLine`) was migrated; the modal was not. The modal also lags
the current **city model** (Tunisia `cities` table + `city_id`; Libya now primarily served by **Darb
Assabil**, not Dexpress).

**Root-cause bug (the "error creating order").** The modal's local `ProductVariant` interface still
has `quantity` and ignores the new `units_per_pack` / `price_basis`. In `handleVariantChange`
([CreateOrderModal.tsx:298-318](../src/components/orders/CreateOrderModal.tsx#L298-L318)) it sets
`quantity = String(v.quantity)` and `total = v.quantity × display_price`. Once the deprecated
`quantity` column is dropped at rollout, `v.quantity` is `undefined` → `"NaN"` and `NaN × price` →
`NaN`, which the form's own validation ([:341-355](../src/components/orders/CreateOrderModal.tsx#L341-L355))
rejects. Even before the column drops, the math **double-charges** whole-pack variants
("2 for 89" becomes 178). The server already does the correct thing — it treats request `quantity`
as **packs ordered** and calls `computeVariantLine` — so the modal and server disagree.

**Intended outcome.** Order creation works correctly from all three interfaces and all markets;
the variant math matches the server (single source of truth = `computeVariantLine`); the modal's
city handling matches the current model (Tunisia `city_id` via the cities table; Libya via the Darb
city/area picker); and the modal is visually restructured into a modern, design-system-native sheet
with a live order summary.

**User-confirmed decisions:**
- Tunisia: **searchable `city_id` picker** (reuse the `Combobox` + `/api/cities`, like the detail panel).
- Libya: **build a Darb city+area picker** (reuse `DarbAssabilLocationPicker` + resolver helpers).
- Redesign: **full restructure** within the design system (right-side `Sheet`, section cards, live summary).
- Tests: **API tests only** for now — extend `orders/route.test.ts` for the new `city_id` /
  `darb_destination_id` server handling. (Note: this diverges from the project's TDD rule for the
  modal UI itself; component tests for the modal are deferred per the user's choice. Flag at PR.)

---

## Branch

`git checkout -b fix/create-order-modal-variants-cities` off `main`.

---

## Part 1 — Fix the variant pack-pricing bug (CreateOrderModal.tsx)

Reuse the shared helper and type — do **not** reimplement pricing in the component.

1. **Imports** (top of file): `import { computeVariantLine, type VariantPriceBasis } from "@/lib/product-calculations";`
2. **Replace the local `ProductVariant` interface** ([:36-43](../src/components/orders/CreateOrderModal.tsx#L36-L43))
   to match the variants API select: `{ id, product_id, label, units_per_pack, price_basis: VariantPriceBasis, display_price: number | string, is_active }`.
3. **Extend `FormState`** ([:53-70](../src/components/orders/CreateOrderModal.tsx#L53-L70)) +
   `emptyForm` with `variant_units_per_pack: number | null`, `variant_price_basis: VariantPriceBasis | null`,
   `variant_display_price: number | null`. When a variant is selected the `quantity` field means
   **packs**; otherwise it means **units** (no schema change).
4. **Rewrite `handleVariantChange`** ([:298-318](../src/components/orders/CreateOrderModal.tsx#L298-L318))
   to call `computeVariantLine({ unitsPerPack, priceBasis, displayPrice, unitCogs: 0, packsOrdered: 1 })`
   (modal never shows COGS → `unitCogs: 0`) and seed `quantity: "1"`, `unit_price: line.unitPrice`,
   `total_price: line.lineRevenue`, plus the three new variant fields. Clearing the variant resets them to `null`.
5. **Make the auto-total `useEffect`** ([:212-221](../src/components/orders/CreateOrderModal.tsx#L212-L221))
   variant-aware: when a variant is active, recompute `unit_price`/`total_price` via `computeVariantLine`
   with the current quantity as `packsOrdered`; else keep the existing `quantity × unit_price` unit path.
   Keep the `s === computed` short-circuit to avoid render loops; add the three new deps.
6. **`handleProductChange`** ([:274-296](../src/components/orders/CreateOrderModal.tsx#L274-L296)) must
   also reset the three new variant fields to `null`.
7. **Variant `<option>` label** ([:639](../src/components/orders/CreateOrderModal.tsx#L639)): replace
   `{v.quantity}x` with a next-intl pattern showing pack semantics, e.g.
   `{label} · {pcs} pcs/pack · {price} ({basis})`.
8. **Quantity field** ([:655-665](../src/components/orders/CreateOrderModal.tsx#L655-L665)): label
   switches "packs"/"units"; show a derived "{units} units total" hint when a pack variant is active
   (`packs × units_per_pack`).
9. **Submit payload** already sends `quantity` (= packs when variant) and `variant_id` — server
   recomputes authoritatively, so the client total is only a preview. Keep as-is plus the city fields below.

## Part 2 — Tunisia city: searchable `city_id` picker

- **Modal:** Replace the static `TUNISIAN_GOVERNORATES` `<select>`
  ([:501-513](../src/components/orders/CreateOrderModal.tsx#L501-L513), drop the `tunisiaCityOptions` memo
  [:234-237](../src/components/orders/CreateOrderModal.tsx#L234-L237) and the governorates import
  [:10](../src/components/orders/CreateOrderModal.tsx#L10)) with the shared
  [`Combobox`](../src/components/ui/Combobox.tsx), mirroring
  [OrderDetailPanel CustomerCard](../src/components/queue/OrderDetailPanel/CustomerCard.tsx#L135-L144).
  Add `city_id: string | null` to `FormState`. SWR-load `/api/cities?market_id=${effectiveMarketId}`
  when `marketCode === "tn"` (pass `market_id` so a super_admin in "all" scope still gets the right
  market's cities). Use `useLocale()` to show `name_ar` in Arabic. `onCommit(id, label)` sets
  `{ city_id: id, customer_city: label }`.
- **Server** ([orders/route.ts POST](../src/app/api/orders/route.ts#L78-L266)): after the product
  lookup, add a `city_id` resolution block mirroring the PATCH handler in
  [orders/[id]/route.ts](../src/app/api/orders/[id]/route.ts) — validate the city exists and
  `city.market_id === marketId` (404 if missing, 409 on mismatch), then set `city_id` and override
  `customer_city = city.name`. Backward compatible: when no `city_id` is sent, fall back to the
  `customer_city` text (webhooks/old clients unaffected). Add `city_id` to the `insert` (line ~228).

## Part 3 — Libya city: Darb city+area picker

- **Modal:** When `marketCode === "ly"`, replace the Dexpress state picker
  ([:514-573](../src/components/orders/CreateOrderModal.tsx#L514-L573)) with the existing
  [`DarbAssabilLocationPicker`](../src/components/queue/DarbAssabilLocationPicker.tsx) (state shape
  `DarbAssabilSelection = { city, area }`, full list since there's no order city yet to scope to).
  On change, set `customer_city = selection.city` (canonical city) and stash the chosen `(city, area)`
  to resolve a `darb_destination_id` on submit. Data is bundled (`DARB_ASSABIL_CITIES`) — no fetch
  needed for the picker, but use [`/api/darb/destinations`](../src/app/api/darb/destinations/route.ts)
  on submit (or a server-side lookup) to map the chosen `(city, area)` → `darb_destination_id`.
- **Server** ([orders/route.ts POST](../src/app/api/orders/route.ts)): accept optional
  `darb_destination_id` (number) and/or a `{ darb_city, darb_area }` pair; resolve to the
  `darb_destinations` row (validate it's active), set `darb_destination_id` and override
  `customer_city = darb_city`. Keep `dexpress_state_id` handling untouched for back-compat. This makes
  manual Libya orders arrive aligned to a real carrier pair (the dispatch modal's
  `resolveDispatchPair` then dispatches single-area cities automatically and only re-prompts for
  multi-area cities — same as today).
- Why store the city (not the area) in `customer_city`: the Darb adapter reads `extra.city` +
  `extra.customer_area` from the dispatch picker and falls back to `order.customer_city` for the city;
  storing the canonical city keeps resolution correct. `darb_destination_id` records the chosen pair
  for traceability/coverage.

## Part 4 — Full visual restructure (design-system-native)

Use the real tokens (`surface-card`, `surface-page`, `ink-primary/secondary/muted`, `line-subtle`,
`rounded-card`, `shadow-panel`, `tabular-nums`) and logical RTL props (`end-0`, `ps/pe`, `border-s`,
`text-start/end`). Monochrome; functional color only on the error banner / status.

- **Adopt the shared [`Sheet`](../src/components/ui/Sheet.tsx)** primitive (placement `end`,
  focus-trap + escape + body-lock built in) to replace the hand-rolled backdrop + FocusTrap
  ([:410-429](../src/components/orders/CreateOrderModal.tsx#L410-L429)), reducing bespoke code.
- **Sections** as `FormSection` cards (keep the local `FormSection`/`FieldLabel` primitives): Context
  (super_admin), Customer, Order. Two-column grids where natural (name/phone, qty/price).
- **Live Order Summary card** (new `FormSection`, appears once a product is selected) modeled on
  [`OrderItemsCard`](../src/components/queue/OrderDetailPanel/OrderItemsCard.tsx): label/value rows with
  `tabular-nums`, product (+ variant), packs vs units, derived physical units (for pack variants),
  unit price, and an emphasized **Total** (`font-semibold text-[16px]`). The raw `unit_price`/`total`
  inputs become read-only and visually folded into this summary.
- **Loading/empty states:** skeleton/disabled product & variant selects while their SWR is in flight;
  a "select a market first" hint for super_admin in "all" scope; keep the existing empty-products hint.
- **RTL:** verify the Arabic mirror (sheet on inline-start, combobox dropdown `insetInlineStart`,
  amounts `text-end`). No physical `left/right/pl/pr`.

## Part 5 — Translations (next-intl, both locales)

Add to `orders.create` in **both** [src/messages/fr.json](../src/messages/fr.json) and
[src/messages/ar.json](../src/messages/ar.json): `fields.quantityPacks`, `fields.quantityUnits`,
`variantOption` (`"{label} · {pcs} pcs/pack · {price} ({basis})"`), `priceBasis.pack`,
`priceBasis.unit`, `derivedUnits`, `sectionSummary`, `summaryPacks`, `summaryUnits`, `summaryTotal`,
`summaryUnitPrice`, `cityTnSearchPlaceholder`, `cityLyPickArea` (+ reuse Darb picker keys under
`dispatch.darbAssabil`), `loadingProducts`, `selectMarketFirst`. No hardcoded strings.

## Part 6 — Tests (API only, per user's choice)

Extend [src/app/api/orders/route.test.ts](../src/app/api/orders/route.test.ts) `POST` block (reuse the
existing `queryChain`/`setupAuth` helpers):
1. `city_id` resolves and overrides `customer_city` from the cities table (assert insert has
   `city_id` + `customer_city = city.name`, even when a different `customer_city` text is also sent).
2. `city_id` market mismatch → 409; not found → 404.
3. `darb_destination_id` (or `{darb_city, darb_area}`) resolves and sets `customer_city = city`,
   `darb_destination_id`.
4. Backward-compat: only `customer_city` text (no ids) → 201, `city_id`/`darb_destination_id` null.
The three existing variant tests ([:191,248,318](../src/app/api/orders/route.test.ts#L191)) must keep
passing — run to confirm no regression. **Deferred:** component tests for `CreateOrderModal`
(`CreateOrderModal.test.tsx`) — call out the TDD gap in the PR description.

## Files to modify / create

Modify:
- `src/components/orders/CreateOrderModal.tsx` — Parts 1–4
- `src/app/api/orders/route.ts` — Parts 2 & 3 (city_id + darb_destination_id support)
- `src/app/api/orders/route.test.ts` — Part 6
- `src/messages/fr.json`, `src/messages/ar.json` — Part 5

Reuse (no change): `src/lib/product-calculations.ts` (`computeVariantLine`),
`src/components/ui/Combobox.tsx`, `src/components/ui/Sheet.tsx`,
`src/components/queue/DarbAssabilLocationPicker.tsx`, `src/lib/carriers/darb-assabil-areas.ts`,
`src/app/api/cities/route.ts`, `src/app/api/darb/destinations/route.ts`.

No DB migration (`orders.city_id`, `orders.darb_destination_id`, `orders.dexpress_state_id` all exist).

## Risks

- **Packs-vs-units optics:** visible `quantity` is packs but `unit_price` is per physical unit. The
  summary card must surface physical units and label the field "packs" so the math reads correctly.
- **super_admin city scoping:** must pass `market_id` to `/api/cities` so "all" scope yields the
  target market's cities.
- **Render loops:** the variant-aware total effect writes form state — keep the equality short-circuit
  and correct deps.
- **Darb multi-area cities:** picking a city with many areas requires an area too; the picker handles
  this, and `resolveDispatchPair` re-prompts at dispatch if the area is missing — acceptable.

## Verification

1. `npm test` / `npm run test:run` — new route tests green; existing variant tests still green.
2. `npm run typecheck` after every file edit; `npm run lint`; `npm run build`.
3. Manual E2E (`npm run dev`) across **super_admin / market_manager / agent** × **TN / LY**:
   - TN: pick a city via Combobox → order row has `city_id` + `customer_city`; create a "2 for 89"
     pack variant order → total **89**, quantity **2** physical units; per-unit variant correct.
   - LY: pick a Darb (city, area) → `customer_city` = city, `darb_destination_id` set; pack math correct.
   - No-variant order from `default_price`.
   - Live summary total matches persisted `total_price` (open in OrderDetailPanel after creation).
   - Arabic: sheet mirrors, combobox/picker align to inline-start, amounts right-aligned.
4. Run `i18n-reviewer` (UI strings/RTL) and `rls-reviewer` (city/darb reads) after edits.
