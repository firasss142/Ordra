# Prospects — the worklist and the console

The pre-order half of Clients → Prospects, rebuilt on 2026-09-14/15 from
`prototypes/prospects-v3.html` in the language of « Suivi livraison ».

> **Status (2026-09-15): both halves are live at `/[locale]/leads`.**
> Agents get the worklist; market_manager and super_admin get the console —
> four KPIs, the pipeline table, campaign funnels and the agent roster.
> The old kanban (`LeadsPageClient`, `LeadsKanban`, `LeadsTable`) is no longer
> mounted, but nothing was deleted: the campaign builder still lives in
> `components/crm/ProspectCampaignPanel` and is where the console's
> « Nouvelle campagne » should lead once it is rebuilt.

---

## 1. Why a bucket is computed, not stored

A parcel's bucket arrives from SQL (`get_delivery_worklist` returns a `bucket`
column). A lead has no such column, and adding one would mean a migration, a
backfill over ~2 000 rows, and a trigger to keep it true. So the rule lives in
one pure function instead:

```
src/lib/prospects/worklist.ts → bucketOf(row, now, hotWindowMinutes)
```

Six buckets, first match wins, most decisive first:

| Bucket | Rule | Tone |
|---|---|---|
| `converted` | `converted_order_id` is set | green |
| `winback` | `source = 'winback'` | red |
| `callback` | `callback_scheduled_at` is set (due **or** ahead) | blue |
| `hot` | inbound source, no attempt yet, younger than the hot window | amber |
| `campaign` | `campaign_id` set, no attempt yet | violet |
| `retry` | everything else | grey |

Two of these rules exist because of what production actually contains.

**`source_order_id` is not the win-back signal.** 1 982 campaign leads carry it,
pointing at the *past* order their audience was built from. Reading the link as
the signal filed the entire campaign list under Retours. Only `source` decides.

**An untouched lead is not hot.** 1 963 of 1 992 leads are `status = 'new'` from
a campaign import. Hot means an inbound source with a person waiting — decision
31 in `plans/suivi-livraison.md` — so campaign stock never interrupts.

Sorting is bucket order, then urgency inside it: callbacks by due time (overdue
first), everything else oldest first. A prospect that has waited longer is more
urgent, not less.

## 2. The columns that do not exist

Checked against the live database on 2026-09-14, not inferred:

- **`leads.is_hot` and `leads.has_duplicate` are typed in `src/types/lead.ts`
  and filtered by `/api/leads`, but neither column exists.** Any query using
  them fails. This surface computes hotness instead and never reads them. They
  remain listed in the known rot of `plans/suivi-livraison.md`.
- **`products.price` does not exist**; the catalogue column is `default_price`.
  Asking PostgREST for the wrong name fails the whole request with a 42703, so
  the worklist test pins the real name.
- **`orders` has no `order_number`**; the human reference is `external_id`.

Two gaps were closed by migration rather than hidden (see §4). Everything else
with no source is simply not rendered: a prospect with no product shows no
price, a campaign with no script shows no script panel.

## 3. Files

Pure logic in `lib/`, rendering in `components/`; no business rule lives in a
component and no React import lives in the lib.

| File | Role |
|---|---|
| `src/lib/prospects/types.ts` | `ProspectRow`, `Bucket`, the response shape |
| `src/lib/prospects/worklist.ts` | buckets, counts, sums, sort, `applyOutcome` |
| `src/lib/prospects/presentation.ts` | situation, move, tone, history badge, callback presets |
| `src/components/prospects/ui.tsx` | `TONE`, `Chip`, `Ltr`, `Money`, button classes |
| `src/components/prospects/ProspectsView.tsx` | the pure view — all props in, callbacks out |
| `src/components/prospects/ProspectRow.tsx` | one row: table row on desktop, card on phone |
| `src/components/prospects/ProspectDetail.tsx` | `…Panel` (aside) + `…Screen` (phone) |
| `src/components/prospects/OutcomeSheet.tsx` | the four-outcome sheet |
| `src/components/prospects/ProspectsClient.tsx` | SWR, the clock, the undo window |
| `src/app/api/prospects/worklist/route.ts` | the list, bucketed server-side |
| `src/app/api/prospects/[id]/outcome/route.ts` | what happened on the call |
| `src/lib/prospects/console.ts` | funnels, trends, agent ranking — pure |
| `src/components/prospects/ProspectsConsole.tsx` | the manager view, pure |
| `src/components/prospects/ProspectsConsoleClient.tsx` | its two SWR reads |
| `src/app/api/prospects/console/route.ts` | one RPC for the whole console |

`now` is a prop, never `Date.now()` inside the view, so every time-dependent
state is testable. 178 tests cover the lib, both views and the three routes.

## 4. Migrations

Six. The first four are additive; the last two add an RPC and rewrite RLS
policies without changing what any of them permits.

1. `prospect_campaigns_offer_and_script` — `offer`, `script_fr`, `script_ar`.
   A campaign told the agent only its name; the offer is what they may promise.
2. `lead_source_winback_value` — adds `winback` to the `lead_source` enum, on
   its own because Postgres will not use a new enum value in the transaction
   that adds it.
3. `leads_winback_from_returned_orders` — `leads.return_reason`, and
   `leads_create_winback()` on `orders AFTER UPDATE`: when a parcel becomes
   `returned`, one prospect is created for the agent who owned the order,
   carrying the courier's remark. Guards: fires only on the transition, never
   twice for one parcel, and a market can disable it with the settings key
   `lead_winback_disabled`.
4. `leads_winback_revoke_rpc_execute` — revokes `execute` from `anon` and
   `authenticated`. A `SECURITY DEFINER` trigger function is exposed by
   PostgREST as `/rest/v1/rpc/...` unless revoked; the advisor caught it.
5. `get_prospect_console` — the console RPC (2026-09-15).
6. `rls_initplan_leads_and_history` — the fix `20260927000002` applied to the
   delivery tables, finally applied to `leads`, `lead_history` and
   `prospect_campaigns`: the helper calls are hoisted into an InitPlan instead
   of running per row. `/api/prospects/console` went 1 815 ms → 330 ms and the
   worklist 1 244 ms → 680 ms. Isolation re-verified under real JWTs after the
   change — see the migration's header.

The remark comes from `darb_timeline_events.remarks` — the courier's own words,
Arabic, free-form. `description_ar` / `description_en` are generic templates
("The order is delayed." on every delayed event) and are only a fallback.

## 5. The console

`get_prospect_console(market, tz)` returns the four KPIs, campaign results and
the agent roster as one JSON document. One RPC rather than four queries: the
database is ~130 ms away, and the whole console computes in 33 ms over
Tunisia's ~1 700 prospects, so the round trips cost more than the work.

Two figures are deliberately shaped rather than reported raw:

- **A campaign's conversion rate is measured against those called**, not against
  the audience. An untouched list says something about distribution, not about
  the agents working it.
- **An agent who has made no calls today has no rate at all**, rather than a
  zero that reads as a judgement.

The roster is ranked worst-served first — hot prospects waiting outrank a merely
long queue, because a hot one goes cold within the hour.

The console also surfaces the finding that made this rebuild worth doing: it
counts prospects with no `assigned_to` and says so in a banner. Today that is
1 982 of ~2 000 in Tunisia, and no agent's queue shows a single one of them.

## 6. What is deliberately not here

- **Campaign distribution.** Decision 33 assigns campaign leads to agents; today
  1 982 of them have no `assigned_to`, so no agent sees them. The buckets are
  ready for them the moment distribution exists, and the console's banner is
  what makes the gap visible.
- **The campaign builder.** « Nouvelle campagne » routes to the old panel; the
  prototype's richer audience builder is not built.
- **A lifecycle migration.** Decision 30 simplifies `lead_status`; the buckets
  derive from the current enum instead, so the rebuild stayed reversible.

## 7. If you change the bucket rules

Change `bucketOf` and its tests, nothing else. The API, the view, the tiles, the
sort and the optimistic move all read the same function, so a rule added in one
place cannot disagree with itself anywhere else.
