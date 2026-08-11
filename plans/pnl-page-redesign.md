# Redesign `/dashboard/pnl` into the Dashboard + Orders visual language

## Context

The Dashboard (`/dashboard`) and Orders (`/orders`) consoles have been rebuilt in a new visual
language: a warm `#FAFAF8` ground, a uniform icon-led metric tile, 10.5px uppercase section
labels, hue-encoded status, and a delta that refuses to print a percentage it cannot support.

`/dashboard/pnl` was not migrated. It still runs the previous generation of primitives
(`FinanceHeroCard`, `SecondaryKpi`, `Panel`, `FilterBar`, `periodDeltaProps`) on the cool grey
`#F6F6F7` ground, and next to the two redesigned pages it reads as a different product.

Three of its problems are not cosmetic:

1. **Broken translations.** `ProfitabilityClient` calls `tNav("today"|"week"|"month"|"custom"|
   "latestDataNotice"|"jumpToToday")`, but `fr.json → dashboard.filters` contains only
   `allMarkets` and `marketPlaceholder`. The period tabs render the raw key strings
   (`dashboard.filters.today`) — visible in the screenshot.
2. **Dishonest deltas.** `+86.0%` and `+87.5%` are drawn off 20 delivered orders. This is exactly
   the failure `lib/dashboard/confidence.ts` was written to stop, and the Dashboard already
   routes every comparison through it. P&L still uses the unguarded `periodDeltaProps`.
3. **A funnel that reports 1300%.** `FinanceFunnel` divides `confirmed` (13) by `leads` (1) and
   `delivered` (20) by `confirmed` (13). The three stages are not one cohort, so the rates are
   meaningless. Design system §4.17 G ("counts must not lie") forbids this.

Outcome: P&L looks and behaves like it belongs to the same console, and stops publishing numbers
it cannot stand behind.

**Deliverable order: prototype first, then the code change.**

---

## Step 0 — Persist this plan

Copy this file to `Ordra/plans/pnl-page-redesign.md` (repo convention, `Ordra/CLAUDE.md`:
"Save every Claude-created plan under `/plans`").

---

## Step 1 — Prototype: `Ordra/prototypes/pnl-v2.html`

Follow the house convention set by `Ordra/prototypes/agent-queue-v2.html`:

- One self-contained HTML file, no build, no CDN.
- Production tokens restated as local CSS vars (`--ground`, `--surface`, `--sunken`, `--hair`,
  `--ink1/2/3`, `--brand`, hue families) with the **exact** hex values from
  `src/app/globals.css` — do not invent a colour.
- Inline the Inter/Cairo woff2 as base64 from `.next/static/media`, same as the existing
  prototype, so type metrics are real.
- Three toggle views in a chrome bar with `aria-pressed`: **After** (the redesign), **Before**
  (faithful repro of the current screen, built from the old `#F6F6F7` / `KpiCard` palette), and
  **Notes** (annotation overlay naming each change and the rule behind it).
- Real data from the screenshot so the comparison is honest: revenue 3 150 LYD, net 2 489 LYD,
  margin 79.0%, 20 delivered, 1 returned, 13 confirmed, 1 lead, ad spend 0.
- Light + dark, both `@media (prefers-color-scheme: dark)` and `:root[data-theme]`.

The **Notes** view must call out the four suppressed deltas — with n=20 the honest render is
"20 livrées — trop peu pour comparer", not "+86.0%". That is the change most likely to be
mistaken for a regression, so it needs to be argued in the prototype, not discovered in review.

Review the prototype before writing any TSX.

---

## Step 2 — The design, precisely

Every class string below already exists on `/dashboard` or `/orders`. Nothing new is introduced.

### Page shell
Replace `bg-surface-page min-h-screen px-4 sm:px-6 pt-5 pb-10` with the Dashboard shell verbatim
([DashboardClient.tsx:91](Ordra/src/app/[locale]/(dashboard)/dashboard/DashboardClient.tsx#L91)):

```
flex min-h-screen flex-col gap-4 bg-oms-bg px-4 pb-20 pt-16 md:px-6 md:pb-20 md:pt-6
```

### Header
Rebuild on the [DashboardHeader.tsx](Ordra/src/components/dashboard/DashboardHeader.tsx) grammar:
`h1` at `text-[26px] font-semibold tracking-[-0.02em] text-oms-ink-1` (currently `text-[20px]`),
meta line at `text-[12.5px] text-oms-ink-2` carrying `MapPin` + market, the resolved window, and
`CalendarDays` + range. Drop the `rounded-pill bg-surface-selected` market chip — the Dashboard
uses a pin icon for the same job.

### Period control
The Dashboard deleted its period control (fixed 30 days, stated in words). P&L genuinely needs
one, so keep it — but move it out of the full-width white `FilterBar`, which is a shape neither
reference page has, and into the header's trailing slot (`ms-auto`).

Build a local `PeriodSegments` in the pnl folder on the §4.18 segment recipe, retokenised to
`--oms-*`: `inline-flex items-center rounded-lg border h-[30px] px-3 text-[12.5px] font-semibold`,
rest `border-oms-border bg-oms-surface text-oms-ink-2`, active `border-oms-border-strong
text-oms-ink-1`. Do **not** reuse `ui/SegmentedTabs` — it is written against `--agent-*` tokens
and belongs to the agent shell.

Add the six missing keys to `dashboard.filters` in **both** `fr.json` and `ar.json`:
`today` / `week` / `month` / `custom` / `latestDataNotice` / `jumpToToday`.

### KPI row — one uniform grammar
Delete `FinanceHeroCard` (3 large cards) and the local `SecondaryKpi` (4 small cards). Both rows
become a single wrapping [`MetricTile`](Ordra/src/components/dashboard/MetricTile.tsx) row, which
is what makes the page recognisably the same product as `/dashboard`.

Ordered as the money-making process, with a `w-px bg-oms-border` divider separating result from
acquisition — the same device `HeroTiles` uses to split volume from money:

| Tile | icon | value | secondary | hint / footer |
|---|---|---|---|---|
| Profit net | `Coins` | net profit | `79.0%` margin | `warm` when negative |
| Chiffre d'affaires | `ChartColumn` | revenue | — | "sur 20 livrées" |
| Marge | `Percent` | `79.0%` | — | prev period, `pp` delta |
| ‖ divider ‖ | | | | |
| Panier moyen | `ShoppingBag` | AOV | — | "20 livrées" |
| Pub | `Megaphone` | ad spend | — | "aucune dépense saisie" when 0 |
| CPA | `Target` | cpa | — | "13 conf." |
| CPL | `UserPlus` | cpl | — | "1 lead" |

Keep `MetricTile`'s monochrome `rounded-full bg-oms-sunken` icon holder. The hue-tinted holder on
`/orders` is reserved for tiles that count a *status* — a P&L figure has none, and tinting it
would encode nothing, which is the argument already written into
[MetricTile.tsx:70-76](Ordra/src/components/dashboard/MetricTile.tsx#L70-L76).

### Deltas — the correctness change
Drop `periodDeltaProps` / `TONE_COLOR` / `formatPP`. Route every comparison through
`toMetric(current, previous, n)` from `lib/dashboard/confidence` and render with `DeltaLine`,
passing the true denominator: `delivered_count` for revenue/net/AOV/margin, `confirmed_count` for
CPA, `leads_count` for CPL/ad spend.

At n=20 (< `CONFIDENCE_OK_MIN` 30, ≥ `CONFIDENCE_LOW_MIN` 10) this yields
"▲ 86.0% · sur 20 livrées" — the figure survives but carries its denominator. At n<10 it
suppresses to "trop peu pour comparer". Both are correct; the current bare `+86.0%` pill is not.

Once P&L migrates, `PeriodDeltaBadge.tsx` has no consumers left — delete it.

### Money formatting
`/dashboard` renders `5 774 LYD` (`Intl.NumberFormat` with `maximumFractionDigits: 0`, currency
as a demoted suffix). P&L renders the same magnitude as `د.ل. 2.489,000` — `formatCurrency` in
[format.ts](Ordra/src/lib/format.ts) uses `style: "currency"` at 3 decimals, which puts an Arabic
currency mark in front of a French-locale number and reads as 2.489 *million*.

Use the Dashboard's formatter on this page: `nf.format(v) + " " + currency`, 0 decimals, currency
in `text-oms-ink-3` at ~0.7em per §4.17 F. Leave `lib/format.ts` alone — other pages depend on it.

### Sections
`Panel` → [`Section`](Ordra/src/components/dashboard/Section.tsx), `EmptyState` → `EmptyWell`.
Section titles drop from `text-[16px] font-semibold` to `text-[10.5px] font-semibold uppercase
tracking-[0.075em] text-oms-ink-2`. `scope` is a required prop, so each must declare one:

- Composition du chiffre d'affaires — `scope="realized"`, `scopeLabel="· 30 j (réalisé)"`
- Entonnoir — `scope="cohort"`
- Opérations — `scope="realized"`

### Composition bars
Keep the row grammar; retokenise. Track `bg-oms-sunken`, neutral fill `bg-oms-ink-2`, returns
escalation reuses the aging scale (`--oms-warn` > 10%, `--oms-bad` > 15%) so a cost overrun is
the same amber/red the rest of the console uses. Net row: `border-t border-oms-border-strong`,
`text-oms-ink-1`, or `text-oms-age-late` when negative. Removes 4 hardcoded hexes.

### Funnel — fix the >100% rates
`FinanceFunnel` currently compares three stages that are not one cohort. Two changes:

1. Suppress any rate `> 100%` or with a stage count `< 10`; render `—` with the denominator
   stated, same suppression principle as `DeltaLine`.
2. Restyle the stages as `bg-oms-sunken` wells inside the `Section` rather than white cards
   nested on a white panel — cards-inside-cards is a shape neither reference page uses.

If leads and orders are genuinely different cohorts (they are, while ad spend is uncaptured), the
honest render is a two-stage confirmed → delivered funnel plus a separately-labelled lead count.
Confirm against `/api/profitability` semantics during implementation.

### Operations block
`OperationalCompactStats`: replace the two hardcoded hexes (`#D72C0D`, `#1A1A1A`) with
`text-oms-age-late` / `text-oms-ink-1`, rows to `border-b border-oms-border`, labels
`text-oms-ink-2`, values `text-[12.5px] font-semibold tabular-nums`.

---

## Files

| File | Change |
|---|---|
| `Ordra/prototypes/pnl-v2.html` | **new** — step 1 |
| `src/app/[locale]/(dashboard)/dashboard/pnl/ProfitabilityClient.tsx` | main rewrite; adds local `PeriodSegments`; deletes local `SecondaryKpi` |
| `src/components/finance/CostCompositionBars.tsx` | retokenise |
| `src/components/finance/FinanceFunnel.tsx` | retokenise + rate suppression |
| `src/components/finance/FinanceHeroCard.tsx` | delete once unreferenced (check `/finance/*` first) |
| `src/components/dashboard/PeriodDeltaBadge.tsx` | delete — P&L is its last consumer |
| `src/messages/fr.json`, `ar.json` | add 6 `dashboard.filters` keys; funnel suppression copy |
| `docs/design-system.md` | note in §4.17 that the console tokens now cover P&L |

Not touched: `KpiCard.tsx`, `Panel.tsx`, `FilterBar.tsx` — still used by follow-ups, products,
leads, stock, ad-spend, investor. They die when those pages migrate, not here.

---

## Verification

TDD per `Ordra/CLAUDE.md` — failing test first.

1. `npm test src/components/finance` — extend existing tests: assert a rate > 100% renders `—`,
   and that a delta at n=20 carries its denominator rather than a bare percentage.
2. `npm run typecheck && npm run lint`.
3. `npm test src/lib/orders/status-contrast.test.ts` — the contrast guard parses `globals.css`;
   it must still pass (no token inputs change, but confirm).
4. `npm run dev`, sign in as `manager.ly@oms.local / testpass123`, open `/fr/dashboard/pnl`:
   - period tabs read "Aujourd'hui / 7 jours / 30 jours / Personnalisé", not `dashboard.filters.*`
   - money reads `2 489 LYD`, not `د.ل. 2.489,000`
   - no bare `+86.0%` pill; deltas carry "sur 20 livrées"
   - funnel shows no rate above 100%
5. Open `/fr/dashboard` and `/fr/orders` in adjacent tabs — grounds, H1 size, tile padding and
   label treatment must match.
6. Switch to `/ar/dashboard/pnl` (Libya, RTL): layout mirrors, `·` separators land correctly, no
   physical-direction leakage.
7. `npm run build`.
