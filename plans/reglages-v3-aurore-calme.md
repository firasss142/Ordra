# Réglages v3 — « Aurore calme », dans la langue de Prospects et Voix du client

2026-10-08 · worktree `.claude/worktrees/reglages-calm` · branch `feat/reglages-calm` (off origin/main aa60bf8f)

Owner's ask: restyle and redesign /system/settings (manager + super admin) to the current
design principles, taking /leads and /feedback as the model. Called out: « Produits et villes
à associer » is "very basic and out of design consistency".

## Phase 0 — prototype (GATE: owner's yes before any src/ change)

`prototypes/reglages-v4.html` (current). v4 = owner feedback on v3: on Boutiques the shop list comes FIRST and « Produits et villes à associer » under it; the Produits tab comes before Villes and opens by default. v3 kept for comparison:
`prototypes/reglages-v3.html` — studio switches `topic`, `role`, `drawer`, `dirty`, `match`, `lang`.
Content and permissions are unchanged from v2 (`prototypes/reglages-v2.html`); v3 changes the form.

## What was found

1. **PR #97 never reached main.** It was merged into `feat/system-logs-settings` at 16:59 on
   10-06, four minutes AFTER that branch had merged to main. The Journaux + Réglages restyle it
   carried is on `origin/feat/system-logs-settings` only. Production still shows the v2 look.
   (Journaux is out of scope here — flagged to the owner.)
2. **317 Tunisian orders are blocked on matching** (prod, read 10-08):
   - 155 wait on a city (9 names, oldest 10 March). Sfax 41, Sousse 37, Monastir 32,
     Bizerte 26, Ariana 5, Ben Arous 4 and Nabeul 1 exist VERBATIM in `cities` — 146 orders
     that intake should have resolved and didn't. « Kef » ≈ « Le Kef ». 4 orders have an empty city.
   - 162 wait on a product (8 references, all 5–7 Oct — the historic import).
   - Libya: 0.
3. The card listed them as two plain columns with an « Associer » button per row and no hint of
   what the match should be, so nobody worked it.

## Design (from /feedback and /leads)

- Aurora ground; one H1 = the topic; crumb « Système › Réglages »; market switch (super admin)
  or market chip (manager) on the header's right, like the controls of /feedback.
- Topic menu = a glass card on the start side; four sections, one calm tint each
  (Ventes green, Expédition blue, Clients et publicité violet, Système slate).
- Glass cards (20 px, soft shadow). A setting row = bold label, help that restates the value,
  a stepper (− value unit +), the history clock. Dirty rows get an amber dot and wash.
- One save bar = the dark floating bar of /feedback, bottom centre.
- Drawers = the floating glass panel of /feedback (26 px radius, inset 12 px).
- Tables use the /feedback header row (10.5 px uppercase); status = `.st` pills; switches = /leads `.sw`.
- Option cards = /leads `.choice`.

### « Produits et villes à associer » becomes a work queue
- Second card on Boutiques, under the shop list (owner, v4); a single « Tout est associé » line when empty.
- Produits | Villes as a segmented control, Produits first and open by default (owner, v4) with counts (no side-by-side columns).
- A summary strip: how many orders wait, the oldest date, and one button:
  « Associer les N noms identiques · M commandes ».
- One table: received name (+ shop and reference for products), orders (bar), waiting since
  (amber past 14 days), Ordra's proposal with « Nom identique » / « Proche », « Associer » (accepts)
  and a quiet « Choisir… » (opens the picker). Rows can be ticked → dark bulk bar.
- Picker drawer: search, « Proposé » first, then the full list, a sentence saying what the click
  does, and « Associer les N commandes ».

## Phase 1 — the kit and the shell (no behaviour change)
`components/reglages/reglages.css` scoped under `.rgc`; restyle `ReglagesShell`, `kit/*`
(SettingsCard, SettingRow, NumberField → stepper, Switch, OptionCards, Pills, Drawer, SaveBar,
RgBadge, th/td). Every topic inherits. px units (root font 14 px; guard test exists).

## Phase 2 — matching (TDD)
- `lib/reglages/match-suggest.ts`: normalise (lowercase, strip accents, punctuation, leading
  « le/la/el/al ») → `same` on equality, `near` on token containment/overlap ≥ threshold, else none.
  Pure, unit-tested against the real cases above.
- `/api/mappings/unmatched` returns grouped rows with `suggestion {id,label,label_ar,confidence}`
  (one destinations/products read per call, market-scoped as today).
- Bulk accept: reuse the existing POST routes; cities bind per order today, so add
  `POST /api/mappings/cities/bulk {orderIds, destination}` (same permission check, one update).
- `MatchingCard` rebuilt to the prototype; `BindDrawer` → picker drawer.

## Phase 3 — proof
Screenshot every prototype state next to the app on local data at 1440 px; FR + AR (LY manager).
Unused i18n keys check. Typecheck + Vitest. PR; owner merges.

## Decisions I made as the expert
- Content, topic list, permissions and save model stay exactly as v2 — only form changes.
- No attention counters in the menu (owner rejected them on 10-02).
- Products never bulk-accept on « Proche »; only « Nom identique » goes into the one-click button.

## Open for the owner
- The 146 city-blocked orders date from March–April. Associating them sends 5–7-month-old
  orders back to agents. Recommendation: associate the names (so future orders resolve), but
  cancel the stale orders rather than call them.
- Why did intake miss exact names like « Sfax »? Not fixed here — separate bug.
