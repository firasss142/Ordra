# Order Status Pipeline

Source: OMS spec Section 6, corrected with fulfillment lifecycle.

---

## Two-Phase Status Model

Orders have two lifecycle phases in one status field:

### Phase 1 — Confirmation (agent workflow)

```
new
 └─→ assigned
      ├─→ attempt_1
      │    └─→ attempt_2
      │         └─→ attempt_3
      ├─→ callback_scheduled  (can repeat from any attempt)
      ├─→ confirmed
      │    └─→ dispatched     ← exits agent queue, enters fulfillment
      └─→ rejected            ← TERMINAL

cancelled                     ← TERMINAL (manager or system, any pre-dispatch)
```

### Phase 2 — Fulfillment (carrier lifecycle, post-dispatch)

```
dispatched
 └─→ deposit                  ← COST BOUNDARY: carrier fees begin, stock −1
      └─→ in_transit
           ├─→ delivered      ← TERMINAL: revenue realized
           └─→ returned       ← TERMINAL: stock +1 (unless damaged)
```

---

## Status Definitions

| Status | Set by | What it means |
|--------|--------|---------------|
| new | System (webhook intake) | Order received, sitting in unassigned pool |
| assigned | System or Manager | Given to an agent, appears in their queue |
| attempt_1 | Agent | First call, customer didn't answer |
| attempt_2 | Agent | Second call, no answer |
| attempt_3 | Agent | Third call, no answer |
| callback_scheduled | Agent | Customer asked to be called back at specific time |
| confirmed | Agent | Customer said yes, agent selected carrier, pushing to API |
| dispatched | System | Carrier API accepted the order — exits agent queue |
| deposit | System / Manager | Carrier physically picked up package — cost boundary, stock −1 |
| in_transit | System / Manager | Active delivery in progress |
| delivered | System / Manager | Successful delivery — revenue realized |
| returned | System / Manager | Package returned to warehouse — stock +1 (unless damaged) |
| rejected | Agent | Customer refused / unreachable / duplicate / wrong number |
| cancelled | System or Manager | Cancelled before dispatch (storefront cancel or manager override) |

---

## Key Boundaries

- **dispatched** = order exits agent queue, enters fulfillment tracking
- **deposit** = COST BOUNDARY — carrier fees and stock changes begin here
- **delivered** = revenue realized
- **returned** = stock +1 (unless damaged)

---

## Terminal Statuses

**delivered, returned, rejected, cancelled** — no further transitions allowed from these.

---

## Transition Rules

### Who can set what
- **Agents** set: attempt_1, attempt_2, attempt_3, callback_scheduled, confirmed, rejected
- **System** sets: new (on webhook intake), dispatched (on carrier API success)
- **System / Manager** sets: deposit, in_transit, delivered, returned (fulfillment updates)
- **Managers** can force: cancelled (at any pre-dispatch status)
- **Agents NEVER set:** dispatched, deposit, in_transit, delivered, returned

### Phase 1 — Confirmation transitions

| From | Allowed To |
|------|-----------|
| new | assigned |
| assigned | attempt_1, callback_scheduled, confirmed, rejected, cancelled |
| attempt_1 | attempt_2, callback_scheduled, confirmed, rejected, cancelled |
| attempt_2 | attempt_3, callback_scheduled, confirmed, rejected, cancelled |
| attempt_3 | callback_scheduled, confirmed, rejected, cancelled |
| callback_scheduled | attempt_1, attempt_2, attempt_3, confirmed, rejected, cancelled |
| confirmed | dispatched, cancelled |

### Phase 2 — Fulfillment transitions

| From | Allowed To |
|------|-----------|
| dispatched | deposit, cancelled |
| deposit | in_transit |
| in_transit | delivered, returned |
| delivered | *(none — terminal)* |
| returned | *(none — terminal)* |
| rejected | *(none — terminal)* |
| cancelled | *(none — terminal)* |

### How fulfillment statuses are set in v1
OMS spec Section 15: "Carrier status webhook — manual or polling in v1."
- Manager manually updates order status (dropdown on order detail page)
- Background polling of carrier API (if available)
- Future: carrier webhook pushes status updates automatically

All paths write to the same `orders.status` field and append to `order_history`.

### Max attempts
Configurable per market via settings table (key: `max_call_attempts`, default: 3).
After max attempts without confirmation, agent must confirm or reject. No more "no answer" allowed.

---

## Rejection Reasons (required on reject)

| Value | French label | Meaning |
|-------|-------------|---------|
| refus_client | Refus client | Customer refused the order |
| faux_numero | Faux numero | Phone number is wrong/fake |
| doublon | Doublon | Duplicate order |
| injoignable | Injoignable | Unreachable after max attempts |
| prix | Prix | Price issue |
| non_serieux | Non serieux | Not a serious buyer |
| autre | Autre | Other — free text note required |

---

## History Log

Every status transition appends a row to `order_history`:
- status_from → status_to
- actor_id (agent or NULL for system)
- actor_type (system, agent, manager)
- note (rejection reason text, callback instructions, error message)
- created_at

**Immutable. No edits. No deletes. Ever.**

---

## Agent Queue Sort Order

When displaying an agent's queue, orders sort in this priority:

1. **callback_scheduled** where `callback_scheduled_at <= now()` — these are overdue callbacks, highest priority
2. **attempt_*** statuses sorted by `created_at ASC` — oldest unfinished attempts first
3. **assigned** (new, never attempted) sorted by `created_at ASC` — oldest first

This ensures agents handle overdue callbacks first, then follow up on previous attempts, then work new orders.

---

## Post-Call Action Sheet (Agent Workflow)

After agent clicks "Appel termine" on an order, a modal presents 4 options:

**Option 1 — Pas de reponse:** Increments attempt (attempt_1 → attempt_2 → attempt_3). Sets next callback time (default +2h). Order returns to queue.

**Option 2 — Confirme:** Agent selects carrier. System pushes to carrier API synchronously. On success → dispatched, tracking number stored, order exits queue. On failure → error shown, order stays confirmed, retry available.

**Option 3 — Rejete:** Agent selects rejection reason (required). One tap to confirm. Order exits queue immediately.

**Option 4 — Rappel demande:** Agent selects date + time. Status → callback_scheduled. Order disappears from active queue and resurfaces at scheduled time.
