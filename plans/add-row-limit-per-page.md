# Add row-limit (page-size) control to Orders + Products lists

## Context

Today, the Orders list is hardcoded to 10 rows per page ([src/hooks/useOrdersList.ts:54](src/hooks/useOrdersList.ts#L54)) and the Products list is hardcoded to 50 ([src/app/[locale]/(dashboard)/products/ProductsPageClient.tsx:60](src/app/[locale]/(dashboard)/products/ProductsPageClient.tsx#L60)). Both serve super_admin and market_manager; neither exposes a "rows per page" selector. Power users (super_admin reviewing all-markets) scrolling 10 rows at a time hits the next button constantly. Managers want bigger batches when triaging.

This change adds a "rows per page" dropdown to the **Orders** and **Products** lists for super_admin and market_manager. Page size is URL-synced (`?limit=N`), shareable, and resets to the per-page default on a fresh visit. Options: **10, 25, 50, 100**.

Out of scope:
- Users, Leads, Team Performance, Assignment Queue, Follow-ups — different paradigms (grouped/kanban/no pagination). Will revisit separately if requested.
- Agent queue, warehouse — agents have a curated queue; warehouse already has [WarehousePagination](src/components/warehouse/WarehousePagination.tsx) with its own selector.

## Approach

### 1. Shared `<Pagination>` component (new)
Create [src/components/shared/Pagination.tsx](src/components/shared/Pagination.tsx) — a single component that owns the prev/next buttons, the page indicator, and the page-size selector. It uses i18n keys (no hardcoded strings) and design-system styling that matches the current OrdersTable footer (white card, `#E1E3E5` borders, ink-primary buttons). RTL-safe (logical `start/end`, no `pl/pr`).

Props (mirrors what callers already compute):
```ts
{
  currentPage: number;            // 1-indexed
  pageSize: number;
  pageSizeOptions?: number[];     // default [10, 25, 50, 100]
  hasNext: boolean;
  hasPrev: boolean;
  // Optional — when known, show "Page X of Y · N entries"; else "Page X"
  totalItems?: number;
  // Optional — when known, show "from–to" range
  rangeFrom?: number;
  rangeTo?: number;
  onNext: () => void;
  onPrev: () => void;
  onPageSizeChange: (size: number) => void;
  isLoading?: boolean;
}
```

i18n keys (add under a single top-level `pagination` namespace in [src/messages/fr.json](src/messages/fr.json) and [src/messages/ar.json](src/messages/ar.json)):
```
pagination.previous          "Précédent" / "السابق"
pagination.next              "Suivant" / "التالي"
pagination.page              "Page {page}"
pagination.pageOf            "Page {page} sur {total}"
pagination.pageRange         "{from}–{to}"
pagination.entries           "{count} entrées"
pagination.rowsPerPage       "Lignes par page"
pagination.perPage           "{n} par page"
```

This unifies the duplicated keys at `orders.previous/next/page/pageOf/pageRange`, `products.pagination.*`, `leads.pagination.*`, etc. — but rather than touching every caller in this PR, we just add the new top-level keys and use them in the new component. Old keys keep working until a future cleanup.

### 2. Orders list
Add `limit` to the URL filter pipeline and thread it through the hook + API.

Files to modify:

- **[src/lib/orders/list-filters.ts](src/lib/orders/list-filters.ts)** — add `pageSize` to `OrderListFilters` (default `25`). Parse from `?limit=` in `parseFiltersFromSearchParams`, serialize when ≠ default in `filtersToSearchParams`. Validate against `[10, 25, 50, 100]`; fall back to default if invalid. The API-side `listQuerySchema` (line 178) already accepts `limit: 1..100` — no change needed. ⚠️ Important: do NOT add `pageSize` to `hasActiveFilters` or `resetFilters` (it's a view preference, not a content filter — resetting filters should not change page size).

- **[src/hooks/useOrdersList.ts](src/hooks/useOrdersList.ts)** — accept `pageSize` (from filters) instead of the hardcoded `PAGE_LIMIT = 10` (line 54). Export `PAGE_LIMIT` still as the default constant (`= 25`) so the page client can pass it as a fallback. Use `filters.pageSize` to set `params.set("limit", ...)` and reset `currentPage` to 1 whenever pageSize changes (the existing `useEffect` on `baseQuery` already covers this because `baseQuery` depends on filters).

- **[src/components/orders/OrdersTable.tsx](src/components/orders/OrdersTable.tsx)** — replace the inline prev/next pagination footer (lines 175–235) with `<Pagination>`. Accept new props `pageSize` and `onPageSizeChange` (replace existing `pageLimit`). Compute `rangeFrom = (currentPage - 1) * pageSize + 1`, `rangeTo = rangeFrom + rows.length - 1`. Pass through `currentPage`, `hasNext`, `hasPrev`, `onNextPage`, `onPrevPage`.

- **[src/app/[locale]/(dashboard)/orders/OrdersPageClient.tsx](src/app/[locale]/(dashboard)/orders/OrdersPageClient.tsx)** — pass `pageSize={filters.pageSize}` and `onPageSizeChange={(n) => update({ pageSize: n })}` to `<OrdersTable>`. Drop the `PAGE_LIMIT` prop (line 533); the component derives from `filters.pageSize`.

  ⚠️ **Server-side fallback caveat**: the server-rendered first page ([src/app/[locale]/(dashboard)/orders/page.tsx](src/app/[locale]/(dashboard)/orders/page.tsx)) is currently rendered at the default size. When the URL has `?limit=100`, SWR will refetch with the right size on the client — the SSR fallback is just a fast hydration shortcut. Acceptable: the user sees the default-size page for one frame, then SWR replaces it. If we want zero flicker, the server page must also read `?limit` from `searchParams` and pass the matched size into the fallback fetch. Recommend doing the server-side read too, it's two lines.

### 3. Products list
Products is already offset-paginated with a fully working API. Just add the URL sync + selector.

Files to modify:

- **[src/app/[locale]/(dashboard)/products/ProductsPageClient.tsx](src/app/[locale]/(dashboard)/products/ProductsPageClient.tsx)** —
  - Replace local `useState(1)` for `page` and the constant `PAGE_SIZE = 50` (line 60) with URL-synced state. Add a small helper at the top of the file (don't extract to a separate module — only two callers in this PR and Products is the only offset-paginated page):
    ```ts
    function useProductsUrlState() {
      const router = useRouter();
      const pathname = usePathname();
      const params = useSearchParams();
      const page = clamp(Number(params.get("page") ?? "1") || 1, 1, 9999);
      const limit = pickFromAllowed(Number(params.get("limit") ?? "25"), [10, 25, 50, 100], 25);
      const setQuery = (patch: { page?: number; limit?: number }) => {
        const next = new URLSearchParams(params);
        if (patch.page != null) patch.page === 1 ? next.delete("page") : next.set("page", String(patch.page));
        if (patch.limit != null) patch.limit === 25 ? next.delete("limit") : next.set("limit", String(patch.limit));
        router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
      };
      return { page, limit, setQuery };
    }
    ```
  - Use `limit` in the SWR key string at line 104 instead of `PAGE_SIZE`.
  - When `status`/search changes (lines 290–294), call `setQuery({ page: 1 })` instead of `setPage(1)`.
  - Replace the inline pagination footer (lines 390–410) with `<Pagination>`. Compute `rangeFrom = (page - 1) * limit + 1`, `rangeTo = (page - 1) * limit + filteredProducts.length`, pass `totalItems = productsData?.pagination?.total`.
  - On `onPageSizeChange`: `setQuery({ page: 1, limit: n })` (reset to page 1 on size change).

  Note: client-side filtering (lines 134–151) means `filteredProducts.length` can be smaller than the page payload. That's a pre-existing display quirk, not introduced here. Leave it.

### 4. i18n
- **[src/messages/fr.json](src/messages/fr.json)** — add the new top-level `pagination` namespace (see keys above).
- **[src/messages/ar.json](src/messages/ar.json)** — same keys, Arabic strings. Use `Intl` plurals where applicable.

## Files to modify

| Path | Purpose |
|---|---|
| [src/components/shared/Pagination.tsx](src/components/shared/Pagination.tsx) | New shared component |
| [src/lib/orders/list-filters.ts](src/lib/orders/list-filters.ts) | Add `pageSize` to filter shape + URL parse/serialize |
| [src/hooks/useOrdersList.ts](src/hooks/useOrdersList.ts) | Drop hardcoded `PAGE_LIMIT`; read from filters |
| [src/components/orders/OrdersTable.tsx](src/components/orders/OrdersTable.tsx) | Use `<Pagination>` instead of inline footer |
| [src/app/[locale]/(dashboard)/orders/OrdersPageClient.tsx](src/app/[locale]/(dashboard)/orders/OrdersPageClient.tsx) | Wire `pageSize`/`onPageSizeChange` |
| [src/app/[locale]/(dashboard)/orders/page.tsx](src/app/[locale]/(dashboard)/orders/page.tsx) | (Optional) read `?limit` server-side for SSR fallback |
| [src/app/[locale]/(dashboard)/products/ProductsPageClient.tsx](src/app/[locale]/(dashboard)/products/ProductsPageClient.tsx) | URL-synced page + limit, use `<Pagination>` |
| [src/messages/fr.json](src/messages/fr.json) | New `pagination.*` keys |
| [src/messages/ar.json](src/messages/ar.json) | New `pagination.*` keys |

## Existing code to reuse
- [WarehousePagination](src/components/warehouse/WarehousePagination.tsx) — model for the dropdown styling and prev/next layout. Not reused directly (hardcoded French strings, different visual treatment), but copy its `pageSizeOptions` pattern (line 58) and the dropdown markup (lines 142–164).
- [useOrdersFiltersUrl](src/hooks/useOrdersFiltersUrl.ts) — pattern for `router.replace(scroll: false)` URL sync. The Orders changes piggyback on this hook directly.
- The orders API (`/api/orders/list`) already validates `limit: 1..100` ([list-filters.ts:178](src/lib/orders/list-filters.ts#L178)) — no server change needed.
- The products API already accepts `?page=&limit=` with `max=200` ([products/route.ts:51–54](src/app/api/products/route.ts#L51-L54)) — no server change.

## Tests (TDD per CLAUDE.md)

Write tests first, in this order:

1. **`src/components/shared/__tests__/Pagination.test.tsx`** (new) — renders prev/next, calls callbacks, dropdown changes selection, disables prev on page 1 / next when no more, hides dropdown when `pageSizeOptions: []`, RTL renders icons flipped (use existing `withLocale` helper if present in `src/test/helpers/`).
2. **`src/lib/orders/__tests__/list-filters.test.ts`** (extend if exists, else new) — `parseFiltersFromSearchParams` parses `?limit=50` to `pageSize: 50`, rejects invalid (`?limit=999` → default 25), `filtersToSearchParams` omits `limit` when default, includes when custom.
3. **Orders SWR key test** — `useOrdersList` constructs `/api/orders/list?...&limit=50` when filters carry `pageSize: 50`. Mock fetch, assert URL.
4. **Products URL state test** — changing the dropdown calls `router.replace` with `?limit=50`, resets `page` param.

Run with `npm test`. CLAUDE.md mandates: failing test first → minimal pass → refactor.

## Verification

1. `npm run typecheck` — clean.
2. `npm run lint` — clean.
3. `npm test` — all pagination tests green.
4. **Manual / Playwright** (Orders, super_admin):
   - `/fr/orders` → footer shows dropdown with options 10/25/50/100. Default 25.
   - Pick 100 → URL becomes `?limit=100`, table re-fetches, shows up to 100 rows.
   - Share URL `…/orders?limit=50&preset=unassigned` in incognito → opens with 50/page and unassigned preset.
   - Change a status filter → page resets to 1, page-size persists.
   - Switch market scope (TN/LY/All) → page-size persists.
5. **Manual** (Products, market_manager):
   - `/fr/products` → footer shows dropdown. Default 25 (behavior change from current 50 — call out in PR description).
   - Pick 100 → re-fetches with `?limit=100`, pagination indicator reflects total pages / new total.
   - Change search → page resets to 1, page-size persists.
6. **RTL** (Arabic):
   - `/ar/orders` and `/ar/products` → dropdown label "صفوف لكل صفحة", chevrons point the right way, layout mirrors correctly.
7. **Auth boundary**:
   - Agent role → no change (agent queue not in scope).
   - Manager → can only see own market (RLS still enforces; URL hack `?market_id=other` is rejected by API, unchanged from today).

## Open behavior choice (flag for PR)

Products default changes from **50 → 25** so Orders and Products share the same default. If that's undesirable, set `DEFAULT_PRODUCTS_PAGE_SIZE = 50` in the URL-state helper instead and document divergence.
