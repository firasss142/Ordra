# Agent Product Sheet — product knowledge + verification for confirmation agents

> **First implementation step:** copy this file to `Ordra/plans/agent-product-sheet.md` (per the repo rule "Save every Claude-created plan under `/plans`").

## Context

Confirmation agents work orders by phone. Today they see almost nothing about the product they are selling: name, variant label, a 40px thumbnail, quantity, unit price. That is the whole picture.

Three concrete gaps:

1. **No knowledge.** `products.description` exists in the DB and is editable in [ProductEditForm.tsx](Ordra/src/components/products/ProductEditForm.tsx) but is rendered nowhere. There is no notes field anywhere in the schema (verified across all 145 migrations). An agent cannot answer "what does it actually do?", "is there a cheaper pack?", "what do I say when they object to the price?"
2. **No verification.** Nothing tells the agent that the order's price no longer matches the catalogue, that stock hit zero, that the product was deactivated, or that the order was never mapped to a catalogue product at all (`mapping_status != 'mapped'` → `product_id` is null).
3. **No media.** One image per product, hard-locked by the deterministic path in [product-images.ts:25](Ordra/src/lib/product-images.ts#L25) (`image.<ext>`, `upsert: true`). Meanwhile the Converty source data being imported already carries 3-size galleries per product.

Outcome: an agent on a call can, in under 5 seconds and without leaving the order, see what they must know about this product, be warned when the order disagrees with the catalogue, and send the customer a photo and price over WhatsApp to close a hesitant sale.

**Design authority:** `docs/design-system.md` (light surfaces, white cards, `surface-*`/`ink-*`/`line-*` tokens, functional color on status only). The `.claude/skills/design` skill describes a dark/neon marketing system that the shipped app does not use — do not follow it here.

---

## Constraints that shape the design

- **Agents must not gain product-browsing access.** [product-permissions.ts:31](Ordra/src/lib/product-permissions.ts#L31) returns `false` for `agent`, and `/products` is not in their route allow-list in `src/lib/role-permissions.ts`. Keep both as-is.
- **Costs must never reach an agent.** `unit_cogs` is `REVOKE`d at column level (`20260819000003_reconcile_products_unit_cogs.sql`). Every agent-facing query uses an explicit column list — never `select("*")`.
- **Products are super_admin-write-only at the DB layer** (`20260422_product_stock_lockdown.sql`). Market-manager writes require a `SECURITY DEFINER` carve-out. Precedent: `toggle_product_active` (`20260422_toggle_product_active_rpc.sql`).
- **`products.image_url` is consumed in three places** — [agent/queue/route.ts:48](Ordra/src/app/api/agent/queue/route.ts#L48), `api/orders/list/route.ts`, and [AddProductPicker.tsx:316](Ordra/src/components/queue/AddProductPicker.tsx#L316). It must keep working untouched.
- TDD is non-negotiable; all UI text via `next-intl` (fr + ar, RTL for Libya) using logical properties.

---

## Data model

### 1. Product content columns (new migration)

```sql
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS agent_brief TEXT,
  ADD COLUMN IF NOT EXISTS agent_brief_tone TEXT NOT NULL DEFAULT 'info'
    CHECK (agent_brief_tone IN ('info','warning','critical')),
  ADD COLUMN IF NOT EXISTS agent_notes TEXT,
  ADD COLUMN IF NOT EXISTS agent_content_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_content_updated_by UUID REFERENCES users(id);

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS agent_note TEXT;
```

Three distinct content layers, deliberately:
- `description` (**existing, currently unrendered**) — customer-facing: what the product is.
- `agent_brief` — the pinned must-know. One line, capped at 280 chars app-side. Always visible on the order, no click.
- `agent_notes` — the body: objections, packs, what not to say. Plain text, `whitespace-pre-wrap`, no markdown renderer in v1.
- `product_variants.agent_note` — one short line per pack tier (≤160 chars). Variants here are quantity/bundle tiers, so the upsell script belongs at this level.

### 2. `product_media` (new table)

```sql
CREATE TABLE product_media (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  market_id    UUID NOT NULL REFERENCES markets(id),   -- denormalized for RLS
  storage_path TEXT NOT NULL,
  url          TEXT NOT NULL,
  alt          TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_media_product ON product_media(product_id, position);
```

No unique constraint on `position` — reordering sends the full ordered id array and the server rewrites `0..n-1` in one pass.

New storage path scheme breaks the singular lock: `${market_id}/${product_id}/${media_id}.${ext}`.

**`products.image_url` stays as a denormalized cover pointer**, rewritten by the media API whenever position 0 changes. This is what keeps the queue card, order list, and product picker working with zero changes. Backfill in the same migration: one `product_media` row at position 0 for every product that already has an `image_url`.

RLS on `product_media`: SELECT for same-market (and super_admin); INSERT/UPDATE/DELETE for super_admin + same-market `market_manager`. New table, so no lockdown to work around.

### 3. Manager write path (new RPC)

```sql
CREATE FUNCTION update_product_agent_content(
  p_product_id uuid, p_description text, p_agent_brief text,
  p_agent_brief_tone text, p_agent_notes text, p_actor_id uuid
) RETURNS products SECURITY DEFINER
```

Asserts caller is `super_admin`, or a `market_manager` whose `market_id` matches the product. Touches **only** the content columns — never costs, stock, name, sku, or price. Stamps `agent_content_updated_at/by`. Mirror the shape of `toggle_product_active`.

---

## Permissions

Add to [product-permissions.ts](Ordra/src/lib/product-permissions.ts):

```ts
// Content = description, agent brief/notes, media, variant notes.
// Deliberately NOT costs, stock, name, sku, or price — those stay super_admin-only.
export function canEditProductContent(role, targetMarketId, actorMarketId): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") return targetMarketId === actorMarketId;
  return false;
}
```

`canViewProducts` and `canManageProducts` are unchanged.

---

## Agent read path

**`GET /api/orders/[id]/product-sheet`** — order-scoped, not product-scoped. This is the key security decision: it reuses the "agent owns this order" check that every agent route already applies (`order.assigned_to !== actor.id → 404`, as in `confirm`/`no-answer`/`transition`), returns the order-dependent verification checks in the same round trip, and never grants agents a general product-read capability.

Response:

```ts
interface ProductSheet {
  product: {
    id; name; description; agent_brief; agent_brief_tone; agent_notes;
    agent_content_updated_at; is_active; current_stock; low_stock_threshold; default_price;
  } | null;                                    // null when the order is unmapped
  raw_product_name: string;                    // order.product_name fallback
  media:    { id; url; alt; position }[];
  variants: { id; label; quantity; display_price; is_active; agent_note }[];
  checks:   SheetCheck[];
  currency: string;
}
```

Explicit column list only. `unit_cogs`, `packing_cost`, `confirmation_processing_cost`, `initial_stock`, `damaged_return_count` must not appear. Stock *is* included — agents already see it today via `/api/products/search` in [AddProductPicker.tsx:348](Ordra/src/components/queue/AddProductPicker.tsx#L348).

Mirror the actor/role check used in `src/app/api/products/search/route.ts` (read it first — it is the one existing route agents reach that touches `products`).

---

## Verification checks

New pure module `src/lib/products/sheet-checks.ts` — no I/O, fully unit-testable:

```ts
export type SheetCheckCode =
  | "unmapped"          // order.product_id is null / mapping_status !== 'mapped'
  | "price_mismatch"    // order unit_price ≠ variant display_price (or default_price)
  | "out_of_stock"      // current_stock <= 0
  | "low_stock"         // 0 < current_stock <= low_stock_threshold
  | "product_inactive"  // is_active = false
  | "variant_inactive"; // the order's variant is deactivated

export interface SheetCheck {
  code: SheetCheckCode;
  severity: "info" | "warning" | "critical";
  values?: Record<string, unknown>;   // e.g. { orderPrice, catalogPrice }
}

export function checkProductSheet(order, product, variants): SheetCheck[]
```

`unmapped` is the one that matters most operationally — without it the sheet is simply blank and the agent has no idea why.

---

## UI

### 1. Pinned brief — always visible, zero clicks

New `src/components/queue/OrderDetailPanel/ProductBriefBanner.tsx`, rendered inside the existing `AlertBanners` region of [OrderDetailPanel/index.tsx](Ordra/src/components/queue/OrderDetailPanel/index.tsx) — it inherits placement and adds no new layout concept.

Shows `agent_brief` plus any `warning`/`critical` check. Tone maps to the existing `status-warning*` / `status-criticalBg` tokens (functional color on status is sanctioned by the design system). Renders `null` when there is no brief and no non-info check.

### 2. Full sheet — stacked drawer

New `src/components/queue/ProductSheetDrawer.tsx`. Opens over `OrderDetailPanel` from the same edge, one z-index level up. `Esc` closes, focus trapped.

Opened by clicking the product name/thumbnail in [OrderItemsCard.tsx:155](Ordra/src/components/queue/OrderDetailPanel/OrderItemsCard.tsx#L155), or the `p` key — register alongside the existing `1`/`2`/`3`/`4`/`j`/`k` handlers in `QueuePage.tsx:586` and add the entry to `ShortcutsOverlay`.

Contents, top to bottom:
1. Media gallery — horizontal thumbnail strip, click opens a lightbox. Lazy-loaded, `object-cover`.
2. Name · cover price · stock badge.
3. Full check strip (including `info`-level).
4. `description` — labelled as customer-facing.
5. `agent_notes` — labelled as internal, visually separated.
6. Pack tiers — each variant: label, `display_price`, `agent_note`.
7. Footer: "updated {date}".

**Extract the stock-badge tone logic** now duplicated at [OrderItemsCard.tsx:136-146](Ordra/src/components/queue/OrderDetailPanel/OrderItemsCard.tsx#L136-L146) and [AddProductPicker.tsx:206-221](Ordra/src/components/queue/AddProductPicker.tsx#L206-L221) into one shared helper rather than writing it a third time.

### 3. Share with the customer

On each media item and in the sheet footer:
- **Copy image link** — `navigator.clipboard.writeText(url)`; the `product-images` bucket is public so the URL works as-is.
- **Send on WhatsApp** — `https://wa.me/<msisdn>?text=<encoded>` in a new tab, prefilled with product name + price + cover URL, phone from `order.customer_phone`.

⚠️ Needs a new `toWhatsappNumber(phone, marketCode)` helper. Stored numbers are local format (`memory/dexpress-dispatch-failure-modes.md` records that Dexpress requires Libyan `09XXXXXXXX`), but `wa.me` needs full international — `216…` for TN, `218…` for LY. Unit-test both. The message template is translated (`fr`/`ar`), not hardcoded.

### 4. Manager authoring

Extend [ProductEditForm.tsx](Ordra/src/components/products/ProductEditForm.tsx) with a "Fiche agent" group: promote the existing `description` field into it, add `agent_brief` (single line + char counter + tone select) and `agent_notes` (textarea). Add per-variant `agent_note` to the variants editor.

Replace `ProductImagePicker` with `ProductMediaManager` — multi-upload, drag reorder, set-cover, delete. Reuse `decodeImageFile()` from `src/lib/client/image.ts` and `uploadImageDataUrl()` from [upload-image.ts](Ordra/src/lib/upload-image.ts) (bucket-agnostic already; only the path scheme changes).

New routes: `GET/POST /api/products/[id]/media`, `PATCH /api/products/[id]/media` (reorder), `DELETE /api/products/[id]/media/[mediaId]`. All gated by `canEditProductContent`; managers route through the RPC, storage writes through `createAdminClient()`.

---

## Fix while here

- `Product` in `src/types/product.ts` is missing `description` and `initial_stock` (both exist in the DB). Add them.
- `ProductVariant` declares `created_at`/`updated_at`, but the table has neither (`001_initial_schema.sql:197`). Remove them.
- `ProductCreateForm.tsx` has no description field.
- **Orphaned blobs:** the current "remove image" path nulls the column without deleting the storage object. The new `DELETE …/media/[mediaId]` must delete the object too.
- Add the `productSheet` i18n namespace to **both** `fr.json` and `ar.json` — Arabic is already ~59 keys behind; do not widen the gap.

---

## Phasing

| Phase | Scope | Status |
|---|---|---|
| **1** | Content columns + RPCs + `canEditProductContent` + `sheet-checks` + `product-sheet` route + brief banner + drawer, reusing the single existing `image_url`. Manager authoring incl. per-pack notes. | **Shipped** on `feat/agent-product-sheet` |
| **3** | Copy-link and WhatsApp share, incl. `toWhatsappNumber`. | **Shipped** (pulled forward — it was cheap once the drawer existed) |
| **2** | `product_media` table + bucket path change + backfill + `ProductMediaManager` + gallery/lightbox. | **Not started** |

Phase 2 was deliberately left last. The drawer already renders `media[]` as an
array and the route already returns one, so adding the table means changing
where that array is built — not reshaping the API or the UI.

### Deviations from the original design, and why

1. **The product read uses the admin client, not the caller's session.**
   `products_select` (20260417) restricts agents to `is_active = true` rows, so
   a deactivated product would return nothing and be indistinguishable from an
   unmapped order — precisely the case the agent most needs warning about.
   Authorization happens on the *order* instead, and the projection is an
   explicit column list so costs cannot leak.

2. **`orders` has no `variant_id` column.** Only `variant_label` and the
   storefront mapping's `product_variant_id`. (The `OrderDetail` TypeScript
   type declaring `variant_id` is drift.) The route resolves the ordered
   variant from `order_items.variant_id` → `orders.product_variant_id` →
   label match.

3. **The panel suspends its own Escape handler while the drawer is open.**
   Both listeners sit on `document`, and `Sheet` uses `stopPropagation`, which
   does not stop sibling listeners on the same element — one Escape would
   otherwise collapse both layers.

4. **`update_product_agent_content` needs an explicit NULL-actor guard.**
   `NULL NOT IN (...)` yields `NULL`, which `IF` treats as false, so an unknown
   `p_actor_id` falls through the role check to the `UPDATE`. Verified against a
   scratch Postgres. **`toggle_product_active` and `adjust_product_stock` have
   the same shape and were left untouched — worth a follow-up.**

5. **Managers can now reach `/products/[id]/edit`.** It previously redirected
   every non-super-admin. The form renders only the "Fiche agent" section for
   them and skips the cost PATCH entirely.

---

## Verification

Tests first, per `CLAUDE.md`.

**Unit** — `sheet-checks.test.ts` covering all six codes plus the null-product path; `toWhatsappNumber` for TN and LY formats; media reorder position assignment.

**Component** — `ProductBriefBanner` renders `null` when there is no brief and no non-info check; `ProductSheetDrawer` renders the unmapped state from `raw_product_name`; `Esc` closes and restores focus.

**Route** — agent on own order → 200, and assert the JSON body contains **no** `unit_cogs`/`packing_cost`; agent on another agent's order → 404; `market_manager` writing a cross-market product → 403; `agent` PATCHing product content → 403.

**Manual end-to-end**
1. `manager.tn@oms.local / testpass123` → edit a product → set brief, tone, notes, a variant note, upload 3 images, reorder.
2. `agent1.tn@oms.local / testpass123` → open the queue → confirm the brief banner shows on the order card without a click; press `p`; confirm gallery, description, notes, pack tiers, and check strip; confirm the WhatsApp link opens with a correctly formatted number.
3. Regression: queue card thumbnail, `/orders` list, and the add-product picker still show the cover image.
4. Negative: as the agent, hit `/api/products` and `/{locale}/products` → still 403 / redirect.
5. Seed note: TN data is dated Feb–Apr 2026, LY May–Jul 2026 (`memory/dashboard-empty-metrics-seed-timeline.md`) — widen date filters when hunting for test orders.

**Gates** — `npm run typecheck`, `npm run lint`, `npm run test:run`, `npm run build`.
