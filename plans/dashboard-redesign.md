# Accueil (/dashboard) — « vos boutiques »

Status: **BUILT 2026-10-04** — the owner approved v2 (« follow exactly the prototype »). Uncommitted in worktree
`.claude/worktrees/dashboard-redesign`, branch `feat/dashboard-redesign`.
Prototype (the spec): `prototypes/dashboard-v2.html` (v2.1 layout: big total + store list + stacked arrival, then the cards).
`prototypes/dashboard-v1.html` (REAL revenue — never commit, the repo is public) is superseded.

What shipped:
- Migration `20261005120000_store_dashboard.sql` — `storefronts.accent_color` (+ backfill, + first-free-hue trigger),
  `get_store_dashboard` RPC, and `get_orders_performance` re-created with `storefront_id` per order. **Paste on prod
  before the deploy** (the new page and Performance's store filter both read it).
- `src/lib/dashboard/stores/*` (period with « Aujourd'hui », facts + `bkAt` equal-age, model rules, build, load),
  `src/lib/calculations/store-dashboard-money.ts`, `GET /api/dashboard/stores`, `src/components/dashboard/home/*`
  (CSS generated from the prototype, scoped `.sdb`), `home.*` keys fr/ar + parity test.
- Default period = **Aujourd'hui** (the prototype's default), compared with yesterday at the same hour.
- Performance › Commandes accepts `?boutique=<storefront id>` (the card click) and shows the store with a clear button.
- Old page removed: DashboardClient, HeroTiles, MetricTile, DashboardHeader, PeriodTabs, PeriodDeltaBadge, Section,
  OutcomeChart, CarrierSummary/Table, carrierStats, useDashboardHealth, /api/dashboard/health, lib/dashboard/health +
  constants, their tests and the dead `dashboard.*` keys (only `dashboard.filters` remains, used by P&L).
  Sidebar label « Dashboard » → « Accueil ».
- Profit = Produits' rules at market scale; a « − Traitement » line appears in the popover only when processing > 0.

Still open: drop `get_dashboard_health` in its own migration AFTER this deploy; Arabic/phone prototype v3 was never
made (the React is RTL-aware); the store « Par boutique » block of Performance (phase 5) is not built — only the filter.

## 1. The owner's answers

Round 1 (2026-10-04 morning, still binding): Accueil only · first 5 seconds = how the period went · pain = **numbers I
don't trust** · read in the morning on desktop + glances · managers get the same page without money.

Round 2 (2026-10-04 evening). It replaces « Accueil = résumé + 3 portes » from the Performance restructure.

| Question | Answer | My recommendation |
| --- | --- | --- |
| The page's job | **Store-first page** | Morning brief (summary + stores + doors) |
| How stores appear | **A card per store** | One row per store |
| Money | **Market profit + paid per store** | same |
| Click on a store | **Performance › Commandes filtered on it** | same |

Context the owner gave: storefronts now have sub-accounts / subdomains (one Converty account = one store, see
`plans/storefront-multi-account.md` in its own worktree); a sub-account sells one product or many; platforms are
Converty, Shopify, LightFunnels and more to come; aim for simple, not dense, beautiful.

## 2. The page (what the prototype shows)

1. **Header** — « Bonjour Firas » · market · the cohort sentence (received from … to …, followed to today) · the
   finality pill (« 91 % ont leur issue finale »). The date button is Performance's (presets, whole months, two-month
   calendar), default **30 jours**.
2. **Banner**, only when true now: ads at zero for ≥ 2 days in a window that reaches today (« ce n'est pas une panne »).
3. **Toutes les boutiques** — four tiles. Owner: Reçues · Livrées /100 · Payé par les clients · **Profit net** with
   « Comment on arrive à ce chiffre » (the five lines of the calculation). Manager: Reçues · Livrées /100 · Confirmées ·
   Retournées /100. Under them, **D'où viennent les commandes**: one pill bar of shares, one colour per store, legend
   with %. Hovering the bar lights the store's card. Doors to Performance (Commandes · Équipe · Livraison).
4. **Vos boutiques** — one card per store with at least one order in the period, sorted by orders (or Livrées /100, or
   Payé for the owner). A card has:
   - avatar in the store's colour + a dot (live / quiet / off), name, platform label (domain and connection method in
     the tooltip), freshness chip (« il y a 23 min », amber when something is wrong);
   - products: two chips + « +N », or one chip + « produit unique »;
   - the **ring of 100** in the fixed outcome colours, centre = livrées /100 + its arrow; under 30 orders a dashed ring
     with the count and « trop tôt pour juger »;
   - three mini cells: Reçues (+ share of the market) · Confirmées · Payé (manager: Retournées /100);
   - **one footer line**, the first that applies: connection broken → stopped receiving → orders to link (unknown
     products) → new / few orders → best delivery → delivers ≥ 5 pts under the market → « Rien à signaler ».
   - click → Performance › Commandes `?boutique=<id>`.
5. **Stores with no order in the period** folded on one line (chip: last order date or « aucune commande, jamais »),
   plus « Connecter une boutique » for the owner → Système › Connexions. Inactive stores are not shown.
6. « Comment lire cette page », collapsed.

## 3. Rules

- **Basis**: orders RECEIVED in the period, followed to today — the Produits / Performance cohort. Counted once per
  order (Produits counts +1 per product line).
- **A store = a `storefronts` row** = a sub-account / subdomain. The platform is an attribute shown as a neutral label:
  never a grouping level (no decision is « more Shopify »), never a colour (identity belongs to the store). A store that
  moves platform keeps one history.
- **Judged from 30 orders**; below that, no « sur 100 » and no arrow.
- **Arrows compare at equal age** *(new — replaces v1's « both periods ≥ 90 % final »)*: the previous period is read
  as it stood `lag` days ago (`lag` = days between the two period starts). A young cohort with parcels still on the
  road is never set against a finished one. Counts are final at once; rates and money are compared at equal age. With
  the old rule the prototype showed every arrow falling (−4 pts delivered, −28 % profit) while nothing had changed.
  **Performance › Commandes should adopt the same rule** so both pages show the same arrows.
- **Stopped receiving**: the window reaches today, the store usually gets ≥ 5 orders a day (days −20 to −7), and every
  day since is under 25 % of that, for ≥ 3 days. **Connection broken**: `storefronts.last_webhook_status` in error /
  `webhook_failure_count` > 0 since the last success. The two are told apart on purpose: « ads off » vs « intake down ».
- **Colours**: five store hues validated with the dataviz checker on all pairs (`--pairs all`, worst CVD ΔE 8.4,
  worst normal ΔE 18.6): indigo `#444CE7`, pink `#DD2590`, cyan `#088AB2`, deep gold `#A15C07`, lime `#4CA30D`. The
  agents' gold `#CA8504` fails next to lime and orange; orange and the only extra passing hue (lilac `#9E77ED`) collide
  with outcome colours on the ring. A 6th store and beyond is slate and folds into « Autres » in the share bar. The
  colour belongs to the store (stored), never to its rank.
- **Money** (owner only): Payé = Σ `orders.total_price` of delivered orders. Profit net — market only = paid − product
  cost − carrier at the invoice per delivered parcel (a failed parcel costs nothing) − packaging per parcel that left −
  ads of every campaign of the market, day by day. **No profit per store** until each campaign names its store: ads are
  attached to products, and 3 Libyan products already sell in two stores.

## 4. Data

Read in prod on 2026-10-04:

- every Libyan order of the last 90 days has a `storefront_id`;
- 13 Libyan storefront rows: one Converty store (via Google Sheets) brings **1 591 of 1 600** orders over 30 days, and 8
  stores had no order in 90 days; Tunisia had 1 order in 90 days;
- `orders.mapping_status` exists; `carrier_parcel_outcome.outcome_at` exists (equal-age comparison is buildable);
- `storefronts` has `last_webhook_received_at`, `last_webhook_status`, `last_webhook_error`, `webhook_failure_count`
  (Sheets sources sync by cron — check where their errors land before relying on these columns).

To build:

- `storefronts.accent_color` text NULL, CHECK in the five keys; the first free one is given on creation, editable in
  Connexions; NULL = slate.
- Platform display label: `google_sheets` + `config.sheet_adapter = converty` → « Converty » (« via Google Sheets » in the
  tooltip).
- Read RPC `get_store_cohort(p_market_id, p_from, p_to, p_prev_from, p_prev_to, p_tz)` (or extend v1's
  `get_market_cohort`). One row per order: storefront_id, bucket, **outcome_at** (rejected/junk: the `order_history` row
  of the decision; delivered/failed: `carrier_parcel_outcome.outcome_at`), total_price, cost lines as Produits,
  mapping_status. Plus per store: last order at, daily counts for 21 days, connection status. Plus ads per day for the
  market. SECURITY DEFINER, market guard as `get_product_cohort`, REVOKE from PUBLIC/anon before GRANT (and again after
  any DROP + CREATE).
- Rules in TypeScript with unit tests: `bucketAt(order, asOf)`, equal-age comparison, judged ≥ 30, stopped, footer
  priority, shares and the slate fold.

Still true from v1, and it matters for every « voir les commandes » link: `orders.status` disagrees with the parcel's
fate. Over 30 days, **238 of the 246 parcels that failed at Darb are `cancelled` in Ordra**, and 14 `rejected` orders
were uploaded then withdrawn. A drill-through built on `status=` lists the wrong orders; Commandes needs an `outcome=`
filter resolved with the same buckets (`carrier_parcel_outcome`), and the store filter must combine with it.

## 5. Phases (TDD throughout)

0. **Prototype review** ← here. Then Arabic + phone in `dashboard-v3.html`.
1. Migration `accent_color` + RPC + SQL tests (market guard, anon denied, counts and outcome_at on a fixture).
2. `src/lib/dashboard/store-cohort.ts` + tests.
3. `GET /api/dashboard/stores` (withRouteErrors) + SWR hook with SSR fallback.
4. UI from the prototype, px units (root font 14 px), `dashboard.v2` keys fr/ar with a parity test, RTL.
5. Performance › Commandes gets the « Boutique » filter (`?boutique=`) and a « Par boutique » block — the click target.
   It belongs to `feat/performance-section`, whose React has not started; until then the card opens Commandes filtered
   on the store.
6. Delete HeroTiles, OutcomeChart, CarrierSummary, CarrierTable, MetricTile and the tests that pin them; drop
   `get_dashboard_health` in its own migration once nothing calls it.
7. Screenshot every prototype state next to the app on seeded local data before calling it done.

## 6. Decisions I made as the expert

- Same date button and the same 30-day default as Performance.
- Equal-age arrows (§3) instead of hiding arrows under 90 % final.
- Equal-size cards judged per 100; size shown as the store's share — so a 3 % store is still readable next to a 42 % one.
- Silent stores folded on one line instead of empty cards (today that is 8 of 13 Libyan connections).
- Five colours, then slate (§3). Platform = neutral label.
- One footer line per card, by priority (§2). Healthy is calm (« Rien à signaler »); problems are tinted.
- The ads-off banner stays: it is the one live fact that explains every card below it.
- Managers: no money anywhere (tiles, cards, sort, popover, sidebar Finances).
- « YouCan » appears with a « nouveau » mark: there is no YouCan connector in Ordra today.

## 7. Risks I raised that the owner accepted

- **Store-first with one dominant store.** Today the page is one full card at 99 % plus near-empty ones (preset
  `aujourdhui`). Mitigated by per-100 judging, the share bar and the fold — but the page earns its place when the
  sub-accounts multiply.
- **A card per store crowds past ~8 active stores.** Grid of 3, sort and fold hold it to ~9; past that, revisit (a row
  per store was the recommendation).
- Accueil now answers « which store » and Performance › Commandes « where orders are lost »; « Livrées /100 » appears on
  both with one definition.

## 8. Open for the owner

- Equal-age arrows: adopt them for Performance › Commandes too?
- Store colours given automatically (first free), editable in Connexions — fine?
- Build a YouCan connector (and which other platforms come next)?
