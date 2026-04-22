# Agent Order Panel — Inline Editing & Product Swap

## Context

The agent's core job is one phone call: pick up, confirm, and — the thing that happens most often — **edit the order while the customer is on the line**. Today that takes 3+ clicks just to change an address (card → Edit button → field → Save button), and **the product cannot be edited at all** (PATCH whitelists only 5 fields; any product change requires reopening the order and recreating it by hand).

You want the agent interface to feel effortless: simple, easy to learn, easy to type. This plan turns the order detail panel into an inline-editable surface with autosave on blur/Enter, adds a proper product swap flow, introduces canonical cities per market, and keeps everything keyboard-optional (mouse-first, shortcuts as sugar).

**Out of scope (deliberately):** post-call outcome flow (confirm/reject/callback modal) — works today, agents know it, and you ranked inline editing as pain #1. Will be a separate session.

---

## Decisions locked from our conversation

| Decision | Choice |
|---|---|
| Edit surface | Inline fields in the existing right-side detail panel (no Edit button) |
| Autosave trigger | On blur + Enter. Optimistic UI, rollback on 4xx/5xx |
| Keyboard model | Mouse-first, every action has a shortcut, visible hint chips |
| City field | Autocomplete from a new `cities` table, per-market |
| Product swap | Same-catalog only (market-isolated). Variant + qty. Live stock badge |
| Pricing | Auto-recalc from `product.unit_price × qty`, server-side. No manual override this pass |

---

## What changes — user-visible

### Before (today)
1. Click card → panel opens (read-only)
2. Click **Edit** → form slides in with 5 fields, no autofocus
3. Type into field → click **Save** → spinner → form closes
4. Product not editable at all — reopen + re-create workaround

### After (this plan)
1. Click card → panel opens. Every editable field shows a faint hover border; clicking turns it into an input with cursor ready.
2. Tab or Enter commits. Blur commits. Escape reverts. Last-saved state shown inline (`Saved · 2s ago`).
3. **City** is an autocomplete combobox. Typing filters canonical list; arrow keys + Enter select.
4. **Product** row shows product name + variant + qty. Clicking product name opens a searchable picker (same pattern as city combobox). Variant is a select. Qty has +/− steppers. Total recalcs live.
5. Small `[E]` hint chip next to the section label — pressing `E` with the panel focused moves focus to the first editable field. No modal. No Save button.

---

## Architecture — how we get there

### New reusable primitives (`src/components/ui/`)
Today's `ui/` only has `Avatar.tsx`. We build lean primitives we need right now:

- **`InlineField.tsx`** — text/tel/number field. Props: `value`, `onCommit(value)`, `validate?`, `type`, `placeholder`. Handles blur/Enter/Escape, optimistic display, error rollback with shake + red border for 2s. Used for name, phone, address, qty.
- **`Combobox.tsx`** — searchable list. Props: `value`, `options: {id, label, hint?}[]`, `onCommit`, `loadOptions?(query)`. Arrow keys, Enter, Escape. Used for city and product.
- **`StepperField.tsx`** — number with +/− buttons, keyboard arrows, min/max. Wraps InlineField.

All three use Tailwind utility classes (not inline styles — `src/components/CLAUDE.md` mandates this; the current panel's inline styles are legacy and we won't add more). Logical properties (`ps/pe/ms/me`) for RTL.

### New hook
**`src/hooks/useOrderMutation.ts`** — wraps PATCH with SWR `mutate`. Exposes `commit(field, value)` that:
1. Applies optimistic update to the SWR cache for `/api/orders/{id}`
2. Fires PATCH
3. On error, reverts cache and surfaces error so the field can shake
4. Debounces only identical repeated commits within 200ms (double-blur safety)

### Refactor: `src/components/queue/OrderDetailPanel.tsx`
Remove the modal-style edit form (lines 392–480 and the `editMode`/`editFields` state block 132–142, 268–307). Replace read-only `DetailRow` rows for editable fields with `InlineField`/`Combobox` components wired to `useOrderMutation`. Keep history, reopen modal, and fulfillment override (manager-only) exactly as they are — those aren't the agent's pain point.

Read-only when `EDIT_BLOCKED_STATUSES.has(order.status)`: components accept a `readOnly` prop and render the value as plain text. Reopen button stays.

---

## Backend changes

### 1. PATCH `/api/orders/[id]` — extend
**File:** [src/app/api/orders/[id]/route.ts](src/app/api/orders/[id]/route.ts)

Current `PATCHABLE_FIELDS` at [line 61](src/app/api/orders/[id]/route.ts#L61): `customer_name, customer_phone, customer_address, customer_city, quantity`.

Add: `product_id`, `variant_id`, `city_id`.

When `product_id` or `variant_id` changes:
- Validate product belongs to `order.market_id` (market isolation — reuse the existing market check pattern)
- Validate product `is_active = true`
- Validate variant (if provided) belongs to product and is active
- Validate `current_stock > 0` (reuse the same stock guard the confirm flow uses at [confirm/route.ts:43](src/app/api/orders/[id]/confirm/route.ts#L43))
- Refetch the new product's `unit_price` and re-derive `total_price = unit_price × quantity` (extend the existing qty-recalc at [route.ts:117-123](src/app/api/orders/[id]/route.ts#L117-L123))
- Update `product_name` and `variant_label` snapshots on the order row (orders already stores snapshots — confirmed via `confirm/route.ts`)

When `city_id` changes: validate it belongs to the order's market. Also update the `customer_city` text snapshot to keep downstream compatibility (carrier adapters, CSV export, queue filters all read `customer_city`).

Keep the existing `order_history` append: one row per PATCH, note = JSON of changed fields (current behavior at [route.ts:128-133](src/app/api/orders/[id]/route.ts#L128-L133) already does this — just make sure the new fields show up in the diff with human-readable values, not raw UUIDs).

### 2. New migration: `cities` table
**File:** `supabase/migrations/NNN_cities.sql`

```sql
CREATE TABLE cities (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id   UUID      NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  name        TEXT      NOT NULL,
  name_ar     TEXT,                            -- optional Arabic display
  is_active   BOOLEAN   NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (market_id, name)
);

CREATE INDEX idx_cities_market_active ON cities(market_id, is_active);

ALTER TABLE cities ENABLE ROW LEVEL SECURITY;
-- RLS: same market-isolation pattern as products/orders
-- super_admin: all; market_manager: own market; agent: own market read-only
```

Seed a minimal starter list (Tunis, Sfax, Sousse, Bizerte, Kairouan, Nabeul, Gabès for TN; Tripoli, Benghazi, Misrata, Zawiya, Bayda, Tobruk for LY) in the migration. Managers can extend via a future settings page (out of scope now — seed is enough to ship).

Add `orders.city_id UUID NULL REFERENCES cities(id)` — **nullable**, so all existing orders keep working. New edits set it; `customer_city` text stays populated for back-compat.

### 3. New endpoint: `GET /api/cities`
**File:** `src/app/api/cities/route.ts`

Returns active cities for the caller's market. Query param `?q=` for server-side filter (case-insensitive prefix match on `name` and `name_ar`). Cached for 5 min. Small payload (<1KB per market) — client can also just fetch all active cities once and filter locally; server-side filter is a progressive-enhancement if the list grows.

### 4. New endpoint: `GET /api/products/search`
**File:** `src/app/api/products/search/route.ts`

Returns `{ id, name, unit_price, current_stock, variants: [{id, label, is_active}] }` filtered by market, `is_active=true`, optional `?q=` prefix match. Used by the product combobox.

Reuse the auth/market-isolation pattern from [src/app/api/orders/[id]/route.ts:17-38](src/app/api/orders/[id]/route.ts#L17-L38).

---

## Critical files

### Backend
- [src/app/api/orders/[id]/route.ts](src/app/api/orders/[id]/route.ts) — extend PATCHABLE_FIELDS, add product/variant/city validation + total_price recalc
- `src/app/api/cities/route.ts` — **new**
- `src/app/api/products/search/route.ts` — **new**
- `supabase/migrations/NNN_cities.sql` — **new**

### Frontend
- `src/components/ui/InlineField.tsx` — **new**
- `src/components/ui/Combobox.tsx` — **new**
- `src/components/ui/StepperField.tsx` — **new**
- `src/hooks/useOrderMutation.ts` — **new**
- [src/components/queue/OrderDetailPanel.tsx](src/components/queue/OrderDetailPanel.tsx) — remove edit-form block (132-142, 268-307, 392-480, 722-739 bottom Edit button), replace DetailRow usage for editable fields with the new primitives

### i18n
- `src/messages/fr.json` and `src/messages/ar.json` — add keys under `orders.detail`: `inlineSaved`, `inlineSaveError`, `pickProduct`, `pickCity`, `outOfStock`, `searchPlaceholder`, `pressEToEdit`

### Tests (TDD — failing first)
- `src/components/ui/InlineField.test.tsx` — blur commits, Enter commits, Escape reverts, error shake
- `src/components/ui/Combobox.test.tsx` — keyboard navigation, filter, commit
- `src/app/api/orders/[id]/patch.test.ts` — **extend** existing test with: product_id swap happy path, variant validation, cross-market product rejected (403/409), qty×unit_price recalc on product swap, city_id validation, stock=0 rejected
- `src/app/api/cities/route.test.ts` — **new** — market isolation, `?q=` filter
- `src/app/api/products/search/route.test.ts` — **new** — market isolation, inactive products excluded

---

## Execution order (so each step is shippable/reviewable)

### Step 1 — Backend foundation
1. Write failing tests for cities and products/search endpoints
2. Migration for `cities` + `orders.city_id` + seed data
3. Implement both GET endpoints
4. Extend PATCH tests with product/variant/city cases → extend PATCH handler

### Step 2 — UI primitives
5. Write failing tests for `InlineField`, `Combobox`, `StepperField`
6. Build the three primitives with Tailwind + logical properties (RTL-safe)
7. Build `useOrderMutation` hook with SWR optimistic pattern

### Step 3 — Wire the panel
8. Refactor `OrderDetailPanel.tsx` — replace edit form with inline primitives
9. Add `E` keyboard shortcut (integrate with existing queue shortcut system at `QueuePage.tsx`)
10. Add translations (fr + ar)

### Step 4 — Verify end-to-end
11. `npm run typecheck && npm run lint && npm test`
12. Manual test in browser (see verification below)

Each step is committable on its own. Step 1 ships without Step 2, Step 2 ships the primitives for reuse, Step 3 is the integration.

---

## Verification

### Automated
- `npm test` — all new and extended tests pass
- `npm run typecheck` — no errors
- `npm run lint` — clean
- `npm run build` — production build succeeds

### Manual (in browser, as agent)
Log in as `agent1.tn@oms.local / testpass123`:

1. **Address edit** — open any order in your queue, click the address field, type new address, press Tab. Field shows `Saved` inline within ~500ms. Refresh page → new address persisted.
2. **City autocomplete** — click city field, type "Sou". Dropdown shows "Sousse". Arrow down + Enter commits. Refresh → persisted.
3. **Product swap** — click product name, type part of another active product's name, select it. Variant selector updates to that product's variants. Total recalculates live. Refresh → new product + price on the order.
4. **Stock=0 guard** — use a product with `current_stock=0` (seed one for testing). Picker shows red "Out of stock" badge; clicking it blocks commit with an error banner.
5. **Market isolation** — as `agent1.tn`, open DevTools Network, try `PATCH /api/orders/{id}` with a `product_id` belonging to a Libya product (fetch one via super_admin). Expect 403/409.
6. **Edit-blocked statuses** — open a `confirmed` order. All fields render as read-only text. Reopen button still available.
7. **RTL** — log in as `agent1.ly`, repeat steps 1–3. Layout mirrors cleanly; combobox dropdowns open on the correct side.
8. **Keyboard flow** — from queue, press Enter to open an order, press `E`, first field is focused. Tab through all fields, every one commits on blur. Press Escape on an edited field to revert without saving.

### Regression checks (must still work)
- Confirm & dispatch flow (PostCallActionSheet) — unchanged
- Reopen flow — unchanged
- Fulfillment override (manager view) — unchanged
- Order history entries appear for every inline edit — unchanged contract
- CSV export reads `customer_city` text snapshot — unchanged

---

## Risks & what we explicitly avoid

- **Product snapshot vs reference.** Orders store `product_name`/`variant_label` as snapshots (confirmed in `confirm/route.ts`). Swapping product updates both snapshot fields AND `product_id`/`variant_id`. Downstream code that reads snapshots keeps working; code that reads references gets the fresh pointer. No schema split.
- **Existing `customer_city` string column.** We keep it populated from `cities.name` on edit so carrier adapters, CSV export, queue filters keep working without rewrite. `city_id` is additive, nullable, enriching.
- **Autosave race.** `useOrderMutation` tags each commit with a monotonic id; only the latest response updates the UI. Older in-flight responses are dropped.
- **No manual price override.** Per your decision — if a customer negotiates a discount on the call, that's a future session. Shipping that now would pull in audit/approval UX we don't need yet.
- **No "custom product" escape hatch.** Same reasoning — market isolation + catalog-only keeps the data clean.

---

## Note on plan location

Project convention in `CLAUDE.md` says plans live under `/Users/firaskarchoud/Documents/ORDER MANAGMENT SYSTEM/oms/plans`. Plan mode required me to write to `~/.claude/plans/my-main-vision-building-lovely-spring.md`. Once this plan is approved, copy it to the project `plans/` folder before implementation kicks off.
