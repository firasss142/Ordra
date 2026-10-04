# Entrepôt — the day loop (restructure + visual redesign)

## Implementation status (2026-10-02, branch `feat/warehouse-day-loop`, uncommitted)

Owner approved v3 (v1 + colour) and asked to implement directly, with the blue
replaced by colours from the brand green's family. Built, test-first:

| Area | What shipped | Where |
|---|---|---|
| Job hues | `--job-*` + `.job-*` scope classes + Tailwind `job`; `--wh-*`/`--wm-*` repointed to Ordra values | `globals.css`, `tailwind.config.ts`, design-system §4.20 |
| Aujourd'hui | `/warehouse` for every role; agent `TodayHome`, desk `TodayDesk` (split by building, À décider, team, building switch) | `components/warehouse/today/*`, `lib/warehouse/day-loop*.ts`, `GET /api/warehouse/today` |
| Shell | bar: Aujourd'hui · Sortir · [Scan centre] · Rentrer · Stock; ScanFab deleted; badge from `/today` instead of the 60 s `/summary` poll; count run full-screen; alerts bell fixed on desk | `shell/*`, `(warehouse)/layout.tsx` |
| Sidebar | Entrepôt → Aujourd'hui, Sortir, Rentrer, Stock | `Sidebar.tsx` |
| Sortir | bench moved to `/warehouse/out`, titled Sortir, « Commencer » per roll opens the run on that roll (`?roll=`) | `bench/BenchHome.tsx`, `run/ScanRun.tsx` |
| Rentrer | agent: Intact / Abîmé as two equal tiles; « Relivrer » stays on the desk only | `returns/ReturnsHome.tsx` |
| Stock | tabs in the address (`?tab=`, `?product=`); « Mouvements » fixed; never-counted notice with « Commencer le comptage »; product names link to the product page | `console/StockConsole.tsx`, `WarehouseStockClient.tsx`, `JournalConsole.tsx` |
| Product page | `/warehouse/stock/[productId]` | `product/ProductStockView.tsx` |
| Count run | `/warehouse/count` (+ `?product=`, `?warehouse_id=`); the one way to count — `StockCountDialog` deleted | `count/CountRun.tsx` |
| Count rule | `record_stock_count` draws from the uncounted pool (owner's decision) | `supabase/migrations/20261002190000_…`, `supabase/tests/stock_count_pool_test.sql` |

**Not yet in production:** the migration is tested on the local DB only — the
Supabase MCP needed re-authentication. Apply it BEFORE deploying this branch;
without it the count run doubles stock on a building's first count.

**Deviations from the prototype, decided while building:**
- No « Anciens » fold on Sortir: the bench already hides stale parcels
  (`bench_cleared_at`, « mis de côté »: Tripoli 351, Benghazi 42). They surface on
  the desk as the first « À décider » line instead. My earlier « ghost queue »
  claim was wrong — the agent never saw them.
- The Scan button opens the bench's existing scan sheet (`?scan=1`), which binds
  with a parcel in hand and looks the sticker up otherwise. Sticker-first and the
  return verdict from the sheet are NOT built yet.
- The desk keeps PreparationConsole for Sortir (no permanent top scan field yet).

Original status line, kept for history:
Branch / worktree: `feat/warehouse-day-loop` in `.claude/worktrees/warehouse-day-loop`, cut
from `origin/main` at `3ea92c5` (goods reception v3 + Journal fix included — the
`feat/product-variants-stock-axis` checkout is behind and must not be the base).

Prototypes (Phase 0 deliverables):
- `prototypes/entrepot-day-loop-agent-v1.html` — warehouse agent, phone, Arabic RTL (Libya)
- `prototypes/entrepot-day-loop-manager-v1.html` — market manager / super_admin, desk, French

---

## 1. Context — why redo it

The owner asked for the stock and warehouse workflow to be restructured and visually
redesigned "to a better appealing and modern touch", from scratch if needed.

What the live data says (prod, read 2026-10-02):

| Fact | Number |
|---|---|
| Markets that use the warehouse | **Libya only** — Tunisia has 0 warehouse agents, 0 ledger rows |
| Warehouse agents | 2 (tarek → Tripoli, adel → Benghazi); 4 LY managers |
| Scan-outs ever | 225 — **205 at Benghazi**, 20 with no site, **0 at Tripoli**; 224 by agents, 0 by managers |
| Scans per day | 8–21, all Benghazi |
| Benghazi discipline | every Benghazi parcel that reached `at_carrier` since 09-09 went through `scanned` (223/223) |
| Parcels shipped from Darb's own warehouse (no scan by design) | 287 since 09-09 (`warehouse_id` null, `uploaded → at_carrier`) |
| Tripoli bench (`uploaded`) | 351 = **323 Dexpress** (carrier dead since May) + 28 Darb; only 16 moved in 3 days |
| Returns since 09-09 | 3 `returning`, 2 `to_be_returned` — **rare, not neglected**. (The 103 `returned` with no ledger row are June–Aug system transitions straight from `uploaded`: pre-rebuild history.) |
| Stock counts ever (`stock_count`) | **0** — so `product_site_stock` has 0 rows and per-site stock is inert |
| Receptions | 1 draft, 0 posted (the feature went live today) |

So: of the four physical jobs a warehouse does — **send out, take back, receive, count** —
sending out is done well, at one building. Taking back is rare and fine. **Counting has
never happened**, and receiving was born today. Every stock figure downstream (finance's
stock value, low-stock alerts, the queue's stock badges) inherits the missing count. And
Tripoli's agent opens a bench of 351 parcels of which 323 belong to a dead carrier — a
screen that teaches its reader to ignore it.

What the code says (main @ 3ea92c5):
- **Every screen is built twice**, once per shell: `bench/BenchHome` vs
  `console/BenchConsole → PreparationConsole`; `returns/ReturnsHome` vs
  `console/ReturnsConsole` (which itself falls back to `mobile/ReturnCard` on phones). A
  manager on a phone and an agent on a phone see different returns screens.
- **Three scanners around one hook** (`useScanOut`): `ScanSheet`, `run/RunScanner`,
  `console/ScanStation`, each behaving differently. Plus a dead `?scan=1` handler.
- **Two palettes apart from Ordra**: `--wh-*` (green `#0E7A45`) and `--wm-*` (mobile), with
  their own primitives (`console/primitives.tsx`, `console/tokens.ts`,
  `mobile/primitives.tsx`). Only `ui/SegmentedTabs` is shared with the rest of the product.
- **Bugs met on the way**: « Mouvements » links to `/warehouse/history?product_id=` which
  redirects and drops the filter (`WarehouseStockClient.tsx`); the alerts bell is dead on
  warehouse pages (no `AlertsPanelProvider` in `WarehouseManagerShell`);
  `/api/warehouse/returns` ignores the building; the manager bench refetches 100 rows
  after the server loaded 200; `loading.tsx` draws chrome neither shell has; the agent
  shell polls the heavy `/api/warehouse/summary` every 60 s for one badge.

## 2. Owner decisions (2026-10-02)

1. **Structure — day loop + one scanner.** Home is « Aujourd'hui »: the four jobs in
   order, each a door into its flow. One Scan button recognises any sticker. Same screens
   for every role; the desk is a wider layout of them, not a second product.
2. **Look — bold & calm, on Ordra's own tokens.** The warehouse palettes retire. Modern
   comes from type, space and motion, never from decoration (no gradients, no resting
   shadows, colour only for state).

   > **Superseded 2026-10-04** — Ordra's design language is now « Aurore » (`docs/design-system.md` §1–§9: aurora ground, glass cards, resting soft shadow, colour with one meaning). The rule above is history, not guidance.
3. **Returns — scan + one tap.** Intact → back on the shelf, or Abîmé. « Relivrer » leaves
   the agent's screen and becomes a manager decision.
4. **Deliverable — plan + HTML prototypes first**, reviewed before any React.

## 3. The structure

### 3.1 Four jobs, one home

```
Aujourd'hui · Benghazi · jeu. 2 oct.         [chauffeur passé ✓]   (avatar → réglages)
┌──────────────────────────────────────────────────────────────┐
│ 1  Sortir     31 colis à scanner · le plus ancien 2 j        │  → /warehouse/out
│               ████████░░░░  14 sortis aujourd'hui            │
│ 2  Rentrer    2 retours chez Darb pour nous                  │  → /warehouse/returns
│ 3  Recevoir   1 livraison attendue                           │  → /warehouse/stock?tab=receptions
│ 4  Compter    7 produits jamais comptés                      │  → count run
└──────────────────────────────────────────────────────────────┘
Stock · 7 produits · 2 sous le seuil                           → /warehouse/stock
                     [ ◉ Scanner ]
```

**Why this « Aujourd'hui » is not the one deleted on 2026-09-08.** That screen was a KPI
dashboard: it repeated figures the other screens already showed, and its "priority
actions" were not clickable. This one has **no KPI tiles**. Each row is the *only* door to
its job and carries exactly one number — the size of that job's backlog — plus at most one
secondary fact. It replaces the bench as home because the bench answered only one of the
four questions, which is precisely why the other three were forgotten. Scanning out costs
no extra tap: the Scan button is on every screen.

The order is the physical order of a day: get today's parcels out before the driver
comes, check in what came back, put away what was delivered, count.

### 3.2 Navigation

| Surface | Entries |
|---|---|
| Phone bottom bar (every role under `md`) | Aujourd'hui · Sortir · **[Scan]** · Rentrer · Stock |
| Desk sidebar, section Entrepôt | Aujourd'hui · Sortir · Rentrer · Stock |
| Inside Stock (tabs, URL-addressable `?tab=`) | Niveaux · Réceptions · Mouvements |

« Recevoir » and « Compter » are jobs on Aujourd'hui and tabs/actions inside Stock — not
extra sidebar items (the sidebar was cut to three on purpose; four is the floor). Réglages
moves to the avatar on Aujourd'hui (phone) and stays reachable for managers too, since
`ScanStation` reads scanner prefs they could never set.

Routes: `/warehouse` = Aujourd'hui (was the bench) · `/warehouse/out` = Sortir (new) ·
`/warehouse/returns` · `/warehouse/stock?tab=levels|receptions|journal&product=` ·
`/warehouse/stock/[productId]` (new — product detail) · `/warehouse/count` (count run,
new) · `/warehouse/scan` stays the full-screen scanner · `/warehouse/settings`.

### 3.3 One scanner

One scan surface, three entry points that open the same component: the Scan button
(phone), the always-focused scan field at the top of every desk screen (keyboard-wedge
scanners type then send Enter), and tapping a parcel in a list.

**The Libyan constraint.** A Darb sticker is pre-printed and blank: its QR is a bare
number that means nothing until we *bind* it to a shipment. So in Libya a scan cannot
tell which parcel is going out — the agent must have a parcel **in hand** first (that is
why today's sheet refuses « Scan ignoré : prenez d'abord un colis »). Tunisia has no such
constraint: our own label QR is the order id.

So the scanner has two modes, chosen by whether a parcel is in hand, and it **resolves
the code before showing anything**:

| In hand? | What the code is | Card shown | Gesture |
|---|---|---|---|
| yes | any sticker number | bind → result (`bound`, `bind_unverified`, `bound_not_committed`, `refused_*`) | auto-advance to the next parcel of the same roll |
| no | a sticker bound to a `to_be_returned` parcel | Return card | **Intact** / **Abîmé** |
| no | a sticker bound to a `scanned` parcel | « Sorti à 10:42 par adel · Darb ne l'a pas encore pris » | Dé-scanner (reason required) |
| no | a sticker bound to a parcel still `returning` at Darb | « Encore en route chez Darb — pas encore reçu » | none (strict-returns rule) |
| no | **an unbound sticker** | « Sticker libre — sur quel colis l'avez-vous collé ? » + the next 3 parcels of the current roll | pick → confirm → bind (new: sticker-first) |
| no | another building's parcel | « Ce colis part de Tripoli » | none |
| no | unknown non-numeric | « Ce n'est pas un sticker Darb » | retry |

Sticker-first is the one new gesture: today an agent who sticks first and scans second is
told to go back. It reuses the bind path unchanged, after an explicit « C'est bien ce
colis ».

The resolver is new read-only server code (it extends `find_return_by_code`'s matching to
every warehouse status); the write RPCs (`scan_order_out`, `scan_return_in`,
`unscan_order`) and the Darb bind route are unchanged.

### 3.4 Sortir

The bench, kept where it was right (grouped by Darb roll colour, because the agent picks
the sticker roll by destination), fixed where it was not:
- **Rolls are the primary action.** Each roll colour is a big row « Rouleau Rouge · 8
  colis · Commencer » that starts the scan run on that roll (the run already exists and
  auto-advances after a clean bind). Tapping a single parcel opens the same scanner with
  that parcel in hand.
- **Fresh first.** Parcels with no movement for more than 10 days fold into one closed
  group at the bottom (« Anciens · 335 »), so 16 real parcels are not buried under 335.
  They stay visible and scannable; nothing is archived. (323 of Tripoli's are Dexpress —
  flagged to the owner as an operations clean-up, outside this redesign.)
- One row per parcel: product(s) first, then city, then age. Multi-line parcels show
  « 2 produits » with the lines underneath.
- The day's progress (sortis aujourd'hui / objectif when `goal_daily_scanned` is set) is a
  thin bar under the header — a bar, not a tile.
- The pickup switch stays (Libya), in the header.
- « Sortis aujourd'hui » is the second segment of the same list, with unscan/rebind.

### 3.5 Rentrer — scan, one tap

Returns are rare (2 since the rebuild), so this screen must be obvious the day one
arrives rather than efficient at volume. The queue: parcels Darb holds for us
(`to_be_returned`, scannable) and, greyed underneath, those still on their way
(`returning`, not scannable — the strict rule stays). Scan one → a big card (products,
customer, Darb's reason) → two buttons of equal size: **Intact — remettre en stock**
(green, stock +qty) / **Abîmé** (red, then the cause — Emballage, Défaut produit,
Dommage client, Dommage transporteur, Autre + note). Redelivery (`scan-received`,
status `received`, stock unchanged) is no longer on the agent's card; the manager desk
offers « Relivrer au client » on any `to_be_returned` parcel.

### 3.6 Stock

- **Niveaux**: one row per product — name, on shelf, engaged, free, en route, last
  counted. Bold free figure, a 14-day sparkline, a state chip only when something is
  wrong (sous le seuil · à découvert · jamais compté). Two buildings → per-site split
  under the row on desk, on the detail page on phone.
- **Product detail** (`/warehouse/stock/[id]`): the figure, the split by site and by
  variant (inequality-honest: « non ventilé » shown as such), en route, and the product's
  own movements — the « Mouvements » link finally lands somewhere.
- **Compter** (count run): the products to count, one at a time — type the number, see the
  difference, next. Built for the 0-counts-ever fact: a first count of 7 products should
  take two minutes.
- **Réceptions**: the v3 screen shipped 2026-10-02 keeps its structure (owner-approved
  days ago); it only moves onto Ordra tokens.
- **Mouvements**: the Journal, deep-linkable by product and family.

## 4. The look

Ordra's tokens, nothing invented (`docs/design-system.md` §2, `src/app/globals.css`):
ground `--bg-page #F6F6F7`, cards `#FFFFFF`, ink `#1A1A1A / #6D7175`, lines `#ECEEF0`,
one green `--brand #15803D` for chrome (active nav, primary action, focus, scan button),
status hues only on state (`--success`, `--warning`, `--critical`, `--action`).

Modern = type, space, motion:
- **Big figures**: 40/700 tabular on Aujourd'hui, 28/700 on job headers; labels 13/500.
- **Generous rows**: 64px touch rows on phone, 52px on desk; 16px gutters; radius 12px
  cards, pill only for chips and the scan button.
- **One accent per screen**: the scan button is the only filled green on a phone screen.
- **Motion with meaning, 160ms**: scan success = the card slides in and a green band
  sweeps once + `navigator.vibrate(30)`; failure = a short horizontal shake + red band;
  progress bars fill. All behind `prefers-reduced-motion`.
- **Arabic**: Cairo on the agent phone (as today), Inter on the desk; logical properties
  only, numbers in tabular Latin digits inside `dir=ltr` isolates.

## 4ter. The reference is v3 = v1 + one colour per job (2026-10-02)

**The owner rejected v2** (below) — « go back to the previous prototypes… just maybe make
it a bit colorful ». So `prototypes/entrepot-day-loop-{agent,manager}-v3.html` is v1
unchanged plus a hue per job, carried by what v1 already had (step circles, job figures,
progress bar, product tiles, sparklines, « Commencer » buttons, the active tab):

| Job | Fill | Tint | Ink (text) | Origin |
|---|---|---|---|---|
| Sortir | `#2563EB` | `#EEF3FE` | `#1D4ED8` | blue |
| Rentrer | `#6D5CE0` | `#F1EFFD` | `#5240C8` | `--ads` « retours » |
| Recevoir · Stock | `#0D9488` | `#E6F6F4` | `#0B6A60` | `--fin-teal` |
| Compter | `#D97706` | `#FFF3DF` | `#8F5608` | `--fin-gold` |

Each screen inherits its job's hue (`.j-out|j-ret|j-rec|j-cnt` on the screen). Status
colours (red refusal, amber « jamais », green success) and the brand green (Scan button,
active nav) are untouched. Phase 1 adds these as `--job-*` tokens.

## 4bis. Visual refinement — v2 (2026-10-02) — REJECTED, kept for the record

v2 (`prototypes/entrepot-day-loop-{agent,manager}-v2.html`) refined by subtraction. The
owner preferred v1. Do not reintroduce these without asking:

| Rule | v1 | v2 |
|---|---|---|
| The day is drawn as a line | 1 hero card + 1 list card, numbered circles | one card (phone) / one 4-column strip (desk) joined by a line; node = state (filled: work · hollow: nothing · amber: never done) |
| The Darb roll is drawn as a roll | saturated 14×40 colour bars, full-bleed band on the scan run | a disc with its core (`roll()` SVG); the scan run keeps a 6 px colour edge + the roll + the viewfinder corners |
| Products are shown, not symbolised | grey tiles with a book icon | the real `products.image_url`, cropped square, 1 px photo edge |
| A universal fact is said once | « jamais » amber chip on all 7 stock rows; big amber banner | one sentence in a white card with an amber dot; rows show a dash |
| Lines are inset | full-width borders on every row | dividers start after the photo; outer card border only |
| Actions appear when wanted | « Prendre » / « Compter » / « Ouvrir » on every row | revealed on row hover / focus (desk); whole row is the link with a chevron |
| One filled accent per screen | black pills + green FAB + green progress | the Scan button (phone) / the brand nav item (desk); secondary actions are text links or soft buttons |
| Type scale | 12.5 / 13 / 13.5 / 15.5 / … | 11 · 13 · 15 · 17 · 22 · 30 · 60 (phone); hero figures weight 600, −0.04em |
| Headers | uppercase letter-spaced `th` and labels | sentence case, 12 px, `--ink3` |
| Motion | per-screen fade | 40 ms staggered rise of the screen's blocks, progress bars fill, scan seal pops, success band crosses once; all off under `prefers-reduced-motion` |

New tokens the React phase adds to `globals.css` (Phase 1): `--warning-ink #7A5B00` (the
text partner §4.21 requires), `--photo-edge rgba(26,26,26,.07)`, `--track #ECEDEF`. The
product photos in the prototypes are the real images, embedded as data URIs because the
published preview cannot load external images; React reads `image_url` as today.

## 5. Phases

### Phase 0 — prototypes (gate)
Two files, repo convention (header comment, studio notes column, `?lang=fr|ar`,
`?screen=` presets, tokens copied from the live product, real Libyan data inline, studio
LTR with only the stage mirrored for Arabic).

**Built 2026-10-02** (both `?lang=ar|fr`, real prod data, fictional customer first names):

Agent (phone) — `?screen=` `today` · `out` (rolls) · `run` (parcel in hand, viewfinder in
the roll colour) · `bound` (success + auto-next ring) · `free` (sticker-first) ·
`wrongsite` (refusal) · `returns` · `verdict` (Intact / Abîmé + causes) · `stock` (truth
banner) · `product` · `count` (count run with live delta) · `settings`. The Scan button
opens the lookup sheet with four simulated outcomes.

Manager (desk) — `today` (four jobs split by building, pickup per site, « À décider »,
team today) · `out` (roll-grouped table, parcel in hand, permanent scan field) · `returns`
(Recevoir / Relivrer) · `stock` (site columns visible and empty) · `product` (« Compter à
<bâtiment> ») · `receptions` (the real test draft) · `journal` (filtered by product).

Gaps the prototypes show that the plan must keep honest:
- « Sortis aujourd'hui = 14 » is a typical day (mean of active days), not today's figure.
- Roll colours are inferred from the city: `darb_shipments.to_branch_group` is null for
  most of these parcels, so the React phase must keep the existing destination → branch
  lookup, not read the shipment.

### Phase 1 — tokens & primitives
Warehouse onto Ordra tokens; new primitives under `src/components/warehouse/ui/`
(JobRow, Figure, ScanButton, ParcelCard, VerdictButtons, StateChip, ProgressBar).
`--wh-*` / `--wm-*` stay defined until Phase 7 so nothing breaks mid-way.

### Phase 2 — shell, navigation, Aujourd'hui
One `WarehouseShell` for every role (bottom bar under `md`; Sidebar on desk with the
`AlertsPanelProvider` it lacks). New light `GET /api/warehouse/today` (four backlog counts
+ today's progress + pickup state) replaces the 60 s poll of `/summary`.

### Phase 3 — the scanner + Sortir
`GET /api/warehouse/resolve?code=` (TDD) → `{kind, order}` reusing the existing lookup
and precheck. One `Scanner` component replacing `ScanSheet`, `RunScanner`, `ScanStation`.
`/warehouse/out` with fresh/old split.

### Phase 4 — Rentrer
Agent: verdict card on `scan_return_in`. Manager: checked-in list + Relivrer.
`/api/warehouse/returns` gains the site filter.

### Phase 5 — Stock, product detail, count run, Mouvements
URL-addressable tabs; `/warehouse/stock/[id]`; `/warehouse/count` on `record_stock_count`
(per site, per variant — `p_variant_id` already exists); Journal reads `product`.

### Phase 6 — Réceptions on new tokens
Reskin only; behaviour and tests unchanged.

### Phase 7 — deletion + docs
Delete the duplicates (`console/BenchConsole`, `PreparationConsole`, `ScanStation`,
`ReturnsConsole`, `mobile/*` that the new set replaces, `WarehouseTrendChart`, the dead
hooks and the unused API routes listed in §1), the `--wh-*`/`--wm-*` tokens, and rewrite
`docs/design-system.md` §4.20, `docs/warehouse-sites-and-statuses.md` (Entrepôt tabs),
`docs/design/entrepot/*/README.md` (point to the new prototypes), CLAUDE.md's navigation
line.

Every phase: failing test first; `npm run typecheck`; `npm run test:run`. (No ESLint config
exists, so `npm run lint` checks nothing — do not report it as clean.)

## 6. Decisions I made as the expert

- **Libya first.** Prototypes use Libyan data and Arabic; nothing is Libya-only in the
  structure, so Tunisia gets the same screens the day it scans.
- **Stale parcels fold, they are not hidden or archived.** 335 of 351 Tripoli `uploaded`
  parcels have not moved in 10 days; whether they are lost, cancelled or never shipped is
  an operations question this redesign surfaces rather than answers.
- **`/warehouse/dispatch` (ToShipCockpit) is out of scope** — unlinked but live; not touched.
- **No new write RPC.** Every write stays on the existing, tested RPCs; the new server code
  is read-only (`today`, `resolve`).
- **Réceptions keeps the v3 structure** — approved and shipped the same day; only its skin
  changes.
- **Managers see the agent's screens, wider.** They get supervision (team today, site
  switch, Relivrer, unscan) as extra columns and actions, not a different layout.

## 7. Outside this redesign — for the owner

- **323 Dexpress parcels sit `uploaded` on Tripoli's bench**, a carrier dead since May.
  They also count as *engaged* stock on our shelf. Cancelling or re-uploading them is an
  operations decision; the redesign only stops them from burying the real queue.
- **tarek (Tripoli) has never scanned.** Either Tripoli's parcels all leave from Darb's
  own warehouse (287 such orders since 09-09 carry no site), or the building is not using
  Ordra. The desk's « Équipe aujourd'hui » makes it visible; the answer is not in the data.
- **The first stock count** is the single action that would make every stock figure in
  Ordra trustworthy. The count run is designed to make it take minutes.

## 8. Verification

- Phase 0: open both prototypes at 390px and 1440px, every `?screen=` preset, `?lang=ar`
  and `?lang=fr`; check RTL mirroring of the stage only.
- React phases: unit + component tests per phase (TDD); `npm run typecheck`;
  `npm run build`; the Libya E2E fixture (`docs/warehouse-e2e-fixture.md`) as adel at
  390×844 in Arabic: scan out, scan a return Intact, count one product, open its
  Mouvements; as manager.ly on desk: same four jobs, Relivrer, site switch.
- RPC writes exercised under a real JWT, never as owner (see the RLS memories).
