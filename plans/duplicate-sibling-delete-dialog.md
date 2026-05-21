# Plan: Icon-only duplicate marker + deletable-sibling dialog

## Context

Today, a potential duplicate order shows an amber **"Doublon · {count}"** text badge (`Layers` icon + text)
that reveals its sibling orders on *hover* via a portal popover (`src/components/shared/DuplicateOrderBadge.tsx`).
The popover is read-only — you can see siblings and a "see order" link, but you cannot act on them.

The ask: go deeper. Every duplicate order should carry a **pure icon** (no "Doublon" text), and **clicking** that
icon opens a **dialog** that lists the sibling orders with their statuses communicated clearly (inspired by the
customer-orders popup card layout). Critically, each sibling must be **deletable directly from that dialog** — and
that delete must work from the **agent**, **manager**, and **admin** interfaces.

Locked decisions (from user):
1. **Marker** = icon-only button (`Layers`), optional tiny count superscript, no text. Click → dialog.
2. **Delete permission** = agents CAN delete, but **only verified duplicate siblings, nothing more**. This is a NEW
   scoped permission, separate from the general manager/admin cancel power (which keeps agent = false). The safety
   gate: the server independently re-verifies the target is a genuine duplicate sibling before allowing any delete.
3. **Delete UX** = confirm prompt → soft-delete (existing `manual_delete_orders` RPC, `status='deleted'`,
   append-only `order_history`) → dialog updates + marker recounts.

Outcome: a single click-to-open dialog that surfaces duplicate siblings and lets any in-market role clean them up
safely, with the server as the single authority on who can delete what.

## Architectural decisions

- **New dedicated route** `POST /api/orders/[id]/delete-duplicate` — NOT a query-param on `cancel`. Keeps the
  agent-scoped bypass isolated from `canCancelOrder` (agent = false) and independently testable. `[id]` = the
  **anchor** order (whose dialog was opened); the **target sibling id** comes in the body.
- **Security gate lives in a shared lib** `src/lib/orders/duplicate-delete.ts`, not inline in the route, so it is
  unit-testable without a NextRequest. Mirrors how `manualDeleteOrders` isolates carrier-void + RPC.
- **Replace, don't rename** the badge component — keep filename/exports `DuplicateOrderBadge` and the
  `data-duplicate="true"` marker to minimize churn at the 3 call sites; change internals from hover-popover to
  click-dialog. New props are optional so existing usages compile.
- **No `ui/Modal` primitive exists** (verified). Follow the established per-feature portal pattern from
  `src/components/in-delivery/EscalateCarrierModal.tsx`: `createPortal` to body, `role="dialog" aria-modal="true"`,
  Escape + overlay-click to close.

## Step 1 — Permission function (`src/lib/order-permissions.ts`)

```ts
export function canDeleteDuplicateSibling(
  role: Role,
  targetMarketId: string,
  actorMarketId: string,
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") return targetMarketId === actorMarketId;
  if (role === "agent") return targetMarketId === actorMarketId;
  return false; // warehouse_agent etc.
}
```

Contract: this is only the **market-scope half** of the gate. The **genuine-sibling half** is enforced by re-running
`enrichRowsWithDuplicates` server-side (Step 2). Status eligibility reuses the existing
`canManuallyDeleteOrderStatus` — no new status set. Deliberately distinct from `canCancelOrder` (untouched).

## Step 2 — Verification lib (`src/lib/orders/duplicate-delete.ts`, new)

`verifyAndDeleteDuplicateSibling(supabase, admin, { anchorId, targetId, actor })`. Exact check order (this IS the
security model — an agent passing an arbitrary `targetId` must fail):

1. **Load anchor** (`id, status, market_id, customer_phone, customer_phone_2, product_id, product_name, quantity, created_at, assigned_to`). 404 if missing.
2. **Anchor visibility:** `canViewOrders(actor.role, anchor.market_id, actor.market_id ?? "")`. For agents, additionally require `anchor.assigned_to === actor.id` (matches `dispatch/route.ts` ownership precedent). Else 403/404.
3. **Re-run duplicate RPC:** `enrichRowsWithDuplicates(supabase, anchor.market_id, [anchor])` → authoritative, RLS-respecting sibling set (same pattern as `dispatch/route.ts:96-100`).
4. **Sibling membership:** `targetId` MUST be in `dup.duplicate_siblings.map(s => s.id)`. Else **422 `not_a_duplicate_sibling`**. This is the gate making arbitrary-id deletion impossible (RPC enforces same-market + phone/product/qty/24h, excludes dead statuses, under the actor's own RLS-scoped client).
5. **Permission:** `canDeleteDuplicateSibling(actor.role, anchor.market_id, actor.market_id ?? "")`.
6. **Status deletable:** load target `ManualDeleteOrderRow` (`id, status, market_id, tracking_number, carrier_id`); require `canManuallyDeleteOrderStatus(target.status)`. Else 400.
7. **Soft-delete:** `manualDeleteOrders(supabase, admin, { orders: [targetRow], actorId: actor.id, note: "Duplicate sibling deleted via duplicate dialog" })` — reuses carrier-void + append-only `manual_delete_orders` RPC.
8. **Return** `{ deleted_id, anchor: <re-enriched duplicate fields> }` so the client can recount.

Reuse error classes `ManualDeleteCarrierVoidError` / `ManualDeleteRpcError`; map to 409/500 like the cancel route.

## Step 3 — Route (`src/app/api/orders/[id]/delete-duplicate/route.ts`, new)

Thin handler modeled on `cancel/route.ts`:
- `getActor(req)` (401 path handled by helper).
- Parse body `{ sibling_id: string }`; 400 if absent; 400 if `sibling_id === id` (use cancel for the anchor itself).
- `verifyAndDeleteDuplicateSibling(supabase, createAdminClient(), { anchorId: id, targetId: sibling_id, actor })`.
- Map typed errors → statuses; success `{ data: { deleted_id, anchor } }`.

## Step 4 — Component (`src/components/shared/DuplicateOrderBadge.tsx`, rewrite)

Keep export `DuplicateOrderBadge` + `data-duplicate="true"`. New optional props: `anchorOrderId: string`,
`canDelete?: boolean`, `onChange?: () => void`.

- **Trigger:** icon-only `<button type="button">` — `Layers` icon, `aria-label={t("trigger.aria",{count})}`, tiny count superscript when `count > 1`, retains `data-has-shipped`. Warning ring (`ring-1 ring-status-warning/40`, or `ring-status-critical/40` when `hasUploadedSibling`). Logical-property paddings (RTL). `onClick` → open + `stopPropagation` (don't trigger row/card nav).
- **Dialog:** click-opened portal modal per `EscalateCarrierModal` pattern — overlay `rgba(26,26,26,0.5)`, Escape + overlay-click close, centered white card reusing RepeatBuyerBadge card classes (`rounded-lg border border-line-subtle bg-surface-card shadow-[0_8px_24px_rgba(0,0,0,0.10)] p-3`). Title row `AlertTriangle` + `t("dialog.title")`, subtitle.
- **Sibling list:** same layout as `RepeatBuyerBadge.tsx:204-225` — `flex justify-between gap-2 text-[12px]`, `#external_id` font-medium tabular-nums, date `text-ink-muted`, status pill `rounded-pill px-1.5 py-[1px] text-[11px]` + `statusToneClass`, product×qty line, "shipped" critical chip, "see order" external link.
- **Per-sibling Delete button:** shown only when `canDelete` AND `canManuallyDeleteOrderStatus(s.status)`. Destructive text-button (`text-status-critical`, `Trash2`), `aria-label={t("dialog.deleteAria",{externalId})}`.
- **Delete flow:** click → `window.confirm(t("dialog.confirm"))` → `setBusyId(s.id)` → `fetch(/api/orders/${anchorOrderId}/delete-duplicate, {method:POST, body:{sibling_id:s.id}})`. On ok: optimistically drop sibling, call `onChange?.()`, auto-close + `t("dialog.empty")` when list empties. On error: inline `t("dialog.error")`.

## Step 5 — Wiring at the 3 render sites

Server is the real gate; `canDelete` is a UX affordance only → pass `true` for in-market lists. Pass `anchorOrderId={order.id}` everywhere.

- **`src/components/queue/OrderCard.tsx`** (~336-342): add `anchorOrderId`, `canDelete`, `onChange`. Thread a new optional `onMutate?: () => void` through `OrderCardProps` ← `QueueList` ← `QueuePage`, wiring to `useAgentQueue().mutate` (QueuePage:168).
- **`src/components/orders/OrderRow.tsx`** (~230-236): add props; parent chain `OrdersTable → OrdersPageClient` already has `role` + `mutate` (OrdersPageClient:162). Pass down and wire `onChange` to `mutate`.
- **`src/components/orders/OrderDetail.tsx`** (~140-146): `anchorOrderId={order.id}`, `canDelete` (from `user.role` in scope:185), `onChange={() => mutate()}` (SWR mutate:76).

## Step 6 — i18n (`src/messages/fr.json` + `ar.json`, `duplicateOrder.*`)

Keep `popover.*` (sub-labels still used) + `uploadGuard.*`. Remove `badge.label`. Add `trigger.aria` and `dialog.*`
(`title`, `subtitle`, `delete`, `deleteAria`, `confirm`, `deleting`, `empty`, `error`). FR + AR copy:

```jsonc
// fr.json
"trigger": { "aria": "{count} doublon(s) possible(s) — ouvrir" },
"dialog": {
  "title": "Doublons possibles",
  "subtitle": "Même client, produit et quantité. Vérifiez avant de supprimer.",
  "delete": "Supprimer",
  "deleteAria": "Supprimer la commande #{externalId}",
  "confirm": "Supprimer définitivement cette commande en double ? Cette action est journalisée.",
  "deleting": "Suppression…",
  "empty": "Aucun doublon restant.",
  "error": "Échec de la suppression. Réessayez."
}
// ar.json
"trigger": { "aria": "{count} تكرار محتمل — فتح" },
"dialog": {
  "title": "تكرارات محتملة",
  "subtitle": "نفس العميل والمنتج والكمية. تحقق قبل الحذف.",
  "delete": "حذف",
  "deleteAria": "حذف الطلب رقم #{externalId}",
  "confirm": "هل تريد حذف هذا الطلب المكرر نهائيًا؟ يتم تسجيل هذا الإجراء.",
  "deleting": "جارٍ الحذف…",
  "empty": "لا توجد تكرارات متبقية.",
  "error": "فشل الحذف. حاول مرة أخرى."
}
```

Status labels keep reusing `orders.statuses.<status>`.

## Step 7 — TDD test plan (red → green)

- **`src/lib/order-permissions.test.ts`** (extend): `canDeleteDuplicateSibling` — super_admin true any market; manager true same / false cross; agent true same / false cross; warehouse_agent false.
- **`src/lib/orders/duplicate-delete.test.ts`** (new, mock supabase + `enrichRowsWithDuplicates`): target not in re-derived siblings → `not_a_duplicate_sibling` (core security test); agent not owner → reject; cross-market agent → reject; non-deletable target status → reject; happy path → calls `manualDeleteOrders` with `[targetRow]` + returns re-enriched anchor; carrier-void error → 409.
- **`src/app/api/orders/[id]/delete-duplicate/route.test.ts`** (new, mirror `cancel/route.test.ts` harness): 401; 400 missing sibling_id; 400 sibling_id===id; 422 not-verified; 200 agent deletes verified sibling (asserts `manual_delete_orders` called with `[sibling_id]`); 403 cross-market.
- **`src/components/shared/DuplicateOrderBadge.test.tsx`** (rewrite, reuse next-intl mock + sibling factory, mock fetch): icon-only trigger (no "Doublon" text), `data-duplicate` present, superscript when count>1; click opens `role="dialog"`; siblings listed w/ status pill+date; delete button shown when `canDelete`+deletable, hidden otherwise; delete → confirm(true) → POST to `/api/orders/{anchor}/delete-duplicate` w/ `{sibling_id}` → sibling disappears + `onChange` called; `hasUploadedSibling` → critical ring + shipped chip; locale "ar" smoke.

## Step 8 — Verification

- `npm run typecheck` after each file; `npm run lint` before commit.
- TDD: run the four test files red→green, then `npm run test:run` full pass, `npm run build`.
- Manual E2E (`npm run dev`) + Playwright MCP, seeded users:
  1. `agent1.ly`: agent queue → click `Layers` marker → dialog lists siblings → delete a `pending`/`confirmed` sibling → confirm → row disappears, marker recounts/vanishes. Verify a non-owned anchor → server 404.
  2. `manager.ly`: orders table, same flow; confirm TN order invisible/forbidden (cross-market).
  3. `admin`: order detail panel delete; confirm `order_history` got an append-only `deleted` row, stock unaffected pre-`scanned`.
  4. Negative: request with a non-sibling `sibling_id` → expect 422.

## Critical files
- `src/components/shared/DuplicateOrderBadge.tsx` (rewrite)
- `src/lib/order-permissions.ts` (add `canDeleteDuplicateSibling`)
- `src/lib/orders/duplicate-delete.ts` (new) — reuses `manualDeleteOrders` from `src/lib/orders/manual-delete.ts`
- `src/app/api/orders/[id]/delete-duplicate/route.ts` (new) — template `src/app/api/orders/[id]/cancel/route.ts`
- `src/lib/duplicate-orders/detect.ts` — `enrichRowsWithDuplicates` is the server re-verification gate
- Render sites: `src/components/queue/OrderCard.tsx`, `src/components/orders/OrderRow.tsx`, `src/components/orders/OrderDetail.tsx` (+ parent chains for `mutate`)
- i18n: `src/messages/fr.json`, `src/messages/ar.json`
