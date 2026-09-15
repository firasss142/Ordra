# Delivery follow-up — customers, actions, zones, worklist

The engine that decides **which late parcel someone should do something about, and
what**. Landed 2026-09-12 in five migrations.

> **Status (2026-09-15): both screens are live at `/[locale]/delivery`.** Phases 0–4 shipped.
> The agent screen came from `prototypes/suivi-livraison-v1.html` v3; the manager and
> super_admin board from `prototypes/suivi-livraison-manager-v1.html`, and the route branches
> on role. The board adds the agents strip, the cockpit (Équipe / Livreurs / Transporteurs)
> and reassignment; its verdicts live in `src/lib/delivery/board.ts` and its per-agent activity
> in `public.get_delivery_board`. Still to do: the commission rule change and the `lost` status
> that decision 38 calls for, the manager task, the proactive-call trigger with its
> notifications, and the deletion phase.
>
> **Relances (/follow-ups) and Tableau livraison (/in-delivery) are still live.** The agent
> tab now points at /delivery and the manager board replaces what /in-delivery showed, but
> the old pages were not deleted. Deleting them is the deletion phase, not a side effect.

---

## 1. Why it exists

A parcel goes quiet at the carrier and nobody notices; the driver writes a remark nobody
reads; an agent rings a customer who was already rung an hour ago. The engine answers
three questions a human otherwise has to hold in their head:

1. Who is this customer, across every order and every spelling of their phone number?
   → `customers`
2. What has already been done about this parcel, and by whom? → `delivery_actions`
3. Is this destination normally this bad, or is this parcel unusual? → `delivery_zone_stats`

`get_delivery_worklist` combines the three into one ordered list.

---

## 2. `customers` — one buyer, one row

Keyed `UNIQUE (market_id, phone_normalized)`. Written **only** by trigger from `orders`
(`trg_orders_link_customer` BEFORE, `trg_orders_refresh_customer` AFTER) and by
`refresh_customer_stats()`. There is no INSERT/UPDATE policy at all — no client can
write here, by design.

`phones text[]` keeps every raw spelling seen; `phone_normalized` is the identity.

**The trunk-zero merge.** `normalize_phone()` was redefined
(`20260926000002`) to strip the Libyan trunk zero, but only on a strict `^0[0-9]{9}$`.
That merged **149 split identities** — the same person counted as two customers, with
two halves of a history. Any new path that stores a phone must go through
`normalize_phone()`, and `src/lib/leads/phone.ts` is the TS mirror that must stay in
step with it.

### `risk_class` — and a live disagreement

`customer_risk_class(orders_count, delivered, returned, rejected)` returns three values:

```
risk    orders_count >= 2 AND (returned + rejected) / (delivered + returned + rejected) >= 0.5
repeat  orders_count >= 1
none    otherwise
```

> **Flagged discrepancy (2026-09-13).** `src/lib/customer-history/classify.ts` — which
> draws the badge an agent actually sees — computes a *different* thing. It has four
> values (`none | repeat | likely | risk`) and its `computeRiskRatio` is
> **`rejected / terminal`**: returns are not counted. So a customer who returns
> every parcel but never rejects a call is `risk` in the database and `repeat` on the
> badge.
>
> The migration comment in `20260926000001_customers.sql` asserts "the TS rule is
> aligned in the same phase so the badge and this column agree." **It is not aligned.**
>
> Impact today is small and will grow: of 7 117 customers, exactly **1** is classified
> differently. Small because returns are still rare relative to rejections — every
> future return widens it. Deciding which definition is right is a product call, so it
> is recorded here rather than patched.

---

## 3. `delivery_actions` — append-only

One row per intervention. `trg_delivery_actions_append_only` rejects UPDATE and DELETE;
there is no INSERT policy either, so everything goes through
`record_delivery_action(...)` (SECURITY DEFINER).

`action_type`, `channel`, `outcome`, `note` (≤500 chars), `next_action_at`,
`template_key`, actor — plus three columns that snapshot the world at the moment of the
action: `status_at_action`, `carrier_slug_at_action`, `remark_class_at_action`. They are
denormalized on purpose: a month later, "why did someone call about this?" is
answerable without replaying the parcel's history.

**`actor_type` is load-bearing.** The worklist's "has a human answered this yet?" test
excludes `actor_type='system'`. If a system-written row counted as an answer, raising an
automated task would silence the very remark that raised it.

---

## 4. `delivery_zone_stats` + the driver's remark

**Zones.** `(market_id, zone_key)` → `delivered_count`, `returned_count`, `sample`,
`delivery_rate`, over `window_days` (default 90). Zone identity comes from
`delivery_zone_key(darb_destination_id, city_id, customer_city)`. Refreshed by
`refresh_delivery_zone_stats()` on the `delivery-zone-stats-nightly` cron (02:17); rows
older than two days are deleted, so a stale rate can never condemn a parcel.

Always check `sample` against `zone_min_sample` before believing `delivery_rate` — a
zone with four parcels has a rate that means nothing.

**The remark.** `darb_shipments` gained `remark_class`, `remark_class_source`,
`remark_classified_at` (CHECK-constrained to 17 classes), filled by
`src/lib/carriers/darb-remark-classifier.ts` during the Darb sync cycle, backfilled by
`scripts/backfill-remark-class.ts`. This turns free text the driver typed into something
the worklist can branch on — the thing that "personne ne lisait".

---

## 5. `get_delivery_worklist(p_market_id, p_agent_id)`

**SECURITY INVOKER** — deliberately. The caller's own RLS does market isolation, which
is what makes it safe to hand directly to an agent. Do not "fix" a permission error by
making it DEFINER.

**Scope.** Market, `archived_at IS NULL`, in-flight statuses — plus terminal ones for
`delivery_done_window_hours`, so an agent sees the parcel they just resolved instead of
watching it vanish. Optionally narrowed to one agent.

**The 391 dead uploads.** Excluded by `status='uploaded' AND created_at < now() -
stall_days AND NOT EXISTS (darb_shipments)`. The filter is on **`created_at`, not
`updated_at`**, because a bulk write reset `updated_at` across the table and made every
corpse look freshly touched. The plan had called for archiving these before launch;
commit `61cae04` instead hid them from the worklist — a deliberate deviation, so the 391
are still `uploaded` in the data.

**Buckets** — first match wins, sorted by bucket then `moved_at ASC`:

| Bucket | Meaning |
|---|---|
| `act_now` | Someone should do something now. |
| `waiting_customer` | Ball is with the customer. |
| `waiting_carrier` | Ball is with the carrier. |
| `returning` | On its way back. |
| `done` | Resolved, still shown briefly. |

`act_now` fires on any of: an open `proactive_call_task`; **`remark_unanswered`** (an
actionable `remark_class` newer than the last *human* action); `delay_unanswered`;
`callback_due` (`next_action_at <= now()`); or `stalled` (`moved_at` older than
`carrier_stall_days`).

**Risk** comes from `evaluate_delivery_risk(order_id)` with exactly three reasons:
`repeat_risk`, `high_value`, `low_zone`. Being a first-time customer is deliberately
**not** a risk signal — new buyers are the business, not a hazard.

> **Performance note.** `evaluate_delivery_risk` is called twice per row in the SELECT
> list (once for `risky`, once for `reasons`). Worth collapsing into one lateral before
> this goes in front of agents at volume.

**Thresholds** are per-market settings read through `delivery_setting_int(market, key,
default)` — never constants: `carrier_stall_days` (5),
`delivery_done_window_hours` (24), `risk_min_prior_failures` (1), `high_value_threshold`
(0 = off), `zone_low_delivery_rate_pct` (60), `zone_min_sample` (20). Editable in
Système → Paramètres.

---

## 6. Files

**Migrations** — `supabase/migrations/20260926000001…06`: `customers`,
`normalize_phone_trunk_zero`, `darb_remark_class`, `delivery_actions`,
`delivery_zone_stats`, `delivery_worklist`.

**TypeScript that landed** — `src/lib/carriers/darb-remark-classifier.ts` (+ tests),
called from `src/lib/carriers/darb-sync-cycle.ts`; `scripts/backfill-remark-class.ts`;
`src/lib/leads/phone.ts`; the settings keys in `src/types/settings.ts` and
`src/components/settings/GeneralSettingsGroups.tsx`.

**Screen (phase 3, 2026-09-13)** — `supabase/migrations/20260926000007…09`: the actor guard on
`record_delivery_action`, `created_at` + `carrier_name` + `get_delivery_agent_scorecard`, and
`get_user_role()` / `get_user_market_id()` pinned to `search_path = public` (without that,
every SECURITY INVOKER function with `search_path = ''` fails RLS with *relation "users" does
not exist* — test such functions under a JWT, never as the owner). Code: `src/lib/delivery/`
(bucket reading, situation + move, validation, WhatsApp, schedule, timeline merge),
`src/app/api/delivery/`, `src/hooks/useDeliveryActionQueue.ts` (the 5-second undo: the POST
waits, no reversal row is ever written), `src/components/delivery/`, page
`src/app/[locale]/(dashboard)/delivery/page.tsx`.

**Plan / prototype** — `plans/suivi-livraison.md`,
`prototypes/suivi-livraison-v1.html`.

**Related** — `docs/darb-assabil-sync.md` (where remarks come from),
`docs/order-presence-and-locking.md` (who may act on an order).
