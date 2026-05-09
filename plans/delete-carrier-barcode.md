# Delete carrier barcode + "previously uploaded" indicator

## Goal

Add a trash-icon button next to the on-screen tracking barcode that, when pressed:

- Calls `GET /merchant/delete-order/{tracking_number}` on Dexpress (silent endpoint, 200 = assumed success).
- Atomically clears local `tracking_number` / `carrier_id` / `carrier_extra` and rolls status `uploaded → confirmed`.
- Records the action in `order_history` (existing) and `carrier_event_log` (new `source='barcode_deletion'`).
- Marks the order as "previously had a carrier barcode that was deleted" so the UI can show a visual sign even though `tracking_number` is now `NULL`.

**Eligibility:** `status === 'uploaded'` AND `tracking_number` set AND `carrier_id` set.
**Permission:** assigned agent / market manager / super_admin (same trust model as reopen).

## Out of scope

- Does NOT delete the order from OMS — only the carrier barcode.
- Does NOT change the print-label flow. Already-printed labels go stale; nothing on our side can claw them back.
- Does NOT cover Navex (no delete endpoint reverse-engineered yet). Button gated on carrier code = `dexpress`.
- Does NOT alter the existing reopen UX or its 7-day window. But — see §4b — reopen will start *actually* voiding Dexpress barcodes once the adapter is wired (confirmed acceptable).

## 1. Database changes — one migration

`supabase/migrations/20260620000001_carrier_barcode_deletion.sql`:

```sql
-- 1. Track that an order was once uploaded and the barcode was deleted by us.
--    Lets the UI show a "previously uploaded, then cancelled" badge after we
--    wipe tracking_number.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS carrier_barcode_deleted_at TIMESTAMPTZ;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS carrier_barcode_deleted_carrier_code TEXT;

-- 2. Allow carrier_event_log.source to record manual barcode deletions
ALTER TABLE carrier_event_log
  DROP CONSTRAINT IF EXISTS carrier_event_log_source_check;
ALTER TABLE carrier_event_log
  ADD CONSTRAINT carrier_event_log_source_check
    CHECK (source IN ('poll', 'webhook', 'barcode_deletion'));

-- 3. RPC: delete_carrier_barcode
--    Atomically: status uploaded → confirmed, clear tracking/carrier fields,
--    set deletion timestamp + carrier code, append history row.
CREATE OR REPLACE FUNCTION delete_carrier_barcode(
  p_order_id     UUID,
  p_actor_id     UUID,
  p_void_outcome TEXT  -- 'carrier_voided' | 'local_only'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status        order_status;
  v_tracking      TEXT;
  v_carrier_code  TEXT;
  v_history_note  TEXT;
BEGIN
  SELECT o.status, o.tracking_number, c.code
    INTO v_status, v_tracking, v_carrier_code
    FROM orders o
    LEFT JOIN carriers c ON c.id = o.carrier_id
   WHERE o.id = p_order_id
     FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  IF v_status <> 'uploaded' THEN
    RAISE EXCEPTION 'Cannot delete barcode: order in status %', v_status;
  END IF;

  IF v_tracking IS NULL THEN
    RAISE EXCEPTION 'Order has no tracking number to delete';
  END IF;

  v_history_note := CASE p_void_outcome
    WHEN 'carrier_voided' THEN 'Code-barres supprimé chez transporteur'
    WHEN 'local_only'     THEN 'Code-barres supprimé localement — coordination manuelle requise chez transporteur'
    ELSE                       'Code-barres supprimé'
  END;

  UPDATE orders
     SET status                                = 'confirmed',
         tracking_number                       = NULL,
         carrier_id                            = NULL,
         carrier_extra                         = NULL,
         carrier_barcode_deleted_at            = NOW(),
         carrier_barcode_deleted_carrier_code  = v_carrier_code,
         updated_at                            = NOW()
   WHERE id = p_order_id;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, 'uploaded'::order_status, 'confirmed'::order_status,
          p_actor_id, 'agent', v_history_note);

  RETURN json_build_object(
    'order_id', p_order_id,
    'previous_tracking', v_tracking,
    'void_outcome', p_void_outcome
  );
END;
$$;

-- 4. On successful re-upload, clear the deletion markers so the badge goes away.
--    Patched into the existing upload write site (perform-dispatch) via app code,
--    not in this migration — same migration only handles schema + RPC.
```

**Reusing `confirmed` not `assigned`:** reopen is for "send back for re-confirmation" but delete-barcode is "undo the upload." The phone-confirmation phase already passed.

**Why a column rather than inferring from history:** the UI would otherwise have to fetch and parse `order_history` notes for every row in a list. A column is O(1).

## 2. Carrier adapter layer

### 2a. New method on `DexpressClient` — `src/lib/carriers/dexpress/client.ts`

```ts
async deleteOrder(trackingNumber: string): Promise<{ ok: boolean; reason?: string }> {
  return this.requestWithRetry(async (session) => {
    const response = await this.fetchWithCookie(
      `/merchant/delete-order/${trackingNumber}`,
      session,
      {
        method: "GET",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          Referer: `${this.config.apiEndpoint.replace(/\/$/, "")}/merchant/pending-orders`,
          Accept: "*/*",
        },
      },
    );

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && isLogoutRedirect(location)) {
      return { kind: "logout" };
    }

    if (response.status === 200) {
      const body = (await response.text()).trim();
      if (body === "") {
        return { kind: "ok", result: { ok: true } };
      }
      return { kind: "ok", result: { ok: false, reason: "unexpected_200_body" } };
    }

    return {
      kind: "ok",
      result: { ok: false, reason: `unexpected_status:${response.status}` },
    };
  });
}
```

`requestWithRetry` already handles "logout once → re-login → retry" — free.

### 2b. Implement `voidDispatch` in `src/lib/carriers/dexpress/adapter.ts`

```ts
async voidDispatch(trackingNumber, config): Promise<CarrierVoidResult> {
  const client = new DexpressClient(config.id, config);
  try {
    const result = await client.deleteOrder(trackingNumber);
    return result.ok
      ? { success: true, supported: true }
      : { success: false, supported: true, reason: result.reason };
  } catch (err) {
    return {
      success: false,
      supported: true,
      reason: err instanceof Error ? err.message : "unknown",
    };
  }
}
```

**Side effect (acknowledged):** the existing Reopen button on uploaded Dexpress orders will start actually voiding the barcode at Dexpress.

## 3. New API endpoint — `POST /api/orders/[id]/carrier-delete`

`src/app/api/orders/[id]/carrier-delete/route.ts`. Logic, in order:

1. Auth + actor (`getActor`).
2. Load order with `id, status, assigned_to, tracking_number, carrier_id, market_id`.
3. **Permission gate** — assigned agent OR market manager (same market) OR super_admin.
4. **Status gate** — `status === 'uploaded'` AND `tracking_number` AND `carrier_id`. Reject 409 otherwise.
5. Load carrier row, build config, get adapter.
6. Call `adapter.voidDispatch(tracking_number, config)` → `voidOutcome = success ? 'carrier_voided' : 'local_only'`.
7. **Best-effort write to `carrier_event_log`** (don't fail the request if logging fails):
   ```
   { carrier_code: 'dexpress', source: 'barcode_deletion', tracking_number,
     order_id, outcome: 'processed' | 'error',
     outcome_reason: voidOutcome,
     raw_body: { reason: result.reason ?? null } }
   ```
8. Call RPC `delete_carrier_barcode(orderId, actorId, voidOutcome)`.
9. Return `{ data: { ok: true, void_outcome }, warning?: "Coordination manuelle..." }`.

**Error path:** if `voidDispatch` throws (network), write `outcome: 'error'` to the log but **do not** flip local state — return 502 + retry hint. Order stays `uploaded`. Matches the reopen route's defensive behaviour.

## 4. UI changes

### 4a. `TrackingBarcode` — `src/components/orders/TrackingBarcode.tsx`

Add an optional `onDelete` prop. When present, render a `Trash2` icon button next to the existing "Copy" button (top-right of the strip). Clicking it opens a confirmation dialog (same shape as the reopen confirm modal):

```
Title:    Supprimer le code-barres
Body:     Cela supprimera la commande du tableau de bord Dexpress
          et remettra cette commande au statut « confirmé ». Action
          irréversible — la commande devra être réuploadée.
Confirm:  Supprimer
Cancel:   Annuler
```

While submitting: button shows a spinner. On success: brief toast, parent revalidates → barcode component receives `value=null` and renders nothing. On `local_only`: warning toast surfaces but local state still updated.

### 4b. `OrderDetailPanel` — `src/components/queue/OrderDetailPanel.tsx`

- Add `carrier_barcode_deleted_at: string | null` and `carrier_barcode_deleted_carrier_code: string | null` to the `OrderDetail` type.
- Compute `canDeleteBarcode = order.status === 'uploaded' && order.tracking_number && (assignedToMe || isManager || isSuperAdmin)`.
- Pass `onDelete` to `<TrackingBarcode>` only when `canDeleteBarcode`. (The PDF doesn't pass it → no button there.)

### 4c. The "previously uploaded, then cancelled" sign

**(a) On the panel header next to the status badge** — when `carrier_barcode_deleted_at` is set (and the carrier is currently `NULL`), render a small ghost badge:

```
[#A1B2C3D4] [confirmed •]  [↩ Dexpress annulé]
```

Tone: neutral, with a `RotateCcw` (or `Ban`) icon, subtle background. Tooltip on hover: "Code-barres Dexpress supprimé le {date} — peut être réuploadé."

**(b) In the `OrderRow` listing on the orders page** — same compact badge in the cell where status appears. Tells managers at a glance which "confirmed" orders are actually re-confirmed-after-deletion vs fresh.

**Cleared on next successful upload:** when `performDispatch` succeeds, also `NULL` out `carrier_barcode_deleted_at` and `carrier_barcode_deleted_carrier_code`. Patched into the existing upload write site, not a separate migration.

## 5. i18n

New keys (fr + ar):

| Key | French |
|---|---|
| `orders.tracking.delete` | Supprimer |
| `orders.tracking.deleteConfirmTitle` | Supprimer le code-barres |
| `orders.tracking.deleteConfirmBody` | Cela supprimera la commande de Dexpress et remettra le statut à confirmé. Réuploadable. |
| `orders.tracking.deleteConfirm` | Supprimer |
| `orders.tracking.deleteCancel` | Annuler |
| `orders.tracking.deleteSuccess` | Code-barres supprimé |
| `orders.tracking.deleteFailedAtCarrier` | Suppression chez Dexpress échouée — coordination manuelle requise |
| `orders.tracking.deleteFailedNetwork` | Erreur réseau — réessayez |
| `orders.detail.carrierBarcodeDeletedBadge` | Dexpress annulé |
| `orders.detail.carrierBarcodeDeletedTooltip` | Code-barres supprimé le {date} — peut être réuploadé |

Arabic equivalents in the same keys.

## 6. Tests

- **Unit** for `DexpressClient.deleteOrder`: mocks fetch, asserts URL/headers/redirect:manual, asserts retry-on-302→/login, asserts `ok:false` on 200+nonempty body and on 500.
- **Unit** for the new RPC: status guard (rejects `confirmed` / `pending` / `dispatched`), missing tracking guard, sets the deletion columns, appends history row, atomicity on concurrent calls.
- **Integration** for `POST /api/orders/[id]/carrier-delete`: permission matrix, status matrix, success path, `local_only` path, `carrier_event_log` row written.
- **Component** for `TrackingBarcode`: trash icon hidden without `onDelete`, confirmation modal flow, optimistic state.
- **Manual smoke**: the validation checklist from `delivery_company_docs/Dexpress/dexpress-delete-order.md`.

## 7. Operational notes / things to watch post-ship

- **Dexpress endpoint silently changes.** If they ever add CSRF or move from GET to POST, our deletion silently no-ops with `200`. The `carrier_event_log` row is the canary — periodically check that `barcode_deletion` rows match deletion volume in their dashboard. Add a TODO comment near `deleteOrder` flagging this.
- **Idempotency.** Pressing delete twice in quick succession: the RPC's status guard rejects the second call (status is already `confirmed`). UI should disable the button while submitting (it will).
- **Recovering deleted orders' barcodes.** Re-uploading is just re-pressing the existing Upload action. Nothing in this plan blocks that path.

## 8. Execution order

1. Migration (column + check constraint relaxation + RPC).
2. `DexpressClient.deleteOrder` + tests.
3. Adapter `voidDispatch` real implementation + adapter tests.
4. API route + tests.
5. `TrackingBarcode` trash icon + confirmation modal.
6. `OrderDetailPanel` wiring + the new "Dexpress annulé" badge + clear deletion markers in upload write site.
7. `OrderRow` badge surfacing.
8. i18n.
9. Typecheck, run tests, manual smoke.

Each step compiles independently; if any reveals a deal-breaker we can stop and discuss without leaving things half-done.
