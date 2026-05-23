# Plan — Fix Add-Product on Order Details (all roles)

> **Branch:** `feat/add-product-picker-and-perf` (create from `main`)
> **Durable copy lives at:** `plans/add-product-picker-and-perf.md` in the project root (per personal CLAUDE.md rule).
> This file at `~/.claude/plans/` is the working scratchpad; the project copy is the source of truth.

## Context

Today the "Add product" affordance on the order details panel is slow and visibly broken across roles:

- **Super_admin sees the wrong market's products.** `OrderDetailPanel` calls `/api/products/search` with no `market_id` query param. The route falls back to `actor.market_id` for super_admin — so opening a Libya order while the super_admin's home is Tunisia returns Tunisia products. Flipping between two orders in different markets reuses a single SWR cache entry and produces flickering/wrong results.
- **The "+ Add product" button is dumb.** It re-POSTs the *first* line-item's product as a duplicate row. To actually add a different product the user has to add a row, then re-pick on the new row's Combobox — two network roundtrips and two full order revalidations.
- **Combobox flashes empty on every open.** It resets `asyncOptions` to `null` on open, then re-runs `loadOptions(debouncedQuery)` after the 200ms debounce — even though the products list is already in memory.
- **No preload on the dashboard.** `QueuePage` warms `/api/products/search`; `OrdersPageClient` does not — so the manager/super_admin's first click on an order pays a cold fetch.
- **No DB index** on `(market_id, is_active, name)` — full scan on every cold fetch.

Goal: make adding a product **fast** (cached, optimistic, no flash), **market-correct for every role**, and replace the dumb button with a polished picker that fits the project's Shopify-inspired design system.

## A. Correctness fixes

### A1. Make the products SWR key market-aware (all roles)
**File:** `src/components/queue/OrderDetailPanel.tsx` (around lines 340-344)

```ts
const productsKey = canEdit && order
  ? `/api/products/search?market_id=${order.market_id}`
  : null;
const { data: productsData, mutate: mutateProducts } = useSWR(productsKey, fetcher, {
  revalidateOnFocus: false,
  dedupingInterval: 60 * 1000,
});
```

Per-market SWR cache entries → flipping between TN and LY orders shows the correct list with no flash.

### A2. Server: accept + validate `market_id` for non-super_admin
**File:** `src/app/api/products/search/route.ts` (lines 14-17)

```ts
const requested = req.nextUrl.searchParams.get("market_id");
let marketId: string;
if (actor.role === "super_admin") {
  marketId = requested ?? actor.market_id ?? "";
} else {
  if (requested && requested !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  marketId = actor.market_id ?? "";
}
if (!marketId) return NextResponse.json({ data: [] });
```

Also extend the `select` to include `image_url` (column already exists per `20260612000002_products_image_url.sql`) so the picker can show thumbnails.

## B. Performance

### B1. Postgres index
**New file:** `supabase/migrations/20260721000001_products_market_active_name_index.sql`

```sql
CREATE INDEX IF NOT EXISTS idx_products_market_active_name
  ON products (market_id, is_active, name);
```

Covers `WHERE market_id=? AND is_active=true ORDER BY name`. `ilike '%q%'` cannot use a b-tree — we filter client-side anyway (see C below), so no trigram needed now.

### B2. Preload products on the orders dashboard
**File:** `src/app/[locale]/(dashboard)/orders/OrdersPageClient.tsx`

Mirror `QueuePage.tsx:195` — add a warm-cache `useSWR` keyed on the effective market. For super_admin with `scope === 'all'`, skip preload (we cannot know the order's market until they open one; per-market entry will populate on first open). Also dynamic-import the new picker so its chunk is ready before the user clicks "+ Add product".

### B3. Combobox: don't drop async results on reopen
**File:** `src/components/ui/Combobox.tsx` (lines 52-71)

Remove `setAsyncOptions(null)` from the open-effect. Keep query reset and focus. The `debouncedQuery` effect still refreshes the list — but cached options stay visible during the refresh, killing the empty-list flash.

### B4. Optimistic insert after POST `/api/orders/[id]/items`
**File:** `src/hooks/useOrderMutation.ts`

Add a sibling helper `addItemOptimistic(item)` that appends a synthetic row to the SWR cache (`{ data: { ...order, order_items: [...order.order_items, tempItem] } }`), POSTs, then replaces the temp row with the server-returned `{ data: newItem }`. Reuse the monotonic `commitIdRef` pattern already in this hook.

## C. Beautiful AddProductPicker

**New file:** `src/components/queue/AddProductPicker.tsx`

**Props**
```ts
{
  orderId: string;
  marketId: string;
  currentItemIds: (string | null)[];   // dim already-added rows
  onClose: () => void;
  onAdded: (item: OrderItem) => void;
}
```

**State:** `query`, `highlighted`, `submitting`, `error`.

**Data:** same SWR key as the panel (`/api/products/search?market_id=${marketId}`) — dedupes against the panel's fetch, so opening the picker is **free** (cache hit).

**Filtering:** purely client-side `name.toLowerCase().includes(query.toLowerCase())`. No debounce, no network. The full list is a few hundred items at most per market.

**Key effects**
- Autofocus the input on mount via ref.
- Reset `highlighted` to 0 whenever `filtered.length` or `query` changes.
- Esc closes; click on backdrop closes; Enter selects `filtered[highlighted]`.

**Decision — popover not modal.** Popover anchored under the "+ Add product" button matches the inline-edit feel of the receipt area and avoids z-index fights with `PostCallActionSheet`. Modal would be heavier and break the receipt rhythm. Cost: less space on small screens; CLAUDE.md declares desktop-first, so acceptable.

**Render structure** (Tailwind utility classes, logical properties for RTL, no gradients/decoration, one soft shadow per Combobox precedent):

```
<div role="dialog" aria-label={t('pickProduct')}
     className="absolute z-50 w-80 bg-surface-card border border-line-subtle rounded-card shadow-popover">
  <input ref={inputRef} role="combobox" aria-expanded
         placeholder={t('searchProducts')}
         className="w-full h-9 px-3 text-[14px] border-b border-line-subtle outline-none" />

  <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
    {filtered.map((p, i) => (
      <li role="option" aria-selected={i===highlighted}
          className="flex items-center gap-2.5 px-3 py-2 cursor-pointer
                     hover:bg-surface-hover aria-selected:bg-surface-selected">
        {p.image_url
          ? <img src={p.image_url} className="w-7 h-7 rounded-md object-cover bg-surface-subdued" />
          : <div className="w-7 h-7 rounded-md bg-surface-subdued flex items-center justify-center
                             text-[11px] font-semibold text-ink-secondary">
              {p.name[0]?.toUpperCase()}
            </div>}
        <div className="flex-1 min-w-0">
          <div className="text-[14px] text-ink-primary truncate">{p.name}</div>
          <div className="text-[12px] text-ink-secondary tabular-nums">{p.unit_price} {currency}</div>
        </div>
        <StockBadge stock={p.current_stock} /> {/* green/inStock | warn/stockLeft | critical/outOfStock */}
      </li>
    ))}
    {filtered.length === 0 && (
      <li className="px-3 py-6 text-center text-[13px] text-ink-muted">{t('noResults')}</li>
    )}
  </ul>

  <div className="px-3 py-2 border-t border-line-subtle text-[11px] text-ink-muted">
    {t('kbdHints')} {/* ↑↓ navigate · ⏎ add · esc close */}
  </div>
</div>
```

**onSelect(product)**: guard `submitting`; call `onAdded(optimistic)`; POST `/api/orders/${orderId}/items` with `{ product_id, quantity: 1, unit_price: product.unit_price }`; on 2xx call `onClose()`; on error set `error` and keep popover open.

**Wire-up in OrderDetailPanel.tsx (replaces current lines 1340-1367):**
```tsx
const [pickerOpen, setPickerOpen] = useState(false);
// dynamic import to keep panel bundle small
const AddProductPicker = useMemo(
  () => dynamic(() => import('./AddProductPicker').then(m => m.AddProductPicker), { ssr: false }),
  []
);

{canEdit && (
  <div className="relative">
    <button type="button" onClick={() => setPickerOpen(o => !o)}
            className="inline-flex items-center justify-center gap-1.5 w-full text-[12px] font-medium
                       text-ink-secondary border border-dashed border-line-strong rounded-card py-1.5
                       hover:text-ink-primary hover:border-ink-primary hover:bg-surface-hover
                       transition-colors duration-fast mt-1">
      <Plus size={12} strokeWidth={2} /> {t('addProduct')}
    </button>
    {pickerOpen && order && (
      <AddProductPicker
        orderId={order.id}
        marketId={order.market_id}
        currentItemIds={items.map(i => i.product_id)}
        onClose={() => setPickerOpen(false)}
        onAdded={addItemOptimistic}
      />
    )}
  </div>
)}
```

## D. TDD — tests to write first

1. **`src/components/queue/__tests__/AddProductPicker.test.tsx`** (new)
   - Renders products from SWR scoped to `marketId`.
   - Autofocuses the input.
   - Filters as the user types (no debounce).
   - ArrowDown then Enter selects the highlighted product and POSTs to `/api/orders/[id]/items`.
   - Esc invokes `onClose`.
   - Renders `noResults` when filter empties the list.
   - Calls `onAdded` **before** the POST resolves (optimistic).
   - Surfaces a server error string on 4xx/5xx and keeps popover open.

2. **`src/app/api/products/search/route.test.ts`** (extend existing)
   - super_admin without `market_id` → uses actor's home.
   - super_admin with `market_id` → uses provided.
   - manager/agent without param → ok, scoped to their market.
   - manager/agent with mismatching param → **403**.
   - manager/agent with matching param → ok.
   - Result is sorted by name, filtered to `is_active=true`, and includes `image_url`.

3. **`src/components/queue/__tests__/OrderDetailPanel.addProduct.test.tsx`** (new)
   - Clicking "+ Add product" opens the picker (does NOT silently duplicate the first item).
   - SWR fetches `/api/products/search?market_id=${order.market_id}` (regression test for the wrong-market bug).

4. **`src/hooks/__tests__/useOrderMutation.test.ts`** (extend if exists, else create)
   - `addItemOptimistic` appends a synthetic row, POSTs, replaces with server data.
   - Race: two adds in flight — both end up in cache in commit order.

## E. Files summary

**Modified**
- `src/components/queue/OrderDetailPanel.tsx`
- `src/app/api/products/search/route.ts`
- `src/app/api/products/search/route.test.ts`
- `src/components/ui/Combobox.tsx`
- `src/app/[locale]/(dashboard)/orders/OrdersPageClient.tsx`
- `src/hooks/useOrderMutation.ts`
- `src/messages/fr.json` — add keys: `queue.addProduct` (already exists, verify), `queue.pickProduct`, `queue.searchProducts`, `queue.noResults`, `queue.outOfStock` (verify), `queue.inStock` (verify), `queue.stockLeft` (verify), `queue.kbdHints`
- `src/messages/ar.json` — same keys, Arabic translations

**New**
- `src/components/queue/AddProductPicker.tsx`
- `src/components/queue/__tests__/AddProductPicker.test.tsx`
- `src/components/queue/__tests__/OrderDetailPanel.addProduct.test.tsx`
- `supabase/migrations/20260721000001_products_market_active_name_index.sql`
- `plans/add-product-picker-and-perf.md` (durable copy of this plan)

## F. Existing utilities to reuse

- `fetcher` from `src/lib/swr-config.ts` (already imported by OrderDetailPanel).
- `useOrderMutation(orderId)` hook — extend it with `addItemOptimistic`.
- `computeOrderTotal` from `src/lib/calculations/order-total.ts` — already called by the items POST route. **Server-side only**, per project rule.
- `canEditOrder`, `EDIT_BLOCKED_STATUSES` from `src/lib/order-permissions.ts` — already gating the route.
- `Badge` from `src/components/ui/Badge.tsx` for the stock chip.
- Lucide icons: `Plus`, `Search`, `X` (already imported in OrderDetailPanel).

## G. Verification (E2E, manual)

1. **super_admin** (`admin@oms.local`):
   - Open a Libya order while super_admin's home is Tunisia → picker shows **Libya** products (regression test for the bug the user reported).
   - Open a Tunisia order in the same session → picker swaps to Tunisia products with **no flash** (per-market cache).
2. **market_manager TN** (`manager.tn@oms.local`):
   - Open a TN order, add a TN product → succeeds.
   - In DevTools, send `GET /api/products/search?market_id=<LY-id>` → **403**.
3. **agent TN** (`agent1.tn@oms.local`):
   - Open an assigned order, click "+ Add product" → picker opens **instantly** (cached by panel SWR).
   - Type 2 letters → results appear in 0 ms (client-side filter).
   - ArrowDown + Enter → product added, line appears **before** the server responds (optimistic), totals reconcile on revalidate.
4. **RTL** (ar locale, Libya agent):
   - Picker opens to the inline-end side, text right-aligned, no horizontal scroll, logical properties only.
5. **Network**:
   - Cold-load `/orders` → exactly **one** `/api/products/search?market_id=…` request preloaded.
   - Subsequent panel opens → **no** new request (60s dedupe).
6. **DB**:
   - `EXPLAIN ANALYZE SELECT … FROM products WHERE market_id=? AND is_active=true ORDER BY name` → uses `idx_products_market_active_name`.

## H. Tradeoffs (decisions taken)

- **Popover vs modal** → popover. Lighter, matches sibling Combobox, avoids z-stack conflict with PostCallActionSheet.
- **Client-side filter vs server `q`** → client-side. Full list already cached; removes 200ms debounce + per-keystroke round-trip. If catalogs ever exceed ~5k SKUs per market, switch to server `q` with debounce + trigram index.
- **Keep Combobox for editing existing items** → yes. Inline display-mode is useful; out of scope to replace. Only fix the reset-on-open bug (B3).
- **ETag on `/api/products/search`** → deferred. `Cache-Control: private, max-age=60` + 60s SWR dedupe already prevents repeats inside the window. Revisit if logs show repeated 200s under 60s.
- **Migrate optimistic logic into `useOrderMutation`** → yes (single hook owns order-mutation lifecycle), rather than scattering `mutate()` calls in the picker.
