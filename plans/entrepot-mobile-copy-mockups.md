# Entrepôt mobile — copy the four mockups

Durable copy of the approved plan (2026-08-25). Working scratchpad lived at
`~/.claude/plans/`; this file is the source of truth.

## Context

The previous pass (`1e5eb8c`) made the warehouse-agent shell mobile-first but
kept the OMS's own visual language: cool `#F6F7F5` ground, grey hairline
borders, IBM Plex Mono figures, a Topbar. The instruction now is different:
**copy the four screenshots** in `docs/design/entrepot/mobile/01-04*.png`,
and skip the design-system docs.

Decisions taken with the user:

| Question | Answer |
|---|---|
| Tabs | Dashboard · Inventaire · Retours · Réglages. Préparation's queue becomes the Dashboard's *Critical Tasks*; the Scan FAB opens the scan screen. |
| Critical Tasks | Real queues as tasks — Préparation / Retours / Comptage with real % and the oldest item's age as the urgency line. No tasks table. |
| Top bar | Removed. Identity, avatar and logout move to Réglages. |

`warehouse/page.tsx` redirected `warehouse_agent` to Préparation — that is why
the Dashboard tab never landed. The redirect goes. Locale is enforced by
market in `middleware.ts`, so Réglages has no language switch.

## Visual language (sampled from the PNGs)

Scoped to `.wh-mobile`; tokens `--wm-*` in `globals.css`.

| Token | Value |
|---|---|
| `--wm-accent` | `#147A47` |
| `--wm-accent-deep` | `#0F6239` |
| `--wm-accent-soft` | `#E4F1E9` |
| `--wm-ground` | `#F4F3ED` |
| `--wm-grid` | `#E3E6DD` (40px cells) |
| `--wm-card-edge` | `#BFD6C7` |
| `--wm-ink` / `--wm-ink-2` | `#111311` / `#4C524D` |
| `--wm-track` | `#E5E5E5` |
| `--wm-viewfinder` | `#353636` |

Bold sans everywhere, including figures — no monospace. Cards
`rounded-[10px]` with the green-tinted 1px edge, no shadow. Outlined green
pills for actions; one filled pill (the FAB). Progress bars 6px with the
percentage inline at the end. Sparklines: bars on dashboard KPIs, line + soft
area elsewhere.

## Screens

0. **Shell** — no Topbar; tabs Dashboard / Inventaire / Retours / Réglages;
   FAB "Quick Scan"; 40px lattice ground.
1. **Dashboard** — KPI carousel (scans du jour vs goal · retours en attente ·
   stock bas · prêts à remettre, each with 14-day bars); Critical Tasks = the
   three real queues with progress + oldest-item age; Interactive Summary =
   cadence /h · exactitude % · dernière heure, each with a line sparkline.
2. **Scanner** — inline viewfinder with corner brackets and 3×3 grid,
   filled camera pill, "Scan Successful" pill only for `bound`; recent scans
   as a 2-column card grid (stock vs goal + product sparkline).
3. **Inventaire** — centred title, pill search, restyled cards with the
   outlined "Compter" pill; phone hides the KPI strip.
4. **Retours** — one card per return with header, product/qty/motif lines,
   3-step stepper, three outlined decision pills, avg processing footer.
5. **Réglages** — identity (avatar via `/api/me/avatar`), logout via
   `/api/auth/logout`.

## Data (one additive migration)

`get_operator_prep_stats.hourly[24]` · `get_warehouse_trend.handed` ·
`get_warehouse_returns_stats.avg_processing_minutes` ·
`get_to_be_returned_orders.returned_at`. Nothing writes.

## Deliberately not copied

Task names with clock deadlines (no task model) · per-scan "Accuracy" (no
ground truth at scan time) · scanner hamburger (nothing to hold) · language
switch (locale is per market).

## Verification

TDD per RPC/route/component; typecheck; warehouse suites (baseline 269 pass,
1 pre-existing `label-prints` failure); build; 390×844 captures for both
agents with a fake camera feed, compared with the PNGs.
