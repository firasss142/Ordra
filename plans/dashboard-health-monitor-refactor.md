# Dashboard — round 2 adjustments

> **Execution step 0:** copy this file to `Ordra/plans/dashboard-health-monitor-refactor.md` (project `plans/` is the source of truth per user CLAUDE.md), replacing the round-1 copy.

## Context

Round 1 shipped and is live: the dashboard is now a business health monitor on the orders-console token set, backed by two `SECURITY DEFINER` RPCs. The performance goal was met and exceeded — the old path ran ~45–55 Supabase round-trips per render (0.5–4.2 s, per migration `20260822000002`); the new `get_dashboard_health` does the whole rollup in **one** round-trip, measured at **76 ms / 12 051 buffers** on the heaviest all-markets scope, and first paint now issues **zero** `/api/dashboard/*` requests because SSR supplies `fallbackData` and `revalidateOnMount: false` holds. Delta suppression works (`n=2 · comparaison non fiable` renders instead of a fake percentage).

This round is a design revision of what that page *shows*, based on review of the live result. Six changes, all above the data layer except two additive SQL fields:

1. **The alert strip goes.** Every signal in it is already duplicated further down the same page — "9 rappels en retard" by the Rappels queue row's red age marker, "9 non assignées > 2 h" by the Nouvelles row, "2 produits en stock bas" by the stock-cover column. The sidebar bell (`AlertsBell` → `AlertsPanel`) fetches `/api/alerts/summary` independently and keeps the full list, so nothing becomes unreachable.
2. **The period selector goes.** No tabs, no URL period state. One fixed window — the last 30 days — stated in the header and on each block.
3. **Carriers become donuts.** One donut per carrier, delivered vs returned, delivery rate as the centre figure.
4. **Flux & files becomes a today-vs-30-days chart.** Answering "is today normal?" rather than listing two rates.
5. **Products get their images** and a tighter layout.
6. **Markets block is dropped** from the page (SQL and type retained — see note).

## Decisions locked this round

| | |
|---|---|
| Window | Fixed **last 30 days**, ending today. Stated in the header and per block. No selector, no URL period state. Carriers use **90 days** — rates need volume, and the block says so. |
| KPI row | Funnel order + committed-revenue tile (below). |
| "Today" baseline | **Trailing 7-day average**, not 30-day. |
| All-time totals | Not shown anywhere — the page stays one window. |
| Alerts | Removed from the dashboard entirely. Sidebar bell owns them. |
| Flux & files | Today vs 30-day trend chart (shape chosen below). |
| Carriers | One donut per carrier, delivery rate in the centre. **First pie/donut in the codebase** — none exist today. |
| Products | Reuse [`ProductAvatar`](Ordra/src/components/orders/ProductAvatar.tsx). 9 of 11 products have `image_url` in Supabase storage. |
| Markets | Not rendered. |

## The KPI row

Measured state of the Libya market that drove this design: **43 orders today, 186 in the last 7 days, 187 in the last 30** — so 186 of 187 arrived in one week; the market restarted. Meanwhile **6 delivered in 30 days against 453 orders sitting at `uploaded`**, and revenue of 1 184 LYD against 53 627 all-time.

Two consequences the row must handle:

- **A 30-day average is the wrong baseline on a ramp.** 43 vs the 30-day mean (6.2/day) reads +594% — an artefact of the restart. Against the trailing 7-day mean (26.6/day) it reads +62%, which is a real signal. Hence the 7-day baseline.
- **Revenue looks like a collapse only because it is all still in flight.** A tile for committed-but-unrealised revenue is what makes 1 184 LYD legible. This replaces the "total delivered orders" idea, which is static and cannot be acted on.

Five tiles, left to right as the money-making process, with a subtle divider between the volume group and the money group:

```
── VOLUME ─────────────────────  │  ── ARGENT ──────────────────────────────
 COMMANDES     CONFIRMÉES        │  CA EN ATTENTE   CA LIVRÉ     MARGE BRUTE
 43            17                │  ~57 000 LYD     1 184 LYD    912 LYD 77%
 aujourd'hui   aujourd'hui       │  453 expédiées   30 j         30 j
 186 / 7 j     91 / 30 j         │  non livrées     6 livrées    ⓘ hors pub
 ▲ +62% vs 7j  49% du flux       │  taux livr. 76%
```

Conversion rates ride inside the tiles rather than occupying their own, so the row shows both volume and efficiency in five slots.

**Committed revenue definition** — `SUM(total_price)` over orders whose current status is `confirmed`, `dispatch_scheduled`, `uploaded`, `scanned`, `dispatched`, `deposit`, `in_transit` or `unverified`. Excludes `to_be_returned` and `received`, which are heading to a return, not a sale. It is shown **gross**, with the trailing delivery rate on the line beneath so the reader can discount it themselves — applying the rate silently would bury a model assumption inside a figure that looks measured.

## Target layout

```
Tableau de bord            ● Libya
30 derniers jours · 9 juil. → 7 août
─────────────────────────────────────────────────────────────────────────
 COMMANDES   CONFIRMÉES  ┊ CA EN ATTENTE  CA LIVRÉ    MARGE BRUTE
 43          17          ┊ ~57 000 LYD    1 184 LYD   912 LYD  77%
 aujourd'hui aujourd'hui ┊ 453 expédiées  30 j        30 j
 186 / 7 j   91 / 30 j   ┊ non livrées    6 livrées   ⓘ hors pub
 ▲ +62% 7j   49% du flux ┊ taux livr. 76%
─────────────────────────────────────────────────────────────────────────
 COMMANDES PAR JOUR · cohorte — commandes créées
 ███▓▓▒▒░░ …            ■ livrées ■ retours ■ rejetées ■ en cours
─────────────────────────────────────────────────────────────────────────
 FLUX · aujourd'hui vs 30 j        │ TRANSPORTEURS · 90 j
 Aujourd'hui 8 reçues · 3 confirm. │   Tripoli        Benghazi
 moy. 30 j 6,2 · 3,0    ▲ +29%     │   ╭─────╮        ╭─────╮
   ▁▃▂▅▃▄▂▆▃▂▄▃▅▂▃▄▂▃▅▄▃▂▄▃▅▂▃▄█   │  │ 75,8%│       │ 87,3%│
   ┈┈┈┈┈┈┈┈┈┈ moy. ┈┈┈┈┈┈┈┈┈┈┈┈┈   │   ╰─────╯        ╰─────╯
   ── confirmées      █ aujourd'hui │  238 livr · 76 ret
 ─────────────────────────────────  │  3,6 j · 10 LYD/livr
 Nouvelles 19 ⚠79j · Assignées 52 … │
─────────────────────────────────────────────────────────────────────────
 PRODUITS · 30 j
 [img] Quran                  597 LYD  80%   n=4    > 1 an
 [img] كتاب الداء والدواء      157 LYD  88%   n=5    > 1 an
```

**Flux chart shape (my call, per "trend you choose"):** a 30-day composed chart — daily **received** as columns, daily **confirmed** as an overlaid line, today's column in the accent colour, and a dashed reference line at the 30-day mean. It reads "is today normal?" at a glance while still showing whether the gap between intake and throughput is widening. The queue rows stay beneath it, compacted to one line.

## Phase A — Migration

**New** `supabase/migrations/20260823000003_dashboard_health_v2.sql`.

The signature gains a parameter, so this must `DROP FUNCTION get_dashboard_health(UUID,DATE,DATE,DATE,DATE,DATE,DATE)` before `CREATE` — adding a param otherwise leaves a stale overload that PostgREST may resolve to.

New signature adds `p_carrier_from DATE` (the 90-day carrier window). Changes inside:

| CTE | Change |
|---|---|
| `daily` | Add `confirmed` — count of `order_history` rows with `status_to='confirmed'` on that day, via a `daily_conf` CTE LEFT JOINed on day. Note this is **event**-based while the outcome columns are **cohort**-based; they sit in the same row but answer different questions, so the chart plots them as different marks (columns vs line) and the block labels both. |
| `today` **(new)** | Orders created today, `confirmed` events today, `delivered` events today. Day boundary computed the same way as the period bounds — `date_trunc('day', now() AT TIME ZONE 'UTC')` — so "today" cannot drift a few hours off the rest of the page. |
| `trailing7` **(new)** | Mean orders/day and mean confirmations/day over the last 7 days. This is the baseline the "today" delta compares against, not the 30-day mean. |
| `committed` **(new)** | `SUM(total_price)` + count over orders whose current status is `confirmed`, `dispatch_scheduled`, `uploaded`, `scanned`, `dispatched`, `deposit`, `in_transit`, `unverified`. Positive `status IN (...)` so `idx_orders_market_status` range-scans. |
| `products_agg` | Add `pr.image_url`. |
| `carriers_agg` | Source from a new `hist_carrier` CTE spanning `[p_carrier_from, p_to]` instead of the 30-day `hist`, so donut rates rest on ~90 days of volume. |

`markets_money` / `markets_funnel` stay — they cost one grouped pass over CTEs already materialised, and keeping them makes restoring the markets block a UI-only change. Flagged as intentionally-unrendered rather than deleted.

Re-run `EXPLAIN (ANALYZE, BUFFERS)` after the change and record the new timing in the migration header, as `20260823000001` does. The 90-day carrier window widens one scan; confirm it stays well under the previous 76 ms budget before accepting it.

## Phase B — Server library

- `src/lib/dashboard/health.ts` — add to the types: `daily[].confirmed`, `daily[].intake` (derived: delivered+returned+rejected+open), `products[].imageUrl`, `today: { received; confirmed; delivered }`, `trailing7: { meanReceived; meanConfirmed }`, and `committed: { value: number; count: number }`. The chart's reference line, the KPI row's "vs 7 j" delta and the flow headline all read from `trailing7` so there is exactly one definition of the baseline. Drop `PeriodPreset`/`anchored` from `DashboardHealthInput`.
- The "today vs 7-day mean" delta goes through the existing [`toMetric`](Ordra/src/lib/dashboard/confidence.ts) so it inherits the suppression rule — on a quiet day, `43 vs 26.6` is a real delta, but `0 vs 0.3` must not render as a confident percentage.
- `src/lib/dashboard/period.ts` — **delete**. With no selector there is no URL period state to parse; the window is `lastNDaysPeriod(30)` from the existing [`lib/date.ts`](Ordra/src/lib/date.ts), which already has the helper.
- `src/lib/dashboard/confidence.ts` — unchanged. It keeps doing the work: thin carrier and product rates continue to render as `n=…` rather than a false percentage.
- `getLatestActivityDateCached` is retained but repurposed: instead of silently shifting the window, if the fixed 30-day window is empty the header shows a plain "dernière activité le {date}" note. Honest, and no hidden anchoring.

## Phase C — Components

| Component | Change |
|---|---|
| `DashboardHeader` | Strip the tablist and the custom `DateRangePicker`. Title + market dot + a static "30 derniers jours · {range}" line. |
| `charts/CarrierDonuts` **(new)** | recharts `PieChart` + `Pie` with `innerRadius`, one per carrier, `Cell` per slice. Colours from `chartTheme` (`delivered` / `returned` — already defined). Centre label via a custom `<text>`. Falls back to the existing `n=…` treatment when a carrier has too little volume to draw honestly. |
| `charts/FlowChart` **(new)** | recharts `ComposedChart` — `Bar` (received) + `Line` (confirmed) + `ReferenceLine` at the 30-day mean. Today's bar via a `Cell` override. |
| `FlowQueuesPanel` | Keep the queue rows and the aging scale; replace the two-rate header with `FlowChart` and compact the rows. |
| `ProductContribution` | Add a 36 px `ProductAvatar` column; cut to name + margin + delivery rate + stock cover; top 5. |
| `charts/chartTheme.ts` | Add the donut/accent tokens and a shared `initialDimension` constant — the round-1 fix for recharts measuring 0×0 inside a dynamic import must be applied to both new charts too, or they will render blank the same way `OutcomeChart` did. |
| `HeroTiles` | Rebuild as the five-tile funnel row above: two volume tiles, a divider, three money tiles. Keep the existing "Marge brute" relabel-on-ad-coverage logic and the cohort-maturity caveat — both were round-1 fixes for real misreporting and must survive the restructure. |
| `DashboardClient` | Remove the alert bar, period state, `DateRangePicker`, `MarketComparison`, and the anchoring banner. |
| `page.tsx` | Drop `searchParams` period parsing and `anchored`; keep the `getActiveMarketScope()` cookie fix from round 1. |

**Delete:** `src/components/dashboard/AlertAttentionBar.tsx` (dashboard-only consumer — verified), `MarketComparison.tsx`, `src/lib/dashboard/period.ts`. Keep `useAlerts` — `AlertsBell`, `AlertsPanel` and `alerts-panel` context all use it.

**i18n:** remove the now-dead `dashboard.attention.*`, `dashboard.filters.*` and `dashboard.markets.*` keys from both `fr.json` and `ar.json`; add `dashboard.flow.today*`, `dashboard.carriers.window`, `dashboard.window`. Every new string in **both** locales; `dir="auto"` stays on product and carrier names.

## Verification

```bash
npx tsc --noEmit && npm run build
npx vitest run        # must still show the pre-existing 15 files / 31 tests failing — no more
```
The failing suites are pre-existing and unrelated (leads, warehouse, settings, DatePicker, carriers, webhook-handler); this was confirmed in round 1 by stashing and re-running, and the counts must not move.

Then via Playwright MCP on `/fr/dashboard`:
- **No period tabs, no alert strip, no markets block.**
- Flux chart draws bars + line + dashed mean, with today's bar emphasised; carrier donuts draw with a centre percentage. Confirm `document.querySelectorAll('.recharts-sector').length > 0` — round 1 proved a chart can have correct data and still render invisible at 0 width, so assert on the DOM, not the screenshot alone.
- Product rows show real images; a product with `image_url = null` (two exist — "E2E Test Product", "Produit Test E2E") falls back to the initial.
- Still **zero** `/api/dashboard/*` requests on first paint (`performance.getEntriesByType('resource')`).
- Thin data still suppressed: carriers/products under n=10 show `n=…`, not a percentage.
- KPI row reconciles against the DB: `COMMANDES aujourd'hui` must equal `SELECT count(*) FROM orders WHERE market_id=… AND created_at >= date_trunc('day', now())` (43 at time of writing), and `CA EN ATTENTE` must equal the committed-status sum. A tile that disagrees with a direct query is the failure mode this whole redesign exists to prevent.
- The "▲ +62% vs 7 j" delta is computed off the 7-day mean, not the 30-day mean — verify by checking it is not the +594% figure the 30-day baseline would produce.
- As `market_manager` (`manager.ly@oms.local` / `testpass123`): no money tiles. Arabic RTL renders mirrored — note the middleware routes a user to their market's locale, so `/ar` must be reached by logging in as a Libya user, not by editing the URL.

Re-run `EXPLAIN (ANALYZE, BUFFERS) SELECT get_dashboard_health(...)` and confirm the 90-day carrier window has not regressed the one-round-trip budget.

---

# Round 3 — carriers, products, flow visuals + de-jargoning

Revision pass after reviewing the round-2 result live. Design-layer only; no SQL
or RPC change, so the one-round-trip budget is untouched.

## What was wrong

| Block | Defect |
|---|---|
| Products | Column headers rendered at the **bottom** of the table, so four unlabelled numbers were read before their meaning; the last header was clipped off the card edge. One column showed *either* a delivery percentage *or* a sample size (`n=4`) depending on volume — one column, two incompatible meanings. Mixed Arabic/Latin names inside a flex row destroyed the implied column alignment. `> 1 an` appeared on every row: a column carrying zero information. |
| Carriers | The ring was **redundant encoding** — it said "75,2% green" while the centre said "75,2%". No comparison between carriers, though "which carrier gets my volume?" is the only decision the block exists for, and the 12-point gap is enormous in COD. Four metrics ran together dot-separated with no labels. Half the block was empty. |
| Flux | Y-axis rendered a column of zeroes while bars had correct heights. Bars at `#D9D4CB` sat ~7% off the white behind them — drawn but invisible. Four legend entries for a small chart. |
| Vocabulary | `n=2 · comparaison non fiable`, `cohorte — commandes créées`, `réalisé` — engineering vocabulary on a business screen. The one line whose whole job was to admit uncertainty was the least readable line on the page. |

## Decisions

- **Products → compact grid cards** (2/row, 3 on xl, top 6). Self-contained cards
  fix RTL alignment; fixed-width grid makes the contribution bars genuinely
  comparable (they previously lived in a flexing cell). Third metric is **CA**.
- **Sample size stated as business fact**: `3 livrées · 1 retour` *is* n=4. No
  statistics vocabulary needed. The delivery % is drawn only above
  `CONFIDENCE_LOW_MIN`; returns turn red only when the rate is both reliable and
  poor, so the warning appears exactly when actionable.
- **Stock is no longer a column** — an amber chip under 14 days of cover only.
- **Carriers → smaller donuts + labelled 2-column stat grid + leader chip +
  verdict line** ("Benghazi livre 12 points de plus"). Ranking and comparison are
  gated on `CONFIDENCE_LOW_MIN` so a carrier that delivered its only two parcels
  cannot "win".
- **Flux → Y axis hidden** (`<YAxis hide />` — it must exist for the domain and
  the mean ReferenceLine to resolve). Fixes the zero-tick bug and removes real
  clutter: today's figure is printed above the chart and the dashed mean is the
  only comparison that matters.

## Two correctness bugs caught during verification

1. **Falsely-named baseline.** Replacing the vague `vs période préc.` with the
   specific `vs 30 j précédents` made the label *false* for the two volume tiles,
   which compare today against the trailing 7-day mean. Fixed with a
   `comparisonLabel` override on `MetricTile`/`DeltaLine`; those tiles now read
   `vs moy. 7 j`. A vague-but-true label had been swapped for a precise-and-wrong
   one — exactly the failure mode this redesign exists to prevent.
2. **Suppressed signal.** `toMetric(today.confirmed, mean, today.confirmed)` gated
   the comparison on *today's* count, so a day with zero confirmations printed
   "0 commandes — trop peu pour comparer" and hid the fact that confirmations had
   stopped dead against a healthy average. `n` is now the volume **behind the
   baseline** (`mean × 7` = the trailing week's total), which is the sample the
   average was actually computed from. The tile now reads `▼ 100.0% vs moy. 7 j`.

Also fixed: the flow chart's inline `ReferenceLine` label had no collision
avoidance — it landed on the bars and clipped to "moy." — so the mean moved to
the legend; and with the Y axis hidden the plot starts at x=0, so side margins
were needed to stop the first/last X tick labels being clipped.

## Verification

- `npx tsc --noEmit` clean; `npm run build` succeeds. (A `/_not-found`
  PageNotFoundError during build was a stale `.next` from a concurrent dev
  server, not a code fault — `rm -rf .next` resolved it.)
- `npx vitest run` → **15 failed files / 31 failed tests**, identical to the
  pre-existing baseline from rounds 1–2. No regressions.
- i18n parity script: 93 keys in each locale, zero asymmetry; every `t()` key
  referenced by the 10 dashboard components exists in both `fr` and `ar`.
- Browser (DOM assertions, not screenshots): 4 donut slices, 15 bar rects, 1 line,
  1 reference line; **zero** `.recharts-yAxis` tick values; all four
  `.recharts-responsive-container` widths non-zero (the round-1 0×0 race has not
  returned); 4 product cards with `naturalWidth > 0` images; no jargon string
  (`n=`, `cohorte`, `comparaison non fiable`, `réalisé`) present anywhere.

## Known cosmetic residue

The carrier column still ends above the flow column because CSS grid equalises
row heights and the flow block carries six queue rows beneath its chart. Much
reduced from round 2 but not eliminated; left alone deliberately rather than
padding the block with filler metrics.

---

# Dashboard round 4 — rebuild the carrier block

> **Execution step 0:** append this to `Ordra/plans/dashboard-health-monitor-refactor.md`
> (project `plans/` is the source of truth per user CLAUDE.md).

## Context

Rounds 1–3 turned `/dashboard` into a business health monitor on one
`SECURITY DEFINER` RPC (109 ms / 18 327 buffers, zero `/api/dashboard/*` requests
on first paint). Round 3 then removed, at the user's request, the **Produits ·
contribution**, **Flux** and **Files** blocks.

That leaves **Transporteurs** owning the entire lower page — and the current
implementation does not deserve it. The user's verdict on the shipped result:
"I didn't like the design and layout at all… its design is scuffed."

They are right. What is actually wrong with `charts/CarrierDonuts.tsx`:

1. **Half the section is dead space.** Two carriers in an `xl:grid-cols-4` grid
   fill two of four columns. Round 3 capped the grid to stop the cards
   stretching, which traded "stretched" for "orphaned".
2. **The delivered/returned ratio is encoded three times per card** — the donut
   arcs, the centre percentage, and the Livrées/Retours rows. The card looks busy
   while carrying one fact.
3. **Inverted hierarchy.** The 112 px ring is the loudest element and holds the
   least unique information; transit and cost — the only non-redundant figures —
   are the quietest.
4. **Colour encodes rank, not health.** 87,3 % is green because it is "best";
   75,2 % renders neutral black. But 75,2 % means roughly one parcel in four
   comes back, which in COD is alarming. The design understates a real problem.
5. **No visual comparison.** Two isolated islands, so the one decision the block
   exists for — who gets my volume — requires reading two numbers and subtracting.
6. **Equal visual weight for unequal evidence.** Tripoli rests on 322 resolved
   orders, Benghazi on 63. Same donut size, and the ★ badge sits on the smaller
   sample with nothing saying so.
7. **`Coût / livraison` is provably useless**: it reads `10 LYD` for *both*
   carriers because it is a flat per-carrier fee. A column that cannot
   differentiate.

## Decisions locked this round

| | |
|---|---|
| Layout | **Hero donut + carrier rows.** One large market-wide donut as the headline, carriers as a compact comparable table beneath. |
| Cost | **Keep the existing flat `costPerDelivered` as-is.** User: "keep cost, we will fix it later for precise calculations." No cost migration this round. |
| New data | **In-flight and stuck parcels per carrier.** |
| Window | Donut and rates stay **90 days**; in-flight/stuck are **live**, and must be labelled as such. |

### Deliberately NOT done

A true-cost-including-returns metric was investigated and costed
(`carriers.return_fee` exists; Tripoli 11,65 vs Benghazi 10,73 LYD per successful
delivery; 440 LYD burned on returns over 90 days). The user chose to defer it.
Do not sneak it in — but the numbers above are correct and ready when they want it.

## Measured data this design must survive

```
market    carrier                  in_flight  stuck  delivered_90d  resolved
Libya     Darb Assabil - Tripoli        0       0        242          322
Libya     Darb Assabil — Benghazi       0       0         55           63
Libya     Dexpress                      0       0          0            0
Tunisia   Navex                       120     120       (1496 all-time)
Tunisia   Cosmos                       64      64        (141 all-time)
```

Three consequences the implementation **must** handle, not discover later:

- **On Libya, in-flight and stuck are 0 for every carrier.** The new column is
  empty in the market the user is viewing. It needs a real empty state
  (`—` / "aucun colis en circulation"), never a bare `0 · 0` that reads as broken.
- **Tunisia shows 100 % stuck** only because that market has not been touched
  since 2026-05-14; the 3-day rule is being applied to dormant demo data. Correct
  per the rule, but do not add alarm styling that implies a live emergency —
  the existing amber/red aging scale is enough.
- **`carriers_agg` only includes carriers with resolved deliveries in the window.**
  A carrier holding stuck parcels but no completed ones (Dexpress today; any new
  carrier tomorrow) would be **invisible**. The row set must be a UNION of the
  historical and the live carrier populations.

## Reuse, do not reinvent

`stuck` and `in-flight` are already defined identically in three places —
[`api/in-delivery/summary/route.ts`](Ordra/src/app/api/in-delivery/summary/route.ts),
[`api/warehouse/carrier-tracking/route.ts`](Ordra/src/app/api/warehouse/carrier-tracking/route.ts),
[`api/orders/[id]/timeline/route.ts`](Ordra/src/app/api/orders/[id]/timeline/route.ts):

```ts
PHASE_2_STATUSES   = ["dispatched", "deposit", "in_transit", "to_be_returned"]
STUCK_THRESHOLD_DAYS = 3          // vs orders.updated_at
```

The dashboard **must** use exactly these. Two pages disagreeing on what "bloquée"
means is a bug, not a variation. (`to_be_returned` is heading back rather than
forward; it is included because the existing pages include it — consistency wins.)

## Target design

```
TRANSPORTEURS                                        90 derniers jours
────────────────────────────────────────────────────────────────────────
    ╭───────────╮      297   livrées
   │   77,1 %   │       88   retours          ■ livrées   ■ retours
    ╰───────────╯      385   résolues
   TAUX DE LIVRAISON · TOUS TRANSPORTEURS
────────────────────────────────────────────────────────────────────────
 TRANSPORTEUR          TAUX DE LIVRAISON     TRANSIT   COÛT    EN CIRCULATION
                                                               · en direct
 ★ Darb — Benghazi  87,3 % ██████████████▓▓   4,1 j  10 LYD         —
   55 livrées · 8 retours
   Darb - Tripoli   75,2 % ███████████▓▓▓▓▓   3,8 j  10 LYD    96 · ⚠ 7
   242 livrées · 80 retours
   Dexpress             pas encore de livraison résolue              —
────────────────────────────────────────────────────────────────────────
 Benghazi livre 12 points de plus que Tripoli
```

Why this shape:

- **Column headers appear once, at the top.** Round 3's product table put them at
  the bottom and the carrier cards repeated a label beside every figure. Neither
  again.
- **The row bars are plain CSS**, not recharts — one shared baseline and one
  scale, so lengths are genuinely comparable. Two separate donuts never were.
  Only the hero donut uses recharts, so the block goes from N chart instances to 1.
- **The donut finally has a job**: it is the headline market rate, not a
  redundant restatement of a number printed inside it.
- **Volume rides under the name** in ink-3, so unequal evidence is visible without
  a fourth encoding of the same ratio.
- **Health colouring, not rank colouring**: a rate under `POOR_DELIVERY_RATE`
  (65) takes the warn/late ink regardless of whether it is the best of a bad set.

## Phase A — Migration

**New** `supabase/migrations/20260823000004_dashboard_carriers_live.sql`.

The signature does **not** change (in-flight is "now", so no new parameter) —
therefore use `CREATE OR REPLACE FUNCTION`, **not** DROP + CREATE. Round 2 needed
the drop only because it added `p_carrier_from`; repeating it here would risk a
window where PostgREST resolves a missing function.

| CTE | Change |
|---|---|
| `carrier_live` **(new)** | Per `carrier_id`: `COUNT(*)` over `PHASE_2_STATUSES`, and the subset with `updated_at < now() - INTERVAL '3 days'`. Positive `status IN (...)` so `idx_orders_market_status` range-scans — same reasoning as the round-2 `committed` CTE. Market-scoped by `v_scope_market`. |
| carriers JSON | Build from `carriers_agg FULL OUTER JOIN carrier_live USING (carrier_id)`, joining `carriers c` to resolve the name for live-only rows. Emit `inFlight` and `stuck`, defaulting to 0. Keep `ORDER BY delivered DESC NULLS LAST`. |

Then re-run `EXPLAIN (ANALYZE, BUFFERS)` and record the timing in the migration
header as `20260823000001` and `…003` do. Current budget is **109 ms / 18 327
buffers**; `carrier_live` adds one indexed scan over live orders and must not
meaningfully move it.

## Phase B — Types

`src/lib/dashboard/health.ts`:

- `CarrierStat` gains `inFlight: number` and `stuck: number`.
- `mapRpcPayload()` maps them via the existing `num()` helper, defaulting to 0.
- Add `hasResolved: boolean` (derived: `delivered + returned > 0`) so the
  component does not re-derive the live-only case at three call sites.

No change to `confidence.ts` — `CONFIDENCE_LOW_MIN` gating still decides whether a
carrier gets a percentage and a bar at all.

## Phase C — Components

| File | Change |
|---|---|
| `charts/CarrierDonuts.tsx` | **Delete.** The name and the shape are both wrong now. |
| `charts/CarrierPerformance.tsx` **(new)** | Hero donut (one recharts `PieChart`, market totals) + the carrier table above. Rows are CSS flex/grid; the rate bar is a two-segment `<span>` using `CHART_COLORS.delivered` / `.returned`. Keeps `CHART_INITIAL_DIMENSION` on the one `ResponsiveContainer` — the round-1 0×0 race applies to any dynamically imported chart. |
| `DashboardClient.tsx` | Swap the dynamic import to `CarrierPerformance`; the `Section` stays `scope="realized"` with the 90-day label. |
| `charts/chartTheme.ts` | No new colours needed — `CHART_COLORS.delivered` / `.returned` already carry the right meaning. |

**Scope discipline.** The block is labelled 90 days but the in-flight column is
live. `Section` takes a single `scope`, so the column header itself must carry
`· en direct`, exactly as the round-2 queues sub-block did. Mixing a realised rate
and a live count under one undifferentiated label is precisely the failure
`Section`'s required `scope` prop exists to prevent.

**Empty and degenerate states** (all reachable with today's data):

- Carrier with resolved history, no in-flight → `—` in that column.
- Carrier with in-flight but no resolved history (Dexpress) → no rate, no bar,
  `pas encore de livraison résolue`, but its in-flight/stuck still shown.
- Carrier under `CONFIDENCE_LOW_MIN` resolved → counts only, no percentage/bar.
- Zero carriers → existing `carriers.empty` well.
- All carriers with zero in-flight → the whole column collapses to `—`; do not
  hide the column, or it would reappear later and shift the layout.

**i18n** — new keys in **both** `fr.json` and `ar.json`, keeping the 65-key parity
the round-3 script verifies:
`carriers.colCarrier`, `colRate`, `colTransit`, `colCost`, `colInFlight`,
`liveSuffix`, `inFlightValue`, `stuckValue`, `noneInFlight`, `noResolved`,
`overallTitle`, `overallResolved`. Keep `dir="auto"` on carrier names.

## Verification

```bash
npx tsc --noEmit && npm run build
npx vitest run    # must stay at the pre-existing 15 files / 31 tests failing
```

Note: `rm -rf .next` before building. A stale `.next` from a running dev server
produced a spurious `PageNotFoundError` twice in round 3; `.next` is gitignored.

Then on `/fr/dashboard` via Playwright, asserting on the DOM rather than a
screenshot (round 1 proved a chart can hold correct data and still render at zero
width):

- Exactly **one** `.recharts-responsive-container`, width > 0, with pie sectors.
- Carrier rows equal the union of historical + live carriers — with Libya scoped,
  Dexpress appears iff it has in-flight parcels, and never silently vanishes.
- In-flight column renders `—` on Libya (measured 0 today), not `0 · 0`.
- Column headers appear once, above the rows, and `en direct` is visible on the
  in-flight header.
- Reconcile against the DB — the block must equal:
  ```sql
  SELECT c.name,
         COUNT(*) FILTER (WHERE o.status IN ('dispatched','deposit','in_transit','to_be_returned')) AS in_flight,
         COUNT(*) FILTER (WHERE o.status IN ('dispatched','deposit','in_transit','to_be_returned')
                            AND o.updated_at < now() - INTERVAL '3 days')                           AS stuck
  FROM orders o JOIN carriers c ON c.id = o.carrier_id
  WHERE o.market_id = '…' GROUP BY c.name;
  ```
  A tile disagreeing with a direct query is the failure mode this whole redesign
  exists to prevent.
- Switch scope to Tunisia and confirm Navex 120/120 and Cosmos 64/64 render, and
  that the hero donut recomputes for that market.
- No jargon strings (`n=`, `cohorte`, `comparaison non fiable`) reappear.
- As `market_manager` (`manager.ly@oms.local` / `testpass123`) the block still
  renders — it carries no money beyond the flat carrier fee.

## Round 4 — verification results (executed)

Migration `20260823000004_dashboard_carriers_live.sql` applied via `CREATE OR
REPLACE` (no signature change, so no DROP window).

**Performance.** shared hit **18 327 → 18 459** (+132, +0.7%), all cache hits,
zero disk reads. Wall-clock is unreliable on this shared instance and was NOT
used as the pass criterion: six consecutive calls gave 86.9 / 57.1 / 57.0 / 56.7
/ 57.0 / 79.6 ms while two EXPLAIN runs minutes apart gave 72.5 ms and 1172 ms
with *identical* buffer counts. Same pages touched, 16× the time — contention,
not query cost.

**The UNION earned its keep immediately.** Against all markets the RPC now
returns 4 carriers; the previous `carriers_agg`-only query returned 2. Navex
(120 in flight, 120 stuck) and Cosmos (64/64) have zero resolved deliveries in
the 90-day window and were therefore **invisible** before — precisely the
carriers an operator would need to chase.

**Reconciled against direct SQL, both scopes:**

| scope | rendered | direct query |
|---|---|---|
| Libya | Tripoli 242/80 → 75,2 % · Benghazi 55/8 → 87,3 % · hero 77,1 % · in-flight `—` | identical |
| Tunisia | Navex — /120 in flight /120 stuck · Cosmos — /64/64 · hero `—` | identical |

Also confirmed: exactly one `.recharts-responsive-container` in the block (was N,
one per carrier); column headers render **once**, above the rows; `en direct`
present on the live column; hero label measured at 61 px inside a 109 px ring
hole (24 px clearance, centre offset 0,0); **zero** `/api/dashboard/*` requests on
first paint, so SSR `fallbackData` still holds; no jargon strings present.

`npx tsc --noEmit` clean · `npm run build` exit 0, dashboard bundle **8.41 → 6.58
kB** · `npx vitest run` **15 files / 31 tests failing = unchanged baseline**.

### Two things worth knowing

1. **The cookie stores a market CODE (`ly`/`tn`/`all`), not a UUID** — see
   `writeCookie` in [`context/market-scope.tsx`](Ordra/src/context/market-scope.tsx).
   Writing a UUID makes `getActiveMarketScope` fall back to the default market
   (Tunisia), which silently renders the wrong market. This cost a confusing
   detour during verification; anyone scripting a scope switch must use the code.
2. **In-flight/stuck is empty on Libya** (measured 0 across all carriers) and
   reads 100 % stuck on Tunisia only because that market has been dormant since
   2026-05-14. The column is correct in both cases; do not "fix" the zeros.

### Still deferred

True-cost-per-delivered including `return_fee` (Tripoli 11,65 vs Benghazi 10,73
LYD; 440 LYD of returns over 90 days). User: "keep cost, we will fix it later for
precise calculations." The flat `costPerDelivered` currently shown reads 10 LYD
for both carriers and cannot differentiate them.

## Round 4b — true cost per delivered (the deferred item, now done)

User: "ok fix it now" — releasing the deferral recorded above.

Migration `20260823000005_dashboard_carrier_true_cost.sql`, three lines of change
(`CREATE OR REPLACE`, signature unchanged): carry `c.return_fee` through
`hist_carrier`, sum it as `return_cost` in `carriers_agg`, emit `returnCost`.

**The metric.** `(delivered × delivery_fee + returned × return_fee) / delivered`
— what one SUCCESSFUL delivery costs once the failures are paid for. Derived in
`mapRpcPayload`, not SQL, per the module rule that the RPC returns raw sums and
ratios are computed beside their denominator. `costPerDelivered` was renamed
`realCostPerDelivered` so nobody later mistakes it for the sticker price.

**Cost model is the repo's, not a new one.** A returned order is charged
`return_fee` ONLY, never `delivery_fee + return_fee`. Verified against three
independent sources before writing anything: `docs/business-logic.md` ("Per
carrier: count_of_returned_orders × carriers.return_fee"),
`lib/calculations/business-profitability.ts` (`totalReturnCost` sums only
`returnedOrders`), and this function's own `markets_money` CTE. A dashboard
inventing a second cost model would be worse than no metric.

**Result** — the column now differentiates carriers, which was the whole point:

| carrier | old flat | real | delta |
|---|---|---|---|
| Darb — Tripoli | 10,00 LYD | **11,65 LYD** | +16,5% |
| Darb — Benghazi | 10,00 LYD | **10,73 LYD** | +7,3% |

Tripoli costs 8,6% more per successful delivery than Benghazi — invisible before.
Money is formatted at 2 dp deliberately: at 0 dp the two would round to 12 and 11
and the gap would read as larger than it is.

Added to the hero: **"440 LYD perdus en retours — 88 colis repartis sans vente"**,
and a tooltip on each cost cell naming that carrier's own return spend.

Verified: RPC `returnCost` reconciles with direct SQL; rendered 11,65 / 10,73
matches; `realCostPerDelivered` is null (renders `—`) for the live-only carriers
with zero deliveries to divide by. tsc clean, build exit 0 (bundle unchanged at
6.58 kB), vitest **15 files / 31 tests failing = unchanged baseline**, i18n parity
76 keys per locale.
