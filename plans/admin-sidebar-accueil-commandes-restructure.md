# Admin Sidebar + Accueil/COMMANDES Restructure & Redesign

> Durable copy to be saved at `plans/admin-sidebar-accueil-commandes-restructure.md` when implementation starts.

## Context

Audit of the admin sidebar and every page in **Accueil** and **COMMANDES** found significant page redundancy and dated visuals; the user confirmed that "Alertes", "À assigner", and "En confirmation" don't deserve standalone pages in those sections.

### Audit findings
- `/orders` is already the superset hub: presets `all / unassigned / today / callbacks / in_delivery`. `/unassigned` is a pure redirect to `orders?preset=unassigned`.
- `/assign` overlaps the `unassigned` preset (same orders, same `/api/orders/bulk-assign`). Unique value: age buckets (`lib/assign/age-bucket.ts`), `AgentCapacityPanel`, `AutoAssignBar` (auto-assign + `/api/assignment-rules`).
- `/dashboard/alerts` is a 996-line ops inbox (8 types, ack/snooze/reassign/history); its summary already renders on the dashboard (`AlertAttentionBar`, same `useAlerts`).
- `/confirmation-flow` is analytics (funnel, TTFC, struggling agents) — belongs under ÉQUIPE, not COMMANDES.
- Defects (verified in code): sidebar `width: 248px` (Sidebar.tsx:396) vs content `ms-[240px]` (DashboardChrome.tsx:61; design system says 240); `src/context/sidebar.tsx` `SidebarCollapseProvider` has zero consumers; legacy `/orders/[orderId]` → `components/orders/OrderDetail.tsx` (hardcoded French title) duplicates the shared `components/queue/OrderDetailPanel`.

### Approved decisions
1. Fold À assigner into `/orders` (unassigned tab gains board mode); delete `/assign` page.
2. Alertes becomes a bell-triggered slide-over panel; delete the page.
3. Move En confirmation under ÉQUIPE (nav move only). COMMANDES = Commandes, Archivées.
4. Evolve the design system (Shopify-light DNA kept) and modernize `/dashboard` + `/orders`.
5. Include the defect cleanups.

**Scope guard:** Accueil + COMMANDES (+ their sidebar entries) only. No API business logic, financial calc, or RLS changes. TDD (failing test first) throughout; fr + ar i18n; RTL-safe logical properties only.

---

## Phase 1 — Cleanups

1.1 **Sidebar width**: `Sidebar.tsx` ~396-397 `248px` → `240px`. Test: extend `src/components/layout/__tests__/sidebar.test.tsx` asserting 240px.
1.2 **Delete** `src/context/sidebar.tsx` (zero consumers, verified). Run typecheck + full vitest.
1.3 **Retire `/orders/[orderId]`** via a new `?open=<id>` deep-link on /orders:
   - Read/write `open` directly in `OrdersPageClient` with `useSearchParams` + `router.replace` (do NOT put it in `OrderListFilters`/`filtersToSearchParams` — it would leak into SWR keys and the export URL).
   - `orders/[orderId]/page.tsx` → `redirect(/${locale}/orders?open=${orderId})` (params is a Promise — keep await). Delete `components/orders/OrderDetail.tsx`.
   - `OrderDetailPanel` self-fetches by id, so `?open=` works even if the row isn't in page 1.
   - Test first: `?open=` opens the panel; closing strips the param; row click sets it.

## Phase 2 — Nav move: En confirmation → ÉQUIPE

- `Sidebar.tsx` NAV_SECTIONS: move `inConfirmation` item from `commandes` (~line 110) into `equipe` (~line 162), first position. Route/page/i18n keys untouched.
- Update sidebar tests (section membership).
- `toAssign`/`alertes` items are removed in Phases 3/4 (never ship dead nav).

## Phase 3 — Fold /assign into /orders

**UI**: on `preset === "unassigned" && canAssignOrders`, the tab offers a segmented view toggle (Assignation board — default | Tableau):
- Board = `AutoAssignBar` (full width) + main column of 4 `AgeBucketSection`s (critical→fresh) + sticky ~300px inline-end rail with `AgentCapacityPanel` (click-to-assign).
- Board data = existing `useUnassignedOrders` (flat ≤100 rows, 15s + realtime) + `useAgentCapacity` + `useAssignmentRule` — keyset `useOrdersList` untouched (skip fetch in board mode). Caption "showing first 100" when total > 100 (new i18n key).
- Active filter chips force table view. `view=board|table` is a browser-only URL param handled like `open`.
- After assign/auto-assign: SWR global mutate matching `/api/orders/list*`, `/api/orders/status-counts*`, `/api/orders/unassigned/count*` + board hooks, so table/strip/badge stay coherent.

**Files**:
- Create `src/components/assign/AssignBoard.tsx` (extract from `AssignPageClient.tsx`, keep `useTranslations("assign")`; props `{marketId, marketCode, onAssigned?}`) and `src/components/orders/OrdersViewToggle.tsx` (`role="radiogroup"`).
- Modify `OrdersPageClient.tsx`: dynamic-import `AssignBoard`; hide table + `OrdersBulkBar` in board mode; thread `marketCode` from `orders/page.tsx`.
- `assign/page.tsx` → locale-aware redirect to `orders?preset=unassigned`; delete `AssignPageClient.tsx` + its test (port cases to `AssignBoard.test.tsx`: bucket grouping, bucket select-all, bulk-assign POST body, auto-assign toasts, algorithm PATCH).
- `Sidebar.tsx`: remove `toAssign`; move `showBadge: true` to the `orders` item (rollup badge logic keeps working); verify the `/api/orders/unassigned/count` fetch condition survives.
- `prefetch.ts:45-48`: repoint `assign` branch → `orders` route (preload unassigned/capacity/rules).
- i18n: remove `nav.items.toAssign` (fr + ar); add `orders.view.*`, `assign.showingFirstN`.
- Tests: OrdersPageClient board-vs-table gating; sidebar test line ~255 (`/fr/assign` active) → `/fr/orders?preset=unassigned` marks Commandes.

## Phase 4 — Alerts: page → bell slide-over

**UI**: bell in the Sidebar header row (inline-end of logo; dark-surface styling, copy `NotificationBell.tsx` patterns — managers have no topbar). Badge rides the existing alerts-summary SWR fetch in Sidebar (line ~347). Panel: `fixed top-0 inset-inline-end-0 h-full w-full sm:w-[440px] bg-surface-card border-s border-line-subtle shadow-panel z-50`, focus trap, Escape closes (own key handler, topmost-only vs OrderDetailPanel). Body: severity tiles → type chips → bulk bar → list → history toggle. Alert rows deep-link `/orders?open=<id>` (Phase 1.3 payoff) and close the panel.

**Files**:
- Create `src/components/alerts/`: `AlertsPanel.tsx`, `AlertsBell.tsx`, `AlertsSeverityTiles.tsx`, `AlertsTypeChips.tsx`, `AlertsList.tsx` (+ AlertRow), `AlertsBulkBar.tsx`, `AlertsHistory.tsx`, `AllClear.tsx`, `constants.ts`, `format.ts` — decomposed from `AlertsClient.tsx` (it already has these internal seams); migrate inline hex → semantic tokens while moving.
- Create `src/context/alerts-panel.tsx` (`openPanel(filter?)`, `closePanel`; reads `?alerts=open` deep-link, strips on close). Mount provider + dynamic panel in `DashboardChrome` only (not warehouse layout).
- `AlertAttentionBar.tsx`: Link → button calling `openPanel({type})` (update its href test).
- `dashboard/alerts/page.tsx` → redirect `/dashboard?alerts=open`; delete `AlertsClient.tsx`.
- `Sidebar.tsx`: remove `alertes` item + now-unused `showAlertsBadge` rollup machinery; render `<AlertsBell />`.
- i18n: remove `nav.items.alertes`; add `alerts.bell` aria-label (fr + ar).
- Tests first: AlertsPanel (severity counts, chip filtering, ack/snooze POST bodies, reassign, all-clear, Escape), AlertsBell (badge + opens panel), deep-link open, redirect, sidebar updates. At least one RTL render.

## Phase 5 — Visual modernization (/dashboard, /orders)

New tokens (tailwind.config.ts + globals.css): `--chart-line` `#8C9196` (sparklines/axis), `--surface-sunken` `#FAFAFB` (skeletons, empty wells); verify `duration-fast` exists. Migrate touched components inline-hex → semantic tokens.

Dashboard: `KpiCard`/`HeroKpiStrip` — trend deltas on every hero KPI, `tabular-nums`, hover `shadow-hover-row`, inline SVG sparklines **only if** `/api/dashboard/summary` already returns a series (verify; otherwise cut sparklines — no API changes). `SecondaryKpiStrip` tighter grid + caption typography. New `src/components/ui/Skeleton.tsx` (`bg-surface-sunken rounded animate-pulse`) replacing text loaders in HeroKpiStrip/TopPerformers/TopPerformingProducts. `Panel` EmptyState: lucide icon + label + action on sunken well. `FilterBar` 36px controls.

Orders: `OrdersPresetPills` → underline tabs (active = 2px `#10B981` accent underline — the design system's reserved-but-unused accent slot; keep `role="tab"`/`aria-selected`), view toggle at inline-end. `OrdersTable`/`OrderRow`: dense rows (py-2.5, 13px), sticky header, uppercase header per §4, numeric `text-end tabular-nums`, skeleton rows, refined empty state. `OrdersFilterBar`: 36px controls, search icon, §4 primary/outline buttons, push rare controls into the Advanced drawer. `OrdersPageClient` shell + error banner → token classes. `OrdersStatusStrip` aligned with KpiCard mini variant.

Tests: behavioral only (tab roles/aria, skeleton role, empty-state action) — no snapshots.

## Phase 6 — docs/design-system.md update

Add token rows (§2), new patterns: underline tabs (accent slot now implemented), Skeleton, dense table variant, slide-over panel (generalize §4.9, 440px), bell + badge dark-surface variant (§4); correct sidebar 240px note + "managers have no topbar" (§5).

---

## Risks / gotchas
- Keep `open`/`view` out of `OrderListFilters` → else SWR refetch on open/close + junk in export URL (`handleExport` uses `filtersToSearchParams`).
- Board's 100-row cap: caption it; select-all only selects loaded rows (same as old page).
- Sidebar badge fetch conditions may reference removed nav items — re-check on edit.
- i18n changes in **both** `src/messages/fr.json` and `src/messages/ar.json`; root-level `messages/` appears dead (loader uses `src/messages/`) — leave alone.
- RTL: board rail + panel via logical props; Escape handling topmost-only when panel + order drawer both open.
- Grep before each phase: `rg "assign\"|dashboard/alerts" src` for stale test/route references.
- Working tree has unrelated modified files (variants/webhook work) — don't touch; keep commits scoped.
- Phase order matters: 1.3 (`?open=`) must land before Phase 4 (alert rows deep-link to it). Each phase: failing tests → code → green → `npm run typecheck`.

## Verification
- Per phase: new/updated Vitest suites green, `npm run typecheck`, `npm run lint`.
- End-to-end: `npm run dev`, log in as tn_manager and super_admin; walk: sidebar (240px, no overlap; COMMANDES = Commandes/Archivées; En confirmation under ÉQUIPE), `/assign` + `/orders/<id>` + `/dashboard/alerts` redirects, unassigned board (bucket assign, auto-assign, badge/strip refresh), bell → panel (ack/snooze/reassign, deep-link to order), dashboard + orders visuals in fr (LTR) and ar (RTL). `npm run build` passes.
