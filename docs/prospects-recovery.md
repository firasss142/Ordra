# Prospects — recover lost sales (the manager desk)

Since 2026-10-06, `/leads` for managers and super admins is a desk with one job:
**win back the sales that were lost**.

- Plan, owner decisions and the audit: `plans/prospects-recovery.md`.
- Approved design: `prototypes/prospects-manager-v5.html` (untracked, because it carries real
  agent names).
- Agents keep their own Prospects tab (`components/agent/crm`, docs/agent-shell.md); it gained
  two buckets.

## 1. Where prospects come from

Four sources. Three of them are created by Ordra itself.

| Desk source | `leads.source` | Created by | When |
|---|---|---|---|
| Rejets rattrapables (`rej`) | `rejected_order` | `prospects_daily_tick` | N days (`rej.delay_days`, default 3) after a rejection whose sub-reason is in `rej.subreasons` |
| Colis en retour (`ret`) | `winback` | `leads_create_winback` trigger | as soon as a parcel enters `returning`, `to_be_returned` or `returned`, once per order |
| Anciens clients (`old`) | `repeat_buyer` | `prospects_daily_tick` | N days (`old.after_days`, default 30) after the latest delivery, with no newer order |
| Listes et saisie (`camp`) | anything else | « Nouvelle liste », CSV, capture, social | by hand |

Never a prospect when:
- the customer has a newer order;
- the phone already has an open prospect;
- `customers.risk_class = 'risk'`.

A prospect whose customer reorders on their own is closed with « a recommandé seul » and counted
nowhere.

Libya never reaches `returned` (returns are not scanned back). That is why win-back listens to the
whole return path; before 2026-10-06 it had never fired in Libya.

## 2. Who gets them — the daily tick

`pg_cron` job `prospects-daily-tick-hourly` (`37 * * * *`) calls `prospects_daily_tick_all()`. Per
market, it acts only in `dist.hour` local time and only once a day (`prospect_tick_log`), in this
order:

1. Create the rejection and past-buyer prospects that are due.
2. Close the prospects whose customer reordered, and those at `max_tries` attempts (`unreachable`).
3. Release the untouched ones: no history for `release_days` days → back to the pool.
4. **Fill each agent's file** up to `file_cap` (default 15).
   - The cap is on the open file, not on daily additions, so an absent agent does not pile up.
   - Priority: winback → rejected_order → due callbacks → repeat_buyer → the rest, oldest first.
   - The agent who handled the source order comes first if she has room.
   - Agents = active agents with a share in `agent_distribution_shares` (all of them if the market
     has no shares).
   - WhatsApp-API lists are never distributed: the message does the work.

« Répartir maintenant » runs step 4 alone (`prospects_distribute_now`, manager or super admin of
the market).

Settings key `prospect_recovery`, merged over SQL defaults by `prospect_recovery_settings()`:
- written by `set_prospect_recovery_settings()`, after `lib/prospects/desk/rules.ts` has validated
  the shape;
- `enabled` is true by default for Libya and false for Tunisia (its team is dormant).

## 3. The page

One page, no tabs, read top to bottom.

1. **The band.** One card of fixed height (owner, round 4):
   - start side: what came back AND was delivered this month (count + LYD, by delivered date,
     `orders.total_price` only);
   - end side: « À faire » folded into one button. Its lines float in a panel and appear only when
     non-zero: pool, untouched files, late callbacks. When all is well it shows « Tout tourne ».
2. **Sources.** One card each, with a bar ordered ramenés → en cours → à appeler → perdus, and
   « dont N déjà livrées ». The four cards' deliveries add up to the band.
3. **Équipe · aujourd'hui.** One card per agent in her colour:
   - a ring of prospects called today out of her file;
   - one warning at most;
   - delivered this month.
4. **La liste.** Source and Agent are multi-select (« Sans agent » included), plus State, a search,
   25 rows a page, bulk Réassigner / Exporter / Fermer, and a drawer per prospect.
   `?open=<lead>` opens a drawer from a link; old `/leads/[id]` links redirect managers there.

**« Nouvelle liste »** is three steps: Qui → Que propose-t-on → Comment.
- **Step 1.** Answers become audience conditions (`lib/prospects/desk/wizard.ts`). The existing
  engine counts them and creates the list (`campaign_audience_rows`), so the number shown is the
  list.
  - Products are picked with one searchable picker (`ProductPicker`), never a wall of tiles. Each
    product may have its own dates (`product_windows`).
  - Rejections filter on **sub-reasons** (`rejection_subreasons`).
  - « Pas recommandé depuis » is `guards.no_order_after_outcome`.
- **Step 2.** The proposed products are one or several (`prospect_campaigns.offer_product_ids`).
- **Step 3.** WhatsApp starts from four templates (`lib/prospects/desk/templates.ts`) that pass
  Meta's rules, with a live phone preview. Variables are the builder's own tokens: `{nom}`,
  `{produit}`, `{ville}`, `{remise}`.

**Export.** `/api/prospects/desk/export`, journaled as `export.prospects`.
- « Excel » = CSV with semicolons and a BOM, so Arabic opens readable.
- Formulas are neutralised.

## 4. Files

| | |
|---|---|
| `src/lib/prospects/desk/types.ts` | the facts contract with `get_prospect_desk` |
| `src/lib/prospects/desk/model.ts` | facts → page (sources, agents, to-do) |
| `src/lib/prospects/desk/list.ts`, `query.ts` | list filters, the one `.or(and(or(…)))` PostgREST accepts, rows, CSV |
| `src/lib/prospects/desk/wizard.ts`, `templates.ts`, `rules.ts` | the 3 steps, WhatsApp templates, settings validation |
| `src/components/prospects/desk/*` | the page; `desk.css` is the prototype's stylesheet scoped under `.pdk` |
| `src/app/api/prospects/desk/**`, `rules/` | facts, list, export, distribute, assign, cities, rules |
| `supabase/migrations/20261006100000…100500` | security, enum values, engine, desk facts, audience v2, rules writer |
| `supabase/prod-paste/prospects-recovery.sql` | the same, paste-ready for production |

## 5. Security (same PR)

On 2026-10-05, five lead RPCs were SECURITY DEFINER, executable by any logged-in user, and trusted
a caller-supplied actor and market:
- `bulk_assign_leads`
- `assign_lead`
- `convert_lead_to_order` (it creates orders)
- `rpc_run_prospect_campaign`
- `rpc_transition_lead_status`

`20261006100000` binds the actor to `auth.uid()` and checks the role and the market. The service
role path is unchanged. Tests: `supabase/tests/lead_rpcs_actor_test.sql`.

## 6. Traps met while building

- PostgREST refuses two `or=` parameters, and supabase-js has no `.and()`. The list sends one
  `.or(and(or(…),or(…)))`, checked against the local PostgREST.
- `.ring` is a Tailwind utility; the agent ring is `.rng`.
- French number grouping uses U+202F, which the app font draws with no width; `fmtNum` swaps it
  for U+00A0.
- `Response.text()` strips a BOM: test the export's raw bytes.
