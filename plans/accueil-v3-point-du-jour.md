# Accueil v3 — « le point du jour »

Status: **BUILT 2026-10-08 from `prototypes/dashboard-v9.html`** (owner: « follow the prototype exactly then open a PR »). No SQL. See §10.
Worktree `.claude/worktrees/dashboard-v3`, branch `feat/dashboard-v3` (off origin/main f69101f3), uncommitted.
Prototype (the spec once approved): `prototypes/dashboard-v3.html` — fictional data, seeded, shaped by prod.

URL presets: `?set=normal|alerte|import|vide &role=owner|manager &lang=fr|ar &device=desktop|phone
&period=today|yesterday|7d|30d|90d|month|m:2026-09|custom&from=&to= &view=cards|list &stale=1`
Review helpers: `&h=2600` (tall phone frame = whole page in one shot), `&ui=more|calc|store:a`, `&notes=1`.
The studio's « Ce qui change » panel carries the same content as this file, in French, for the owner.

## 1. The ask (2026-10-07)

Redesign /dashboard from scratch, keep the idea (total orders + each store's orders). It is the page the
owner opens first every day: phone-responsive and intuitive; on desktop the most efficient display, elegant,
calm visuals and charts. Resolve the bugs introduced along the v2 → calm → pass 2/3 journey. Output: a prototype.
The owner asked for my point of view as the business expert.

## 2. Recommendation

1. **One question each morning: « est-ce que tout tourne, et d'où viennent mes commandes ? »** Everything that
   does not serve it lives in Performance, one click away from the card where the question arises (the
   header « doors » are gone: « Où se perdent les commandes », « Salle de contrôle », the store itself).
2. **Problems first, with their cause** — « À regarder », one line each, worst first: ads stopped (merged with
   the store that stopped because of it), store stopped receiving, connection broken, orders to link,
   historic import, calls left over from yesterday. Nothing wrong = one green line (« Tout tourne »).
3. **Pace, not yesterday.** Today is judged against a usual day at the same hour = **median of the same
   weekday over the 4 previous weeks**. Not « yesterday » (may itself be abnormal) and not « the last 7 days »:
   after a week of ads off their median is ~0 and the page called an outage « trop tôt pour juger » — found
   on the Libya scenario while building. « Hier » joins the shortcuts (the morning judges the full day).
4. **Total and every store in one glance**: the hero number, bars stacked by store in soft store hues, a
   legend with each store's count and share; hover/tap a store and its part lights up.
5. **Money in three figures** (owner only): Encaissé (deep green — the page's answer), En route, Bénéfice brut
   — « provisoire » while the cohort is under 90 % final.
6. **The phone is not a shrunken desktop**: sticky period bar, stores as rows, the full card in a bottom
   sheet, every value reachable by touch (nothing lives only in a hover tooltip).

## 3. The page

Desktop (sidebar 240, content ≤ 1240, container queries on the content area):
header (greeting · market · date · « À jour 09:41 ») + period segments (Aujourd'hui · Hier · 7 jours · 30 jours ·
Plus ▾ = 3 mois, ce mois-ci, 4 whole months, calendar) → « À regarder » → hero (number + verdict/trend + the
comparison WRITTEN under it + store legend | chart) → row B (period ≥ 7 d: « Ce que sont devenues ces commandes »
outcome pill bar + Confirmées · Livrées · Retournées [+ Rejetées for managers], « L'argent » for the owner;
today/yesterday: « Le traitement » À appeler · Confirmées · Rejetées · Expédiées) → « Vos boutiques »
(cards — the owner's 2026-10-04 choice, made compact — or a « Liste » table for comparing) → silent stores
folded on one line → one footer line (basis + comparison).

Phone (≤ 640 px container): same order; period bar sticky under the 52 px phone bar; legend as chips;
tiles 2-up; stores as rows (logo · name · platform · freshness · count · trend · alarm line) → bottom sheet
with the full card and « Voir sa performance ».

Charts: today/yesterday = cumulative curve since midnight (ink) vs the usual day (dashed), « now » dot +
label, crosshair readout; ≥ 7 days = daily bars stacked by store (≤ 45 days) or Monday–Sunday weeks, the
day/week in progress hatched and outside the average, cap labels on the max and the last complete bar only.

## 4. Rules (new or changed)

| Rule | Value |
|---|---|
| Usual day | median of the same weekday, 4 previous weeks; cumulative by 15-min slot |
| Pace verdict | ≥ +25 % au-dessus · ±25 % normal · down to −60 % en dessous · beyond presque rien · usual < 6 at this hour = trop tôt |
| Arrow dead band | under ±5 % (or ±2 pts) the pill is grey: noise, not news |
| Stopped store | unchanged (usual days −20…−7 ≥ 5/day, ≥ 3 days < 25 %) — computed for EVERY active store, whatever the period |
| Ads cause | store stop within ±1 day of an ads-at-zero run → one merged line « Pub à l'arrêt … les commandes ont suivi » |
| Calls left over | ≥ 5 orders received before today still undecided → warn line (today's own wait is shown, never red) |
| Imported | orders placed before the store's connection: excluded from every figure, one warn line + « hors N importées » |
| Confirmées | confirmed incl. awaiting upload (u + uploaded) ÷ decided |
| Livrées % | delivered ÷ (delivered + failed) — parcels that reached the end; « N en route » beside it |
| Provisoire | Math.round(final) < 90 — same rounding as the « n % ont leur issue finale » chip |
| Equal-age arrows | kept from v2 for multi-day periods |

Palettes: outcome calm set of design-system §2.4 (del #4DAE7E · en route #6FC29A · ret #E9A23B · rej #E46A7B ·
junk #9D8FEF — validator PASS, CVD 8.2 / normal 17.0); store hues unchanged (all-pairs PASS 8.4 / 18.6),
bars at a 40 % tint (66 % for the last complete day). The live Accueil pastels FAIL (normal-vision ΔE 13.8,
amber out of band) — re-checked with `validate_palette.js` on 2026-10-07.

## 5. Bugs the v3 resolves (live code on main, f69101f3)

1. **A stopped or broken store disappears.** `build.ts` puts every store with no order in the window into
   `quiet`; `Blocks.tsx` renders nothing from `quiet`; broken/stopped are only evaluated on cards that have
   orders. On « Aujourd'hui » (the default) Libya's main store has had no card since 2026-10-06.
2. **The empty state claims « les boutiques sont connectées, rien n'arrive »** whatever the connections say
   (`home.all.emptyHint`, printed unconditionally in `Summary`).
3. **The « pub à l'arrêt » cause is gone.** The banner was removed in the calm pass; `ads` only suffixes a
   stopped note on a card that is no longer shown. Prod: Libya ad spend 0 from 2026-09-30, orders stopped
   2026-09-29 17:30.
4. **Bulk imports count as orders received.** Connecting 5 Converty stores on 2026-10-05 imported 698 orders
   placed July–September (most already delivered/rejected in Converty): `orders.created_at` = import time, so
   Accueil showed 811 orders received on 5 Oct (real: 15). All `pending`, unassigned. The source date is only
   in `raw_payload->>'Created At'`.
5. **Today's bar looks like a collapse each morning** (`bars.ts`: `hot` = last bar = the partial day, full
   colour + label, same scale, counted in the average).
6. **The last « 3 derniers mois » week holds 6 days** and weeks start on the window's first day, not Monday.
7. **Phone overflow and hover-only details**: `.sdb{padding:30px 40px}` at every width + `.cards`
   `minmax(330px)` → horizontal scroll under 410 px; profit popover 400 px wide; bar values, ring segments and
   the comparison basis exist only in `data-tip`.
8. **The outcome palette fails the validator** (see §4).
9. **Numbers go stale silently**: SWR `revalidateOnFocus:false`, `refreshInterval` 0 outside today, and
   `Cache-Control: private, max-age=30, stale-while-revalidate=300` — a tab left open overnight shows yesterday.
10. **A store clicked on « Aujourd'hui » opens Performance on 30 days** (`openStore` drops `period=today`;
    Performance's `resolveWindow` defaults to 30d).
11. **Two names for one calculation**: « Profit net » here, « Bénéfice brut » in Finances › P&L since 10-04.
12. **A young cohort's profit is shown as final** (all ads counted, most parcels still on the road).
13. **« Confirmées » ignores confirmed-not-yet-uploaded orders** (`summ().conf` = uploaded ÷ (uploaded +
    rejected)); on today they count nowhere. Small in prod today (LY: 1 order in the 30-day cohort).
14. **RTL leftovers**: `.dp{right:0}`, calendar range radii physical.
15. **Links inside a button**: the store card is `role="button"` and its note holds « Voir » / « Relier »
    links (nested interactive controls).

Checked and NOT a bug (an earlier claim of mine was wrong): the « under 600 px only first/last x labels »
rule does exist (`store-dashboard.css` line 272).

## 6. Prod facts read on 2026-10-07 (aggregates only, read-only SQL)

- Libya: ~50–140 orders/day until 2026-09-29 17:30, then 0 (09-30 → 10-03), 1, 10, 0, 0. Ad spend
  ~800–1 500/day until 09-29, 0 since (89 on 10-05). The Converty sheet syncs every 15 min, 960 runs in 10
  days, 0 failures — it is ads, not the connection. 5 « active » Libyan storefronts are test/dev rows with no
  order in months.
- Tunisia: 5 Converty-via-Sheets stores connected 2026-10-05 19:30–22:00; 860 orders in 3 days, ALL `pending`,
  NONE assigned; 698 from the connection burst, placed 2026-07 → 2026-09 per `raw_payload 'Created At'`, with
  Converty statuses mostly final (Sept: 306 delivered, 114 rejected, 86 returned). Real new orders by source
  date: 2–15/day, 43 on 10-06.
- Libya 30-day cohort (received 38–8 days ago, n = 1 733): 304 delivered (17.5 %), 274 failed + 34 withdrawn,
  686 rejected, 277 junk + 132 deleted, 20 in calls. Of 100 orders received, ~18 are delivered.

## 7. Phases after approval (TDD throughout)

1. **Data**: `orders.placed_at timestamptz` (the storefront's own order time; NULL → created_at), filled by
   every adapter that has one (Sheets « Created At », webhooks' created_at), backfilled from `raw_payload`;
   an order placed > 48 h before its store's first sync = `imported` (flag or derived). Paste-ready SQL for
   the owner (MCP apply_migration is declined in this repo).
2. **RPC** `get_store_dashboard` v2: cohort by `placed_at`, imported excluded + counted per store; health per
   store regardless of the window (stopped, broken, unmapped, imported, waiting); the 4 same-weekday days as
   15-min cumulative slots (market + per store); REVOKE from PUBLIC/anon before GRANT.
3. **lib/dashboard/stores**: `usualDay`, `verdictOf`, dead-band `trend`, alert builder + priority, Monday
   weeks + partial flags in `bars.ts`, `conf` incl. awaiting upload — each rule with a unit test.
4. **UI** from the prototype, px units (14 px root), container queries, sheets on phone, keyboard paths,
   `home.*` keys fr/ar with the parity test; SWR `revalidateOnFocus`, 60 s today / 5 min otherwise, the « À jour »
   stamp; API `Cache-Control: private, no-cache`.
5. **Performance › Commandes** accepts `period=today|yesterday` (the store click keeps its period).
6. Delete the dead `quiet`/`ads` paths and the old CSS; screenshot every prototype state next to the app on
   seeded local data before calling it done.

## 8. Decisions I made as the expert

Default « Aujourd'hui »; verdict thresholds and dead band (§4); doors moved into the cards; bars stacked in
store hues, today's curve in ink (not a store colour); compact cards kept (owner's choice) + a « Liste » view;
phone rows + sheet; « calls left over » = ≥ 5 from before today; imported = out of every figure; managers =
same page without money, Arabic for Libya.

## 9. Open for the owner

1. The 698 historic orders imported in Tunisia (already processed in Converty): archive them out of the queue
   (recommended) or have them called?
2. Default view: « Aujourd'hui » (recommended) or « Hier »?
3. Bénéfice brut on Accueil: keep it, marked provisional (recommended), or leave it to the P&L only?

## 10. Built from v9 (2026-10-08)

The prototype iterated v3 → v9 with the owner; v9 is the spec. It keeps three blocks only: the header
(greeting, « À jour », the doors, the deployed date button + « Hier »), ONE hero card (« Commandes reçues »
and « Chiffre d'affaires » as two panels with a 14-day sparkline, then a ring + one ranked store list,
shares by largest remainder), and the store cards (four tiles on a day, ring + 3 minis on a period).
« À regarder », row B (traitement / résultat / l'argent) and the footer were dropped in v4–v5.

- **No migration.** A day window reads `get_store_dashboard` ONCE over [day − 28, day]: yesterday's
  total, the sparkline and the usual day (same weekday, 4 weeks, `lib/dashboard/stores/pace.ts`) come from
  it. Multi-day windows read the window and the period before, as before. The product-cohort reads are
  gone (v9 shows no profit): `lib/calculations/store-dashboard-money.ts` is now `caOf` + `paidOf`.
- **The four tiles** map onto real statuses: En attente = pending/new/assigned · Tentatives = attempt_* /
  callback_scheduled · Téléchargées = uploaded and beyond · Rejetées = rejected + never real + deleted
  (GROUP rej + junk) · the gap line = confirmed / dispatch_scheduled. They always add up to the count.
- **Health whatever the period** (bug 1): broken, stopped (+ « pub à l'arrêt »), orders to link, and
  « en attente de sa première commande » keep a store's card even with 0 orders.
- **Deviations, said:** « importées » is not built — it needs the storefront's own order time
  (`orders.placed_at`, phase 1), which does not exist; a click on a store from « Aujourd'hui »/« Hier »
  opens Performance on its default period (Performance does not read days yet, phase 5); an uploaded shop
  logo replaces the initials (the prototype has no logos). API: `Cache-Control: private, no-cache`; SWR
  refreshes on focus, every 60 s on « Aujourd'hui », 5 min otherwise; « Mis à jour il y a N min » after 10.
