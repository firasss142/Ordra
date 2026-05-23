# Show the hovered order in the duplicate & repeat-buyer popovers

## Context

Today the popovers don't reliably reflect the order you're hovering on:

- **Duplicate popover** — already prepends the hovered order as a violet anchor card, but the user wants the anchor to read more obviously as "this is the order you're looking at" (a stronger visual signal — currently the only cue is the violet tint, easy to miss).
- **Repeat-buyer popover** — does NOT include the hovered order at all. The customer-history RPC explicitly excludes it via `p_exclude_order_id`, so `detail.orders` only contains *prior* orders. As a result, hovering a row only shows other duplicate/recurrent orders and not the row itself.

The desired UX (confirmed with the user):
- Both popovers show the hovered order alongside its siblings/history, **merged into a single list sorted by date (newest first)**. The hovered order stays in its natural date position rather than being pinned to the top.
- The hovered order is marked with a **stronger visual accent** (violet tint + an inline-start violet accent bar) so it's unmistakably "this row" — works for both popovers and removes the need for an "anchor goes first" rule.
- The repeat-buyer header count includes the hovered order (`N+1`).
- For CRM lead rows (`AgentLeadsQueue`), the hovered LEAD is also rendered in the popover with the fields a lead has (name/address/city/created_at + lead status).

## Recommended approach

### 1. `RelatedOrderCard` — strengthen the anchor accent
File: [src/components/shared/RelatedOrderCard.tsx](src/components/shared/RelatedOrderCard.tsx)

Today (`isAnchor` is already a prop): anchor cards just get `bg-[#F4F1FE]`. Bump the cue to:
- Same violet fill (`bg-[#F4F1FE]`)
- Solid (non-dashed) left border bar in the brand violet `#7C3AED` (`border-l-4`, switching the card's `border-dashed border-[#C9BCF5]` to keep the other sides dashed but the inline-start side a solid 4px violet — use logical `border-s-4 border-s-[#7C3AED]` for RTL safety).
- Allow a tiny new optional prop `unknownPrice` (hides the price block when totalPrice is null) so lead anchors can omit the price cleanly.

### 2. `RepeatBuyerBadge` — accept hovered-order props and render it inline by date
File: [src/components/shared/RepeatBuyerBadge.tsx](src/components/shared/RepeatBuyerBadge.tsx)

- Extend `RepeatBuyerBadgeProps` with 9 new fields mirroring DuplicateOrderBadge's anchor props: `anchorOrderId`, `anchorStatus`, `anchorCreatedAt`, `anchorTotalPrice` (number | null — null for leads), `anchorProductName`, `anchorProductImageUrl`, `anchorCustomerName`, `anchorCustomerAddress`, `anchorCustomerCity`.
- In `PopoverPanel`: build a unified array `const merged = [anchorRow, ...orders]`, sort by `created_at` desc (most recent first), `slice(0, 6)` for display, and render each as `<RelatedOrderCard isAnchor={row.id === anchorOrderId} ... />`. The anchor entry never shows the "delete" action.
- Header text: change to `t("totalOrders", { count: (stats?.total_orders ?? priorOrderCount) + 1 })` so the count reflects the merged list.
- Keep the risk callout, "See all orders" link, and `plusLeads` line unchanged.

### 3. `DuplicateOrderBadge` — switch to merge-by-date (still flags anchor)
File: [src/components/shared/DuplicateOrderBadge.tsx](src/components/shared/DuplicateOrderBadge.tsx)

- Replace the "anchor first, then `rows.map`" pattern with a unified `merged = [anchorRow, ...rows]`, sort by `created_at` desc, render each as `<RelatedOrderCard isAnchor={row.id === anchorOrderId} ... />`.
- Sibling-only props (`alreadyShipped`, `rightSlot` delete button) are still gated by `row.id !== anchorOrderId`.
- The bumped accent from §1 visually identifies the hovered row regardless of its position in the date order.

### 4. Call sites — pass the new anchor props
- [src/components/orders/OrderRow.tsx](src/components/orders/OrderRow.tsx) — extend the `<RepeatBuyerBadge ... />` call with the same anchor fields already passed to `<DuplicateOrderBadge>`.
- [src/components/queue/OrderCard.tsx](src/components/queue/OrderCard.tsx) — same.
- [src/components/crm/AgentLeadsQueue.tsx](src/components/crm/AgentLeadsQueue.tsx) — extend the `<RepeatBuyerBadge ... />` for leads:
  - `anchorOrderId={l.id}`, `anchorStatus={l.status}`, `anchorCreatedAt={l.created_at}`, `anchorTotalPrice={null}` (no price on leads — RelatedOrderCard hides the block when null), `anchorProductName={null}`, `anchorProductImageUrl={null}`, `anchorCustomerName={l.customer_name}`, `anchorCustomerAddress={l.customer_address ?? null}`, `anchorCustomerCity={l.customer_city ?? null}`.
  - This requires `customer_address`/`customer_city` on the lead row type — check `useAgentLeadQueue` and the lead query select. If they're not selected today, add them to the select + type (small follow-on).

### 5. i18n
No new keys needed for orders. For the leads case, the existing `unknownCustomer` covers the name fallback; we'll hide the price block at the component level when `totalPrice` is null (no string needed). If the lead's `status` produces a label not in `orders.statuses`, fall back to a `t("leadStatus." + status, { default: status })` lookup or pass a precomputed label — defer until we run into a missing key.

### Critical files
- `src/components/shared/RelatedOrderCard.tsx` (+ its test)
- `src/components/shared/RepeatBuyerBadge.tsx` (+ its test)
- `src/components/shared/DuplicateOrderBadge.tsx` (+ its test)
- `src/components/orders/OrderRow.tsx`, `src/components/queue/OrderCard.tsx`, `src/components/crm/AgentLeadsQueue.tsx`
- Possibly `src/hooks/useAgentLeadQueue.ts` (if address/city missing on lead row)

## TDD
Per project rule, write failing tests first:

- **RelatedOrderCard**: a new test asserting the anchor accent — `isAnchor` adds the solid violet inline-start border class and keeps the violet fill; `totalPrice={null}` hides the price block (new "lead-anchor" case).
- **DuplicateOrderBadge** test: assert the anchor card is rendered AT THE POSITION matching its `created_at` in the merged sort, not always at index 0.
- **RepeatBuyerBadge** test: with a hovered order + 2 prior orders mocked from `useCustomerHistory`, the popover shows 3 cards total, sorted by date, with `isAnchor` applied to the one matching `anchorOrderId`. Header reads `Total Orders: 3` (3 = 2 priors + 1 hovered).

## Verification
1. `npm test` → all touched component tests pass.
2. `npm run typecheck` → clean.
3. `npm run dev` → on the orders list, hover a row marked as a duplicate anchor: the popover lists the hovered order + its siblings sorted by date, with the hovered row clearly accented. Hover a recurrent badge: the popover lists the hovered order alongside prior orders, sorted by date, header reads N+1.
4. Switch to CRM agent leads queue and hover a lead's repeat-buyer badge: the lead appears as the accented card with name/address/city/date, prior orders below, no price block on the lead row.
5. RTL (`/ar`): logical `border-s-4` keeps the accent on the start side; layout flips correctly.
6. `npm run build` → green.

## Out of scope
- Changing the customer-history RPC to include the source order (avoid DB migration; we already have all the data on the client via the row being hovered).
- Re-styling the popover headers or footers beyond the count update.
- AgentLeadsQueue's lead-status pill colors (statusToneClass falls back to neutral for unknown lead statuses, which is acceptable).
