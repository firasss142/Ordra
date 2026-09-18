# Order Status Pipeline

The `order_status` enum as it exists in the live database — **27 values**, verified
2026-09-13. Rewritten that day: the previous version predated `uploaded`, `scanned`, the
move of the stock boundary, and the whole Darb fulfillment vocabulary, and described a
`confirmed → dispatched` path that no longer exists.

Assignment is **ownership** (`orders.assigned_to`), not a status. A new order is
`pending` whether or not anyone owns it.

---

## Phase 1 — Confirmation (agent workflow)

```
pending
 ├─→ attempt_1 → attempt_2 → attempt_3
 ├─→ callback_scheduled        (can repeat from any attempt)
 ├─→ confirmed                 ← phone outcome ONLY; no carrier work yet
 │    ├─→ uploaded             ← separate "upload" action; carrier API succeeded
 │    └─→ dispatch_scheduled → uploaded   (cron; never reverts to confirmed)
 └─→ rejected                  ← TERMINAL

cancelled                      ← TERMINAL (manager/system, any pre-dispatch status)
deleted                        ← TERMINAL (manager)
```

**Confirm is atomic and never depends on the carrier API.** Confirming puts the order in
`confirmed` and stops. The carrier upload is a *separate* action landing on `uploaded`.
On any upload failure the order stays `confirmed` (or `dispatch_scheduled` for
cron-driven uploads) — never rolled further back. A retry is just a retry.

## Phase 2 — Fulfillment (carrier lifecycle, post-scan)

**Libya (Darb Assabil)** — the carrier's own vocabulary, since 2026-09-09:

```
scanned → at_carrier → in_transit → out_for_delivery ⇄ delivery_delayed
                                  │      └─→ delivered        ← TERMINAL
                                  └─→ returning → to_be_returned → returned  ← TERMINAL
                                                                └─→ received → confirmed (re-sent)
```

**Tunisia** keeps the older chain: `scanned → dispatched → deposit → in_transit →
delivered | returned`.

A status is **never walked backwards** — `order_status_rank()` is the guard. See
`docs/warehouse-sites-and-statuses.md`.

`dispatching` and `unverified` also exist in the enum: `dispatching` is a transient
upload state, `unverified` a parking state for orders that failed verification
(`unverified_after_days`).

---

## Key boundaries

| Status | Boundary |
|---|---|
| `confirmed` | Phone confirmation outcome only. Still in the agent queue, awaiting upload. |
| `uploaded` | Carrier API succeeded; `tracking_number` + `carrier_id` set; ready to print + scan. |
| `scanned` | **STOCK BOUNDARY** — warehouse scan-out deducts stock −qty. |
| `dispatched` | Carrier acknowledged receipt (Tunisia chain). |
| `deposit` | **COST BOUNDARY** — carrier fees begin (stock already moved at `scanned`). |
| `delivered` | Revenue realized. |
| `returned` | Stock +qty, unless damaged (increments `damaged_return_count`). |

---

## Terminal statuses

`delivered` · `returned` · `rejected` · `cancelled` · `deleted` — no further transitions.

---

## Who sets what

- **Agents**: `attempt_*`, `callback_scheduled`, `confirmed`, `dispatch_scheduled`,
  `uploaded` (via the upload action), `rejected`
- **Warehouse**: `scanned` (`uploaded → scanned`, via `scan_order_out`)
- **System**: `pending` (webhook intake), `deposit`, `in_transit`, the Darb statuses,
  `delivered`, `returned`, `unverified`
- **Managers** can force: `cancelled`, `deleted` (any pre-dispatch status)
- **Agents NEVER set**: `scanned`, `dispatched`, `deposit`, `in_transit`, `delivered`,
  `returned`

Transitions go through `transition_order_status(...)` and `fulfill_order_transition(...)`;
Darb promotions through `promote_darb_status(...)`. Every one appends to `order_history`.

**Max attempts** is per market via `settings.max_call_attempts` (default 3).

---

## Rejection reasons (required when status = rejected)

**Nine values** in the `rejection_reason` enum:

| Value | Meaning |
|---|---|
| `refus_client` | Customer refused the order |
| `faux_numero` | Phone number wrong or fake |
| `doublon` | Duplicate order |
| `injoignable` | Unreachable after max attempts |
| `prix` | Price issue |
| `non_serieux` | Not a serious buyer |
| `commande_invalide` | Order itself is invalid |
| `livraison_impossible` | Cannot be delivered to this destination |
| `autre` | Other — free-text note required |

---

## History log

Every transition appends to `order_history`: `status_from → status_to`, `actor_id`
(NULL for system), `actor_type`, `note`, `created_at`.

**Append-only, enforced by `trg_order_history_append_only`.** No edits, no deletes, ever
— the trigger will refuse. Correct a mistake by appending, never by rewriting.

---

## Agent queue sort order

1. `callback_scheduled` where `callback_time <= now()` — overdue callbacks first
2. `attempt_*` — oldest `created_at` first
3. `pending` (untouched, owned by the agent) — oldest `created_at` first
4. `confirmed` — shows the "Upload" affordance until `uploaded`

## Post-call action sheet

After "Appel terminé":

1. **Pas de réponse** — increments the attempt and sets the next callback (default +2h);
   the order returns to the queue.
2. **Confirmé** — status → `confirmed`. **No carrier call happens here.** The upload is a
   separate action that lands on `uploaded`, or leaves the order at `confirmed` on
   failure.
3. **Rejeté** — rejection reason required; the order leaves the queue immediately.
4. **Rappel demandé** — date + time; status → `callback_scheduled`; the order resurfaces
   at the scheduled moment.

Related: `docs/order-presence-and-locking.md` (who may act on an order),
`docs/warehouse-sites-and-statuses.md` (the Darb vocabulary and the scan),
`docs/darb-assabil-sync.md` (where fulfillment statuses come from).
