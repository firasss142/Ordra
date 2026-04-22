# Quality Sweep Plan — Sessions 1–11 Consolidation

## Context

The OMS has 58 components, 54 API routes, and 73 lib files built across sessions 1–11. This sweep addresses accumulated design violations, hardcoded strings, business logic gaps, and documentation drift before declaring v1 production-ready.

**Key discovery**: `docs/design-system.md` describes Shopify's marketing website design (dark backgrounds, neon green, 96px display text, NeueHaasGrotesk). The **actual** OMS design follows CLAUDE.md: light content (#F6F6F7), dark sidebar (#1A1A1A), white cards, system fonts, 14px base, zero decoration. The design-system.md needs a complete rewrite.

---

## Phase 0: Baseline

- [ ] `npm run typecheck` — record result
- [ ] `npm test -- --run` — record result  
- [ ] `npm run build` — record result

---

## Phase 1: Design System Compliance (Section A)

### 1a. Remove blue `#2C6ECB` — replace with `#1A1A1A`

| File | Line(s) | Change |
|------|---------|--------|
| `src/app/globals.css` | 28-29 | `--action: #2C6ECB` → `#1A1A1A`, `--action-hover: #1F5199` → `#333333` |
| `src/app/[locale]/(auth)/login/page.tsx` | 105-106, 150-151 | Focus: `borderColor: "#1A1A1A"`, remove `boxShadow` entirely |
| `src/components/products/ProductListItem.tsx` | 103, 116 | `color: "#2C6ECB"` → `"#1A1A1A"` + add `textDecoration: "underline"` |
| `src/components/settings/TeamSection.tsx` | 71 | Same: `#1A1A1A` + underline |
| `src/components/settings/StorefrontsSection.tsx` | 283 | Same: `#1A1A1A` + underline |
| `src/components/settings/CarriersSection.tsx` | 258 | Same: `#1A1A1A` + underline |

### 1b. Remove dead dependency

- `package.json`: remove `"lucide-react": "^0.474"` (grep confirms zero imports)

### 1c. Fix English metadata

- `src/app/layout.tsx:6`: change `description: "Manage your orders efficiently"` → `"OMS"` (internal tool, no SEO needed)

### 1d. Items confirmed as NOT violations

- **Form tags** (5 files): native HTML `<form>` is correct for accessibility — keep
- **Z-index overlays** (8 files): slide panels and modals are core UI — keep
- **Shadows**: none in components (only login focus ring, fixed in 1a)
- **Icons**: none imported
- **Toasts/spinners**: none present
- **English UI labels**: none (all use `useTranslations`)

---

## Phase 2: Security & Business Logic Fixes (Section B)

### 2a. HIGH: no-answer route — add explicit max-attempts guard

**File**: `src/app/api/orders/[id]/no-answer/route.ts`

Current: relies entirely on `no_response_with_auto_reject` RPC for max-attempt enforcement.

Fix: After line 50 (`getNextAttemptStatus`), fetch market settings max_attempts and add:
```ts
import { isMaxAttemptsReached } from "@/lib/attempt-logic";
// After getNextAttemptStatus returns null → already blocks attempt_3+
// Add explicit guard + comment documenting defense-in-depth
```

Note: `getNextAttemptStatus("attempt_3")` already returns `null`, so the existing `if (!nextStatus)` on line 51 catches this. The fix is adding a clear comment and an explicit `isMaxAttemptsReached` check with a specific error message distinct from the generic "Cannot log no-answer" error.

TDD: write test first — POST no-answer on attempt_3 order → expect 400 with max-attempts message.

### 2b. MEDIUM: no-response route — add terminal status check

**File**: `src/app/api/orders/[id]/no-response/route.ts`

Fix: After loading order, add `isTerminalStatus(order.status)` check before `getNextAttempt`. Return 400 "Order is in terminal status" if terminal.

TDD: write test first — POST no-response on rejected order → expect 400.

### 2c. LOW: dispatch route — use validateTransition

**File**: `src/app/api/orders/[id]/dispatch/route.ts` (line 62)

Replace manual `order.status !== "confirmed"` with `validateTransition(order.status, "dispatched")` from order-engine.ts for consistency.

### 2d. LOW: queue-sort determinism

**File**: `src/lib/orders/queue-sort.ts`

Add `id: string` to `QueueOrder` interface. Add tertiary sort by ID when created_at is equal:
```ts
const timeA = new Date(a.created_at).getTime();
const timeB = new Date(b.created_at).getTime();
if (timeA !== timeB) return timeA - timeB;
return (a as any).id?.localeCompare?.((b as any).id) ?? 0;
```

TDD: write test first — two orders with same status + same created_at but different IDs.

---

## Phase 3: i18n Sweep — Hardcoded French Strings (Section A continued)

### Scope: ~20 components with hardcoded French that bypass `useTranslations`

**Components needing i18n wiring** (grouped by namespace):

| Namespace | Components | Approx new keys |
|-----------|-----------|-----------------|
| `common` (new) | All — loading, error, save, cancel, etc. | ~15 |
| `dashboard` | TeamOverview, MetricsTable, Leaderboard, ProfitabilityTable, AdSpendManager, RejectionBreakdown, DashboardTabs | ~40 |
| `settings` (new) | GeneralSettingsForm, TeamSection, StorefrontsSection, CarriersSection, SettingsNav | ~30 |
| `team` (new) | AgentDrilldown, ReassignControls, TeamTable | ~15 |
| `products` (extend) | ProductProfitability, ProductPerformanceCard, product detail page | ~15 |
| `orders` (extend) | OrderDetail, FulfillmentControls, OrderList | ~10 |
| `queue` (extend) | CarrierSelect, DexpressLocationPicker, QueuePage | ~5 |
| `nav` (existing) | Sidebar — replace hardcoded arrays with dynamic i18n | ~0 (keys exist) |

**Process for each component**:
1. Add `useTranslations("namespace")` 
2. Replace hardcoded strings with `t("key")`
3. Add new keys to both `fr.json` and `ar.json`
4. Update any tests that assert on hardcoded French text

**Special cases**:
- `Sidebar.tsx`: Replace `NAV_ITEMS_FR`/`NAV_ITEMS_AR` arrays with single array using `t(key)` + dynamic `/${locale}/path` hrefs
- `AgentDrilldown.tsx`: Remove duplicated `STATUS_LABELS` record, use `t("orders.statuses.${status}")` instead
- `RejectionBreakdown.tsx`: Remove duplicated reason labels, use `t("orders.rejectionReasons.${reason}")`

---

## Phase 4: Simplify Pass (Section C)

Target files (corrected paths from user request):

| User requested | Actual path | Size | Action |
|----------------|-------------|------|--------|
| `src/app/api/webhooks/easy-orders/route.ts` | `src/app/api/webhooks/[storefrontId]/route.ts` | ~100L | Review for complexity |
| `src/lib/assignment-engine.ts` | `src/lib/orders/auto-assignment.ts` | ~131L | Already clean, minor review |
| `src/lib/order-engine.ts` | `src/lib/order-engine.ts` | ~70L | Already simple, skip |
| `src/components/queue/PostCallActionSheet.tsx` | Same | ~566L | Extract style constants, consider sub-components |
| `src/components/dashboard/TeamOverview.tsx` | Same | ~154L | Extract shared table styles after i18n |
| `src/components/dashboard/AgentDrilldown.tsx` | `src/components/team/AgentDrilldown.tsx` | ~273L | Remove STATUS_LABELS after i18n, consider extracting order card |

Run `/simplify` on each, then `npm run typecheck && npm test -- --run` after.

---

## Phase 5: Documentation (Section E)

### 5a. Rewrite `docs/design-system.md`

Replace Shopify marketing copy with actual OMS design system:
- Surfaces: sidebar #1A1A1A, page #F6F6F7, card #FFFFFF
- Typography: system fonts, 14px base, weights 400/500/600
- Colors: #1A1A1A text, #6D7175 secondary, #E1E3E5 borders
- Functional colors: status badges only (green/yellow/red/gray)
- Focus: `border: 2px solid #1A1A1A`, no shadow
- Do's/Don'ts aligned with CLAUDE.md

### 5b. Update CLAUDE.md

- Verify all file paths still exist
- Add note: all strings via next-intl (no hardcoded text)
- Update design system section to match reality
- Add production readiness note

### 5c. Update `src/components/CLAUDE.md`

- Line 7: "Use Tailwind utility classes" → describe actual pattern (inline styles)

---

## Phase 6: Playwright Visual Verification (Section E continued)

Use Playwright MCP to:
1. Navigate to login page → verify focus rings are black (#1A1A1A), no blue, no shadow
2. Navigate to settings/carriers → verify "Modifier" links are black with underline
3. Navigate to products list → verify edit links are black with underline
4. Navigate to agent queue → verify panel overlays work correctly
5. Navigate to Arabic locale → verify RTL layout mirrors correctly
6. Screenshot each page → visual comparison against design system

---

## Phase 7: Final Build Verification (Section D)

- [ ] `npm test -- --run` — all suites pass
- [ ] `npm run typecheck` — zero errors
- [ ] `npm run build` — no errors/warnings
- [ ] Fix any unused imports or missing keys surfaced by build

---

## Critical Files (most changes concentrated here)

- `src/app/globals.css` — CSS variable fix
- `src/messages/fr.json` — ~130 new translation keys
- `src/messages/ar.json` — ~130 new translation keys (Arabic translations)
- `src/app/[locale]/(auth)/login/page.tsx` — focus ring fix
- `src/components/settings/TeamSection.tsx` — link color + i18n
- `src/components/settings/CarriersSection.tsx` — link color + i18n
- `src/components/settings/StorefrontsSection.tsx` — link color + i18n
- `src/components/dashboard/TeamOverview.tsx` — i18n
- `src/components/team/AgentDrilldown.tsx` — i18n + remove STATUS_LABELS
- `src/components/layout/Sidebar.tsx` — i18n refactor
- `src/app/api/orders/[id]/no-answer/route.ts` — security fix
- `src/lib/orders/queue-sort.ts` — determinism fix
- `docs/design-system.md` — complete rewrite

## Reusable Functions Found (to leverage, not duplicate)

- `isTerminalStatus()` from `src/types/order-status.ts`
- `isMaxAttemptsReached()` from `src/lib/attempt-logic.ts`
- `validateTransition()` from `src/lib/order-engine.ts`
- `getNextAttemptStatus()` from `src/lib/attempt-logic.ts`
- `useTranslations()` from `next-intl` — pattern established in queue components
- Status labels in `fr.json` → `orders.statuses.*` and `orders.rejectionReasons.*`

## Verification Plan

After each phase:
1. `npm run typecheck` — must pass
2. `npm test -- --run` — must pass
3. After all phases: `npm run build` — must pass with zero warnings
4. Playwright visual spot-check on key pages (login, settings, products, queue, Arabic locale)
