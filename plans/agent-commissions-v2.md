# Mes commissions v2 — the agent's statement, order by order

Approved 2026-09-30 from `prototypes/agent-commissions-v2.html` (Phase 0 done). Replaces
the v1 view (`AgentCommissionsView.tsx`, `get_my_commissions`).

## Why

On tasnim's real data the v1 page could not answer what the agent asks: how much am I owed,
how much have I received, which delivered orders are paid, which are waiting, which will
never pay. It also lied twice: « قيد التسليم 2 » when 28 parcels were on the way (the
in-flight list knew only Tunisian statuses), and a rate of 10 when everything earned was at 9.

## The page rule

Every number at the top is a tab below whose rows add up to it.

- **Hero** — owed now, "for N delivered orders not paid yet", and the equation
  earned − received = left. Last payout underneath.
- **En route** — count, estimate at today's rate, a "likely" estimate at the delivery rate,
  stages (awaiting scan · with carrier · out for delivery · delayed · returning); delayed
  links to /delivery.
- **Taux de livraison** — delivered ÷ (delivered + finished without delivery), confirmed
  since the window start, with the funnel.
- **Tabs** — غير مدفوعة (sums to owed) · في الطريق · مدفوعة (grouped by payout) · لم تُحتسب.

## Decisions (owner approved the prototype; the four open points took their defaults)

1. Delivery rate IS shown to the agent, phrased without blame.
2. Customer names on rows; the Mongo external id is dropped from the row.
3. Window = since activation, capped at `p_days` (default 90). No period filter yet.
4. The two 2026-09-30 accruals at 9 (rate 10 entered 16:12, effective midnight) are NOT
   re-rated. The ledger freezes the rate at accrual time.

## Definitions (one place each)

- **Stage of an order** — `commission_order_stage(status)`, IMMUTABLE:
  queue (pending, new, assigned, attempt_*, callback_scheduled) · awaiting_upload (confirmed,
  dispatch_scheduled) · awaiting_scan (uploaded, dispatching) · with_carrier (scanned,
  at_carrier, dispatched, deposit, in_transit, unverified) · out (out_for_delivery) ·
  delayed (delivery_delayed) · returning (returning, to_be_returned, received) · delivered ·
  rejected · returned · cancelled · deleted. In flight = awaiting_scan … returning.
  `get_team_commissions` and `get_my_commissions` use it too — that is the « 2 vs 28 » fix.
- **Mine** — the last `confirmed` transition by an agent is this agent (same attribution as
  the accrual sweep).
- **Credits** — accruals without a reversal, plus adjustments. Σ credits = earned.
- **FIFO** — credits sorted by `effective_at`; cumulative payouts settle the oldest first.
  A credit is settled by payout k when P(k−1) < cum ≤ P(k); `split` when it started before
  P(k−1). Credits past the last payout are unpaid; the one straddling it is `partial` and
  shows only its remainder, so Σ unpaid = owed exactly.
- **Estimate** — in-flight (not returning) × today's rate, only when enabled; likely =
  estimate × delivery rate. Orders uploaded while commission was off
  (`commission_counts_upload` false) are not in flight for commission purposes.
- **Not counted** — mine, confirmed in the window, finished as cancelled (reason
  `carrier_cancelled` when the cancelling actor is `system`, else `cancelled`), rejected or
  returned; plus mine delivered in the window that the rule excludes: a reversal exists, or
  the upload gate / delivery-day rate says no (`before_activation` if uploaded before the
  activation day, else `commission_off`). A just-delivered order waiting for the 15-min sweep
  is NOT listed as not counted.

## Contract — `get_my_commission_statement(p_days int default 90) → jsonb`

SECURITY DEFINER, caller = `auth.uid()` (agent, not deleted). REVOKE from PUBLIC/anon, GRANT
authenticated. Shape in `src/lib/commissions/types.ts` (`AgentStatement`).

## Work (TDD)

1. `supabase/tests/commission_statement_test.sql` — FIFO incl. split/partial, Σ unpaid = owed,
   stages incl. Darb statuses, gate, not-counted reasons, funnel, rate, activation, grants.
2. Migration: helper + new RPC + the two old RPCs on the helper. Additive: the deployed app
   keeps calling `get_my_commissions` until the new build ships.
3. Route `/api/agent/commissions` → the new RPC (route test first).
4. `AgentCommissionsView` rewrite from the prototype (component test first), fr + ar.
5. Docs: `docs/agent-commissions.md`.

Later: drop `get_my_commissions` once no deployed build calls it.
