# Confirm flow upgrade + revert-from-confirmed

## Goals

### Issue #1 — collapse the post-confirm steps
Today: confirm → switch tabs → "envoyer transporteur" → pick carrier → upload.
Target: confirm → carrier picker appears in the same sheet → "Envoyer maintenant" or "Programmer livraison" → done.

### Issue #2 — allow status revert from `confirmed`
Today: a confirmed order can only become `uploaded`, `dispatch_scheduled`, or `deleted`.
Target: also allow `attempt_1/2/3`, `callback_scheduled`, `rejected`. Excluded: `pending` (the "new" state).

---

## Issue #1 — Inline carrier picker

### State machine

`PostCallActionSheet`'s `Flow` union gains two states:

```ts
type Flow =
  | "option_select"
  | "confirm_flow"
  | "reject_flow"
  | "callback_expanded"
  | "upload_after_confirm"        // NEW
  | "schedule_after_confirm";     // NEW
```

Sequence after a successful `submitConfirm()`:

1. Status is now `confirmed` server-side.
2. Sheet flips to `upload_after_confirm`. Body shows:
   - **Always-visible carrier radio list** (fetched from `/api/carriers?market_id={mid}` filtered to `is_active`). Even with one carrier, the radio is shown — explicit choice.
   - **"Envoyer maintenant"** (primary)
   - **"Programmer livraison"** (secondary)
   - **"Plus tard"** (ghost link) — closes, finalises as `confirmed`.
3. **Envoyer maintenant** branch:
   - Determine carrier code:
     - `dexpress` + order has `dexpress_state_id` → POST `/dispatch` with `extra: { state_id: order.dexpress_state_id }`.
     - `dexpress` + no `dexpress_state_id` → flip a tiny inline `DexpressLocationPicker` into the same sheet (no new modal); the "Envoyer" button only enables once a state is picked.
     - any other carrier code → POST `/dispatch` with no extra.
   - Success → close, `onSuccess({ action: "confirmed", newStatus: "uploaded" })`.
   - Failure → inline error; status stays `confirmed`; agent can retry.
4. **Programmer livraison** branch:
   - Flip to `schedule_after_confirm`. Body: date/time picker (mirroring `ScheduleDispatchModal`'s body) with the carrier already selected (locked).
   - Submit POSTs `/schedule-dispatch` with `auto_dispatch: true, carrier_id: selected, scheduled_at`.
   - Success → close, `onSuccess({ action: "confirmed", newStatus: "dispatch_scheduled" })`.

### Programmer livraison semantics

- **Always auto-dispatch.** Picking "Programmer" means the cron will upload at the scheduled time — no extra confirmation step. The current `ScheduleDispatchModal`'s `auto_dispatch` toggle is removed in this flow (we always set it to `true`).
- The existing `ScheduleDispatchModal` is kept as-is for any other invocation paths; this new flow is a separate code path that reuses *its body* (date/time inputs) inline.

### What stays untouched

- The existing "Envoyer transporteur" button on `OrderDetailPanel` — still the path for confirmed orders the agent left "for later", and the only path for re-uploading after a delete-barcode.
- The existing `confirm_flow` sub-flow's "Confirmer + planifier" button → repurposed: only "Confirmer" remains. Scheduling is reachable only via the new post-confirm carrier picker.
- The existing `ScheduleDispatchModal` — preserved for backward compatibility but no longer launched from `PostCallActionSheet`.

### Files

- `src/components/queue/PostCallActionSheet.tsx` — bulk of the work
- `src/components/queue/CarrierSelect.tsx` — reused as-is (already used by `ScheduleDispatchModal`)
- `src/components/queue/DexpressLocationPicker.tsx` — reused as-is for the inline state-picker fallback
- `src/messages/{fr,ar}.json` — new keys under `queue.*`:
  - `pickCarrier`, `pickCarrierEmpty`
  - `uploadNow`, `uploadingNow`, `uploadFailed`
  - `scheduleUpload`, `schedulingUpload`
  - `notNow`
  - `pickCityForDexpress` (inline fallback)

### No DB changes, no new API endpoints

Reuses `/dispatch` and `/schedule-dispatch` exactly as they exist today.

---

## Issue #2 — Allow status revert from `confirmed`

### DB layer

New migration `supabase/migrations/20260620000002_relax_confirmed_transitions.sql`:

```sql
-- Recreate transition_order_status with confirmed → broader set of next
-- states. Needed so agents/managers can backtrack a confirmed order if the
-- customer recanted or it was confirmed by mistake. All other transitions
-- unchanged from 20260506000000_uploaded_status_model.sql.
CREATE OR REPLACE FUNCTION transition_order_status( ... )
  -- only this line differs:
  WHEN 'confirmed' THEN p_new_status IN (
    'attempt_1', 'attempt_2', 'attempt_3',
    'callback_scheduled', 'rejected',
    'uploaded', 'dispatch_scheduled', 'deleted'
  )
  -- ...rest unchanged
```

The full function body is reproduced from migration `20260506000000` so the recreate is self-contained.

### TS layer

`src/types/order-status.ts`:

```diff
-  confirmed: ["uploaded", "dispatch_scheduled", "deleted"],
+  confirmed: [
+    "attempt_1", "attempt_2", "attempt_3",
+    "callback_scheduled", "rejected",
+    "uploaded", "dispatch_scheduled", "deleted",
+  ],
```

### Permissions layer

`src/lib/order-permissions.ts` — already correct:
- `AGENT_ALLOWED_TARGETS` includes `attempt_1/2/3`, `callback_scheduled`, `rejected`.
- Managers and super_admin pass any valid graph transition.

No change needed.

### UI

In `OrderDetailPanel.tsx`'s sticky header, when:
- `order.status === "confirmed"` AND
- `canDeleteCarrierBarcode`-style permission check passes (assigned agent / market manager / super_admin),

…render a small text link `"Modifier statut"` below the status badge. Click → opens the existing `PostCallActionSheet` from scratch (with `option_select` as `initialFlow`). The sheet already presents Tentative / Rappel / Rejet branches and routes each through the right endpoint:

- Tentative → `/no-answer` (increments `attempts_count`)
- Rappel → `/callback` (with time picker)
- Rejet → `/reject` (with reason picker)

No new endpoints. No duplicated form logic.

### Reopen behaviour

The existing `/api/orders/:id/reopen` endpoint is unchanged — it's a different action (post-upload recovery with a 7-day window). The new "Modifier statut" link is only available pre-upload (status === "confirmed").

### Side-data integrity

Because the manual revert routes through the existing endpoints:

- `attempts_count` is incremented correctly by `/no-answer`.
- `callback_scheduled_at` is set correctly by `/callback`.
- `rejection_reason` and `rejection_note` are captured by `/reject`.

No bypass paths are introduced.

### Files

- `supabase/migrations/20260620000002_relax_confirmed_transitions.sql` (new)
- `src/types/order-status.ts` (one line)
- `src/components/queue/OrderDetailPanel.tsx` (status section gets a clickable "Modifier statut" link)
- `src/messages/{fr,ar}.json` — new key `orders.detail.changeStatus`

---

## Order of operations

1. Save this plan.
2. Implement #1 (no DB changes — fast to test).
3. Implement #2 (DB migration + UI).
4. Typecheck. Run touched tests. Migration left to user to apply.

## Out of scope

- Reopen UX (`/api/orders/:id/reopen`) — already works for post-upload reverts.
- Status revert from anything other than `confirmed`. Your spec was "confirmed → anything except new"; if you also want to allow reverts from `attempt_3` etc. that'd be a separate scoping pass.
- New telemetry / analytics for revert events.
