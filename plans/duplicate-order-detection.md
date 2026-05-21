# Duplicate Order Detection + Warning

## Context

Orders arrive from storefronts (often abandoned carts that the customer later re-submits), producing **two distinct order rows** with different `external_id` for what is essentially the **same physical order**: same customer phone + same product + same quantity, placed close together in time. Because nothing flags this, an agent can accidentally **upload the same order to the carrier twice** — shipping and paying for it two times.

This is **distinct from the existing "recurrent buyer" feature** (`repeat_kind` / `RepeatBuyerBadge`), which is about a customer ordering *different* things over their lifetime. The two are different concepts and must look different in the UI so agents don't confuse them.

**Outcome:** detect potential duplicate orders, surface a clear, minimalist warning badge + tooltip everywhere orders are listed, and require the agent to explicitly confirm before uploading an order whose duplicate sibling is **already shipped to the carrier**.

### Confirmed requirements
- **Duplicate rule:** another order in the same market with the **same normalized phone** AND **same product** (`product_id`, fallback `product_name`) AND **same quantity**, within a **24-hour window** (either direction). Dead orders (`cancelled`, `deleted`, `rejected`, `returned`) are **ignored** — they aren't a re-shipping risk.
- **Upload guard:** **warn + require confirm** (never hard-block). If a sibling is already shipped to carrier, the agent sees a confirm dialog and may proceed.
- **Placement:** agent queue card, orders table row, **and** order detail view.
- **"Already shipped to carrier"** = sibling status ∈ `(uploaded, scanned, dispatched, deposit, in_transit, delivered)`.

### Architecture being mirrored
This feature deliberately mirrors the existing repeat-buyer pattern. One deliberate divergence: duplicate sibling sets are tiny (1–3 rows), so the popover data ships **inline with the batch RPC** — no lazy detail route/hook needed.

---

## Implementation (TDD order)

### Step 1 — Detection lib (test first)
**New:** `src/lib/duplicate-orders/detect.ts` + `src/lib/duplicate-orders/detect.test.ts`

Mirror `src/lib/customer-history/enrich.ts`. Same defensive contract: no market / no rows / RPC error / throw → every row gets an EMPTY enrichment (never break the list).

```ts
export interface SiblingOrder {
  id: string;
  external_id: string | null;
  status: string;
  created_at: string;
  product_name: string | null;
  quantity: number;
  already_shipped: boolean;
}

export interface DuplicateEnrichment {
  is_potential_duplicate: boolean;
  duplicate_count: number;
  duplicate_siblings: SiblingOrder[];
  has_uploaded_sibling: boolean;
}

// Pure, unit-testable — no DB
export function deriveDuplicateEnrichment(siblings: RawSibling[]): DuplicateEnrichment;

// Mirrors enrichRowsWithCustomerHistory signature
export async function enrichRowsWithDuplicates<T extends EnrichableRow>(
  supabase, marketId: string | null, rows: T[],
): Promise<(T & DuplicateEnrichment)[]>;
```

`EnrichableRow` needs `id, customer_phone, customer_phone_2, product_id, product_name, quantity, created_at`.

**Tests** (mirror `src/lib/customer-history/classify.test.ts` — pure, no mocks): zero siblings → not duplicate; ≥1 → correct count; `has_uploaded_sibling` true only when a sibling is shipped; per-sibling `already_shipped` correct across each status.

### Step 2 — SQL RPC migration
**New:** `supabase/migrations/20260626000001_duplicate_orders_rpc.sql` (timestamp after the latest existing migration).

Reuses `normalize_phone()`, `get_user_role()`, `get_user_market_id()`. `SECURITY DEFINER`, `STABLE`, market isolation identical to `get_customer_history_batch`.

```sql
CREATE INDEX IF NOT EXISTS idx_orders_market_dup
  ON orders (market_id, product_id, quantity, created_at);

CREATE OR REPLACE FUNCTION get_duplicate_orders_batch(
  p_market_id UUID,
  p_rows JSONB   -- [{id, phone, phone_2, product_id, product_name, quantity, created_at}]
)
RETURNS TABLE (source_id UUID, duplicate_count INT, siblings JSONB)
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $$
DECLARE v_caller_role TEXT; v_caller_market UUID;
BEGIN
  v_caller_role := get_user_role();
  v_caller_market := get_user_market_id();
  IF v_caller_role IS DISTINCT FROM 'super_admin'
     AND v_caller_market IS DISTINCT FROM p_market_id THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH inputs AS (
    SELECT (r->>'id')::UUID AS src_id,
           normalize_phone(r->>'phone')   AS np,
           normalize_phone(r->>'phone_2') AS np2,
           NULLIF(r->>'product_id','')::UUID AS pid,
           lower(coalesce(trim(r->>'product_name'),'')) AS pname,
           coalesce((r->>'quantity')::INT, 0) AS qty,
           (r->>'created_at')::TIMESTAMPTZ AS created_at
    FROM jsonb_array_elements(p_rows) AS r
  ),
  matches AS (
    SELECT i.src_id, o.id, o.external_id, o.status::TEXT AS status,
           o.created_at, o.product_name, o.quantity,
           (o.status::TEXT IN ('uploaded','scanned','dispatched','deposit','in_transit','delivered')) AS already_shipped
    FROM inputs i
    JOIN orders o
      ON o.market_id = p_market_id
     AND o.id <> i.src_id
     AND (
       (i.np  <> '' AND (normalize_phone(o.customer_phone)=i.np  OR normalize_phone(o.customer_phone_2)=i.np))
       OR (i.np2 <> '' AND (normalize_phone(o.customer_phone)=i.np2 OR normalize_phone(o.customer_phone_2)=i.np2))
     )
     AND (
       (i.pid IS NOT NULL AND o.product_id = i.pid)
       OR ((i.pid IS NULL OR o.product_id IS NULL) AND i.pname <> '' AND lower(trim(o.product_name)) = i.pname)
     )
     AND o.quantity = i.qty
     AND abs(extract(epoch FROM (o.created_at - i.created_at))) <= 86400
     -- CONFIRMED: ignore dead siblings (no re-ship risk)
     AND o.status::TEXT NOT IN ('cancelled','deleted','rejected','returned')
  )
  SELECT i.src_id,
         COUNT(m.id)::INT AS duplicate_count,
         COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'external_id', m.external_id, 'status', m.status,
           'created_at', m.created_at, 'product_name', m.product_name,
           'quantity', m.quantity, 'already_shipped', m.already_shipped
         ) ORDER BY m.already_shipped DESC, m.created_at DESC)
           FILTER (WHERE m.id IS NOT NULL), '[]'::jsonb) AS siblings
  FROM inputs i
  LEFT JOIN matches m ON m.src_id = i.src_id
  GROUP BY i.src_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_duplicate_orders_batch(UUID, JSONB) TO authenticated;
```

Apply via Supabase MCP `apply_migration` at execution time **and** commit the migration file.

### Step 3 — Types
- **Edit** `src/types/queue.ts` — add to `QueueOrder` (required, like `repeat_*`): `is_potential_duplicate`, `duplicate_count`, `duplicate_siblings: SiblingOrder[]`, `has_uploaded_sibling`.
- **Edit** `src/hooks/useOrdersList.ts` — add the same four to `OrdersListRow` as **optional** (matches how `repeat_*` are optional there).
- `SiblingOrder` imported from `@/lib/duplicate-orders/detect`.

### Step 4 — Wire enrichment into the list routes
Run `enrichRowsWithDuplicates` alongside the existing `enrichRowsWithCustomerHistory`, merging extra-field maps by `id`.
- **Edit** `src/app/api/agent/queue/route.ts` (~line 136): enrich `allSorted` and `closedOrders`. Queue uses `select("*")` — all columns present.
- **Edit** `src/app/api/orders/list/route.ts` (~line 161–178, per-market `Promise.all`): enrich inside each market group. `LIST_SELECT` already has `product_id, quantity, customer_phone_2, product_name, created_at`.
- **Leads queue** (`src/app/api/agent/leads/queue/route.ts`): **scoped out** — leads lack `product_id`/`quantity`; duplicates are an order-only concept.

### Step 5 — Badge component (test first)
**New:** `src/components/shared/DuplicateOrderBadge.tsx` + `.test.tsx`

Mirror `RepeatBuyerBadge.tsx` (trigger `Badge` + portal `PopoverPanel`, RTL-aware `useLayoutEffect` positioning, `formatDateTime`, `useTranslations`) but:
- **No lazy hook** — siblings arrive via props.
- **Visually distinct from RepeatBuyerBadge:** `tone="warning"` (amber), icon `Copy` or `Layers` (repeat-buyer uses `Star`/`AlertTriangle`), `data-duplicate="true"`. Label `duplicateOrder.badge.label` → "Doublon · {count}".
- **Popover** clearly communicates the useful info: headline ("Possible doublon — même client, produit et quantité"), then each sibling: `#external_id`, status pill (reuse `statusToneClass`), `formatDateTime(created_at)`, product × qty, and a prominent **critical "Déjà envoyé au transporteur"** chip when `already_shipped`. Optional deep-link `/{locale}/orders?q=<external_id>`.

```ts
interface DuplicateOrderBadgeProps {
  count: number;
  siblings: SiblingOrder[];
  hasUploadedSibling: boolean;
  locale?: string;
}
```
Renders nothing when `count === 0`.

**Tests** (mirror `RepeatBuyerBadge.test.tsx`): nothing at count 0; "Doublon · 2" for 2; sets `data-duplicate`; shows the "déjà envoyé" critical chip only when a sibling is shipped; `warning` tone.

### Step 6 — Render the badge (3 placements + detail route)
- **Edit** `src/components/queue/OrderCard.tsx` (~line 228, after `RepeatBuyerBadge`): `{order.is_potential_duplicate && <DuplicateOrderBadge ... />}`.
- **Edit** `src/components/orders/OrderRow.tsx` (~line 218, after `RepeatBuyerBadge`). The `React.memo` comparator compares `order` by reference — new fields ride along, no comparator change.
- **Edit** `src/components/orders/OrderDetail.tsx` (~line 123, near `customer_name`): render the badge.
- **CONFIRMED — add to detail view:** **Edit** `src/app/api/orders/[id]/route.ts` GET to call `enrichRowsWithDuplicates(supabase, market_id, [order])` and spread the result; extend `OrderDetailData` type with the four fields.

### Step 7 — Upload guard (server-authoritative, test first)
**Edit** `src/app/api/orders/[id]/dispatch/route.ts`:
- Extend the order lookup (line 34) to also select `market_id, customer_phone, customer_phone_2, product_id, product_name, quantity, created_at`.
- Between the status check (line 80) and `performDispatch` (line 89):

```ts
const confirmDuplicate = body.confirm_duplicate === true;
if (!confirmDuplicate) {
  const [e] = await enrichRowsWithDuplicates(supabase, order.market_id, [orderRow]);
  if (e.has_uploaded_sibling) {
    const shipped = e.duplicate_siblings.find(s => s.already_shipped)!;
    return NextResponse.json(
      { error: "duplicate_confirmation_required", needsConfirmation: true,
        duplicate: { id: shipped.id, external_id: shipped.external_id, status: shipped.status } },
      { status: 409 },
    );
  }
}
```

**Client (both dispatch call sites):** on `409 && needsConfirmation`, open a confirm `Modal` ("Cette commande ressemble à un doublon de #{externalId} déjà envoyé au transporteur — envoyer quand même ?"); on confirm re-POST with `confirm_duplicate: true`.
- **Edit** `src/components/queue/PostCallActionSheet.tsx` (`submitUploadNow`, ~line 317).
- **Edit** `src/components/queue/DexpressDispatchModal.tsx` (~line 108).

**Tests:** **Edit** `src/app/api/orders/[id]/dispatch/route.test.ts` — 409+`needsConfirmation` when a shipped sibling exists and no confirm flag; 200 dispatch when `confirm_duplicate: true`; normal 200 when no duplicate. Mock the new RPC via existing `mockRpc`.

### Step 8 — i18n
**Edit** `src/messages/fr.json` + `src/messages/ar.json` — new `duplicateOrder` namespace mirroring `customerHistory`:
```
duplicateOrder.badge.label         "Doublon · {count}"
duplicateOrder.popover.headline    "Possible doublon — même client, produit et quantité"
duplicateOrder.popover.shipped     "Déjà envoyé au transporteur"
duplicateOrder.popover.seeOrder    "Voir la commande"
duplicateOrder.uploadGuard.title   "Doublon possible"
duplicateOrder.uploadGuard.body    "Cette commande ressemble à un doublon de #{externalId} déjà envoyé au transporteur. Envoyer quand même ?"
duplicateOrder.uploadGuard.confirm "Envoyer quand même"
duplicateOrder.uploadGuard.cancel  "Annuler"
```
Reuse `orders.statuses.*` for status labels in the popover.

---

## Critical files

**New**
- `src/lib/duplicate-orders/detect.ts` (+ `detect.test.ts`)
- `supabase/migrations/20260626000001_duplicate_orders_rpc.sql`
- `src/components/shared/DuplicateOrderBadge.tsx` (+ `.test.tsx`)

**Modified**
- `src/types/queue.ts`, `src/hooks/useOrdersList.ts`
- `src/app/api/agent/queue/route.ts`, `src/app/api/orders/list/route.ts`, `src/app/api/orders/[id]/route.ts`
- `src/app/api/orders/[id]/dispatch/route.ts` (+ `dispatch/route.test.ts`)
- `src/components/queue/OrderCard.tsx`, `src/components/orders/OrderRow.tsx`, `src/components/orders/OrderDetail.tsx`
- `src/components/queue/PostCallActionSheet.tsx`, `src/components/queue/DexpressDispatchModal.tsx`
- `src/messages/fr.json`, `src/messages/ar.json`

**Reused (do not reinvent)**
- `normalize_phone()`, `get_user_role()`, `get_user_market_id()` SQL fns
- `src/lib/customer-history/enrich.ts` pattern, `src/components/shared/RepeatBuyerBadge.tsx` structure
- `src/components/ui/Badge.tsx`, `src/components/ui/Modal.tsx`, `src/lib/format.ts` (`formatDateTime`)

---

## Verification (end-to-end)

Per TDD, run failing tests first, then implement. After each file: `npm run typecheck`. Before commit: `npm run lint && npm run test:run && npm run build`.

1. **Apply migration** via Supabase MCP `apply_migration`.
2. **Seed** via `execute_sql`: a real `market_id` + `product_id`, two `orders` with the **same** phone + product + quantity, `created_at` ~1h apart, distinct `external_id`; one `confirmed` (agent's), one `uploaded` (shipped sibling), both `assigned_to` a tn_agent.
3. **RPC sanity** (`execute_sql`): call `get_duplicate_orders_batch` for the confirmed order → `duplicate_count=1`, `siblings[0].already_shipped=true`. Negatives: different product → 0; >24h apart → 0; sibling `cancelled` → 0.
4. **Agent view** (`npm run dev`, login `agent1.tn@oms.local`): queue shows the **Doublon** badge, distinct from the repeat badge; hover → popover shows the uploaded sibling with the "Déjà envoyé" chip. Verify with Playwright MCP (`browser_navigate`/`browser_snapshot`/`browser_take_screenshot`); check RTL via `ly` agent.
5. **Upload guard:** click upload on the confirmed order → confirm dialog appears (driven by 409). Cancel → no dispatch. Confirm → dispatch proceeds. An order with no shipped sibling uploads with no dialog.
6. **Table + detail:** as manager, verify badge in `OrderRow` and `OrderDetail`.
7. **Cleanup** seeded rows via `execute_sql`.
