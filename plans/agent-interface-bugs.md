# Agent interface — verified bug list

Produced 2026-08-11 by a multi-agent sweep (5 hunt lenses, adversarial refutation,
then ranking). Every finding below survived a refuter whose default verdict was
"not a bug". Live counts re-verified against project `vshynigvgrlihngozuwb`.

Caveat: the `refute:realtime` pass died on a connection error, so realtime-lens
findings carry one less round of scrutiny than the rest.

## Status

**Tier 1 (#1–#4) is FIXED and deployed.** Each was reproduced by a failing test
before the fix:

| # | Fix | Evidence |
|---|---|---|
| 1 | `no_response_with_auto_reject` — status now floors the attempt counter (`greatest(count+1, status_implied+1)`). Dead 4-arg overload dropped, which also un-breaks `/api/orders/[id]/no-response`. | Migration `20260829000004`. Reproduced live pre-fix: `attempt_3`/count-0 → `"attempt_1"`. Post-fix, all 6 seed permutations verified in a rolled-back transaction — no status descends; healthy ladders unchanged. |
| 2 | `key={callTerminatedOrderId}` on `PostCallActionSheet` (`QueuePage.tsx`). | New `QueuePage.bulkAdvance.test.tsx` asserts the sheet mounts once per order; it recorded `["A"]` before the fix, `["A","B"]` after. |
| 3 | PATCH `/api/orders/[id]` — update is now sequential with `.select("id")`, returns 409 on zero rows, and the `order_history` INSERT runs only after a confirmed update. | 2 new tests in `patch.test.ts`; 13 existing update-chain mocks migrated. |
| 4 | POST `/api/orders/[id]/items` — same `.select("id")` guard, plus a compensating delete so line items are rolled back rather than left diverged from `total_price`. | 2 new tests in `items/route.test.ts`. |

**Tier 2 #5 and #6 are also FIXED**, together with the payload work since all
three touch the same files:

| # | Fix | Evidence |
|---|---|---|
| 5 | `delivered` / `returned` added to `CLOSED_STATUSES` (route) and `CLOSED_AGENT_STATUSES` (buckets). `cancelled` deliberately left in `TERMINAL_REMOVED_STATUSES` so it keeps its toast. | `buckets.closed-statuses.test.ts`, 6 tests. Re-measured: worst-case closed-7d rises 387 → 394, still far under the 1000-row cap. |
| 6 | `product_display_name` added to `toQueueOrder`, which is now exported. | `toQueueOrder.test.ts` — includes a key-coverage test that fails for the *next* dropped field too, not just this one. |

**The product decision on #3 is resolved:** agents *can* edit rejected orders
(migration `20260829000005` adds `rejected` to the `orders_update` allow-list).
The 409 added in `20260829000004` now fires only for genuinely closed statuses.
Verified by impersonation: an agent updates their own rejected order (1 row) and
still cannot touch another agent's (0 rows).

Remaining tier 2–3 items and the migration-only list below are **not** started.

# Agent Interface — Final Bug List

Twenty-two findings survived the adversarial pass. Five were refuted outright and are listed at the bottom with the reason, so nobody re-files them. Two things that look like bugs are actually missing product decisions and are quarantined under **Needs your call**.

Root: `/Users/firaskarchoud/Documents/CODE/XPAND/Internal-tools/ORDER MANAGMENT SYSTEM/oms-cloned-/Ordra/`
All live counts re-verified against `vshynigvgrlihngozuwb` today.

---

## Tier 1 — fix this week (HIGH severity × happens today)

### 1. `no_response_with_auto_reject` walks orders backwards through the status machine
**HIGH · needs a DB migration**

- **Where:** `supabase/migrations/20260827000002_stamp_next_retry_slot.sql:121` (`v_new_attempts := v_new_attempts + 1;`) and `:137-141` (status derived from the counter alone). Reverts `supabase/migrations/20260620000006_attempts_count_single_source_of_truth.sql:101-103`. Confirmed against the *deployed* body via `pg_get_functiondef`, not just the migration file.
- **Trigger:** agent opens an order sitting at `attempt_2` or `attempt_3` with `attempts_count = 0` and clicks **"Pas de réponse"** (`PostCallActionSheet.tsx:379` → `/api/orders/[id]/no-answer`). The RPC computes `0 + 1 = 1` → `attempt_1`, and does a **raw `update orders set status`** with no validator.
- **What the agent sees:** the order jumps from *Tentative 3* back to *Tentative 1*. `order_history` records the illegal `attempt_3 → attempt_1` edge. The customer gets re-called two times more than the ladder allows, and auto-reject fires 3 clicks late.
- **Live exposure: 131 assigned orders** (`attempt_2`/count-0 = 64, `attempt_3`/count-0 = 67) are one click away. Zero backwards rows exist since 2026-08-10, so this has **not fired in production yet** — it is armed, not exploded.
- **Minimal fix** — two lines back into the 5-arg function only:
  ```sql
  v_status_implied := case v_current_status when 'attempt_1' then 1 when 'attempt_2' then 2
                                            when 'attempt_3' then 3 else 0 end;
  v_new_attempts   := greatest(v_existing_count + 1, v_status_implied + 1);
  ```
  Re-adding the `attempts_count` clause to `transition_order_status` is correct hygiene but fixes nothing reachable today (the only route that transitions *into* `attempt_*` is `/api/orders/[id]/attempt`, which no client calls).
- **Test first:** `supabase/tests/` or a `src/lib/orders/__tests__/no-answer-ladder.test.ts` integration test against a local branch — seed `{status:'attempt_3', attempts_count:0}`, call the RPC, assert `status === 'attempt_3'` (not `attempt_1`) and `attempts_count === 4`. Add the invariant `new_status_digit >= old_status_digit` as a property test over all 4 seed permutations.
- **Note:** `p_next_attempt` is a dead parameter — the body never reads it. `no-answer/route.ts:85` passes the literal `"attempt_1"`, which makes the caller look like it decides something it does not. Delete it in the same migration.

---

### 2. Bulk "Terminer l'appel" reuses one `PostCallActionSheet`, carrying the previous order's rejection reason onto the next order
**HIGH · code-only · one-line fix**

- **Where:** `src/components/queue/QueuePage.tsx:855` — `<PostCallActionSheet …>` rendered with **no `key`**. Contrast `:822`, where `OrderDetailPanel` *is* keyed `key={selectedOrderId ?? "none"}`. State that survives: `PostCallActionSheet.tsx:208` (`flow`), `:263-265` (`rejectionReason/Subreason/Note`), `:228` (`selectedCarrierId`), plus `RejectionReasonSelect.tsx:49-52` which holds `group`/`sub` in its own `useState`.
- **Trigger:** tick 2+ eligible rows → sheet opens on A → agent takes A to `reject_flow`, picks `faux_numero`, confirms. `submitReject` (`:586-614`) calls `onSuccess` in the same synchronous continuation as `setCallTerminatedOrderId(null)`; React 18 automatic batching (react ^18 on next 14.2.29) takes `callTerminatedOrderId` A→B in **one commit**, so the `&&` at `:854` never evaluates false and React preserves the instance.
- **What the agent sees:** order B — never called, status `pending`/`attempt_*` — opens **directly on the rejection screen with `faux_numero` visibly pre-selected** and the submit button already enabled (`isValidPair` true, `loading` false). One click writes a terminal `rejected` with a reason belonging to a different customer. The confirm path leaks the same way: `submitConfirm` (`:425-457`) sets `flow="upload_after_confirm"` without calling `onSuccess`, so B opens showing "✓ Commande confirmée" for an order that was never confirmed; the follow-on "Uploader maintenant" 400s and surfaces the raw untranslated English `"Order must be confirmed (or dispatch_scheduled) to upload to carrier"` (`dispatch/route.ts:79-84` → `PostCallActionSheet.tsx:516-521` prefers `json.error`).
- **Minimal fix:** `key={callTerminatedOrderId}` on `QueuePage.tsx:855`.
- **Test first:** `src/components/queue/__tests__/QueuePage.bulk.test.tsx` — render with two eligible orders, drive A through reject→submit with a mocked 200, then assert the sheet rendered for B has no reason selected and its submit button is `disabled`. The test must fail before the `key` is added.

---

### 3. Agent edit of a `rejected` order is a silent no-op that writes a false audit row
**HIGH · code-only (RLS-aligned) · 844 live rows**

- **Where:** `src/app/api/orders/[id]/route.ts:438-452` (the `Promise.all` of orders-UPDATE + history-INSERT); permission gap at `src/lib/order-permissions.ts:164` (`EDIT_WINDOWED_STATUSES = {rejected, confirmed}`) and `:243-245`.
- **Trigger:** Fermées tab → open a `rejected` order → edit `customer_phone`. The UI lets you (`OrderDetailPanel/index.tsx:457-459` gates only on `EDIT_BLOCKED_STATUSES`, which does **not** contain `rejected`). The live `orders_update` RLS policy allows agents on `pending, assigned, attempt_1..3, callback_scheduled, confirmed, dispatch_scheduled, uploaded` — `rejected` is absent. A `USING` mismatch filters the row out: PostgREST 204, supabase-js `{data:null, error:null}`, so `if (updateError)` at `:450` never fires. The route re-reads the unchanged row and returns **200**.
- **What the agent sees:** `runCommit` (`OrderDetailPanel/index.tsx:580-594`) sets `saveFlash="saved"`, and because `useOrderMutation.commit` writes the server response into SWR with `revalidate:false` (`useOrderMutation.ts:44-45`), the field **visibly snaps back to the old value while a "saved" indicator shows**. The `order_history` INSERT succeeds unconditionally (`order_history_insert` WITH CHECK = `true`), so the append-only timeline now permanently records an edit that never happened.
- **Live exposure: 844 rejected orders** assigned to an agent inside the 7-day edit window.
- **Minimal fix:** `.update(updates).eq("id", id).select("id")`, return 409 on zero rows, move the history insert *after* a confirmed update, and align `EDIT_WINDOWED_STATUSES` with the RLS allow-list (drop `rejected`) — or add `rejected` to the policy if editing rejected orders is intended (see *Needs your call*).
- **Test first:** `src/app/api/orders/[id]/__tests__/route.patch.test.ts` — mock the supabase update chain to resolve `{data: null, error: null}` (the RLS-filtered shape), assert the route returns 409 and that the `order_history` insert mock was **not** called.

---

### 4. Same silent no-op corrupts money: `order_items` land, `orders.total_price` does not
**HIGH · code-only**

- **Where:** `src/app/api/orders/[id]/items/route.ts:160-166` (insert), `:183-196` (the follow-up `orders` UPDATE and its dead `if (updateError)` guard at `:192`). Same gate at `:39-47`.
- **Trigger:** agent adds a line item to a `rejected` order they own. `order_items_agent` RLS is `ALL` with **no status predicate**, so the insert lands. The `orders.total_price` UPDATE is blocked by `orders_update`, returns `error: null`, and the guard — whose own comment says *"Surface this so an operator can re-sync rather than letting the drift silently propagate"* — cannot fire. Route returns **201**.
- **What the agent sees:** the new line appears next to a stale total. Persisted in the DB: `order_items` sums to the new subtotal, `orders.total_price` keeps the old one. There is **no safety net** — the only triggers on `orders`/`order_items`/`order_history` are `trg_orders_updated_at` and `trg_order_history_market_id`; nothing recomputes `total_price`. CLAUDE.md pins revenue to `orders.total_price` only, so reported revenue silently diverges from the line items. Same shape on the legacy-backfill path at `:130-147`.
- **Minimal fix:** `.select("id")` on the orders UPDATE; on zero rows, delete the just-inserted items and return 409 (or check the RLS-writable status set before inserting).
- **Test first:** `src/app/api/orders/[id]/items/__tests__/route.test.ts` — update mock resolves `{data: [], error: null}`; assert 409 **and** that the item-delete rollback fired.

---

## Tier 2 — real, visible, lower blast radius

### 5. Fermées tab loses every Darb-delivered / returned order; three chips are structurally always 0
**MEDIUM-HIGH · code-only · 840 assigned rows**

- **Where:** `src/app/api/agent/queue/route.ts:68-71` (`CLOSED_STATUSES = ["rejected","uploaded","dispatched"]`) and `src/lib/agent-queue/buckets.ts:39` (same set client-side).
- **Trigger:** `promote_darb_status` (migration `20260817000001`) writes `uploaded → delivered|returned|cancelled` directly. `QueuePage.tsx:263-275` fires `POST /api/darb-assabil/sync-market` on **every mount**, so the promotion happens while the agent is watching. Realtime delivers the UPDATE; `cache-patch.ts:105` treats only `{cancelled, deleted}` as removals-with-notice, so `delivered`/`returned` fall through to `applyRowPatch` (`buckets.ts:137-138`), which filters the row out of `closedOrders` with **no toast at all**.
- **What the agent sees:** an order they confirmed and shipped vanishes from Fermées the moment the carrier reports success. The *Livré* / *Retourné* / *Annulé* chips (`QueueHeader.tsx:466-482`) read **0 for every agent, always**. Live: 40 `uploaded→delivered`, 18 `→cancelled`, 8 `→returned` in the last 30 days, all still assigned; 840 assigned orders sit in those three statuses overall. This is a **regression** — `plans/darb-assabil-status-display.md:25` shipped `completed → delivered` in the chip table on 2026-06-03; `promote_darb_status` (2026-06-23, `c4b462e`) made that row unreachable.
- **Minimal fix:** add `"delivered","returned"` to `route.ts:68` and `buckets.ts:39`. `bucketFor` already maps both correctly. Headroom is fine — worst-case closed-7d is 380 against the 1000 cap. **Do not** also move `cancelled` out of `TERMINAL_REMOVED_STATUSES`: cancellation is the one of the three that currently *does* notify the agent (`cache-patch.ts:105` → `kind:"cancelled"` toast), and demoting it to a silent Fermées row trades a real signal for a chip. See *Needs your call*.
- **Test first:** `src/lib/agent-queue/__tests__/buckets.test.ts` — assert `applyRowPatch` keeps a row in `closedOrders` when status goes `uploaded → delivered`, and `src/components/queue/__tests__/QueuePage.closed-chips.test.tsx` asserting the *Livré* chip counts it.
- **⚠️ Perf collision:** this widens the closed query. Coordinate with the `/api/agent/queue` perf workstream — the `.range(0, 999)` they will likely add must be sized after this change, not before.

---

### 6. `toQueueOrder` drops `product_display_name`, so agent and manager see different product names for the same order
**MEDIUM · code-only · one line**

- **Where:** `src/components/queue/QueuePage.tsx:57-114` — the object literal has no `product_display_name` key. Verified: the field is shipped by `src/app/api/agent/queue/route.ts:150`, declared in `src/types/queue.ts:14`, and read at `src/components/queue/OrderCard.tsx:169` (`order.product_display_name || order.product_name`).
- **Trigger:** any order whose `product_id` resolved to a catalog product with a different `products.name` than the webhook's `orders.product_name`.
- **What the agent sees:** the raw storefront string, forever — the `||` always falls through because the field is `undefined` on every `QueueOrder` the queue builds. **77 active assigned orders** currently differ. Every manager surface (`orders/OrderRow.tsx:153`, `team/AgentDrilldown.tsx:379`, `assign/OrderCard.tsx:42`) reads the field correctly, so the two roles read different product names off the same order. Never self-heals.
- **Minimal fix:** `product_display_name: (raw.product_display_name as string | null) ?? null,` in the literal.
- **Test first:** `src/components/queue/__tests__/toQueueOrder.test.ts` — export the mapper, assert every key of the API `FlatRow` shape survives the round-trip (a key-set equality test catches the next one of these too).

---

### 7. `attachLastAgentAction` truncates at 1000 rows: hundreds of Fermées orders read "never actioned"
**MEDIUM · code-only · ⚠️ perf collision**

- **Where:** `src/app/api/agent/queue/route.ts:26` (`HISTORY_ROW_CAP = 10_000`) and `:41` (`.limit(HISTORY_ROW_CAP)`); the reasoning at `:20-25` is wrong on both counts.
- **Trigger:** `.limit(N)` cannot exceed PostgREST's server-side cap — the repo documents this itself at `src/lib/supabase/fetch-all.ts:1-3`, and it was re-verified empirically (`?limit=5000` → `content-range: 0-999`). The DESC sort is **global across the whole id set**, not per order, so an order whose newest agent action ranks 1001+ globally contributes nothing.
- **What the agent sees:** `last_action_at = null` → `classifyLastAction` returns `{minutes: null, tier: "never"}` (`src/lib/queue/last-action.ts:53`) → `OrderCard.tsx:410` renders **`—`**. Live: agent `6e5367ef` loses the stamp on **185 of 396** orders; `76fda186` on 8 of 332. Split by list, **every lost stamp is on a closed row** (active: 105 orders, 0 lost) — so it's visible wrongness on the Fermées tab, not on work in hand. Non-deterministic: the set shifts on every history write anywhere.
- **Minimal fix:** one row per order server-side. An RPC doing `select distinct on (order_id) order_id, created_at from order_history where order_id = any($1) and actor_type='agent' order by order_id, created_at desc` — payload bounded by `ids.length`, no pager needed. `fetchAllRows` also works but pulls 1600 rows to use 388.
- **Test first:** `src/app/api/agent/queue/__tests__/last-action.test.ts` — feed the mock 1000 history rows in which order X's row is at index 999 and X's *newer* row would have been at 1001; assert X gets a non-null stamp. Fails today.
- **⚠️ Perf collision:** this creates a **new RPC on the `/api/agent/queue` hot path**, which is exactly what the perf workstream is rewriting. Hand them the `DISTINCT ON` requirement rather than shipping a competing RPC; if they are already batching enrichment RPCs, fold this into that batch.

---

### 8. Realtime-added rows carry no server-derived fields — the duplicate warning silently disappears on a freshly-assigned order
**MEDIUM · code-only**

- **Where:** `src/lib/agent-queue/cache-patch.ts:110` (`const mergedNew = prev ? { ...prev, ...event.new } : event.new;`) and `:87` (INSERT path); insertion at `src/lib/agent-queue/buckets.ts:134`.
- **Trigger, two live paths:** (a) a manager assigns an unowned order to the agent — Postgres emits an **UPDATE**, not an INSERT, so `prev` is null and the raw `orders` tuple is prepended; (b) warehouse walks `uploaded → scanned → dispatched` — the row is evicted from `closedOrders` at `scanned` (`buckets.ts:138`) and re-added at `dispatched` (`:142`) with `prev` gone.
- **What the agent sees:** the card renders with `product_image_url = undefined` (no thumbnail), `carrier_code = null` → `OrderCard.tsx:452` hides the carrier logo *and* `QueuePage.tsx:503,509` **excludes the order from the manual "Actualiser" carrier-status sweep**; `repeat_kind` undefined → repeat-buyer badge gone (`OrderCard.tsx:207`); `is_potential_duplicate`/`duplicate_siblings` undefined → **the duplicate-order warning disappears** from a freshly-assigned order. Persists until the 60 s poll, then self-heals.
- **Not** a re-ship risk: `dispatch/route.ts:90-101` re-checks server-authoritatively and 409s, as does `bulk-dispatch/route.ts:190`. A degraded client flag cannot cause a double ship. It is a lost *warning*, not a lost guard.
- **Minimal fix:** in `useAgentQueueRealtime`, when `applyRealtimeEvent` adds an id that was not previously in either list, return the optimistic row **and** schedule a debounced `mutate(QUEUE_KEY)`.
- **Test first:** `src/lib/agent-queue/__tests__/cache-patch.test.ts` — assert `applyRealtimeEvent` with `prev === null` sets a `needsRevalidate` flag (or returns the added id) rather than silently inserting a bare tuple.

---

### 9. Global search asserts "no order matches" over a set the server already truncated
**MEDIUM · code-only · does not self-heal**

- **Where:** `src/components/queue/QueuePage.tsx:536-550` (the comment claims it scans "the agent's **ENTIRE** order set" — it combines only `rawAllOrders + rawClosedOrders`), `:556-558`, and the empty state at `src/components/queue/QueueList.tsx:70-84`.
- **Trigger:** `/api/agent/queue` returns closed rows only for `status IN ('rejected','uploaded','dispatched') AND updated_at >= now()-7d` (`route.ts:68-71`, `:97-103`). Search a customer whose order is `delivered`, `cancelled`, `returned`, `scanned`, or simply closed 8 days ago.
- **What the agent sees:** "0 résultats" and the unqualified **"Aucune commande ne correspond à « {query} »"** for an order that is the agent's own. Live, invisible-to-search assigned orders: `rejected 578, delivered 427, uploaded 325, cancelled 226, returned 186, deleted 124, dispatched 91` = **1,957 rows**; for agent `32b9dbe0` that is 555 of 729 assigned orders (76%). Agents use this to answer "did this customer already order?", so a false negative here drives duplicate confirmations.
- **Minimal fix (cheapest honest one):** scope the copy — `"Aucune commande dans votre file ou vos 7 derniers jours ne correspond à « {query} »"`. The correct fix is a server-side search endpoint over the agent's full set; that is a scoped piece of work, not a patch.
- **Test first:** `src/components/queue/__tests__/QueueList.empty.test.tsx` — snapshot the empty-state string and assert it names the scope. (A behavioural test for the real fix belongs with the endpoint.)

---

### 10. The post-call sheet shows "Tentative 0/9" while the card next to it shows "Tentative 3/9"
**MEDIUM · code-only**

- **Where:** `src/components/queue/PostCallActionSheet.tsx:288` (`const currentAttemptNumber = attemptsCount;`), fed by `QueuePage.tsx:75` (`(raw.attempts_count) ?? (raw.attempt_count) ?? 0`) → `:860`.
- **Trigger:** `attempts_count` is `0` (not null) on 234 live rows, so the `??` never fires. `ca96f79` fixed exactly this reading in `presentStatus` (`src/lib/orders/status-presentation.ts:158-163`, which treats 0 as absent and falls back to the status digit) but the sheet was never updated.
- **What the agent sees:** two contradictory numbers for the same fact on the same screen — card pill "Tentative 3/9" (via `agent-status.ts:141` → `presentStatus`), sheet header "Tentative 0/9" (`:672`, `fr.json` `queue.attemptCounter`).
- **Refuted sub-claim, do not chase it:** the `atMax` gate is **not** wrongly suppressed. `max_call_attempts` is 9 (tn) / 8 (ly) and the status enum caps at `attempt_3`, so a status-digit-derived value can never reach max either. `noResponseHintMax` and the `injoignable` pre-seed are correctly off. This is a display bug only.
- **Minimal fix:** derive from the same rule the pill uses — `presentStatus(orderStatus, { attemptsCount, maxAttempts })` — and read the counter off its result.
- **Test first:** `src/components/queue/__tests__/PostCallActionSheet.test.tsx` — render with `{orderStatus:'attempt_3', attemptsCount:0, maxAttempts:9}` and assert the header reads "Tentative 3/9".

---

### 11. Optimistic rollback restores a whole-cache snapshot, resurrecting orders the agent no longer owns
**MEDIUM · code-only**

- **Where:** `src/hooks/useOptimisticOrderAction.ts:52` (`const before = cache.get(QUEUE_KEY)?.data`) and `:92` (`mutate(QUEUE_KEY, before, { revalidate: false })`).
- **Trigger:** agent submits reject/callback/confirm on order A. During the ~300-800 ms flight a realtime event for order **B** patches the cache (`useAgentQueueRealtime.ts:50-85`). A's request then fails — 401, 409 `statusChanged`, or a network blip; all three are already modelled in `httpErrorMessage` (`PostCallActionSheet.tsx:365-371`), so this is an expected path.
- **What the agent sees:** the pre-request snapshot is written back wholesale, discarding B's patch. If B's event was a `removeFromAll` (reassigned/cancelled/deleted, `cache-patch.ts:43-58`), **B reappears in the list and in the header bucket counts** after the agent was explicitly told it was taken away — and the toast has already fired and cleared, so it returns silently. Any action on B then 403s/409s. The `commitIdRef` guard at `:85-89` does not help: it orders two calls from the same hook instance only.
- **Reconciliation:** `revalidate: false` means nothing repairs it until `refreshInterval: 60000` (`useAgentQueue.ts:20`); `revalidateOnFocus` is explicitly `false` (`:21`), so tab focus won't close it early.
- **Minimal fix:** roll back one row inside a functional mutate — `mutate(QUEUE_KEY, (cur) => patchCache(cur, orderId, currentRow), { revalidate: false })` (`currentRow` is already captured at `:55`) — or just pass `{ revalidate: true }` on the failure path.
- **Test first:** `src/hooks/__tests__/useOptimisticOrderAction.test.tsx` — the existing test uses a single-row cache and therefore cannot see this. Add a two-row cache, remove row B mid-flight, fail the request, assert B is still absent after rollback.

---

### 12. Bulk advance onto an order that left the cache freezes the queue keyboard with nothing on screen
**MEDIUM · code-only**

- **Where:** `src/components/queue/QueuePage.tsx:674-690` — `handleCallTerminated` calls `setActiveOrderSnapshot` **only inside** `if (fromAll)`; `:751-758` (`activeOrder` = live lookup ?? snapshot); `:855` (sheet requires `activeOrder`); `:603-611` (keyboard swallow, with the Escape branch at `:615` dead behind it).
- **Trigger:** agent bulk-selects A and B; while the sheet is open on A, a manager cancels or reassigns B (realtime `removeFromAll`). A's `onSuccess` (`:870`) clears the snapshot to `null`, then calls `handleCallTerminated(B)`; B is not found, so the snapshot stays `null`.
- **What the agent sees:** `callTerminatedOrderId === B` but `activeOrder === null`, so **nothing renders** — and `handleKeyDown` returns unconditionally for every key. ↑/↓/j/k, Enter and Escape are all dead, with no sheet mounted to service its own Escape. The bulk batch stops with no message. Only a mouse click recovers it. Does not self-heal on the 60 s poll. 226 assigned orders are `cancelled` live, so the precondition occurs.
- **Refuted sibling:** the panel / `?openOrderId=` variant of this is **not** reachable — `onCallTerminated` only fires for `kind ∈ {endCall, changeStatus, rescheduleCallback}`, which `usePrimaryAction.ts:82-118` emits only for statuses that are all in `ACTIVE_QUEUE_STATUSES` and returned unfiltered in `allOrders`. Dropping the `ctx` argument at `:832` is currently harmless. Don't spend time there.
- **Minimal fix:** backstop after the `activeOrder` computation — `if (callTerminatedOrderId && !activeOrder) setCallTerminatedOrderId(null)` — plus advance to the next `bulkQueue` entry instead of stalling.
- **Test first:** `src/components/queue/__tests__/QueuePage.bulk.test.tsx` — bulk-select A and B, remove B from the SWR cache, complete A, assert `document` keydown for `ArrowDown` still moves focus.

---

### 13. Empty due-now list + a failing `/api/agent/stats` = permanent "Chargement…"
**MEDIUM · code-only**

- **Where:** `src/components/queue/QueuePage.tsx:728` — `if (!rawOrders.length && !error && !statsData)`.
- **Trigger:** `rawOrders` is `data?.orders`, the server's **time-filtered** active list (`route.ts:157-176`), which excludes future-dated `callback_scheduled` and future-dated manual `dispatch_scheduled`. An agent who scheduled all callbacks for tomorrow gets `orders: []` while `allOrders` is non-empty. `statsData` comes from `useSWR("/api/agent/stats", jsonFetcher, …)` at `:356`, and `jsonFetcher` (`:51-55`) **throws** on any non-2xx, so it stays `undefined` for as long as stats errors.
- **What the agent sees:** the queue payload loaded fine and `error` is null, but the component returns the skeleton and never renders `QueueHeader`/`QueueList`. En cours, Confirmé and Fermées are all invisible — orders they own — because an unrelated **stats** endpoint is down. No retry affordance.
- **Minimal fix:** gate on the queue's own load state — `if (isLoading && !data)` (`isLoading` is already returned by `useAgentQueue` and unused here) — and render the header with zeroed stats when `statsData` is missing.
- **Test first:** `src/components/queue/__tests__/QueuePage.loading.test.tsx` — queue resolves with `{orders: [], allOrders: [oneOrder]}`, stats rejects; assert `QueueList` renders the order.

---

### 14. The queue error screen is a dead end — polling is disabled while an error sits in the cache
**MEDIUM-LOW · code-only**

- **Where:** `src/hooks/useAgentQueue.ts:17-24` and `src/components/queue/QueuePage.tsx:739-745`.
- **Trigger:** one 500/timeout from `/api/agent/queue`. SWR 2.4.1 (`node_modules/swr/dist/index/index.mjs:610`) skips the revalidate when `getCache().error` is set — the polling loop keeps re-scheduling but never fetches. `revalidateOnFocus: false` (`:21`) removes the second line of defence.
- **What the agent sees:** a bare `<div>` reading *"Erreur de chargement. Nouvelle tentative…"* with **no button**. Recovery rests entirely on `onErrorRetry`'s uncapped exponential backoff (5000 ms × 2^n) — after ~8 failures the gap is 10-20 minutes, during which the screen truthfully claims it is retrying and nothing the agent does shortens it short of a full reload. Realtime events in that window are also dropped (`useAgentQueueRealtime.ts:53`, `if (!current) return current;`).
- **Minimal fix:** render a retry button wired to `mutate()` in the error branch. Consider `revalidateOnFocus: true`.
- **Test first:** `src/components/queue/__tests__/QueuePage.error.test.tsx` — SWR in error state, assert a button with the retry label exists and clicking it calls `mutate`.

---

## Tier 3 — confirmed, low impact (batch these)

| # | Bug | File:line | What the agent sees | Fix |
|---|---|---|---|---|
| 15 | `closedRes.error` is never inspected | `api/agent/queue/route.ts:106`, `:160` | On a transient closed-query error the route returns **200 with `closedOrders: []`** — Fermées empty-state, all six chips 0, closed search dead, no error anywhere. Trigger is not live today (`EXPLAIN ANALYZE` on the heaviest agent: 13 ms vs an 8 s timeout). | `if (activeRes.error \|\| closedRes.error) return 500;` or ship `closedError: true` so the tab says "indisponible". Test: route test where only the closed mock errors. |
| 16 | Escape never closes `OrderDetailPanel` for `uploaded`/`dispatched` | `OrderDetailPanel/index.tsx:630-651` — `if (!order \|\| !canEdit) return;` gates an effect that also registers Escape | Fermées → open any uploaded/dispatched row → Escape does nothing; the panel is mouse-only. The sibling "p" effect at `:552-565` is deliberately *not* gated, which shows the coupling is accidental. `rejected` rows are fine. | Split the effect: Escape on `order && !productSheetOpen`; keep `"e"` behind `canEdit`. |
| 17 | Shortcuts **3** and **4** are dead code | `QueuePage.tsx:602-611` + `PostCallActionSheet.tsx:208` | `ShortcutsOverlay.tsx:28-31` / `fr.json` advertise "3 — Rejeté", "4 — Rappel demandé". `initialFlow` is read only as a `useState` initializer and every open path sets it to `undefined` first, so pressing 3/4 does nothing. | `useEffect(() => { if (initialFlow) setFlow(initialFlow); }, [initialFlow])`, or delete the two overlay rows. |
| 18 | Dispatch UIs dismissible mid-upload; the carrier error is then thrown away | `PostCallActionSheet.tsx:279`, `:646`; `DarbAssabilDispatchModal.tsx:241-247`, `:316-318`; `DexpressDispatchModal.tsx:93-99`, `:148-150` | Clicking the backdrop during a multi-second carrier round-trip unmounts the dialog; on failure `setError` lands on an unmounted tree and the agent gets **zero** feedback. Order correctly stays `confirmed` and keeps its Upload affordance, so no wrong state — only lost feedback. | `if (uploading \|\| loading) return;` in all three, matching the guards already at `OrderDetailPanel/index.tsx:1427` and `TrackingBarcode.tsx:123`. |
| 19 | QueuePage's document keyboard handler stays live on the Leads tab | `AgentTabsContainer.tsx:34-39` (kept mounted under `display:none`) + `QueuePage.tsx:647-650` | Enter on a focused button in Leads mounts the post-call sheet **inside the hidden subtree**; QueuePage then swallows its own shortcuts until Escape. Native scroll/Tab still work (`:611` returns without `preventDefault`) and `AgentLeadsQueue` registers no handlers, so the damage is bounded. | Early-return from `handleKeyDown` unless `usePathname()` resolves to the queue tab; same guard on the `AGENT_NEW_ORDER_EVENT` listener at `:653-657`. |
| 20 | `handleRefreshDexpress` swallows failures | `QueuePage.tsx:516-531` | No `res.ok` check, no `catch`. A failed sync-batch stops the spinner with the pills unchanged and no message; a network throw escapes as an unhandled rejection and skips the `await mutate()` at `:528`. Agent believes the refresh succeeded. | Check `res.ok`, `catch`, toast on failure. |
| 21 | Error message renders on top of a fully-rendered stale order | `OrderDetailPanel/index.tsx:1128-1130` and `:1132` are independent conditionals | With `fallbackEnvelope` supplying `fallbackData`, `order` is non-null while `swrError` is set, so "Erreur de chargement" prints above a complete stale order body. | Make them mutually exclusive, or downgrade the error to an inline "données possiblement périmées" banner. |
| 22 | Two toasts fire for one reassign-away | `QueuePage.tsx:375` (from `useAgentQueue.reassignmentEvent`) and `:843-845` (from `useOrderDetailRealtime.onReassignedAway`) | Two identical warnings stack — `Toast.tsx:57-64` assigns a fresh id per call and does not dedupe by message. Only when the panel is open. | Dedupe by `(orderId, kind)` in the toast store, or suppress the panel-sourced toast when the queue-level one already fired. |

---

## Additional migration-only items (separate PR from all code work)

These are all confirmed but **latent** — zero or near-zero live instances. Batch them into one migration so they don't each cost a deploy.

| Item | Where | Status |
|---|---|---|
| **`next_retry_slot` shipped with no backfill** | `20260827000002_stamp_next_retry_slot.sql` has no `UPDATE orders`. Live: 251 of 303 `attempt_*` orders have `callback_scheduled_at IS NULL`, 216 of them assigned, 212 untouched >7 days. `run_notifications_check()` gates the `attempt_due` insert on `callback_scheduled_at <= now()`, so the bell never nudges them. **Downgraded from the original report:** these orders are *not* invisible — `attempt_*` is in `ACTIVE_QUEUE_STATUSES` and `sortAgentQueue` gives them priority 1, above `pending`. Only the notification is missing. | LOW. One-time `update orders set callback_scheduled_at = public.next_retry_slot(market_id) where status in ('attempt_1','attempt_2','attempt_3') and callback_scheduled_at is null and assigned_to is not null;` |
| **Retry slot leaks onto non-attempt statuses** | `20260827000005_rejection_subreason_in_transition.sql:102-106` — only a `callback_scheduled` *source* clears the column, so `attempt_* → confirmed\|rejected\|uploaded` carries the slot forward. 9 live rows. **This does render wrong**, contrary to the original report: `src/components/orders/OrderRow.tsx:157-159` computes `callbackOverdue` with **no status guard** and paints a red "rappel en retard" dot on `confirmed`/`uploaded`/`rejected` orders in the manager console (the memo comparator at `:408-413` repeats the ungated computation). The agent queue is safe — `AttemptEtiquette.tsx:75-83` gates on status. | LOW. Add the `when v_current_status in ('attempt_1','attempt_2','attempt_3') and p_new_status not in (…) then null` branch **and** a status guard at `OrderRow.tsx:157`. |
| **Ambiguous `no_response_with_auto_reject` overload** | Two overloads live; a 4-named-arg call gets `PGRST203 / HTTP 300`, which `no-response/route.ts:84-91` does not match, so it 500s. **No client caller exists** — the UI uses `/no-answer`, which passes `p_actor_type` and resolves. The 4-arg form is a pure delegating wrapper (`return … (…, 'agent')`), so dropping it is behavior-preserving. | LOW, risk-free. `drop function public.no_response_with_auto_reject(uuid, order_status, timestamptz, uuid);` Fold into the Tier-1 #1 migration. |
| **Cron `dispatch_scheduled → confirmed` is an invalid transition** | `transition_order_status`: `when 'dispatch_scheduled' then p_new_status in ('uploaded','deleted')`. `cron/dispatch-scheduled/route.ts:93-99` raises every time; `dispatch_scheduled_ready` has no failure marker, so the row is re-selected and re-fails forever with no timeline note. Zero live instances — all 3 `dispatch_scheduled` rows are `scheduled_dispatch_auto = false` and the view requires `true`. | LOW. Clear `scheduled_dispatch_*` and write a history note without a status change (cleanest — `transition_order_status` already nulls those columns when leaving the state). Also log `revertError`, which currently only appears in the cron's JSON body. |
| **`/api/agent/stats` omits `dispatch_scheduled`** | `api/agent/stats/route.ts:7-15` lists 7 statuses; `ACTIVE_QUEUE_STATUSES` lists 8. The *Assignées* meter (`QueueHeader.tsx:326`, fed by `QueuePage.tsx:660`) disagrees with the sum of the chips beside it. Live: agent `2236fe7b` shows 127 against a real queue of 130. | LOW, **code-only** — `import { ACTIVE_AGENT_STATUSES } from "@/lib/agent-queue/buckets"` and delete the local list. Listed here because it pairs with the stats TZ decision below. |
| **Leads chips ≠ rows (overdue callbacks in no chip)** | `api/agent/leads/queue/route.ts:91-93` counts `callback_scheduled` into `rappel_prevu` only when the time is NULL or future, while `AgentLeadsQueue.tsx:103-113` lists every `callback_scheduled` lead and `:122-127` requires `callbackAt > now` for the sub-chip. Same defect `2bf55ed` fixed on the orders side. Live: 4 `callback_scheduled` leads, all with `assigned_to IS NULL`, so the route's `.eq("assigned_to", actor.id)` means **none reach any agent**. | LOW, **code-only**, structural only. Count `callback_scheduled` unconditionally; make `matchesSub("scheduled")` a pure status test. |
| **Dispatch duplicate guard fails open** | `dispatch/route.ts:95-100` → `duplicate-orders/detect.ts:136-146` returns `EMPTY` (`has_uploaded_sibling: false`) on error, throw, or `!data` — the same swallow-and-return-empty shape as the known `enrich.ts` bug. **Downgraded:** the guard is advisory by design and says so at `:91-93` ("We warn rather than block"), and the timeout theory doesn't apply — the call passes one row and the RPC times at 8.7 ms. | LOW, **code-only**. Return `null`/throw on error and 503 from the route, keeping `EMPTY` only for the legitimate no-market/no-rows case. **⚠️ Perf collision:** `detect.ts` and `enrich.ts` are both being rewritten by the perf workstream — hand them the "distinguish *no duplicates* from *could not determine*" requirement rather than editing in parallel. |

---

## Needs your call — missing product decisions, not bugs

### A. Day boundary: whose midnight?
`api/agent/stats/route.ts:29-31` uses `new Date(); setHours(0,0,0,0)`, which resolves to UTC on Vercel. Markets are Africa/Tunis (UTC+1) and Africa/Tripoli (UTC+2), so *Traitées* and *Taux de confirmation* reset at 01:00 / 02:00 local instead of midnight.

**Why this isn't a filed bug:** it is a repo-wide convention, not a defect of this route. The same UTC boundary appears in ≥20 places — `api/orders/queue/route.ts:71`, `api/orders/status-counts/route.ts:49`, `api/team/sparklines/route.ts:85`, `api/warehouse/returns/summary/route.ts:24`, `api/team/route.ts:28`, `api/confirmation-flow/overview/route.ts:30`. Patching only the agent tile would make it disagree with every manager dashboard. And the live impact is currently nil: `shift_config` for both markets is `08:00–18:00, Mon–Fri`, and there were **2 agent actions in local hours 0–3 over 30 days**.

**Decision needed:** adopt a `startOfMarketDay(marketId)` helper repo-wide (the SQL side already does this correctly in `next_retry_slot`) and document a timezone policy in CLAUDE.md — or explicitly accept UTC days as the reporting convention. Do not let someone fix this in one file.

### B. Should `cancelled` sit in Fermées, or keep its toast?
Bug #5 adds `delivered` and `returned` to `CLOSED_STATUSES`. `cancelled` is the ambiguous one: today it is in `TERMINAL_REMOVED_STATUSES` (`buckets.ts:41`) and produces a **"cancelled by manager" toast** — a real signal. Putting it in Fermées so the *Annulé* chip works would trade that signal for a count. 226 assigned orders are affected. Product call: signal or chip. (You could have both — keep the toast and also land the row in Fermées — but that is new behaviour, not a fix.)

### C. Does the 7-day closed window belong on `uploaded`?
`route.ts:72` applies a uniform 7-day window to all closed statuses. For `rejected`/`dispatched` that's defensible — a recent-activity log the agent owes nothing on. For **`uploaded` it is arguable**: an `uploaded` order is a live, un-scanned handoff (CLAUDE.md: "ready to print + scan"), and **325 assigned `uploaded` orders are past the window and invisible on every agent surface** (`/api/agent/stats` only counts today's history). Nothing reconciles them. Decide whether `uploaded` is exempt from the window, or whether stale handoffs are a warehouse concern the agent shouldn't see.

### D. Can agents edit rejected orders at all?
Bug #3's minimal fix stops the lie, but there are two valid landings: **(i)** drop `rejected` from `EDIT_WINDOWED_STATUSES` — agents cannot edit rejected orders, and the panel greys out; or **(ii)** add `rejected` to the `orders_update` RLS allow-list — agents can fix a typo'd phone on a rejected order within 7 days, which is plausibly the original intent given the constant is literally named `EDIT_WINDOWED_STATUSES`. Ship the 409 guard either way; pick the landing before touching the permission constant.

---

## Refuted — do not re-file

| Claim | Why it's dead |
|---|---|
| Auto-reject's 1.5 s `setTimeout` double-fires / fires post-unmount (`PostCallActionSheet.tsx:393-418`) | The code shape is exactly as described, but **the branch is unreachable**. The RPC auto-rejects only when `attempts_count` already equals max; the sheet hides the "Sans réponse" card at exactly that point (`:708`, `atMax = attemptsCount >= maxAttempts`, both sides reading the same setting). The unit test that exercises it mocks a server response the real RPC cannot produce. Worth a `clearTimeout` as hygiene; not a defect. |
| `canTransition` throws a `TypeError` on `new`/`dispatching` | The code fact is right (`order-status.ts:137-138` does an unguarded `TRANSITIONS[from].includes(to)`), but no reachable path passes those statuses. `new` falls to the documented close-only fallback in `usePrimaryAction.ts:203-207` — no endCall, no changeStatus. Both live `new` rows are `assigned_to = null`, and `reject/route.ts:132` requires ownership. Nothing writes `status='new'` any more. `dispatching`: 0 rows. Take the `(TRANSITIONS[from] ?? [])` one-liner if you're in the file; don't schedule it. |
| Two stale copies of the flat-seven rejection list (`api/metrics/route.ts:132-140`, `AgentDrilldown.tsx:70-78`) | Both are dead code. `rejection_breakdown` has zero consumers (`prefetch.ts:23` only `preload()`s the key). `AgentDrilldown` fetches `/api/team/metrics`, not `/api/metrics`, and that RPC's JSON has no `rejection_breakdown` key — so the guard at `:392` is never satisfied and `REJECTION_LABELS` never renders. Deleting them is cleanup. |
| `/api/orders/queue` is dead and divergent | Both facts are true (only its own test references it; `QUEUE_STATUSES` omits `dispatch_scheduled` and `getQueuePriority` orders differently from `sortAgentQueue`). Unreachable code shows no agent wrong data. File as a deletion ticket, not a bug. |
| Panel `?openOrderId=` path can freeze the keyboard like bug #12 | `onCallTerminated` only fires for kinds that `usePrimaryAction` emits exclusively for statuses in `ACTIVE_QUEUE_STATUSES`, all of which are returned **time-unfiltered** in `allOrders`. The one residual gap (ref-deleted `uploaded` >7 days) has **0 rows** live. Dropping the `ctx` argument at `QueuePage.tsx:832` is currently harmless. |
| `fetchAgentCapacity` truncation breaks auto-assign load balancing | The truncation is real (`agent-capacity.ts:28-32`, `:41-45`, both unbounded), but **both auto-assign callers are market-scoped and gated on an active non-manual rule first**; only Tunisia reaches the function, at 601 orders / 148 history rows — well under 1000. What is genuinely broken is the super_admin all-markets assign board (`useAgentCapacity.ts:19-21` drops `market_id`), which enumerates 1283 rows with no `ORDER BY`. That is the **manager assign board, outside this scope** — hand it to whoever owns `/assign`. |

---

## Workstream collision summary

Three fixes touch files the `/api/agent/queue` performance workstream is actively rewriting. Coordinate before starting:

- **#7 (`attachLastAgentAction`)** — introduces a new RPC on the hot path. Hand perf the `DISTINCT ON (order_id)` requirement; do not ship a competing RPC.
- **#5 (`CLOSED_STATUSES`)** — widens the closed query. Perf will likely add `.range(0, 999)`; that must be sized after this change (worst case rises to ~440 of 1000).
- **Dispatch duplicate guard** — `detect.ts` and `enrich.ts` are both being rewritten. Give perf the "distinguish *no duplicates* from *could not determine*" contract rather than editing in parallel. The known `get_customer_history_batch` non-sargable timeout is theirs; this is the same failure shape one layer up.

Everything in Tier 1–3 other than those three is independent and can ship immediately. All DB migrations belong in one PR, separate from all code work, with #1 (`no_response_with_auto_reject`) gated on its own test.