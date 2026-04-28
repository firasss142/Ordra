# Market Switcher Duplication — Full Audit Report

**Date:** 2026-04-26  
**Auditor:** Claude Code (Playwright + source inspection)  
**Scope:** All super_admin-visible pages in the OMS dashboard

---

## Executive Summary

There are **two entirely independent market-switching mechanisms** coexisting in the app. For a `super_admin` user, this means every settings page and several content pages display two market selectors simultaneously — one in the sidebar and one inside the page content. They do **not share state**, so switching one does not switch the other. This is confusing, redundant, and architecturally broken.

---

## The Two Mechanisms

### Mechanism A — Sidebar `MarketScopeSwitcher` (the right one)

| Property | Value |
|----------|-------|
| Component | `src/components/layout/MarketScopeSwitcher.tsx` |
| Mounted in | `src/components/layout/Sidebar.tsx` line 440 |
| Visibility | Super admin only (`user.role !== "super_admin" → return null`) |
| State | `MarketScopeContext` (`src/context/market-scope.tsx`) |
| Persistence | Cookie `oms_scope_market`, survives page refresh |
| Effect | `router.refresh()` + SWR global revalidate on change |
| Options | Tunisia / Libya / All markets |
| Position | Top-left, inside sidebar brand area |

This is the **canonical, intentional** market scope control. It powers all pages that call `useMarketScope()`.

---

### Mechanism B — `SettingsPageHeader` inline select (the duplicate)

| Property | Value |
|----------|-------|
| Component | `src/components/settings/SettingsPageHeader.tsx` |
| Mounting condition | `showMarketSelector={user.role === "super_admin"}` |
| State | Local `useState<string>` inside each client page component |
| Persistence | None — resets to `initialMarketId` on every page load |
| Effect | Re-renders the section with a new `marketId` prop |
| Options | Only real markets (no "All" option) |
| Position | Top-right, inside the page content area, labeled "Marché" |

This was built as a **one-off page-level market picker** before the `MarketScopeContext` existed (or without awareness of it). It has **zero connection** to Mechanism A.

---

## Page-by-Page Inventory

### Pages with BOTH mechanisms visible simultaneously

These pages show the sidebar switcher AND the `SettingsPageHeader` inline `<select>`:

| Page | URL | Client component | Screenshot evidence |
|------|-----|-----------------|---------------------|
| Transporteurs (Carriers) | `/fr/settings/carriers` | `CarriersClient.tsx` | `03-carriers.png` — "Tunisie" in sidebar + "Marché / Tunisia ▼" top-right |
| Storefronts | `/fr/settings/storefronts` | `StorefrontsClient.tsx` | `04-storefronts.png` — same pattern |
| Paramètres généraux | `/fr/settings/general` | `GeneralSettingsClient.tsx` | `05-settings.png` — same pattern |

All three use the same pattern:
```tsx
// In CarriersClient.tsx / StorefrontsClient.tsx / GeneralSettingsClient.tsx
const [selectedMarketId, setSelectedMarketId] = useState<string>(initialMarketId);
// ...
<SettingsPageHeader
  ...
  showMarketSelector={user.role === "super_admin"}
  selectedMarketId={selectedMarketId}
  onChange={setSelectedMarketId}
/>
```

### Pages with inline market filter in content (different pattern)

These use a market dropdown inside a filter bar — also duplicating the sidebar switcher, but in a functional "filter" UX pattern:

| Page | URL | Component | Behaviour |
|------|-----|-----------|-----------|
| Commandes (Orders) | `/fr/orders` | `OrdersFilterBar.tsx` + `OrdersPageClient.tsx` | "Tunisia ▼" chip in filter bar; initialised from `initialMarketId` prop, not context |
| Produits & marges | `/fr/products` | `ProductsFilterBar.tsx` + `ProductsPageClient.tsx` | "Tunisia" chip; reads from `useMarketScope()` but ALSO shows its own selector |
| Prospects (Leads) | `/fr/leads` | `LeadsFilterBar.tsx` | "Tunisia ▼" chip; reads `selectedMarketId` prop from parent |

**Note on Products:** `ProductsPageClient.tsx` reads `scopeMarketId` from `useMarketScope()` but then passes it down as a prop to `ProductsFilterBar` which renders it as a separate clickable chip. This means the Products page **is wired to context** but still shows a redundant visual control in the content area.

### Pages with NO duplication (context only, correct)

| Page | URL |
|------|-----|
| Dashboard (Pulse) | `/fr/dashboard` |
| Alertes | `/fr/dashboard/alerts` |
| P&L global | `/fr/dashboard/pnl` |
| À expédier | `/fr/to-ship` |
| En livraison | `/fr/in-delivery` |
| Stock & inventaire | `/fr/dashboard/stock` |
| Archives | `/fr/orders/archive` |

These all consume `useMarketScope()` directly — no second selector.

---

## Root Cause Analysis

### Why it happened

The `MarketScopeContext` and `MarketScopeSwitcher` were added as **Session-level improvements** (performance/UX migration). The settings pages (`CarriersClient`, `StorefrontsClient`, `GeneralSettingsClient`) were built earlier with their own local `useState` market picker. When the context was added to the sidebar, nobody removed the page-level pickers.

### State divergence consequence

When a super_admin is on `/fr/settings/carriers`:
1. Sidebar shows "Tunisie" (from cookie-persisted context).
2. Page header shows "Tunisia" (from `initialMarketId` prop, e.g. also Tunisia).
3. Admin changes sidebar to "Libya" → sidebar updates, page content does NOT change (still shows Tunisia carriers).
4. Admin changes page header to "Libya" → page content changes, sidebar still shows "Libya" (coincidentally aligned now but by accident).
5. Admin navigates away and back → page header resets to `initialMarketId`, context still shows Libya. Divergent again.

The two controls are **never reliably in sync**.

---

## Component Relationship Map

```
Sidebar.tsx
└── MarketScopeSwitcher.tsx          ← THE CANONICAL CONTROL
    └── useMarketScope() → setScope()
        └── MarketScopeContext (cookie + router.refresh())
            ├── InDeliveryClient.tsx  (useMarketScope ✓)
            ├── ProductsPageClient.tsx (useMarketScope ✓, but also shows inline chip)
            ├── DashboardClient.tsx   (useMarketScope ✓)
            ├── AlertsClient.tsx      (useMarketScope ✓)
            ├── ProfitabilityClient.tsx (useMarketScope ✓)
            └── ArchivePageClient.tsx (useMarketScope ✓)

SettingsPageHeader.tsx               ← THE DUPLICATE (to remove)
├── CarriersClient.tsx    (independent useState, no context)
├── StorefrontsClient.tsx (independent useState, no context)
└── GeneralSettingsClient.tsx (independent useState, no context)
```

---

## Fix Strategy (for Claude Code to implement)

### Phase 1 — Settings pages (highest priority, most visible duplication)

**Goal:** Remove `SettingsPageHeader` market `<select>` entirely. Wire the three settings clients to `MarketScopeContext` instead.

**Steps:**

1. **`SettingsPageHeader.tsx`** — Remove the `showMarketSelector`, `markets`, `selectedMarketId`, `onChange` props and the entire `{showMarketSelector && ...}` block. Keep only `title`, `description`, `isRtl`. Rename to just a page title header.

2. **`CarriersClient.tsx`** — Replace local `useState<string>(initialMarketId)` with `const { marketId } = useMarketScope()`. Remove the SWR `/api/markets` fetch (no longer needed here). Remove `initialMarkets` and `initialMarketId` props. Pass `useMarketScope().marketId` directly to `<CarriersSection>`.

3. **`StorefrontsClient.tsx`** — Same as above for storefronts.

4. **`GeneralSettingsClient.tsx`** — Same pattern; the settings form already scopes to a market via `marketId`, just read it from context.

5. **`settings/carriers/page.tsx`**, **`storefronts/page.tsx`**, **`general/page.tsx`** — Remove `initialMarkets` / `initialMarketId` props passed from server to client. Remove any market-list DB queries no longer needed.

6. **`SettingsPageHeader.test.tsx`** — Update tests to match the simplified component (no market selector props).

### Phase 2 — Orders / Products / Leads inline market chip (medium priority)

These are ambiguous — for a `market_manager` (non-super_admin), the inline chip is the **only** way to "filter" within their fixed market (it can't switch markets, just confirms which market is shown). For a `super_admin`, it duplicates the sidebar.

**Recommended approach:** Make the inline chip display-only (non-interactive) for super_admin — it just reflects `useMarketScope()` scope and cannot be changed inline. The sidebar is the single point of control. Keep it interactive only for market_manager (who has no sidebar switcher).

- `OrdersPageClient.tsx`: initialise `filters.marketId` from `useMarketScope().marketId` instead of `initialMarketId` prop.
- `ProductsPageClient.tsx`: already reads from `useMarketScope()` — just remove the interactive chip for super_admin.
- `LeadsFilterBar.tsx` / parent: read from context; make the market chip non-interactive for super_admin.

### Phase 3 — Cleanup

- Remove the `initialMarkets` SWR fetches from any client that no longer needs it.
- Ensure the `SettingsPageHeader` changes are covered by updated snapshot/unit tests.
- Verify no pages accidentally lost their market-scoped data fetching.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/settings/SettingsPageHeader.tsx` | Remove market selector props and JSX |
| `src/app/[locale]/(dashboard)/settings/carriers/CarriersClient.tsx` | Use `useMarketScope()`, remove local state + SWR markets fetch |
| `src/app/[locale]/(dashboard)/settings/carriers/page.tsx` | Remove market props passed to client |
| `src/app/[locale]/(dashboard)/settings/storefronts/StorefrontsClient.tsx` | Same as carriers |
| `src/app/[locale]/(dashboard)/settings/storefronts/page.tsx` | Remove market props |
| `src/app/[locale]/(dashboard)/settings/general/GeneralSettingsClient.tsx` | Same pattern |
| `src/app/[locale]/(dashboard)/settings/general/page.tsx` | Remove market props |
| `src/components/settings/__tests__/SettingsPageHeader.test.tsx` | Update tests |
| `src/app/[locale]/(dashboard)/orders/OrdersPageClient.tsx` | Read `marketId` from context |
| `src/app/[locale]/(dashboard)/products/ProductsPageClient.tsx` | Remove interactive chip for super_admin |
| `src/components/crm/LeadsFilterBar.tsx` | Make market chip display-only for super_admin |

---

## What NOT to Change

- `MarketScopeSwitcher.tsx` — correct and complete, do not touch
- `MarketScopeContext` — correct, do not touch
- `Sidebar.tsx` — correct placement of the switcher
- Pages that already use `useMarketScope()` without a secondary selector
