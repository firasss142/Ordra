# Plan: Correct & consistent product-variant handling (color / size / pack)

## Context

**Why this change exists.** A product such as
`أكمام تغطية للساعد والمعصم للمحجبات (White, قطعتين ب 89 …)`
("hijab forearm/wrist sleeves — **White, two pieces for 89**") exposes that the OMS variant model
is **semantically ambiguous and computed inconsistently across intake paths**. One freeform
`variant_label` smuggles in two unrelated concepts at once:

1. **An attribute** (color `White`) — must NOT affect stock or money.
2. **A pack/bundle** (`قطعتين ب 89` = 2 pieces sold for 89) — MUST affect stock (deduct 2 units),
   COGS (cost 2× unit), and revenue (the customer pays 89 for the pack, not 89×2).

Today a single `product_variants.quantity` field is overloaded to mean *both* "pack size" and
"order line quantity," and the two order-intake paths disagree on how to use it. The result is two
**opposite** bugs from the same root cause:

- **Manual order** ([src/app/api/orders/route.ts:169-199](src/app/api/orders/route.ts#L169-L199)):
  selecting the "2 pieces for 89" variant sets `quantity = 2` and `unit_price = display_price = 89`,
  then `total_price = 2 × 89 = 178`. **Revenue is double-counted** for whole-pack-priced variants.
- **Webhook order** ([src/lib/orders/webhook-handler.ts:458-489](src/lib/orders/webhook-handler.ts#L458-L489)):
  trusts the storefront's `total_price` (correct — EasyOrders sends the true total paid) but stores
  `quantity` as whatever the storefront sends for the line (typically **1** for a "pack" line item).
  At scan-out the RPC deducts `orders.quantity` units, so a 2-piece pack **deducts only 1 unit of
  stock** and undercounts COGS.

**Intended outcome.** A variant has an unambiguous structure so that — regardless of whether the
order is created manually or via webhook — revenue, stock deduction, and COGS are all correct.

### Decisions locked with the user
- **Pricing basis is per-variant** ("depends per variant"): some variants price the *whole pack*,
  others price *per piece*. → introduce an explicit price-basis flag on the variant.
- **Keep a single freeform `label`** ("White · pack of 2"): do **not** split into color/size columns.
  Only fix the math + display.
- **COGS is derived** ("per-pack derived from unit cost"): cost of a variant = `units_per_pack ×
  product.unit_cogs`. **No** per-variant cost override column.
- **Both intake paths** (manual + webhook) must capture the corrected semantics.

## Core model change

Stop overloading `product_variants.quantity`. Split the two meanings:

| New field on `product_variants` | Meaning | Drives |
|---|---|---|
| `units_per_pack` (INTEGER, default 1) | physical units contained in one unit of this variant | **stock deduction** & **COGS multiplier** |
| `price_basis` (TEXT enum: `'pack'` \| `'unit'`, default `'pack'`) | is `display_price` the price of the whole pack, or per single piece? | **revenue** computation |

`display_price` keeps its name but its interpretation is now governed by `price_basis`.

**`orders.quantity` is redefined to mean "number of physical stock units" for this order** — the
stock-and-COGS truth — so the scan-out RPC and COGS formula need **no change**. We compute it from
`packs_ordered × units_per_pack`. (The existing column already feeds both; we just make every writer
populate it consistently.)

Per-line correctness formulas (single source of truth, see "Shared helper" below):
```
physical_units = packs_ordered × units_per_pack          # → orders.quantity
line_revenue   = price_basis === 'pack'
                   ? display_price × packs_ordered        # 89 × 1 = 89  ✅
                   : display_price × physical_units        # per-piece
line_cogs      = product.unit_cogs × physical_units        # unit_cogs × 2 ✅
unit_price (stored, for display) = line_revenue / physical_units   # keeps total = qty×unit invariant
```
For "White, 2 pieces for 89" bought once: `units_per_pack=2`, `price_basis='pack'`,
`display_price=89`, `packs_ordered=1` → `physical_units=2`, `line_revenue=89`,
`line_cogs=2×unit_cogs`. Revenue and stock both correct.

## TDD — write failing tests first (NON-NEGOTIABLE, per CLAUDE.md)

Read `.claude/skills/test-driven-development/SKILL.md` and `testing-anti-patterns.md` first. For each
code change below, add/extend the **failing test** before touching production code.

## Changes

### 1. DB migration — new variant columns (new file under `supabase/migrations/`)
- `ALTER TABLE product_variants ADD COLUMN units_per_pack INTEGER NOT NULL DEFAULT 1 CHECK (units_per_pack >= 1);`
- `ALTER TABLE product_variants ADD COLUMN price_basis TEXT NOT NULL DEFAULT 'pack' CHECK (price_basis IN ('pack','unit'));`
- **Backfill**: `UPDATE product_variants SET units_per_pack = quantity;` (preserve current stock
  behavior — today `quantity` already plays the pack-size role on the manual path).
- Keep the legacy `quantity` column for now (drop later) to avoid breaking any reader during rollout;
  add a comment marking it deprecated. Verify no other reader depends on it via grep before drop.
- After applying, regenerate types (see Verification). Update `docs/database-schema.md` variant table.

### 2. Shared calculation helper — extend [src/lib/product-calculations.ts](src/lib/product-calculations.ts)
This file already exists and already has `calculateVariantCogs(unitCogs, variantQuantity)` (currently
**unused in production** — only tested). Make it the home of the new pure logic so both intake paths
and COGS reporting share ONE implementation:
- Add `computeVariantLine({ unitsPerPack, priceBasis, displayPrice, unitCogs, packsOrdered })`
  returning `{ physicalUnits, lineRevenue, lineCogs, unitPrice }` using the formulas above.
- Keep/relabel `calculateVariantCogs` as the COGS piece (`unitCogs × physicalUnits`).
- Pure, DB-free, fully unit-tested — mirrors the `decideProductResolution` split style already used in
  [product-resolver.ts](src/lib/storefronts/product-resolver.ts).
- **Test**: extend [src/lib/__tests__/product-calculations.test.ts](src/lib/__tests__/product-calculations.test.ts)
  with the "2 pieces for 89" case and a per-piece case.

### 3. Manual order route — [src/app/api/orders/route.ts:169-199](src/app/api/orders/route.ts#L169-L199)
- Select the new columns (`units_per_pack, price_basis, display_price`) on the variant lookup.
- Treat the request `quantity` as **packs ordered** (default 1), then call `computeVariantLine`.
- Insert `quantity = physicalUnits`, `unit_price = unitPrice`, `total_price = lineRevenue`.
- **Test**: rewrite the variant case in [src/app/api/orders/route.test.ts:191-246](src/app/api/orders/route.test.ts#L191-L246)
  — for `display_price=89, units_per_pack=2, price_basis='pack'`, assert `total_price=89` and
  `quantity=2` (this test currently encodes the buggy `2×price` expectation — it must change).

### 4. Webhook intake — make it variant-aware
The webhook currently trusts payload numbers and never reads the variant
([webhook-handler.ts:458-489](src/lib/orders/webhook-handler.ts#L458-L489)). EasyOrders sends the
correct **total_price**, but a wrong **quantity** for packs.
- After `resolveProduct` returns a `product_variant_id`, fetch that variant's `units_per_pack`.
- Set `orders.quantity = (payload quantity) × units_per_pack` so stock/COGS are right.
  Keep `total_price` from the payload (storefront is the revenue source of truth per
  `src/lib/storefronts/CLAUDE.md`); recompute `unit_price = total_price / quantity` for display
  consistency.
- When no variant resolves (unmatched/needs_review), behave exactly as today (no multiplier).
- **Test**: extend [src/lib/orders/webhook-handler.test.ts:192-280](src/lib/orders/webhook-handler.test.ts#L192-L280)
  with a payload qty=1 that resolves to a `units_per_pack=2` variant → asserts inserted `quantity=2`,
  `total_price` unchanged.

### 5. Variant management API + UI (capture the new fields)
- [src/app/api/products/[id]/variants/route.ts](src/app/api/products/[id]/variants/route.ts) and the
  `[variantId]` route: accept/validate/persist `units_per_pack` and `price_basis` on create/PATCH.
- Product detail variant UI (under [src/app/[locale]/(dashboard)/products/[id]/](src/app/[locale]/(dashboard)/products/[id]/)
  and `src/components/products/`): add the two inputs. **Follow `docs/design-system.md`** (dark
  sidebar / light content, zero decoration) and route all copy through next-intl (`messages/fr.json`,
  `messages/ar.json`) — no hardcoded strings, RTL-safe. Run the `i18n-reviewer` agent after UI edits.
- Label guidance (no schema change): keep `label` freeform but suggest a consistent convention in the
  form helper text, e.g. `White · pack of 2`, so attribute + pack read clearly. Display is unchanged
  (the `OrderCard` / `OrderItemsCard` already render `product_name · variant_label`).

### 6. order_items consistency (line-item path)
`order_items` are created lazily by [src/app/api/orders/[id]/items/route.ts](src/app/api/orders/[id]/items/route.ts).
- When an item is added from a variant, apply the **same** `computeVariantLine` helper so
  `quantity`/`unit_price`/`line_total` follow the identical rule as the manual route.
- Note (no change needed): scan-out reads `orders.quantity`, not the sum of `order_items` — confirmed
  in `scan_order_out` ([20260506000000_uploaded_status_model.sql](supabase/migrations/20260506000000_uploaded_status_model.sql)).
  Keep it that way; `orders.quantity` remains the stock truth.

## Out of scope (explicit, per user)
- No color/size/option1-option2 structured columns.
- No per-variant COGS override column.
- No per-variant SKU.

## Verification
1. **Unit tests (TDD loop)**: `npm test` while building; `npm run test:run` for a clean pass. New/edited
   tests: `product-calculations.test.ts`, `orders/route.test.ts`, `orders/[id]/items/route.test.ts`,
   `webhook-handler.test.ts`.
2. **Types & lint**: `npm run typecheck` after every file change; `npm run lint` before commit.
   Regenerate Supabase types after the migration (`mcp__supabase__generate_typescript_types`) and
   reconcile `src/types/product.ts` (`ProductVariant` gets `units_per_pack`, `price_basis`).
3. **Migration smoke (local/branch)**: apply migration on a Supabase dev branch
   (`mcp__supabase__apply_migration` / `create_branch`); confirm backfill set `units_per_pack = quantity`
   and `get_advisors` is clean.
4. **Manual order E2E** (`npm run dev`): create the example product; add variant
   `label="White · pack of 2", units_per_pack=2, price_basis='pack', display_price=89`. Create a
   manual order picking that variant, packs=1 → order shows **total 89**, **quantity 2**. Move to
   `uploaded` → scan out → **stock drops by 2**. Open product profitability → **COGS = 2 × unit_cogs**.
5. **Webhook E2E**: POST an EasyOrders-shaped payload (qty 1) whose variant resolves to the
   `units_per_pack=2` variant; confirm inserted `orders.quantity=2`, `total_price` = payload total,
   and scan-out deducts 2.
6. **Per-piece regression**: a variant with `price_basis='unit'`, `display_price=50`,
   `units_per_pack=1`, packs=3 → total 150, quantity 3 (proves the flag path).
7. **RLS / isolation**: run `rls-reviewer` after the migration; run `i18n-reviewer` after UI edits.

## Critical files
- `supabase/migrations/<new>_variant_pack_pricing.sql` (new)
- [src/lib/product-calculations.ts](src/lib/product-calculations.ts) + [src/lib/__tests__/product-calculations.test.ts](src/lib/__tests__/product-calculations.test.ts)
- [src/app/api/orders/route.ts](src/app/api/orders/route.ts) + [src/app/api/orders/route.test.ts](src/app/api/orders/route.test.ts)
- [src/lib/orders/webhook-handler.ts](src/lib/orders/webhook-handler.ts) + [src/lib/orders/webhook-handler.test.ts](src/lib/orders/webhook-handler.test.ts)
- [src/app/api/orders/[id]/items/route.ts](src/app/api/orders/[id]/items/route.ts) + its test
- [src/app/api/products/[id]/variants/route.ts](src/app/api/products/[id]/variants/route.ts) (+ `[variantId]` route)
- Product variant UI under `src/components/products/` and [src/app/[locale]/(dashboard)/products/[id]/](src/app/[locale]/(dashboard)/products/[id]/)
- [src/types/product.ts](src/types/product.ts), `docs/database-schema.md`, `messages/fr.json`, `messages/ar.json`
