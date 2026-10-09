# Prospects → recover lost sales

Status: **BUILT 2026-10-06** on branch `feat/prospects-recovery` (prototype v5 approved by the
owner, who asked to implement and open a PR). Reference: docs/prospects-recovery.md.
Production SQL: `supabase/prod-paste/prospects-recovery.sql`, to paste before merging.
Worktree `.claude/worktrees/prospects-recovery`, branch `feat/prospects-recovery` off origin/main.
Prototype: `prototypes/prospects-manager-v2.html` (untracked, it carries real agent first names).

## Why

`/leads` for managers is a four-tab analytics console built for inbound social leads.
Production, read on 2026-10-05:

- **Nothing feeds it.** No lead created since 2026-07-08; 13 lead actions in 90 days; last
  2026-09-15. Libya's only campaign (« Delivered products », 290) has waited undistributed since
  July. Root cause found by the audit: the campaign builder's agent step is never sent, and the
  toast says « répartis » anyway.
- **The lost sales are elsewhere.** Libya, last 30 days: 1 522 orders → 855 rejected (56 %), 230
  cancelled, 271 delivered. Of 540 customers rejected 1–3 months ago, 29 reordered by themselves,
  2 were delivered.
  - Won-back rejections in my default set: 212 / 30 days with no later order, ≈ 50 000 LYD of orders.
  - Parcels entering the return path: 40 / 30 days.
  - Delivered customers with no second order after 30 days: 434, plus ≈ 140 new each month.
- **Win-back never fired in Libya.** `leads_create_winback()` waits for `returned`; no Libyan order
  has reached `returned` since 2026-09-14 (returns are never scanned back).
- Libya sells four books (249 / 199 LYD): a buyer of one is the natural prospect for another.

## The owner's decisions

Round 1:
1. The page's job is **recover lost sales**: prospects = everyone we can still sell to.
2. Ordra creates prospects by itself from **won-back rejections, returning parcels and past buyers**.
3. Prospects reach agents **automatically, with a daily cap**; the agent who knew the customer first.
4. Pains: « I don't know what to do on it », « too many tabs and blocks », « campaigns too complicated ».

Round 2, figures. The owner asked to be picky: **no KPI tile row**.
5. Headline = **brought back AND delivered this month, count + LYD**.
6. Source card = **where its prospects are**: one bar with to call · being called · brought back ·
   lost, with counts. I had recommended « brought back + rate ». I absorbed the risk that a flow
   hides the verdict: « ramenés » is the one count in bold answer-green, and the card's title line
   carries the LYD it brought back.
7. Agent card = **today + this month**: a thin ring for called today out of her file, then
   this month's **delivered** count · LYD. I wrote « livrées » rather than « ramenés » so the
   money follows the revenue rule and the six cards add up to the headline. The tooltip gives
   both counts.
8. Health = **to-do lines only when non-zero**; one green line when all is well.

Round 3, owner's review of v2 (2026-10-06) → `prototypes/prospects-manager-v3.html`:
9. **Filters are multi-select** (sources and agents); source and agent cards toggle on and off.
10. **« Nouvelle liste » rebuilt:**
    - starting points: anciens clients, rejetés, **colis retournés**, de zéro, CSV;
    - a condition builder (toutes / au moins une, plus **groups**), with the count left after
      each condition (drill-down);
    - every date is a custom range (presets + from/to);
    - **several products, each with its photo and optionally its own dates**;
    - the offered product + offer;
    - WhatsApp: click a template, insert variables as chips, toggle the header photo and the
      reply buttons, and see a **live phone preview**. For calls, the preview shows what the
      agent sees.
11. **Warnings collapse into one fixed-height strip:** chips that act, and « Détails » floats
    over the page without moving it.
12. **Export:** scope (filtered list / selection / the whole month), Excel or CSV, collapsible
    columns, in-button progress, then a toast.

Round 4 (2026-10-06) → `prototypes/prospects-manager-v4.html`:
13. **Top of the page = one compact band** of fixed height: on the left the result (26px, not
    34px, plus its detail line); on the right « À faire » as one button (bell + count +
    one-line summary). Its details float in a panel that never moves the page.
14. **« Nouvelle liste » guided in 3 steps** (Qui ? → Que propose-t-on ? → Comment ?), with the
    steps clickable at the top:
    - step 1 asks 2–3 plain-sentence questions per starting point (book tiles with covers, a
      date range, « pas recommandé depuis »);
    - « Affiner » and « Conditions avancées » (and / or, groups) are folded away;
    - the preview always shows the count + **one sentence describing who will be contacted**;
    - the WhatsApp options are folded.

## Decisions I made as the expert

- **One page, no tabs.** Reading order: to-do → headline → sources → team today → the list.
  The list is a working sheet at the bottom, with filters and a drawer. Pipeline, Campagnes and
  Équipe stop being tabs.
- **Won-back rejections, default sub-reasons:** pas de réponse, raccroché, numéro hors service,
  changement d'avis, prix élevé, produit non voulu, rappelled **3 days** after the rejection.
  - Excluded: numéro invalide, mauvais interlocuteur, acheté ailleurs, every « commande invalide »
    sub-reason, hors couverture, autre.
  - Editable in « Règles », which shows each sub-reason with its 30-day count.
- **No prospect when** the customer already has a newer order, the phone already has an open
  prospect, or the customer's `risk_class = 'risk'`.
- **Returning parcels:** created when a parcel enters `returning` / `to_be_returned` (Libya) or
  `returned` (Tunisia), once per order. It goes to the agent who confirmed it, with the courier's
  remark.
- **Past buyers:** 30 days after delivery, no newer order, at most one re-buy prospect per customer
  per 90 days. The prospect names the product received; the agent offers another one.
- **"Ramené" = an order created from the prospect** (`converted_order_id`). The headline counts
  those delivered in the month, by delivered date; money = `orders.total_price` only.
  - A customer who reorders by themselves closes the prospect as « a recommandé seul », counted
    nowhere. Nobody calls someone who just ordered.
- **Automatic distribution:**
  - Runs once a day at **09:00 local**, plus « Répartir maintenant ».
  - Tops each agent up to a **file of 15** open prospects. The cap is on the file, not a daily
    addition, so an absent agent does not pile up.
  - Priority: returns > rejections > due callbacks > past buyers > campaigns, oldest first.
  - The agent of the original order comes first if she has room.
  - « Available » = active agent with a share in the order distribution (nobody in Libya uses the
    Disponible toggle, see availability-toggle memory).
  - Untouched for 3 days → back to the pool. 3 unanswered attempts → closed « injoignable ».
- **Tunisia:** sources off by default. Its team is dormant (811 pending orders untouched); the
  April campaign stock is left alone, and the manager can close it in bulk.
- **Period:** calendar month with a stepper; the trend pill compares with the previous month.
- **Campaigns become « Nouvelle liste »**, one sheet with three blocks:
  - who: past buyers of a product, rejected for a reason, or a CSV file;
  - how: call by the agents, or WhatsApp from the business number, folded;
  - the offer, one line.
  The list joins the automatic distribution. No agent picking, no pacing screen unless WhatsApp.
- **`/leads/[id]`** redirects managers to `/leads?open=<id>`, the drawer. The old detail page goes.
- **Agent side:** two buckets in the existing agent Prospects tab, « Rejets » and « Anciens
  clients ». Returns already have « Retours ». No other agent UI change.

## Phase 0 — prototype (this gate)

`prototypes/prospects-manager-v2.html`, Aurore calme, FR + AR. Studio bar presets:
- `?state=todo|calm|empty`
- `?sheet=rules|list|drawer|reassign`
- `?lang=ar`
- `?src=rej|ret|old|camp`

Its figures are **simulated from September's real Libyan volumes**: the sources do not exist yet.

## Phase 1 — security (ships first, on its own)

Verified on prod 2026-10-05: `bulk_assign_leads`, `assign_lead`, `convert_lead_to_order`,
`rpc_run_prospect_campaign` and `rpc_transition_lead_status` are SECURITY DEFINER and executable by
`authenticated`, with no `auth.uid()` or role check. Each trusts the `p_actor_id` and market sent
by the caller.

So any logged-in user (agent, warehouse agent, investor) can reassign leads in either market,
forge history, or **create orders** (`convert_lead_to_order`).

Fix:
- bind the actor to `auth.uid()` whenever `auth.role() = 'authenticated'`;
- check the role and the market against `users`;
- keep the service-role path.

Pin each fix with a SQL test under a real JWT. Re-revoke after any DROP (see the
drop-function-resets-grants memory). Paste-ready SQL for the owner, because MCP `apply_migration`
is declined.

## Phase 2 — data

1. `lead_source` += `rejected_order`, `repeat_buyer`, each in its own migration.
2. Per-market settings key `prospect_recovery`: sources on/off, sub-reasons, delays, file cap,
   hour, release days, max no-answer. It goes through the scalar/wrapped settings readers (see
   the settings readers memory).
3. Win-back trigger moved to the return path, deduped per order.
4. `prospects_daily_tick(market)`, SECURITY DEFINER, revoked from anon / authenticated. In order:
   - create due rejection and re-buy prospects;
   - close prospects whose customer reordered;
   - release stale ones;
   - fill the files.

   pg_cron runs it hourly at :37 and it acts only in the configured local hour, with an
   idempotency guard (same pattern as `reset_agent_availability_daily`).
5. `get_prospect_desk(market, month, tz)` returns **facts**; the view is built in TypeScript with
   tests: `src/lib/prospects/desk/`.

## Phase 3 — manager UI

New `src/components/prospects/desk/`:
- the page, with the to-do lines, headline, source cards, agent cards, the list, the filter bar
  (§4.7b) and the drawer;
- the sheets: Nouvelle liste, Règles, Réassigner, Fermer.

Px units throughout (root font 14px). Every string goes through `prospects.desk.*` in fr + ar.
Screenshot every prototype screen next to the app before calling it done.

## Phase 4 — agent side

`bucketOf` gains `recover` and `rebuy`, plus their tiles and words in `components/agent/crm`.

## Phase 5 — delete the old design

- `components/prospects/console/**` (12 files plus tests)
- `ProspectsConsole.tsx`, `ProspectsConsoleClient.tsx`
- `ProspectsClient.tsx`, `ProspectsView.tsx`, `ProspectRow.tsx`, `ProspectDetail.tsx`,
  `OutcomeSheet.tsx`, `ProspectWhatsAppSheet.tsx`, `ui.tsx`. Each one is checked for importers on
  main first; the agent shell replaced them.
- `components/prospects/detail/**`
- `app/[locale]/(dashboard)/leads/LeadsPageClient.tsx`
- `components/crm/**` (15 + tests)
- dead hooks: `useLeads`, `useLeadDetail`, `useAgentLeadQueue`, `useProspectCampaigns`,
  `useLeadDuplicates`
- dead routes: `/api/leads` GET, `/api/leads/metrics`, `/api/leads/duplicates`,
  `/api/leads/campaigns/**`, `/api/leads/[id]/assign`
- the old RPC `get_prospect_console`, after deploy
- unused `prospects.console.*` keys

## Bugs found (audit 2026-10-05) and where each one ends

| # | Bug | Fixed by |
|---|---|---|
| 1 | Lead RPCs callable by anyone, actor forged | Phase 1 |
| 2 | Manual assign assigns 0 (cap − calls today) and still toasts success | rebuild: assign ignores the daily cap |
| 3 | Campaign agents never sent; 290 Libyan prospects stuck since July | rebuild: lists join auto distribution |
| 4 | Pipeline chips (except « Non assignés ») filter nothing; KPI jumps land on dead filters | rebuild: server-side filters, tested |
| 5 | « Répartir le reste » of one campaign distributes the whole pool | rebuild |
| 6 | Rebalance ignores the overloaded agent; « min » is idle time | gone (auto distribution) |
| 7 | Pool counts lost/won leads | facts RPC: open statuses only |
| 8 | Funnel stages not nested; mixed periods; bare « vs période précédente » | funnel removed; one period |
| 9 | « Appels » counts only no-answers | facts RPC counts every logged call |
| 10 | « Délai 1er contact » measures time to assignment | metric dropped (owner: not picked) |
| 11 | Truncation banner says 0; oldest 300+ unreachable | paging in the list |
| 12 | Bulk close turns converted into lost | outcome route guards converted |
| 13 | « Rouvrir » impossible (lost is terminal) | action removed |
| 14 | Hot alert wrong when hot leads have no agent | gone (to-do lines from facts) |
| 15 | Campaigns sorted as text | gone (sorted in TS) |
| 16 | Search promises agent/campaign; stale agent filter survives jumps | filter bar rewritten |
| 17 | Raw error codes / « Enregistré » as error fallback; hardcoded « min » | mapped error keys |
| 18 | Panel: order ref not a link; save errors swallowed | drawer rewritten |
| 19 | Composer products/cities from the filtered list only | catalogue from the DB |
| 20 | `/leads/[id]` always « Nouveau numéro »; returned mapped from rejected | page removed (drawer) |
| 21 | « Importer CSV » does nothing | CSV inside « Nouvelle liste » via `/api/leads/import` |
| 22 | `/api/leads` GET filters phantom columns | route deleted |
| — | Win-back waits for a status Libya never reaches | Phase 2.3 |
| — | `customers.delivered_count` wrong for 438 Libyan customers | not read by the new sources (they use orders); reported separately |

## Verification

- vitest for the lib, the routes and the views.
- SQL tests under real JWTs for Phase 1 and the tick.
- Prod dry run of the tick, read-only counts, before the first real run.
- Playwright / Chrome screenshots of every prototype screen next to the app, local stack, fr + ar.
