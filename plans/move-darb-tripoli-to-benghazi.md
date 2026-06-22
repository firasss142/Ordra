# Move 76 مصحف orders Tripoli → Benghazi + fix the reopen void bug

> On implementation, copy this plan to `plans/move-darb-tripoli-to-benghazi.md`.

## Context

The user has مصحف orders (`مصحف القرآن تدبر وعمل حجم كبير`) uploaded to the Darb
account **"Darb Assabil - Tripoli"** and wants them **reopened and re-uploaded to the
second account "Darb Assabil — Benghazi"**, matched by **QR code = `orders.tracking_number`**
against the attached CSV. Test one first, then bulk.

**Investigation (the "deeper problem" — data is intact, but a real bug exists):**
- 8 CSV QR codes didn't match by `tracking_number` because they are **stale Darb refs**: 6
  belong to orders that were re-uploaded (now carry a newer tracking that IS in the CSV and
  IS in the move set); 2 are now `rejected`. No corruption — every order exists.
- **Root-cause bug:** [reopen/route.ts:56-59](src/app/api/orders/[id]/reopen/route.ts#L56-L59)
  calls `adapter.voidDispatch(order.tracking_number, config)` with **no third arg** and never
  selects `carrier_extra`. Darb's `voidDispatch` needs `carrier_extra.darb_assabil_id` (the
  internal shipment id) — without it, it **short-circuits as "failed — coordination manuelle
  requise" and never calls Darb**, so the shipment is never cancelled. This orphaned
  shipments and produced **6 double-shipments**. [carrier-delete/route.ts:88-92](src/app/api/orders/[id]/carrier-delete/route.ts#L88-L92)
  and the new `bulk-reopen` route pass `carrier_extra` correctly.

**Move set (verified):** **76 distinct مصحف orders** currently `uploaded` on Tripoli whose
`tracking_number` ∈ CSV. All 76 have `carrier_extra` with `darb_assabil_id` (to cancel
Tripoli), `city` + `customer_area` (the proven destination — reuse it), and `service_id`.
The 2 rejected orders are **excluded**. 6 of the 76 also have an orphaned **old** shipment.

**Decisions (confirmed):** fix the reopen bug; execute via a one-off script; **test one
first**; **skip-on-void-failure** (if a Tripoli void doesn't confirm success, do NOT upload
to Benghazi — never create a new double).

## Part A — Fix the reopen void bug

[src/app/api/orders/[id]/reopen/route.ts](src/app/api/orders/[id]/reopen/route.ts):
- Add `carrier_extra` to the order `select` (line ~26).
- Pass it to the void: `adapter.voidDispatch(order.tracking_number, config, order.carrier_extra ?? undefined)`
  (line ~56) — mirroring carrier-delete. Now reopen actually cancels the Darb shipment.
- Verify with `npm run typecheck` (a focused test is optional).

## Part B — Move script

New `scripts/move-darb-tripoli-to-benghazi.ts`, run via `npx tsx` with **`.env.local`
loaded** (needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the app's credential
**encryption key** used by `@/lib/crypto` so `buildConfig` can decrypt carrier credentials).

Constants: `TRIPOLI = 4f1271c8-b1f2-4836-9293-8ab3d0b18e69`,
`BENGHAZI = 43077d36-3d61-40d6-ae35-59ed15cec8f7`, product = مصحف…, and the CSV QR set.

Move-set query: `tracking_number ∈ CSV ∧ product = مصحف ∧ status = 'uploaded' ∧ carrier =
Tripoli` (→ 76).

Per order (sequential):
1. **Void Tripoli** — `buildConfig(tripoliCarrierRow)` + `getCarrierAdapter('darb_assabil')`
   → `voidDispatch(tracking_number, config, carrier_extra)`. **Require `success === true`.**
   If not → **skip** the order (log `void_failed`), do not proceed (no double-ship).
2. **Revert** — `delete_carrier_barcode` RPC `(p_order_id, p_actor_id=null, p_void_outcome='carrier_voided')`
   → `uploaded → confirmed`, clears tracking/carrier/carrier_extra.
3. **Re-upload to Benghazi** — `performDispatch({ orderId, carrierId: BENGHAZI, actorId: null,
   extra })` where `extra = { city, customer_area, service_id, service_fee_on_top: false }`
   plus the per-order option flags (`is_fragile`, `allow_inspection`, `allow_testing`,
   `allow_card_payment`) read from the order's pre-void `carrier_extra`. → new Benghazi
   `uploaded` + new tracking + new `darb_assabil_id`.
4. **Record** old tracking → new Benghazi tracking + void/dispatch outcomes.

Modes: `--dry-run` (list the 76 + planned destination, no side effects), `--one <tracking|first>`
(process exactly one), `--bulk` (all). **Idempotent:** an order no longer `uploaded` on
Tripoli is skipped (already moved).

**Reuse (do not reinvent):** `performDispatch` ([perform-dispatch.ts](src/lib/carriers/perform-dispatch.ts)),
`buildConfig` + `dispatchToCarrier` ([dispatch.ts](src/lib/carriers/dispatch.ts)),
`getCarrierAdapter` ([adapter-registry.ts](src/lib/carriers/adapter-registry.ts)), the
carrier-delete void pattern + `delete_carrier_barcode` RPC. Reusing the stored
`carrier_extra` destination is **why a script beats the bulk-dispatch endpoint** here — that
endpoint would re-resolve `customer_city` and **skip multi-area cities** (e.g. طرابلس), whereas
these orders' real area (e.g. السراج) lives only in `carrier_extra`.

## Verification

1. Fix reopen route → `npm run typecheck`.
2. `npx tsx scripts/... --dry-run` → prints 76 orders with `old_tracking → (Benghazi, city,
   area)`. Confirm count = 76.
3. `--one first` → for ONE order verify: (a) `voidDispatch` returned success and the **old
   Tripoli shipment is actually cancelled** (confirm via the Darb portal / Darb API for that
   SH ref); (b) the order is now `uploaded` on **Benghazi** with a NEW tracking; (c) the
   destination `(city, area)` matches the original. Inspect via Supabase MCP (order
   status/carrier/tracking/carrier_extra).
4. If the test is clean → `--bulk`. Watch succeeded / skipped(void_failed) / failed. Safe to
   re-run (idempotent).
5. Report: moved count, any skipped (void failed → still on Tripoli, manual), and the **6
   orphaned OLD Tripoli shipments** (old refs: SH1777014, SH1777775, SH1778238, SH1783073,
   SH1783093, SH1784483) for **manual Darb cancellation** — their internal ids were
   overwritten, so the script can't cancel them; out of scope per your choice.

## Risks / notes

- **Real operation:** cancels up to 76 live Tripoli shipments + creates 76 Benghazi → likely
  triggers customer SMS per order. The `--one` test gates the bulk.
- **Skip-on-void-failure:** if Darb refuses a void, that order stays on Tripoli, no Benghazi
  upload, reported — no new doubles.
- **6 orphaned old shipments persist** after the move (old internal ids lost). Listed for
  manual cleanup; not auto-handled (per scope).
- Benghazi shares Darb destinations + services (confirmed), so the reused `(city, area,
  service_id)` are valid there.
- Excludes the 2 rejected orders (`67a20892…`, `77c1f837…`).
