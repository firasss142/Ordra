# Entrepôt — finish the light-prototype rebuild

## Context

The Entrepôt redesign has been "done" twice and was not. The cause was not
judgement — it was that **the prototype was never a file**. `entrepot-light.html`
(827 lines) was pasted into the conversation as a document attachment. Every time
the context compacted, the markup vanished and the screens got rebuilt from prose
notes, which drift. That is why the same screens came back "close but not it".

The full prototype has now been recovered from the session transcript. **Step 0 is
writing it into the repo** so it can be diffed against, line by line, instead of
remembered.

State today: Préparation matches the prototype. **Aujourd'hui is structurally
different** (no Classement, wrong vs-hier layout, wrong KPI strip anatomy).
**Retours and Journal are still the pre-redesign screens.** Stock stays as it is —
only its section label changed, per instruction.

Answers given this round: relax the scan guard for carriers that supply their own
labels · drop the Retours reason strip (no data source) · Journal ships 5 filters,
Réceptions/Transferts dropped · the sticker is recorded on our side, no Darb call.

### Production facts that shape this

| Fact | Consequence |
|---|---|
| `order_history` holds **0** `scanned` events, ever | Every "today"/leaderboard figure renders **0** until the bench is used. Correct, not broken — empty states must be designed. |
| 407 LY our-warehouse `uploaded`, **0 with a `label_prints` row** | `scan_order_out` rejects all of them today. Fixed in step 1. |
| 49 LY orders are `carrier_extra->>'fulfil_from_carrier_warehouse'` | Feeds the "servis par Darb" action row; these must never be scanned. |
| 50 `to_be_returned` (all TN), `carrier_status_slug` null on every one | No failure reason exists → reason strip dropped. |
| 28 d: 99 delivered / 17 returned | Return rate 14,7 % — real, computable. |
| Two carrier rows share code `darb_assabil` (Tripoli + Benghazi) | Never resolve Darb by code alone; use carrier ids. |

---

## 0. Make the prototype durable — do this first

- Extract the attachment from
  `~/.claude/projects/…/38da479e-….jsonl` (object with `title:"entrepot-light.html"`,
  content at `source.data`; it is double-encoded — `.encode('latin1').decode('utf8')`).
- Write it verbatim to **`Ordra/docs/design/entrepot/entrepot-light.html`**.
- Rewrite `Ordra/docs/design/entrepot/README.md`: this file is the source of truth;
  `entrepot-spec.md` (the dark transcription) is superseded — mark it so, don't delete.
- Copy this plan to `Ordra/plans/entrepot-light-rebuild.md`.

Nothing else starts until the HTML is on disk.

## 1. Migration — unblock the Libya scan

`Ordra/supabase/migrations/2026…_warehouse_scan_prereqs.sql`

- `carriers.supplies_own_labels boolean not null default false`; set `true` for both
  `darb_assabil` rows **by id**.
- `orders.carrier_sticker_ref text` + partial unique index
  `(market_id, carrier_sticker_ref) where carrier_sticker_ref is not null` — so the
  same sticker cannot be bound twice.
- Replace `scan_order_out(p_order_id, p_actor_id, p_sticker_ref text default null)`:
  - label guard applies **only** when the order's carrier has
    `supplies_own_labels = false` (Tunisia keeps print-then-scan);
  - when `p_sticker_ref` is present, write it to `orders.carrier_sticker_ref`;
    a duplicate raises a distinct message the route maps to `STICKER_ALREADY_USED`;
  - everything else unchanged — still one `inventory_log` row and one
    `order_history` row, so the three-path stock model is untouched.
- Add `STICKER_ALREADY_USED` to `ScanErrorCode` and to `classifyRpcError` in
  `src/app/api/warehouse/scan-out/route.ts`; pass the sticker through.

The existing carrier-warehouse short-circuit in that route stays exactly as is.

## 2. Data layer

`src/lib/warehouse/summary.ts` — replace `snapshotKpi` usage with real day counts.

- New RPC `get_warehouse_day_stats(p_market_id, p_tz)` → `scanned_today`,
  `scanned_yesterday`, `handed_today`, `handed_yesterday`, `returns_done_today`,
  `returns_done_yesterday`, from `order_history` (`status_to` in `scanned`,
  `dispatched`) and `inventory_log` (`reason='returned'`). Kills the fabricated
  `previous = current` comparison.
- New RPC `get_warehouse_leaderboard(p_market_id, p_tz)` → per actor:
  `full_name`, `scanned`, `first_scan_at`, `last_scan_at`.
  **Active hours = last_scan − first_scan**, floored at 0,5 h — the only honest
  proxy we have; the rate is `scanned / active_hours`. State that in the card's
  tooltip, as the prototype does.
- Extend the summary payload with the four action-row counts: never-scanned
  (`uploaded`, our warehouse, older than 7 d), late (oldest-first, > 48 h),
  `confirmed` not uploaded, Darb-held.
- Returns stats (new `/api/warehouse/returns/stats`): queue count + value,
  processed today + value, 28-day return rate with 4 weekly points for the
  sparkline, depreciated units + value.
- Journal: add a `handover` kind to `src/lib/warehouse/history-fetch.ts`, sourced
  from `order_history` where `status_to='dispatched'`. Filters ship as
  **Tout · Sorties · Remises · Retours · Inventaires · Impressions**.

## 3. Aujourd'hui — rebuild to the prototype

`src/components/warehouse/console/TodayOverview.tsx` + `primitives.tsx`.

Diff to close, measured against the HTML:

| Prototype | Today |
|---|---|
| `.pipeline` — 5 equal cells, 42 px holder r11, value **mono 30 px/700**, label 10.5 px `.08em`, bar **absolutely positioned at the cell's bottom edge** (3 px, inset 20 px) | 38 px holder, 32 px non-mono, in-flow gauge |
| 5th cell **dimmed** (`opacity .5`) when nothing to do | renders a check chip instead |
| KPIs: À préparer · Scannées · **Remis** · Retours · Stock bas | pendingLabels · toScanOut · returnsInbox · **damagedThisWeek** · lowStock |
| `.ov-grid` `1.55fr / minmax(340px,1fr)` | `1.35fr / minmax(300px,.85fr)` |
| Actions: 4 fixed rows, stripe on the **first row only**, value mono 16 px | stripe per-severity, value 15 px, rows vary |
| **Classement** card — rank · initials avatar · name · `N sorties · H h actives` · race bar with objective tick · rate `/h` · gap line · footer "Objectif : 3,0 /h" | **absent** |
| **Aujourd'hui vs hier** — `.vs` 3-column grid, mono 23 px, ▲/▼ % | stacked 3-row list |

Chart: keep recharts, restyle to the prototype — dashed grid at 0/10/20/30, green
area + line, **violet dashed** returns line, circled final point, `5 août` /
`aujourd'hui` end labels, 2-series legend (drop `damaged`).

Empty states, since production reads zero: Classement shows "Aucune sortie scannée
aujourd'hui"; vs-hier shows the zeros with a muted dash, never a fake %.

## 4. Retours — rebuild

New `src/components/warehouse/console/ReturnsConsole.tsx`, replacing
`ReturnsQueue.tsx` at the route. Four KPI cards (`.kpi` anatomy: 30 px holder r9,
mono 29 px value, `.kn` note, `.kf` divided footer, `edge-*` inset top bar):
Dans la file (amber edge, value + valeur en file) · Traités aujourd'hui (green
edge) · Taux de retour (red spark, 4 weekly points, S-4…S-1) · Dépréciés (dimmed
at zero).

**No reason strip** — dropped.

Work grid `1.4fr / minmax(380px,1fr)`. Left: queue rows (`.rrow` — bell for
age ≥ 10 j, customer block, product, value, age pill, `Traiter`). Right, sticky at
`top:70px`: scan input with the green glow, **3-step indicator** (Scanner →
Décision → Journal), selected-parcel tile, three decision tiles at `opacity .55`
until armed (Remettre en stock / Endommagé / Rélivrer), then `Valider la décision`.
`scan_return_in` for restock+damaged, `scan_received_in` for redeliver.

## 5. Journal — rebuild

New `src/components/warehouse/console/JournalConsole.tsx`, replacing
`WarehouseHistoryClient.tsx` at the route. Three KPI cards (Événements /
Anomalies amber-edge / Traçabilité green-edge, each with a divided `.kf` footer),
then one card: filter pills in the header (active = solid green), search row,
scrollable table `max-height:640px` with **sticky day bands** carrying a per-day
count, rows `Heure · Type chip · Événement · Opérateur · Δ → Solde · copy`,
anomaly rows with the amber inset stripe + `à justifier` chip, and the legend
footer. Export CSV keeps working.

## 6. Verify

- `npm run typecheck` and `npm run test:run` — TDD per screen, tests written first.
  Baseline: 1 known pre-existing failure ("renders En confirmation under ÉQUIPE");
  nothing new.
- `npm run build` — note: the branch build currently fails on
  `src/app/api/connections/overview/route.ts`, an **untracked file from the other
  session**. Confirm it is still not mine before reporting; do not edit it.
- **Show the result.** One dev server only (`pkill -9 -f next-server; rm -rf .next`
  first — stale multi-server state produced phantom 404s before). Log in headless by
  injecting an `@supabase/ssr` session cookie minted with the service key, then
  capture `/fr/warehouse`, `/fr/warehouse/returns`, `/fr/warehouse/history` at
  1440×900 and put them beside the prototype's own screens in a review artifact.
- Re-read `entrepot-light.html` and walk each screen against it before saying done.

## Out of scope

Stock (unchanged by instruction) · Remise transporteur (no prototype screen) ·
supplier receptions and Darb transfers (no data model) · pushing the sticker to
Darb's `PATCH /shipments/reference`.
