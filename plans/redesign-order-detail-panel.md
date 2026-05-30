# OrderDetailPanel — Visual & UX Redesign

## Context

The order details panel (`src/components/queue/OrderDetailPanel.tsx`, ~2000 lines) is the single shared surface used by agents, market_managers, and super_admins to review and act on an order. The current implementation works, but the visual hierarchy is muddled: the order-id pill outweighs the status badge, "change status" is a tiny grey link, every section uses an ad-hoc tinted background that violates the design system's "zero decoration" rule, the dark phone capsule is an island of depth in an otherwise flat surface, and the footer is a flat two-button row that doesn't telegraph what the agent should do next. This redesign keeps every existing handler and API contract but rewrites the visual layer to: (1) lead with status, not id; (2) remove tinted section accents and rely on uppercase labels + lucide icons for section identity; (3) introduce a sticky white header + light hero card with a refined dark phone capsule; (4) replace the two-button footer with a single state-contextual primary CTA + overflow menu; and (5) treat every order status with a deliberate visual treatment (in-confirmation / awaiting-upload / dispatched-or-later / terminal). The redesign applies to all three roles in one shared panel and adds two new UI primitives (`Sheet`, `Menu`) to remove the ad-hoc modal/overflow patterns repeated across the file. Intended outcome: agents recognise state instantly, hit the right action without scanning, and managers see the same panel with the same hierarchy plus their override controls. Direction confirmed with the user: "evolve the system" (subtle elevation + 12px stacking + dark hero phone capsule retained, but no decoration), all roles, all states in one pass, desktop + tablet polish, sticky-header + light-hero layout, no section tints, single primary CTA + overflow menu.

## Critical files

- `src/components/queue/OrderDetailPanel/index.tsx` — new shell, replaces the current 2000-line file; mounts header/hero/body/footer + lifts state.
- `src/components/queue/OrderDetailPanel/PanelHeader.tsx` — sticky white header (id pill, status badge, change-status link, save flash, close).
- `src/components/queue/OrderDetailPanel/CustomerHero.tsx` — light hero card (name 22px, phone capsule, phone-2, city chip).
- `src/components/queue/OrderDetailPanel/AlertBanners.tsx` — edit-blocked / callback-scheduled / dispatch-scheduled banners.
- `src/components/queue/OrderDetailPanel/CustomerCard.tsx` — address + city picker + note (single white card, no tint).
- `src/components/queue/OrderDetailPanel/OrderItemsCard.tsx` — line items, stepper, variant, delivery fee, card payment, grand total.
- `src/components/queue/OrderDetailPanel/HistoryTimeline.tsx` — collapsible vertical timeline.
- `src/components/queue/OrderDetailPanel/FulfillmentCard.tsx` — manager-only override controls.
- `src/components/queue/OrderDetailPanel/ActionFooter.tsx` — sticky single primary CTA + overflow menu + feedback toast.
- `src/components/queue/OrderDetailPanel/SectionCard.tsx` — shared white card with uppercase label + lucide icon header (replaces tinted variants).
- `src/components/queue/OrderDetailPanel/usePrimaryAction.ts` — pure helper resolving `(status, role, userId, order)` → `{ primary, overflow }`.
- `src/components/queue/OrderDetailPanel/types.ts` — shared `OrderDetail`, `HistoryEntry`, `OrderItem`, `PanelAction`.
- `src/components/queue/OrderDetailPanel.tsx` — thin re-export shim (`export { OrderDetailPanel } from "./OrderDetailPanel/index"`) so existing imports keep working.
- `src/components/ui/Sheet.tsx` — NEW side-drawer + center-modal primitive (focus trap, overlay, ESC, scroll lock).
- `src/components/ui/Menu.tsx` — NEW lightweight overflow/menu primitive built atop existing `Popover`.
- `docs/design-system.md` — add §4.9 "Panel variant" (subtle elevation + 12px gap stack) and §4.10 "Section label + icon".
- `tailwind.config.ts` — add `boxShadow.panel-elevated: "0 6px 20px rgba(16,24,40,0.08)"` and `colors.surface.elevated: "#FFFFFF"`. No other tokens (existing `border-line-subtle`, `rounded-card`, `duration-fast/base` cover the rest).
- `src/messages/fr.json`, `src/messages/ar.json` — add `orders.detail.actions.*` keys (listed below).

### Test files (TDD — write first, in order)

- `src/components/queue/OrderDetailPanel/__tests__/usePrimaryAction.test.ts`
- `src/components/queue/OrderDetailPanel/__tests__/PanelHeader.test.tsx`
- `src/components/queue/OrderDetailPanel/__tests__/CustomerHero.test.tsx`
- `src/components/queue/OrderDetailPanel/__tests__/AlertBanners.test.tsx`
- `src/components/queue/OrderDetailPanel/__tests__/CustomerCard.test.tsx`
- `src/components/queue/OrderDetailPanel/__tests__/OrderItemsCard.test.tsx`
- `src/components/queue/OrderDetailPanel/__tests__/HistoryTimeline.test.tsx`
- `src/components/queue/OrderDetailPanel/__tests__/FulfillmentCard.test.tsx`
- `src/components/queue/OrderDetailPanel/__tests__/ActionFooter.test.tsx`
- `src/components/queue/OrderDetailPanel/__tests__/OrderDetailPanel.integration.test.tsx` (replaces/extends current `OrderDetailPanel.test.tsx`)
- `src/components/ui/Sheet.test.tsx`
- `src/components/ui/Menu.test.tsx`

## State → primary CTA map

Handler legend (all already in [src/components/queue/OrderDetailPanel.tsx](src/components/queue/OrderDetailPanel.tsx)):
- `onCallTerminated` — opens `PostCallActionSheet` (rejection / callback / confirmed paths)
- `handleUploadToCarrier` — opens carrier picker `Sheet`, then POSTs `/api/orders/:id/dispatch`
- `handleCancelSchedule` — POST `/api/orders/:id/transition` body `{ status: "confirmed" }`
- `handleDeleteCarrierBarcode` — POST `/api/orders/:id/carrier-delete`
- `handleReopen` — POST `/api/orders/:id/reopen`
- `handleReturnToPool` — invokes `onReturnToPool` prop
- `handleFulfillmentOverride` — POST `/api/orders/:id/fulfillment`
- `setScheduleDispatchOpen(true)` — opens `ScheduleDispatchModal`
- `onClose` — closes panel

Role tokens: **A** = agent or `role===undefined` (own-pool view), **M** = market_manager, **S** = super_admin.

| Status | Primary CTA key | Primary handler | Overflow items | Notes |
|---|---|---|---|---|
| `pending` | `actions.endCall` | `onCallTerminated` | `actions.returnToPool` (A); `actions.cancel` (M/S) | Overflow hidden if no items |
| `assigned` | `actions.endCall` | `onCallTerminated` | same as pending | — |
| `attempt_1/2/3` | `actions.endCall` | `onCallTerminated` | `actions.returnToPool` (A); `actions.cancel` (M/S) | — |
| `callback_scheduled` | `actions.endCall` | `onCallTerminated` | `actions.rescheduleCallback`; `actions.cancel` (M/S) | Banner above shows scheduled time |
| `confirmed` | `actions.uploadToCarrier` | `setUploadOpen(true)` | `actions.scheduleDispatch` (A/M/S); `actions.changeStatus`; `actions.cancel` (M/S) | Primary disabled if no active carrier (tooltip `primaryDisabledNoCarrier`) |
| `dispatch_scheduled` | `actions.uploadNow` | `setUploadOpen(true)` | `actions.cancelSchedule`; `actions.cancel` (M/S) | Banner also exposes cancel-schedule pill |
| `uploaded` (tracking) | `actions.close` | `onClose` | `actions.deleteCarrierBarcode` (A own / M / S); `actions.reopen` (A, within window); `actions.cancel` (M/S) | — |
| `uploaded` (ref-deleted) | `actions.uploadToCarrier` | `setUploadOpen(true)` | same as `confirmed` | Treated as confirmed for editing |
| `scanned` | `actions.close` | `onClose` | `actions.fulfillmentOverride` (M/S); `actions.cancel` (M/S, pre-dispatch) | Agent overflow empty |
| `dispatched` | `actions.close` | `onClose` | `actions.reopen` (A); `actions.fulfillmentOverride` (M/S) | — |
| `deposit` | `actions.close` | `onClose` | `actions.fulfillmentOverride` (M/S) | — |
| `in_transit` | `actions.close` | `onClose` | `actions.fulfillmentOverride` (M/S) | — |
| `delivered` (terminal) | `actions.close` | `onClose` | — | No overflow trigger |
| `returned` (terminal) | `actions.close` | `onClose` | — | — |
| `rejected` (terminal) | `actions.close` | `onClose` | `actions.reopen` (A, within window) | Overflow hidden if not reopenable |
| `cancelled` (terminal) | `actions.close` | `onClose` | — | — |
| `deleted` (terminal) | `actions.close` | `onClose` | — | — |

New translation keys under `orders.detail.actions` (fr + ar):
`endCall, returnToPool, cancel, rescheduleCallback, changeStatus, uploadToCarrier, uploadNow, scheduleDispatch, cancelSchedule, deleteCarrierBarcode, reopen, fulfillmentOverride, close, overflowMenu, primaryDisabledNoCarrier`.

Reuse existing labels where they already match (`callEnded`, `returnToPool`, `reopen`, `close`, `uploadToCarrier`, `scheduledDispatchCancel`, `changeStatus`, `tracking.delete`); the new keys consolidate them under `actions.*` so the footer reads from one namespace.

## Visual specification per state

**Shared frame (all states):**
- Drawer: `fixed top-0 end-0 h-full w-full sm:w-[480px] z-50 bg-surface-card border-s border-line-subtle shadow-panel`
- Sticky header band: `flex-shrink-0 h-[56px] bg-surface-card border-b border-line-subtle px-4 flex items-center justify-between`
- Hero card (under header): `mx-4 mt-3 rounded-card bg-surface-card border border-line-subtle px-4 py-4 shadow-panel-elevated`
- Body scroll: `flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3` (12px between cards)
- Section cards: `rounded-card bg-surface-card border border-line-subtle p-4` — pure white, no tinted fills. Label row `flex items-center gap-1.5 mb-3`, icon `<Icon size={12} strokeWidth={2} className="text-ink-muted" />`, label `text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted`
- Footer: `flex-shrink-0 bg-surface-card border-t border-line-subtle px-4 py-3 flex items-center gap-2`. Primary CTA `flex-1 h-11 rounded-card bg-ink-primary text-white text-[14px] font-semibold hover:bg-[#2A2A2A]`. Overflow trigger `w-11 h-11 rounded-card border border-line-subtle hover:bg-surface-hover`

### Group A — In-confirmation
`pending`, `assigned`, `attempt_1/2/3`, `callback_scheduled`
- Hero: full color name (`text-ink-primary`), dark phone capsule active, phone-2 inline if present
- AlertBanners: callback banner if `callback_scheduled`; never edit-blocked
- Sections rendered: Customer card, Order items card (collapsed by default), History (collapsed)
- FulfillmentCard hidden for A; for M/S shown but disabled with tooltip `fulfillment.notApplicablePreScan`
- TrackingBarcode + DexpressStatusSection: rendered but pass `value={null}` / `enabled={false}` (no-op)
- Footer primary: `actions.endCall`

### Group B — Awaiting upload
`confirmed`, `dispatch_scheduled`, reference-deleted `uploaded`
- Hero: full color
- AlertBanners: `dispatch_scheduled` shows blue banner with date + inline `cancel-schedule` pill (kept for fast access); no banner for `confirmed`
- Sections: Customer, Order items (**expanded by default when `confirmed`** so the agent can verify before upload), History (collapsed)
- TrackingBarcode: shown only if `reference_deleted_at` present (small "deleted by carrier" pill)
- Footer primary: `actions.uploadToCarrier` (or `actions.uploadNow` for scheduled)

### Group C — Dispatched-or-later
`uploaded` (with tracking), `scanned`, `dispatched`, `deposit`, `in_transit`
- Hero: full color but phone capsule subdued (background unchanged, hover still on)
- AlertBanners: edit-blocked banner if not reference-deleted: `flex items-start gap-2 px-4 py-2.5 bg-surface-page border-y border-line-subtle text-[12px] text-ink-secondary` with `AlertTriangle` icon in `text-status-warning`
- TrackingBarcode visible whenever `tracking_number` set
- DexpressStatusSection visible (Libya + Dexpress)
- Sections: Customer + Order items read-only (no edit chrome), History (collapsed with badge count), FulfillmentCard available for M/S
- Footer primary: `actions.close`. Overflow exposes `deleteCarrierBarcode` (uploaded only), `reopen` (agent window), `fulfillmentOverride` (M/S)

### Group D — Terminal
`delivered`, `returned`, `rejected`, `cancelled`, `deleted`
- Hero adapts: name renders `text-ink-secondary` (muted), phone capsule replaced by a flat row `bg-surface-page border border-line-subtle text-ink-secondary` (no `tel:` surface). Phone-2 hidden
- Status badge in header uses tone from `statusToneClass` (delivered=success, rest=critical or neutral)
- No alert banner unless `rejected` + reopenable (single neutral hint "Réouvrir disponible jusqu'au …")
- Sections: Customer + Order items read-only; History **expanded by default** (the terminal narrative is the most useful info)
- TrackingBarcode visible if tracking still present
- FulfillmentCard hidden
- Footer primary: `actions.close`. Overflow: `reopen` only when applicable, otherwise overflow trigger hidden entirely

Status badge tone source: keep using the local `STATUS_TONE` map (header) plus `statusToneClass` from [src/lib/order-status-tone.ts](src/lib/order-status-tone.ts) (popover-style usages). Both already centralised — do not duplicate.

## New primitives

Introduce two: **`Sheet`** + **`Menu`**.

**`Sheet`**: ad-hoc modals appear 5× in this file alone (overlay + upload picker, `ScheduleDispatchModal`, `DexpressDispatchModal`, reopen confirm) and many more across `src/components/admin/*` and `src/components/settings/*`. They share the same overlay-z40 + dialog-z50 + ESC + focus-trap dance. A single `Sheet` primitive with `side` (`"end" | "center"`), `width`, `onClose`, optional `headerSlot/footerSlot` removes ~80 lines of repetition here and makes the side-drawer pattern testable in one place. Thin wrapper around `focus-trap-react` (already a dependency) so existing behaviour is preserved.

**`Menu`**: the footer overflow needs a roving-tabindex listbox that closes on ESC and outside-click. `Popover` already handles outside-click and ESC; `Menu` extends it with item ARIA, keyboard nav, and an icon+label+`disabled` item type. Lifting it to `src/components/ui/Menu.tsx` lets the orders archive page (`OrderRow.tsx` already imports `MoreHorizontal`) consume the same primitive next.

Both new primitives are additive — `Popover` stays.

## Component extraction recommendation

Split the 2000-line file into the directory shown under "Critical files". `OrderDetailPanel.tsx` becomes a re-export shim so callers (`AgentQueue`, `OrdersPageClient`, `QueuePage`) need zero import changes.

Lifted state lives only in `index.tsx`: `swrData`, `mutate`, `saveFlash/saveError`, `uploadOpen/uploadingCarrierId`, `dexpressModalOpen`, `scheduleDispatchOpen`, `reopenModalOpen`, `historyOpen/orderOpen/addProductOpen`, `phoneCopied`, `fulfillment*`, `deleteFeedback`, `uploadFeedback`, plus `runCommit`, `handleUploadToCarrier`, `handleDeleteCarrierBarcode`, `handleCancelSchedule`, `handleReopen`, `handleReturnToPool`, `handleFulfillmentOverride`, `handleCopyPhone`.

Sub-components receive only the slice of `order` they need plus relevant handlers, so each can be unit-tested without re-mounting the full SWR/Realtime tree.

`AddProductTrigger` (already a local subcomponent at file end) moves to `OrderDetailPanel/AddProductTrigger.tsx`.

## Implementation phases

Each phase is independently shippable (panel keeps working after every merge).

### Phase 0 — Scaffolding & TDD setup
- Add `surface.elevated` + `shadow-panel-elevated` to `tailwind.config.ts`
- Add `orders.detail.actions.*` keys to fr + ar
- Create `OrderDetailPanel/types.ts` + `usePrimaryAction.ts` + its test file. Make the helper green for every status row in the table
- Update `docs/design-system.md` with §4.9 "Panel variant" + §4.10 "Section label + icon"

### Phase 1 — Header + Hero + Footer skeleton
- Build `PanelHeader.tsx`, `CustomerHero.tsx`, `ActionFooter.tsx` + tests
- Build `Sheet.tsx` + `Menu.tsx` + tests
- Rewrite `OrderDetailPanel/index.tsx` mounting these + delegating sections to old inline blocks (still inside `index.tsx` temporarily)
- Behaviour parity: every existing button must still fire its existing handler. Same buttons, new visuals.

### Phase 2 — Section cards (Customer + Order Items)
- Extract `SectionCard.tsx` (new, white-only) and migrate the customer + order item blocks into `CustomerCard.tsx` and `OrderItemsCard.tsx`
- Remove `SECTION_ACCENT` map; replace each tinted card with `SectionCard` + lucide icon (`User`, `ShoppingBag`, `StickyNote`)
- Tests: `CustomerCard.test.tsx`, `OrderItemsCard.test.tsx`. Confirm no `bg-[#F3F7FC]` / `bg-[#F1F9F4]` / `bg-[#FFFCF2]` / `bg-[#F0EBFA]` survives

### Phase 3 — History + Fulfillment + Alerts
- Extract `HistoryTimeline.tsx`, `FulfillmentCard.tsx` (`Truck` icon), `AlertBanners.tsx`
- Tests for each
- Maintain RTL behaviour by re-using `historyLocale === "ar"` check inside `HistoryTimeline`

### Phase 4 — Overflow + Reopen Modal via Sheet primitive
- Replace ad-hoc reopen modal + carrier picker modal + dispatch modal overlay with `Sheet` (`placement="center"`)
- Wire `ActionFooter` overflow to `Menu` driven by `usePrimaryAction(order, role, userId).overflow`
- Tablet polish: footer buttons reach 44px hit area (`h-11`), pad phone-2 call icon, keep `sm:w-[480px]` width
- Replace `OrderDetailPanel.tsx` with re-export shim

## Test plan

Write tests BEFORE the corresponding component in each phase.

### `usePrimaryAction.test.ts`
- returns endCall for `pending` / `attempt_1` / `callback_scheduled` and forwards onCallTerminated
- returns uploadToCarrier for `confirmed` when canUploadToCarrier
- disables uploadToCarrier when `activeCarriers` is empty and surfaces `primaryDisabledNoCarrier`
- returns uploadNow for `dispatch_scheduled` and includes cancelSchedule in overflow
- returns close for `delivered` / `returned` / `cancelled` / `deleted` with empty overflow
- returns close for `rejected` and exposes reopen in overflow only when canReopenOrder is true
- manager overflow on confirmed includes cancel; agent overflow on confirmed includes scheduleDispatch
- agent on `uploaded` with `reference_deleted` reverts to confirmed action set

### `PanelHeader.test.tsx`
- renders 8-char uppercase id pill from `order.id`
- renders status badge with correct tone for confirmed (action)
- renders changeStatus link only for agent owner + confirmed
- does not render changeStatus link for manager on uploaded
- displays save-flash success then clears after 1500ms
- close button calls `onClose`

### `CustomerHero.test.tsx`
- renders name at `text-[22px] font-semibold` in non-terminal status
- mutes name color when status is delivered
- phone capsule renders `tel:` anchor with `order.customer_phone`
- copy button switches to Check icon for 1500ms after click
- phone-2 hidden when null and order not editable
- phone-2 visible as editable input when canEdit

### `AlertBanners.test.tsx`
- renders editBlockedStatus banner for uploaded without reference deletion
- omits editBlockedStatus banner when `isReferenceDeletedUpload` returns true
- renders scheduledCallbackBanner with locale-formatted date for ar-LY
- renders scheduledDispatchAutoBanner when `scheduled_dispatch_auto` is true
- cancel-schedule pill triggers `handleCancelSchedule` and shows `scheduledDispatchCanceling` label while pending

### `CustomerCard.test.tsx`
- renders pure white background (no tinted bg classnames)
- address `InlineField` commits via `runCommit`
- city `Combobox` commits `city_id`
- Libya order shows Dexpress state picker instead of `Combobox`
- note `InlineField` hidden when no note and not editable; visible when editable

### `OrderItemsCard.test.tsx`
- collapsed by default and toggle reveals receipt
- legacy line uses `runCommit(quantity:)`
- non-legacy line PATCHes `/api/orders/:id/items/:itemId`
- add-product trigger opens picker
- delivery fee commit updates
- card_payment toggle hidden for non-Libya orders
- grand total band uses `border-line-subtle`, no status-success border

### `HistoryTimeline.test.tsx`
- collapsed by default with badge count
- expanding sets `aria-expanded=true` and renders `<ol>`
- RTL locale renders `dir="rtl"`
- empty state renders emptyHistory text
- latest entry dot uses `bg-ink-primary`, older entries `bg-line-strong`

### `FulfillmentCard.test.tsx`
- not rendered for agent role
- damaged checkbox visible only when status select === returned
- submitting POSTs to `/api/orders/:id/fulfillment` with `is_damaged` when checked
- error state surfaces `fulfillmentNoteRequired` when note blank

### `ActionFooter.test.tsx`
- renders primary CTA label from `usePrimaryAction`
- clicking overflow trigger opens Menu with provided items
- Menu items invoke handlers and close menu
- ESC inside menu returns focus to trigger
- primary disabled state shows tooltip-equivalent text

### `OrderDetailPanel.integration.test.tsx` (extends existing file)
- keeps all three Dexpress eligibility cases passing
- confirmed order shows Upload primary, then after upload mutate transitions footer to Close
- terminal delivered shows muted hero and Close primary
- manager view on uploaded shows Cancel in overflow

### `Sheet.test.tsx`
- overlay click invokes `onClose`
- ESC invokes `onClose`
- focus traps inside dialog
- restores focus to previously focused element on unmount
- `side="end"` renders drawer width 480, `placement="center"` renders centered
- applies and removes document scroll lock

### `Menu.test.tsx`
- Down arrow moves focus to next item, wraps at end
- Home/End jump to first/last
- Enter activates focused item and closes menu
- ESC closes and returns focus to trigger
- disabled item ignores Enter

## Verification checklist

For each status group, open the panel on a TN (LTR/fr) and LY (RTL/ar) order. Test creds in CLAUDE.md.

### LTR (Tunisia / fr) — login `manager.tn@oms.local`
1. `pending` agent view — hero name fully colored, footer "Appel terminé", overflow shows "Retirer de l'agent". No tinted card backgrounds anywhere.
2. `attempt_2` — header pill `#XXXXXXXX`, status badge amber, no callback banner.
3. `callback_scheduled` — blue banner with date `dd/mm hh:mm`, overflow has "Replanifier le rappel".
4. `confirmed` agent view — footer primary "Envoyer au transporteur" (dark), overflow "Planifier la livraison". Order items card expanded by default.
5. `dispatch_scheduled` — banner with auto/manual variant, footer primary "Envoyer maintenant", inline cancel pill on banner works.
6. `uploaded` with tracking — TrackingBarcode shows, status badge action-tone, edit-blocked banner visible, footer primary "Fermer", overflow exposes "Supprimer le code-barres" + "Réouvrir" for agent.
7. `scanned` — inputs read-only; for M/S overflow exposes "Mise à jour fulfillment" which scrolls to FulfillmentCard.
8. `delivered` (terminal) — hero name muted gray, no phone-call capsule, footer primary "Fermer" only, no overflow trigger.
9. `rejected` within agent reopen window — footer overflow shows "Réouvrir la commande", confirming opens reopen Sheet, success warning surfaces.
10. `cancelled` — same as delivered muted, no overflow.

### RTL (Libya / ar) — login `manager.ly@oms.local`
11. Drawer slides from the start edge (visually left in RTL), `ps`/`pe` mirror correctly, phone-2 icon sits at end.
12. Libya `confirmed` — DexpressDispatchModal opens via carrier picker for the dexpress entry; address card uses the Libya state picker (`dir="auto"`).
13. `dispatch_scheduled` banner reads Arabic, cancel pill labelled correctly.
14. Libya `uploaded` with Dexpress — DexpressStatusSection mounts with `enabled=true` and renders Arabic timeline; barcode component shows; overflow translates correctly.
15. Libya `delivered` (terminal) — RTL mirror intact, hero muted, history default-open.
16. Tab through every interactive control in both locales — focus ring (neon green) visible, focus order matches DOM order both in LTR and RTL.
17. Resize to tablet 820px — drawer stays 480px, buttons >= 44px hit area, hero phone capsule wraps cleanly.
18. Resize to mobile 390px — drawer goes full-width, footer single-column stacking, overflow menu still positions inside viewport.

Run `npm run typecheck`, `npm run lint`, `npm run test:run`, `npm run build` after each phase.

## What we are explicitly NOT doing

- Not changing any server route, RPC, or SQL — `/api/orders/:id/*` endpoints, RLS, and order-state machine stay as is.
- Not introducing framer-motion or any new animation library; motion stays CSS `duration-fast` / `duration-base`.
- Not redesigning `TrackingBarcode`, `DexpressStatusSection`, `DexpressDispatchModal`, `ScheduleDispatchModal`, `AddProductPicker`, `CallbackPicker`, `PostCallActionSheet`, or `RejectionReasonPicker` — they keep their current chrome; only their hosting wrapper changes.
- Not unifying `STATUS_TONE` and `statusToneClass` into a single helper (out of scope; would touch popovers across the app).
- Not introducing a global theming system, dark-mode toggle, or design tokens outside the current Tailwind config.
- Not touching the agent queue list (`OrderCard.tsx`, `QueueList.tsx`) — they previously consumed the panel and continue to mount it through the re-export shim.
- Not adding a Toast/notification primitive — save-flash + upload feedback continue to render inline as today.
- Not migrating older callers (admin / settings ad-hoc modals) onto the new `Sheet` primitive in this PR; deferred to follow-up tickets.
- Not changing keyboard shortcut bindings (`E` to edit name, `Escape` to close) — they remain attached at `index.tsx` level.
- Not introducing a `Modal` component named `Modal`; `Sheet` covers both side-drawer and centered-dialog use cases under one API to avoid two primitives that overlap.
