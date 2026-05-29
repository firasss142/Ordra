# Fix duplicate + repeat-buyer badges

## Context

Two issues surfaced on the order list / queue / detail surfaces:

1. **Both badges keep appearing on deleted anchors.** The repeat-buyer badge and the duplicate badge render based on enrichment fields that the API attaches to every row, but neither badge checks the anchor's own status. When a row is `status='deleted'` (visible only via `include_deleted=true` on the list, or by navigating to `/orders/[id]` directly), the badges still render — visual noise on a dead row.

2. **Deleted prior orders inflate the repeat-buyer count.** [`get_customer_history_batch`](supabase/migrations/20260611000001_repeat_buyer_rpc.sql) counts every matching order in the market regardless of status. If a customer's three prior orders were all deleted, the next order is still classified as `repeat`. The popover detail RPC ([`get_customer_history_detail`](supabase/migrations/20260720000005_customer_history_customer_name.sql)) also lists deleted orders in the timeline. The user's rule: **deleted only** — cancelled and rejected still count toward repeat-buyer (the customer did try to buy).

3. **Duplicate detection misses real duplicates** when the customer changes the quantity on the re-order. Current rule requires same phone + same product + **same quantity** + 24h window. The quantity constraint is too strict. The user wants to drop it; phone + product + window is enough.

## Recommended changes

### A. Hide both badges when anchor status is `deleted`

Pure UI guard. The enrichment fields are still computed and returned (cheap, and useful elsewhere) — we just don't render the badge when the row itself is dead.

**Edit these render sites** to add `&& order.status !== 'deleted'` (or `lead.status !== 'deleted'` for the lead variant) to the existing condition:

| File | Lines | Current condition | New condition |
|---|---|---|---|
| [src/components/orders/OrderRow.tsx](src/components/orders/OrderRow.tsx#L223-L267) | 223–224 (wrapper) + 247 (inner) | `(order.repeat_kind && order.repeat_kind !== "none") \|\| (order.is_potential_duplicate && order.is_duplicate_anchor)` | Add `order.status !== "deleted" && ` prefix on the wrapper. The inner `is_potential_duplicate && is_duplicate_anchor` check at line 247 stays as-is (already guarded by the wrapper). |
| [src/components/queue/OrderCard.tsx:338](src/components/queue/OrderCard.tsx#L338) and [:361](src/components/queue/OrderCard.tsx#L361) | wrapper + duplicate inner | same combined condition | same `order.status !== "deleted"` prefix on the wrapper. Note: agent queue does NOT include deleted statuses today, so this is defense-in-depth — keeps the component robust if queue filters ever change. |
| [src/components/orders/OrderDetail.tsx:144](src/components/orders/OrderDetail.tsx#L144) | duplicate badge | `order.is_potential_duplicate && order.is_duplicate_anchor` | add `order.status !== "deleted"` |
| [src/components/orders/OrderDetail.tsx](src/components/orders/OrderDetail.tsx) (repeat badge — find render site) | search for `RepeatBuyerBadge` use; if absent, skip | — | add same guard if present |
| [src/components/crm/AgentLeadsQueue.tsx:323](src/components/crm/AgentLeadsQueue.tsx#L323) | `l.repeat_kind && l.repeat_kind !== "none"` | add `l.status !== "deleted"` (leads can be soft-deleted — verify the field exists on the lead row; if not, skip this file) | — |

**Per CLAUDE.md (TDD)**: extend [src/components/orders/__tests__/OrderRow.test.tsx](src/components/orders/__tests__/OrderRow.test.tsx) with a failing test asserting that a row with `status: 'deleted'` AND `repeat_kind: 'repeat'` AND `is_potential_duplicate: true, is_duplicate_anchor: true` renders neither badge. Add the equivalent test in [src/components/queue/__tests__/OrderCard.test.tsx](src/components/queue/__tests__/OrderCard.test.tsx). Currently `RepeatBuyerBadge` is mocked at [OrderRow.test.tsx:19](src/components/orders/__tests__/OrderRow.test.tsx#L19) — the test should query for `[data-testid="repeat-buyer-badge"]` or for the inline-end customer block layout and assert the badge container is absent.

### B. Exclude deleted prior orders from repeat-buyer count + popover history

Two functions, one new migration. **Only filter `status = 'deleted'`** — cancelled / rejected still count (they were genuine purchase attempts).

**New migration:** `supabase/migrations/<next-timestamp>_customer_history_exclude_deleted.sql`

Recreate both functions from their latest definitions:
- [`get_customer_history_batch`](supabase/migrations/20260611000001_repeat_buyer_rpc.sql) — base definition; the orders→counts CTE never got a status filter
- [`get_customer_history_detail`](supabase/migrations/20260720000005_customer_history_customer_name.sql) — latest definition (already returns customer_name in the popover)

In **both** functions, add `AND o.status::TEXT <> 'deleted'` to the `orders` join predicate(s):

- `get_customer_history_batch`:
  - `order_phone_matches` CTE — add the filter on the join
  - `order_identity_matches` CTE — add the filter on the join
  - **Do not** add it to `lead_phone_matches` — leads don't have the same status model and we only count them as a weak signal.
- `get_customer_history_detail`:
  - `matched` CTE — add the filter inside the `WHERE`

This naturally cascades: `prior_order_count`, `prior_delivered_count`, `prior_returned_count`, `prior_rejected_count`, `phone_matched`, and `last_known_address` all derive from the filtered set. The `total_orders` / `delivered_count` / etc. in the detail aggregate also derive from the filtered `v_orders`.

**No code changes** needed in [src/lib/customer-history/classify.ts](src/lib/customer-history/classify.ts) or [src/lib/customer-history/enrich.ts](src/lib/customer-history/enrich.ts) — they consume whatever the RPC returns.

### C. Drop the same-quantity constraint in duplicate detection

**Same new migration** (bundle the SQL changes — one round-trip for review): recreate [`get_duplicate_orders_batch`](supabase/migrations/20260720000004_duplicate_siblings_customer_fields.sql) (latest definition) and **remove** the line:

```sql
-- same quantity
AND o.quantity = i.qty
```

Keep everything else: phone match, product match (id-or-name fallback), 24h window, dead-sibling exclusion. The popover already shows quantity per sibling card, so a mismatched-qty duplicate is visually distinguishable to the agent.

**Index hygiene**: the existing index [`idx_orders_market_dup`](supabase/migrations/20260626000001_duplicate_orders_rpc.sql#L18) is `(market_id, product_id, quantity, created_at)`. After dropping the quantity filter, `quantity` becomes useless in the index. Leave it for now (no functional impact, minor planner cost) — the index migration is out of scope for this fix.

### D. Tests

**Update existing tests:**

- [src/lib/duplicate-orders/detect.test.ts](src/lib/duplicate-orders/detect.test.ts) — the pure-derivation tests don't touch quantity, so no changes here. Add **no** test for the SQL quantity change — it's a SQL-only change and we don't have RPC-level tests.
- [src/components/orders/__tests__/OrderRow.test.tsx](src/components/orders/__tests__/OrderRow.test.tsx) — add the "deleted anchor hides badges" test described in section A.
- [src/components/queue/__tests__/OrderCard.test.tsx](src/components/queue/__tests__/OrderCard.test.tsx) — same.
- [src/components/orders/OrderDetail tests](src/components/orders/) — if a test file exists for OrderDetail, add the same assertion; if not, skip.

**No update needed:**
- [src/components/shared/RepeatBuyerBadge.test.tsx](src/components/shared/RepeatBuyerBadge.test.tsx) and [DuplicateOrderBadge.test.tsx](src/components/shared/DuplicateOrderBadge.test.tsx) — these test the badge components in isolation; the deleted-anchor guard is at the parent (render-site) level, not inside the badge. Tests stay green.
- [src/lib/customer-history/classify.test.ts](src/lib/customer-history/classify.test.ts) — classification logic is unchanged.

## Files modified

1. `src/components/orders/OrderRow.tsx` — guard
2. `src/components/queue/OrderCard.tsx` — guard
3. `src/components/orders/OrderDetail.tsx` — guard
4. `src/components/crm/AgentLeadsQueue.tsx` — guard (if lead has a deleted status; otherwise skip)
5. `src/components/orders/__tests__/OrderRow.test.tsx` — new test
6. `src/components/queue/__tests__/OrderCard.test.tsx` — new test
7. **New** `supabase/migrations/<next>_customer_history_exclude_deleted_and_dup_relax.sql` — recreates `get_customer_history_batch`, `get_customer_history_detail`, `get_duplicate_orders_batch`

## Verification

1. `npm test -- OrderRow OrderCard` — new TDD tests fail on red, pass after the guard is added.
2. `npm run typecheck` — no type changes; should be clean.
3. **Apply the migration locally** against the dev Supabase instance, then exercise in the dev server (`npm run dev`):
   - **Repeat-buyer**: log in as a Tunisia manager. Find a customer with N prior orders, manually mark one prior order `deleted` via the manager delete flow, refresh `/fr/orders`. The badge count must decrement by 1; popover history must no longer list the deleted order.
   - **Duplicate**: create two orders for the same customer + same product but different quantities, within 24h, in the same market. The badge should now appear on the newer order. Open the popover: the older order should be listed as a sibling.
   - **Deleted anchor**: navigate to `/fr/orders?include_deleted=true`, find a deleted order that has a duplicate sibling AND repeat-buyer history. Confirm neither badge renders on the deleted row, while the live sibling (also visible in the list) still shows the duplicate badge anchored on it.
4. `npm run build` — verify no regressions for the Vercel deploy.
