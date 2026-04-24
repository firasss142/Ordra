# Warehouse Journal — Redesign Plan (Audit-First)

**Route:** `/[locale]/warehouse/history`
**Status:** Proposal. No code written yet.
**Owner:** warehouse surface
**Companion doc to:** the earlier `plans/returns-redesign-decision-first.md` (same aesthetic family; different verb).

---

## 1. Thesis

Today the Journal is a paginated, kind-tabbed list of events. It answers *what happened* but not *who did it, when, in context, or whether it was unusual*. For a warehouse where scans drive stock integrity and adjustments move money, that is not enough.

The redesigned Journal is an **operational audit log**: every row tells a complete story on its own, grouped into the operator-session that produced it, searchable end-to-end, exportable for accounting, and with anomalies surfaced visually before anyone has to ask.

The single sentence: **"Who did what, when, why — and was it normal?"**

---

## 2. What stays

Everything below is already well-built. Don't churn it.

- Server-prefetch of first page in [page.tsx](../src/app/[locale]/(warehouse)/warehouse/history/page.tsx) — keep.
- Union merge + keyset cursor in [history-fetch.ts](../src/lib/warehouse/history-fetch.ts) — extend, don't rewrite.
- `useSWRInfinite` + URL-synced filters in [useWarehouseList.ts](../src/hooks/useWarehouseList.ts) and [useWarehouseHistoryFiltersUrl.ts](../src/hooks/useWarehouseHistoryFiltersUrl.ts) — keep.
- Realtime hook INSERTs on `inventory_log` + `label_prints` — already covers manual adjustments, no change needed.
- API route shape, pagination contract, market scoping in RLS — keep.

---

## 3. What changes

### 3.1 Data model additions

Three new data sources merge into the unified row stream; the cursor machinery generalises to more "kinds":

| Kind | Source | Actor column | Identifying reason |
|---|---|---|---|
| `scan` | `inventory_log` | `actor_id` | `reason='scanned'` |
| `return` | `inventory_log` | `actor_id` | `reason in ('returned','damaged_writeoff')` |
| `print` | `label_prints` | `printed_by` | — |
| **`adjust`** (new) | `inventory_log` | `actor_id` | `reason='manual_adjustment'` |
| **`writeoff`** (new, split out of `return`) | `inventory_log` | `actor_id` | `reason='damaged_writeoff'` when **not** tied to an order-return (i.e. `order_id IS NULL`) |
| **`transition`** (new, optional — see §7) | `order_history` | `actor_id` | `status_to in ('confirmed','dispatched','delivered','returned')` |

Notes:
- `inventory_log.actor_id` and `label_prints.printed_by` already exist (verified).
- `adjust_product_stock` RPC already writes `actor_id`. Zero schema migrations required for the core redesign.
- `transition` is scoped optional because it materially expands the journal's identity from "warehouse movements" to "whole-order audit". Decide in §7.

### 3.2 Row shape

`WarehouseHistoryRow` grows to carry actor, product, and scale metadata so that each row can render self-contained:

```ts
interface WarehouseHistoryRow {
  kind: "scan" | "return" | "print" | "adjust" | "writeoff";
  id: string;
  at: string;              // ISO timestamp
  order_id: string | null;
  order_number: string | null;
  product_id: string | null;
  product_name: string | null;
  qty_change: number | null;    // null for prints
  balance_after: number | null;
  is_damaged: boolean;
  is_reprint: boolean;
  note: string | null;
  actor: {
    id: string;
    full_name: string | null;
    role: "super_admin" | "market_manager" | "warehouse_agent" | "agent" | null;
    avatar_url: string | null;
  } | null;                // null for system-authored rows
}
```

Fetch strategy: extend the two existing SELECTs in [history-fetch.ts](../src/lib/warehouse/history-fetch.ts) to join `users` by `actor_id` / `printed_by`. One FK join per stream — no fan-out; RLS on `users` already permits read for authenticated staff.

### 3.3 Filter model

```ts
interface WarehouseHistoryFilters {
  kind: "all" | "scan" | "return" | "print" | "adjust" | "writeoff";
  dateFrom: string | null;
  dateTo: string | null;
  q: string;                     // now ALSO searches notes + product name
  actorId: string | null;        // NEW — single-actor filter
  productId: string | null;      // NEW — per-product shortcut
  onlyAnomalies: boolean;        // NEW — see §4.5
}
```

- `kind` list is defined in [list-filters.ts](../src/lib/warehouse/list-filters.ts) → `WAREHOUSE_HISTORY_KINDS`. Adding to that array drives the tab bar, URL parsing, and chips automatically.
- `q` fan-out in [history-fetch.ts](../src/lib/warehouse/history-fetch.ts) currently hits `orders.order_number` + `orders.customer_name`. Extend to OR `products.name` and `inventory_log.note`. `label_prints` has no note — that's fine, `q` for prints keeps hitting the orders join.
- `actorId` → `.eq("actor_id", …)` on `inventory_log` and `.eq("printed_by", …)` on `label_prints`.
- `productId` → `.eq("product_id", …)`. Prints have no product, so when `productId` is set we skip the prints stream entirely (mirrors existing `includePrints` logic for `kind=scan`).

### 3.4 URL contract

The API route [route.ts](../src/app/api/warehouse/history/route.ts) Zod schema gains the new query params with validation. Same cursor format — the union cursor already tolerates a larger `kind` space because it encodes into two buckets (`print` vs `scan-family`). We'll keep that encoding; `adjust`/`writeoff`/`scan`/`return` all use the `scan` cursor bucket because they live in the same table and share `created_at` order.

---

## 4. Visual redesign

### 4.1 Layout — row is the hero

Every row is a **card-dense audit line**. Not a list item, not a table row — a single visual unit with:

```
┌─────────────────────────────────────────────────────────────────┐
│  [avatar]  Anis M.                        [kind pill]   14:32   │
│   WH-TN    Scanned out #A1B2 · Printemps Coton Rose · qty −1   │
│   stock: 142 → 141                                     note: —  │
└─────────────────────────────────────────────────────────────────┘
```

Structure:
- **Leading column (56px):** circular avatar, initials fallback (`initialsOf()` already exists in [src/lib/user.ts](../src/lib/user.ts)). Ring color encodes role:
  - super_admin: black `#1A1A1A`
  - market_manager: `--action` `#2C6ECB`
  - warehouse_agent: `--success` `#008060`
  - agent (confirmation): `--neutral` `#6D7175`
  - system / null actor: dashed gray ring, no initials — just a clock glyph
- **Main column:** actor name (700 weight, 14px) · role tag (11px `--text-secondary`). Second line = action sentence (13px, `--text-primary`). Third line = quantitative detail (12px `--text-secondary`, tabular-nums): `stock: N → M`, `qty ±X`, or `note: …` when present.
- **Trailing column (right-aligned):** kind pill using the existing color mapping — scan/return/adjust on green, writeoff on red, print on neutral, reprint carries the ↺ chip already in use. Timestamp below, 12px `--text-secondary`, tabular-nums.

No shadows. `1px` bottom border between rows. Hover: `--bg-hover`. This matches the Shopify admin aesthetic codified in [docs/design-system.md](../docs/design-system.md).

### 4.2 Timeline grouping

Rows cluster into **operator-sessions**. A session = contiguous rows from the same actor with no gap > 30 minutes. Session header is sticky within its group:

```
━━━ Anis M. · warehouse_agent · 14:20 – 14:47 · 23 scans, 2 returns ━━━
  row
  row
  ...
```

- Client-side grouping after the flat rows arrive. No server change.
- Toggleable: a segmented control at the top right — `[Timeline] [Flat]`. Persist in URL as `view=timeline|flat`.
- When any filter other than `actorId` is active, default to `flat` — grouping by operator is misleading when the set is pre-filtered by product or kind.
- Fallback header when actor is system: "System events · HH:MM – HH:MM".

### 4.3 Day separators

Above the first row of each calendar day (in the user's locale), a thin divider: `— Aujourd'hui ·  Mercredi 23 avril —`. Uses `formatDateTime` patterns already in [src/lib/format.ts](../src/lib/format.ts); add a `formatDayHeader(date, locale)` sibling.

### 4.4 Search

Single search box, debounced 250ms (already in place), now routing to:
- `orders.order_number` (existing)
- `orders.customer_name` (existing)
- `products.name` (new)
- `inventory_log.note` (new)

Search results are always rendered in **flat view** — grouping a filtered set by operator-session defeats the point.

Show search hit count inline with the filter chips: `17 résultats · effacer`. Matches the affordance from the decision-first returns redesign (same surface family).

### 4.5 Anomaly highlighting

The rule set, all computed server-side in [history-fetch.ts](../src/lib/warehouse/history-fetch.ts) alongside the row fetch:

1. **Actor volume outlier:** in the current result set, compute per-actor daily event count. Flag rows where `actor_today_count > 3 × actor_14day_median`. Query: one additional `SELECT actor_id, DATE(created_at), COUNT(*)` over the last 14 days, scoped by market. Mark the row with `anomalies: ["volume_outlier"]`.
2. **Product concentration:** for today's `damaged_writeoff` + `return (is_damaged=true)` rows in scope, compute per-product share. If one product ≥ 80% of today's damage events AND today's damage count ≥ 5, flag every row for that product with `anomalies: ["damage_concentration"]`.
3. **Adjustment after print:** if a `manual_adjustment` row lands on a product whose latest `scanned` row on the same `order_id` is within 2 hours and the adjustment is negative, flag `anomalies: ["post_scan_adjustment"]`. Quietly critical: this is the shape of covering-up a miscount.

Visual: a thin `2px` left border in `--critical` on the row card and a small red triangle `◤` in the top-left corner. Tooltip on hover explains the rule. Anomaly rows do not break grouping — they stay in their session.

The `onlyAnomalies` filter keeps only rows whose `anomalies` array is non-empty.

### 4.6 Per-product shortcut

Product name in any row → clickable → sets `productId` filter, clears `kind` tab to `all`, switches view to `flat`. Breadcrumb chip appears: `Produit: Printemps Coton Rose · ×`. Same interaction pattern as existing filter chips (see `FilterChip` in [WarehouseHistoryClient.tsx](../src/components/warehouse/WarehouseHistoryClient.tsx)).

### 4.7 Empty / loading / error

- Empty (no rows, no filters): warm copy — "Le journal est vide. Dès qu'un scan, une impression ou un ajustement a lieu, il apparaîtra ici."
- Empty (no rows, filters active): "Aucun événement ne correspond à ces filtres. [Effacer les filtres]"
- Loading first page: skeleton rows matching the row layout — 5 skeletons, 56px avatar circle + two-line text block.
- Error: inline banner with retry, no full-page replacement. The existing SWR flow keeps previous data.

---

## 5. Export (CSV + PDF)

### 5.1 CSV

New endpoint: `GET /api/warehouse/history/export.csv?…` — same query params as the list route, no `cursor`, but with a hard cap (e.g., 10 000 rows) and a `400` if the filtered set exceeds it (message: "Réduisez la plage de dates avant l'export").

Columns:
```
timestamp_iso, actor_name, actor_role, kind, order_number, product_name, qty_change, balance_after, is_damaged, is_reprint, note, anomalies
```

Stream with `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="journal-YYYY-MM-DD.csv"`. No BOM (Excel on macOS handles UTF-8 fine; Windows folks use the same file from Drive).

### 5.2 PDF (stamped audit report)

New endpoint: `GET /api/warehouse/history/export.pdf?…`. Server-side render using `@react-pdf/renderer` (add dep if not present).

Header:
- OMS logo + market name
- Generated: {actor full_name} · {timestamp ISO} · {timezone}
- Filter summary: "Kind: all · From: 2026-04-01 · To: 2026-04-23 · Search: (none)"
- **Stamp box** in top-right: `RAPPORT D'AUDIT` / generation hash (sha256 of query + result row IDs, first 8 chars).

Body: compact table, one row per event, same columns as CSV minus `anomalies` (call them out with a marginal ◤ glyph instead).

Footer on every page: page N of M · `Signé par {actor} · {hash}`.

The generation hash matters: an auditor can later rerun the same query and re-compute the hash to check tampering. Document this in the `/docs` page for the feature.

### 5.3 UX

Two buttons next to the filter chips area: `[Exporter CSV]  [Exporter PDF]`. Disabled while the filtered set is loading. Both honour the **current** filters. No modal — one click → download.

---

## 6. File map

### New

- `src/app/api/warehouse/history/export.csv/route.ts` — CSV export.
- `src/app/api/warehouse/history/export.pdf/route.ts` — PDF export.
- `src/lib/warehouse/anomalies.ts` — pure functions: `detectVolumeOutliers`, `detectDamageConcentration`, `detectPostScanAdjustments`. Each takes rows + supporting aggregates and returns row IDs → anomaly tags. All unit-testable, no Supabase dependency.
- `src/lib/warehouse/history-pdf.tsx` — `@react-pdf/renderer` component.
- `src/lib/warehouse/group-by-session.ts` — pure: `groupRowsIntoSessions(rows, gapMinutes=30)`.
- `src/components/warehouse/JournalRow.tsx` — the audit row.
- `src/components/warehouse/JournalSessionHeader.tsx`.
- `src/components/warehouse/JournalDaySeparator.tsx`.
- `src/components/warehouse/JournalToolbar.tsx` — search, kind tabs, actor select, product chip, anomaly toggle, view toggle, export buttons.
- `src/components/warehouse/__tests__/WarehouseHistoryClient.test.tsx` — integration, real data fixtures.
- `src/lib/warehouse/__tests__/history-fetch.test.ts` — union + cursor + actor filter tests (hits real Supabase per CLAUDE.md rule — no mocks).
- `src/lib/warehouse/__tests__/anomalies.test.ts` — pure unit tests for each rule.
- `src/lib/warehouse/__tests__/group-by-session.test.ts` — pure unit tests.

### Modified

- [src/lib/warehouse/history-fetch.ts](../src/lib/warehouse/history-fetch.ts) — widen row type, add actor joins, extend `q` to products.name + notes, accept `actorId`/`productId`, compute anomalies.
- [src/lib/warehouse/list-filters.ts](../src/lib/warehouse/list-filters.ts) — expand `WAREHOUSE_HISTORY_KINDS`, add new filter fields, parser/serializer, chip helper, `view` param.
- [src/hooks/useWarehouseHistoryFiltersUrl.ts](../src/hooks/useWarehouseHistoryFiltersUrl.ts) — expose new fields.
- [src/app/api/warehouse/history/route.ts](../src/app/api/warehouse/history/route.ts) — Zod schema gets new fields.
- [src/components/warehouse/WarehouseHistoryClient.tsx](../src/components/warehouse/WarehouseHistoryClient.tsx) — becomes a thin orchestrator: fetches pages, groups into sessions (client-side), composes toolbar + rows/headers. The 670-line mega-file shrinks substantially.
- [src/lib/format.ts](../src/lib/format.ts) — add `formatDayHeader(date, locale)`.
- `src/messages/fr.json` + `src/messages/ar.json` — new keys under `warehouse.history.*`:
  - `kind.adjust`, `kind.writeoff`
  - `filter.adjust`, `filter.writeoff`, `filter.actor`, `filter.product`, `filter.anomaliesOnly`, `filter.view.timeline`, `filter.view.flat`
  - `session.header` (placeholders: actorName, role, startTime, endTime, count)
  - `anomaly.volumeOutlier`, `anomaly.damageConcentration`, `anomaly.postScanAdjustment`
  - `export.csv`, `export.pdf`, `export.stampedBy`, `export.generatedAt`, `export.tooLarge`
  - `empty.noFilters`, `empty.filtered`
  - `row.stockChange` (e.g. "{from} → {to}"), `row.qty`, `row.note`
- Optional: [src/types/database.ts](../src/types/database.ts) — regenerate if the actor joins complain.

### Not touched

- `supabase/migrations/*` — no schema changes.
- `adjust_product_stock` RPC — unchanged.
- RLS policies on `inventory_log`, `label_prints`, `users` — existing policies already cover this read surface.
- Realtime hook — already listens to the right tables.

---

## 7. Open decision — include `order_history` transitions?

Arguments for:
- A truly complete audit includes "who confirmed this order" and "when it was dispatched".
- Gives warehouse staff one place to trace the entire life of a shipment without bouncing to an order detail page.

Arguments against:
- This page is linked in the sidebar as **"Journal entrepôt"**. Scope creep into the full OMS audit log changes its identity.
- Volume: `order_history` is high-frequency. Merging it with scan/print events will drown the signal warehouse staff come here for.
- A separate `/audit` page owned by super_admin is the cleaner home.

**Recommendation:** exclude from this redesign. Keep the Journal focused on **physical warehouse events + stock adjustments**. If we want a cross-cutting audit log later, that's its own surface.

Flagging for user confirmation before implementation.

---

## 8. Testing strategy (TDD, real DB per CLAUDE.md)

Write failing tests first, in this order:

1. **`anomalies.test.ts`** — pure. Volume outlier with various windows, damage concentration threshold logic, post-scan-adjustment detection edge cases (exactly 2h, exactly same product). Fast, deterministic.
2. **`group-by-session.test.ts`** — pure. 30-minute gap boundary, mixed actors interleaved, single-row session, system (null actor) rows forming their own sessions.
3. **`history-fetch.test.ts`** — integration against Supabase. Seeds:
   - A scan, a print, a manual_adjustment, a damaged_writeoff, a return — each with a distinct actor.
   - Assert merge order, cursor round-trip, market scoping, actorId filter, productId filter, q=notes hit, q=product-name hit.
4. **`WarehouseHistoryClient.test.tsx`** — integration with real fixtures (not mocks — use the SWR fallback path that [page.tsx](../src/app/[locale]/(warehouse)/warehouse/history/page.tsx) already uses). Assert: row renders actor name + role ring color, session header collapses 3 same-actor rows, anomaly badge shows on outlier row, clicking product chip updates URL, switching to flat view removes session headers, empty state copy matches the filter state.
5. **Export route tests** — integration. Assert CSV content-type, header row, row count matches filtered set, 400 on over-cap queries. PDF tests assert a 200 and that the stamped hash is deterministic for the same filters + same data.

No DB mocks anywhere — confirmed rule in CLAUDE.md.

---

## 9. Accessibility

- Each row is a `<article>` with `aria-labelledby` pointing to the actor name.
- Session headers are `<h2>` within a sectioning element so screen readers can jump by session.
- Anomaly indicator is not color-only — it includes the `◤` glyph and an `aria-label` with the translated anomaly reason.
- Avatar is `role="img"` with the actor's full name. No decorative images.
- View toggle is a proper segmented radio group, not two buttons.
- The product-link and actor-link affordances are `<button>`s (they mutate filters, don't navigate) with visible focus ring `#36F4A4`.

---

## 10. Rollout

No feature flag needed — this is an internal tool surface. Ship in one PR once tests are green. The existing realtime hook means live rows appear immediately for users already on the page.

Post-merge:
- Watch for export size complaints in the first week; if users hit the 10k cap a lot, reconsider the cap or add streaming.
- Watch the anomaly rules for false positives; the thresholds (3×, 80%, 5, 2h) are seeded from intuition, not data. Plan to revisit after two weeks of real traffic.

---

## 11. Non-goals

- No editing of history rows — append-only per the project rule.
- No deletion or redaction UI — if a row was written in error, the fix is another row that offsets it.
- No cross-market view for non-super_admins — RLS enforces this already; don't mock around it.
- No notifications on anomalies in this iteration — surfacing in the row is enough; alerting is the Alerts surface's job.
