# Order Detail Panel — Prototype-Inspired Refinement + Mobile-First Responsiveness

## Context

The user shared a Claude Design handoff bundle (`oms/project/Order Detail.html` + `Order Detail Desktop.html`, RTL Arabic, dark/mint COD-agent order panel) and asked us to **be inspired by it — not copy it** — to redesign the OMS order-detail panel across all roles, with a deliberate **mobile-first** treatment *and* a strong desktop version, fixing wherever the prototype's ideas collide with OMS logic.

**Key discovery during exploration:** a large redesign of this exact panel **already landed in `main`** via PR #39 (`feat/order-detail-panel-redesign`, merged 2026-05-30). That work modularized the old 1,978-line monolith into a clean `OrderDetailPanel/` folder (`PanelHeader`, `CustomerHero`, `CustomerCard`, `OrderItemsCard`, `HistoryTimeline`, `FulfillmentCard`, `ActionFooter`, `SectionCard`, `usePrimaryAction`), added `Sheet` + `Menu` UI primitives, and made the panel **status-first, white-only, single-CTA + overflow menu** — already embodying much of the prototype's *intent*. It is role-aware (agent / market_manager / super_admin in one shared surface) and keeps every existing handler + API contract.

So this is **not** a from-scratch redesign. The merged panel covers ~80% of the prototype's information-architecture goals. What it is **missing** — and what this prototype most distinctively contributes — is:

1. **True mobile-first responsiveness.** The merged panel is still a desktop-first side-drawer that merely goes `w-full` on mobile. The prototype is explicitly mobile-first (bottom-sheet feel) with a separate docked-sidebar desktop view. We add a real **bottom-sheet on mobile, side-drawer on desktop** treatment.
2. **The missing-delivery-address "headline alert."** The prototype's single best idea: for a COD order with no address, the blocker becomes the loudest thing on screen — an amber alert carrying the customer's own note inline, an inline "add address" form, and the attempt count as a pill. It resolves into a calm address card once filled. The merged panel buries address as a plain `FieldRow` in the customer card. This is a real OMS UX win (a no-address order cannot ship).

**User decisions (confirmed):** Build on the merged branch (now in `main`) · Adapt the prototype to the OMS white/light design system (no dark surfaces, no mint accent, status-color only) · Bottom-sheet mobile + side-drawer desktop · Cover the one shared panel for all three roles.

### Where the prototype "breaks" against OMS logic (and how we adapt)

- **Dark/mint theme** → rejected. `docs/design-system.md` forbids dark content surfaces, gradients, decoration, and any accent beyond the two sanctioned `#10B981` uses. We keep the OMS white/light system; the prototype informs *layout & interaction*, not color.
- **Prototype statuses** (`confirmed/prep/shipped/delivered/canceled`) → don't match OMS's two-phase model (`pending → attempt_* → confirmed → uploaded → scanned → …`). We keep OMS statuses and the existing `STATUS_TONE` map; status changes already route through `PostCallActionSheet` / `usePrimaryAction`, not an inline header dropdown.
- **Prototype "send to carrier" gated only on address** → OMS upload is gated on `status ∈ {confirmed, dispatch_scheduled}`, carrier selection, role/ownership, and duplicate checks (server-enforced in `/api/orders/:id/dispatch`). We keep that. The address alert *informs* but never replaces those gates.
- **Prototype free-text city** → Tunisia uses a `cities` lookup, Libya uses Dexpress states. The address alert's city field must reuse the existing `CustomerCard` city pickers (`/api/cities`, `/api/dexpress/states`), not a free text box.
- **Prototype single hardcoded line item + "card payment / paid" chips** → OMS supports multi-item orders, `card_payment` is a Libya +10% surcharge toggle (not a "paid" state), and revenue = `total_price` only. The existing `OrderItemsCard` already models this correctly; we leave its logic intact and only align spacing/typography.

## Branch strategy (explicitly requested)

Current state, verified against `origin`:
- `origin/main` (`dba6cfb`) **already contains** the merged redesign (PR #39).
- Local `main` and the current working branch `docs/architecture-diagrams` are **2 commits behind** `origin/main` and have **0 unique commits** — the branch only holds untracked working-tree files (architecture diagrams, screenshots, `plans/*.md`).
- The redesign feature branch `feat/order-detail-panel-redesign` exists locally **and** on the remote, but its PR is **already merged** — so it is dead weight.

**Plan:**
1. **Salvage the untracked artifacts** on `docs/architecture-diagrams` first (they are unrelated to this task): the architecture diagrams under `docs/diagrams/` + the three `plans/*.md` are worth keeping. The loose `phase*.png` / `phase*-*.png` screenshots at repo root and `.vercel/` are throwaway — leave untracked or gitignore; do **not** commit them. (Confirm with the user before committing the diagrams, or split them into their own small PR.)
2. **Delete the merged feature branch** locally and on the remote — it is fully in `main`:
   - `git branch -d feat/order-detail-panel-redesign`
   - `git push origin --delete feat/order-detail-panel-redesign`
3. **Do this task's work on a fresh branch off the up-to-date `origin/main`** — e.g. `feat/order-detail-panel-mobile-first` — so we build on the merged modular components, not the stale local tree:
   - `git fetch origin && git switch -c feat/order-detail-panel-mobile-first origin/main`
4. When complete, open a PR into `main` and merge it. That is the branch that reaches `main`.
5. The stale `docs/architecture-diagrams` local branch can be deleted after its useful artifacts are preserved (step 1). Other long-dead remote branches (`agent-ui`, `agent-workflow`, `improvements`, `mobile-responsiveness`, `order-id-auto-generation`, etc.) are out of scope — flag for separate cleanup, don't touch here.

## Critical files

All paths are in the **merged** modular panel (now in `main`):

- `src/components/ui/Sheet.tsx` — **extend** with `placement="bottom"` (mobile bottom-sheet: `fixed inset-x-0 bottom-0`, `max-h-[92vh]`, `rounded-t-[20px]`, slide-up animation, grab-handle affordance). Keep `end` + `center` untouched.
- `src/components/queue/OrderDetailPanel/index.tsx` — the shell currently hardcodes its drawer div (`fixed top-0 end-0 h-full w-full sm:w-[480px] …`). **Replace that hardcoded wrapper** with the `Sheet` primitive driven by `useIsMobile()`: `placement={isMobile ? "bottom" : "end"}`. This is the single switch that gives mobile-first behavior to the whole panel. Also mount the new `AddressAlert`.
- `src/components/queue/OrderDetailPanel/AddressAlert.tsx` — **NEW.** The prototype's headline. Renders only for **non-terminal, address-missing** orders. Shows: amber alert (`bg-status-warningBg` / `text-status-warning`), the customer note inline (reusing `formatOrderHistoryNote` style), an attempt pill (`Tentative N` from existing `attempt_*` labels), and an **"Add address" inline form** that reuses the *exact* address + city editors from `CustomerCard` (so Tunisia `cities` / Libya Dexpress-state logic is preserved — no free-text city). On save it calls the existing `runCommit({ customer_address, city_id | dexpress_state_id })`. When an address exists, render a calm resolved-address line instead (or simply defer to `CustomerCard`).
- `src/components/queue/OrderDetailPanel/CustomerCard.tsx` — keep address/city/note logic; the `AddressAlert` reuses its city-picker building blocks (extract the city editor into a shared sub-component if cleaner, or import the pieces). Avoid duplicating the Libya/Tunisia branching.
- `src/components/queue/OrderDetailPanel/ActionFooter.tsx` — make the sticky footer mobile-safe: add `pb-[env(safe-area-inset-bottom)]` and ensure it stays pinned in the bottom-sheet. Primary CTA already correct.
- `src/components/queue/OrderDetailPanel/CustomerHero.tsx` / `PanelHeader.tsx` — light responsive polish only: header height + hero padding scale down slightly on mobile; add a grab-handle row at the very top when in bottom-sheet mode (passed via prop or read from a context).
- `src/components/queue/OrderDetailPanel/HistoryTimeline.tsx` — verify the collapsible timeline animates cleanly inside a scrolling bottom-sheet (the prototype's expandable السجل). Likely no change.
- `src/hooks/useIsMobile.ts` — **reuse as-is** (640px breakpoint, matches Tailwind `sm`). No change.
- `src/messages/fr.json` + `src/messages/ar.json` — add `orders.detail` keys: `addressMissingTitle`, `addAddress`, `addressSaved`, `addressAlertAttempt` (and reuse existing `fieldAddress`, `fieldCity`, `attempt_1/2/3`). Both locales, identical key sets.
- `tailwind.config.ts` — only if a new keyframe is needed for the bottom-sheet slide-up (`slideInBottom`); otherwise reuse `animate-[slideInEnd_…]` pattern with a new keyframe in `globals.css`.
- `src/app/globals.css` — add `@keyframes slideInBottom` (translateY(100%) → 0) for the mobile sheet.

### Test files (TDD — write the failing test first)

- `src/components/ui/Sheet.test.tsx` — extend: `placement="bottom"` renders bottom-anchored, rounded-top, ESC + overlay close still work.
- `src/components/queue/OrderDetailPanel/__tests__/AddressAlert.test.tsx` — **NEW**: renders only when address missing + non-terminal; shows attempt pill + note; inline form commits via `onCommit`; hidden when address present or terminal; respects `canEdit` (read-only when blocked).
- `src/components/queue/OrderDetailPanel/__tests__/OrderDetailPanel.integration.test.tsx` — extend: asserts `Sheet placement` flips with `useIsMobile`, and the address alert appears/disappears with `customer_address`.

## Implementation approach

1. **Sheet `placement="bottom"`** (primitive first, with its test). Mobile sheet: overlay `z-40`, panel `fixed inset-x-0 bottom-0 z-50 max-h-[92vh] rounded-t-[20px] flex flex-col`, slide-up keyframe, small centered grab-handle at top. Preserve focus-trap, ESC, scroll-lock, outside-click.
2. **Wire the shell to `useIsMobile()`** in `index.tsx`: swap the hardcoded drawer div for `<Sheet open onClose={onClose} placement={isMobile ? "bottom" : "end"} ariaLabel={…}>…</Sheet>`. Header / hero / scroll-body / footer move *inside* the Sheet unchanged. This alone delivers the mobile-first form factor for all roles and all states.
3. **AddressAlert** (test first). Mount it in `index.tsx` right after the alert-banner stack and before the body sections, gated on `order && !terminal && !order.customer_address`. Reuse `runCommit`, `canEdit`, the Libya/Tunisia city pickers from `CustomerCard`, and the attempt label. Keep the OMS amber status tokens — no dark/mint.
4. **Responsive polish** across `PanelHeader`, `CustomerHero`, `ActionFooter` (safe-area padding, slightly tighter mobile paddings, grab handle). Desktop side-drawer visuals unchanged.
5. **i18n**: add the handful of new keys to `fr.json` + `ar.json`. No hardcoded strings.
6. **Keep all handlers + API contracts identical.** No server/route/permission changes. Revenue still `total_price`; financial logic stays server-side; status transitions unchanged.

## Verification

- `npm run typecheck` and `npm run lint` clean.
- `npm test` — new/extended tests pass (Sheet bottom placement, AddressAlert behavior, integration responsive flip). Follow TDD: red → green → refactor.
- `npm run build` succeeds.
- **Manual (Playwright MCP or `npm run dev`)**, both locales, both markets, all three roles:
  - Agent queue (`/queue`) → open an order → resize below 640px: panel becomes a bottom-sheet (rounded top, slides up, sticky footer, safe-area). Above 640px: docked end-side drawer (480px). Confirm in RTL (`ar`) the drawer docks on the correct inline edge and the sheet still bottom-anchors.
  - An order with **no address**: the amber headline alert shows with the note + attempt pill; the inline form (Tunisia city dropdown / Libya Dexpress state) commits and the alert collapses into the normal address display. Upload-to-carrier remains gated by status/carrier/duplicate rules regardless of the alert.
  - Manager / super_admin (`/orders`): same panel, same hierarchy, plus their override controls (FulfillmentCard, cancel) intact; primary-CTA + overflow menu unchanged.
  - Terminal orders (delivered/rejected/cancelled): no address alert, muted hero, `Close` primary.
- Screenshot mobile + desktop, both locales, for the PR description.
