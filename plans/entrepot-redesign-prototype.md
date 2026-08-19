# Entrepôt redesign — interactive HTML prototype + spec

> **Livré le 18 août 2026.** Prototype : `Ordra/docs/prototypes/entrepot-redesign.html`
> · Spécification : `Ordra/docs/prototypes/entrepot-redesign.md`
> · Artifact privé : https://claude.ai/code/artifact/d0088f19-603d-4eff-af3e-bda8537bcbcd

## Context

The current "Entrepôt" nav group (Préparation · Expédition · Retours · Suivi transporteur · Tableau livraison · Journal entrepôt, plus "Stock & inventaire" hidden under Finances) grew page-by-page. Six screens each render their own order table over overlapping status slices (`uploaded`, `scanned`, phase-2 in-flight, `to_be_returned`, history), the Expédition tab is actually a bulk *upload-to-carrier* cockpit (agent work, not warehouse work), and nothing covers stock-in, counts or transfers. Warehouse agents jump straight to Préparation and have no landing view.

Prod facts that shape the design (read-only SQL, 2026-08-18):
- Libya is ~90 % **our own warehouse** (pack → Darb pre-printed sticker → handover) and ~10 % **Darb-held stock** (`fulfil_from_carrier_warehouse`, Darb Tripoli ships, no scan on our side). All August orders happen to be Darb-held; June–July were home mode (563 stickered parcels).
- **444 LY orders sit in `uploaded`** — the OMS never saw the sticker scan because binding was done in the Darb app. This is the #1 KPI the redesign must expose.
- Tunisia (Navex): 119 `confirmed` not uploaded, 142 `dispatched`, 50 `to_be_returned` — no new orders since May, but the flow must work.
- Our label already exists (`src/app/api/warehouse/label-prints/route.ts` + `src/lib/labels/OrderLabelPdf.tsx`, A4): **QR encodes `order.id`**, BL number Code128, **carrier tracking Code128** when uploaded, sender/customer/COD. So "keep carrier barcode, add our QR" is already the label — the redesign only changes *when* it is printed and *what* is scanned.
- Darb sticker: number bound at scan; rolls are **colour-coded per region** (not city) — mapping unknown today, to be added later.
- Stock changes only via `scan_order_out`, `scan_return_in`, `scan_received_in`, `adjust_product_stock` (super_admin) → `inventory_log` append-only. No reception / transfer / count tables exist yet.

Decisions already taken with the user:
1. Libya: build for **our warehouse first**, with a secondary "Stock chez Darb" view (live Darb qty + transfers).
2. Libya scan: **pick order on screen → scan Darb sticker** = one action: bind sticker (replaces `SH…` ref) + scan-out (stock −qty, `uploaded → scanned`).
3. Warehouse agents get **Réceptions (stock-in), Inventaires/Ajustements, Transferts vers Darb**. (No undo-scan / write-off requested.)
4. **Stock becomes a sub-section of Entrepôt**; Finances keeps the €/capital analytics.
5. Deliverable: **one self-contained interactive HTML** (both markets via switch, Manager + Agent-entrepôt view toggle, French LTR) saved in the repo **and** published as a private Artifact. Sticker colour: show region + an empty swatch slot; no invented colours.

Deliverable = design prototype + spec, **no product code, no migrations**.

---

## 1. Information architecture (replaces the 6 tables)

Nav group **Entrepôt** (dark sidebar, same position as today):

| # | Sub-section | Answers | Replaces |
|---|---|---|---|
| 1 | **Aujourd'hui** | "What must the warehouse do now, and are we late?" | WarehouseOverviewClient (manager-only today) — now also the agent landing |
| 2 | **Préparation** | "Which parcels to pack, and scan them out" | ToLabelQueue + ToScanQueue + PreparationClient (tray) |
| 3 | **Remise transporteur** (was Expédition) | "Which scanned parcels leave with which carrier, with a manifest" | ToShipCockpit (its bulk *upload* job moves to Commandes; a link stays on Aujourd'hui) |
| 4 | **Retours** | "Decide restock / damaged / re-deliverable" | ReturnsQueue + ReturnsDecisionCard (kept conceptually, restyled) |
| 5 | **Stock** | "Units on hand, at Darb, coming in; receptions, counts, transfers" | Stock & inventaire (units part) + LowStockBanner |
| 6 | **Journal** | "Everything that happened, append-only, exportable" | WarehouseHistoryClient |

Moved **out** of Entrepôt (unchanged pages, shown greyed in the prototype sidebar under a "Livraison" group): Suivi transporteur, Tableau livraison — they are post-handover tracking, not warehouse work. Flagged as a decision, not silently dropped.

Roles: `warehouse_agent` = tab band only (no sidebar), sees 1–6 with Stock limited to units + own actions; `market_manager` / `super_admin` = sidebar + same six tabs + manager-only cards (team throughput, backlog age, market switch).

## 2. Business logic per market (one flow, two scan sources)

Common status path (unchanged): `uploaded` → **scan-out** → `scanned` → **remise** → `dispatched` → … → `to_be_returned` → **retour** → `returned` | `received`.

| Step | Libya (own warehouse, Darb Assabil) | Tunisia (Navex & co.) |
|---|---|---|
| Print | Optional picking list only (no own label needed) | **Imprimer étiquettes** (existing PDF: carrier Code128 + our QR) per selection; `label_prints` row |
| Identify parcel | Tap the row in Préparation (grouped by region → sticker roll) | Scan our QR (order id) — no on-screen picking needed |
| Scan | Scan **Darb sticker** → OMS binds sticker to shipment (Darb API, replaces `SH…`) **and** `scan_order_out` | Scan **our QR** → `scan_order_out` |
| Guards | order must be `uploaded`; sticker unused; Darb not delivered/cancelled; API failure → row stays "à réessayer", stock untouched | order must be `uploaded` and label printed |
| Remise | Group by Darb account (Tripoli / Benghazi); "Remettre" → `dispatched` + manifest PDF | Group by carrier; same |
| Darb-held orders | Never appear in Préparation (badge "Expédié par Darb"); visible in Stock › Chez Darb | n/a |

Stock movements (all append `inventory_log`, all shown in Journal): scan-out −qty · retour +qty / damaged +damaged_count · **réception** +qty · **inventaire** ±delta (counted − system, reason required) · **transfert Darb** −qty ours / +qty Darb-held (new concept, prototype-only).

## 3. Screens (wireframe intent — Ordra visual language: white cards on #F6F6F7, 10 px radius, 1 px #E1E3E5 borders, no shadows, brand green #15803D only for CTA/active, functional colour on badges only)

Every screen = page header (title + subtitle + market dot) → **KPI row of 4–5 cards** (label uppercase 10.5 px, big number 30 px tabular, unit muted, 2–3 sub-stats footer — the `StockKpiCard` shape) → one primary work area → one secondary panel. Low density: max one table per screen, generous 16/24 px spacing.

1. **Aujourd'hui** — KPIs: À préparer (uploaded, own-warehouse) · Scannés aujourd'hui · À remettre (scanned) · Retours à traiter · Stock bas. Below: a horizontal **flow strip** uploaded → scanné → remis (counts + oldest age, red when > 48 h) ; **Alertes** list (444 en attente depuis > 7 j, produits sous seuil, N confirmées non téléchargées → link to Commandes) ; manager extra: throughput per agent today + 14-day sparkline. Agent variant is titled "Ma journée" and drops the manager cards.
2. **Préparation** — left 60 %: list of `uploaded` own-warehouse orders, **grouped by region** (LY: region band + empty colour swatch "Rouleau — couleur à définir"; TN: by carrier), row = customer · city · product × qty · age · stock chip; select rows → sticky bar "N sélectionnées · Imprimer étiquettes (TN) / Liste de picking". Right 40 % sticky **Scan panel**: big input (auto-focus, hardware scanner = keyboard), current order card (LY: "Collez le sticker, puis scannez"), feedback tile (green: "Sticker 889 201 lié · stock 108 → 107"; red: reasons), last 8 scans. Progress "12 / 20 aujourd'hui".
3. **Remise transporteur** — KPIs: À remettre · Remis aujourd'hui · Colis par transporteur. Cards per carrier/account (Darb Tripoli 34 colis, Darb Benghazi 6 …) with parcel list, "Remettre N colis" → confirm modal → manifest PDF + `dispatched`. Secondary: "Remises récentes" (manifest history).
4. **Retours** — KPIs: À traiter · Traités aujourd'hui · Taux retour 28 j · Endommagés 28 j. Scan/select → **decision card**: Remettre en stock / Endommagé (reason chips + optional photo) / Re-livrable (received). Queue list below with age.
5. **Stock** — KPIs: Produits sous seuil · Jours de couverture min · Unités chez Darb · Réceptions 28 j. Product cards/rows: position bar (registre / engagé / libre — reuse the stock console vocabulary), Darb-held qty chip (live), last count date. Actions (buttons top-right + per row): **Réception**, **Inventaire**, **Transfert Darb** → modals (product, qty, ref/note, date; inventaire = counted qty → delta preview + reason). No € here.
6. **Journal** — segmented filter (Tout · Scans · Remises · Retours · Réceptions · Inventaires · Transferts · Impressions), search, day-grouped timeline rows (icon · what · who · qty/stock after · order link), Export CSV.

Cross-cutting: **order side panel** (click a row anywhere: customer, product, status timeline, sticker/tracking, actions), toasts, empty states, market switch (Libye · LYD / Tunisie · TND) and role toggle in a small floating "prototype controls" bar.

## 4. KPI list (actionable, units only)
Aujourd'hui: à préparer, scannés aujourd'hui (+ vs hier), à remettre, retours à traiter, stock bas, plus âge du plus ancien `uploaded`, confirmées non téléchargées.
Préparation: sélectionnées, scannées / objectif jour, erreurs de scan, par région.
Remise: colis par transporteur, remis aujourd'hui, manifestes.
Retours: à traiter, traités, taux retour 28 j, part endommagés, âge moyen.
Stock: sous seuil, couverture (j), chez Darb, réceptions 28 j, dernier inventaire.
Journal: événements aujourd'hui, anomalies.

## 5. CRUD matrix (warehouse_agent)
Create: scan-out, remise + manifest, décision retour, **réception**, **inventaire/ajustement**, **transfert Darb**, impression (batch/reprint), picking list. Read: everything in 1–6 (own market). Update: `products.is_active` toggle, notes on own reception before end of day (spec note: implement as a new compensating log row, ledger stays append-only). Delete: none — "Annuler" creates a reversal entry with reason. Managers additionally: market switch, agent throughput. super_admin only: raw `adjust_product_stock`.

## 6. Build steps

0. Copy this plan to `Ordra/plans/entrepot-redesign-prototype.md` (project rule: plans live in `/plans`).
1. Load skills `artifact-design` and `dataviz` (required before writing the artifact / KPI tiles & sparklines).
2. Pull realistic data (read-only SQL, project `vshynigvgrlihngozuwb`): LY products (5 SKUs, `current_stock`, thresholds), LY cities → Darb region mapping from `src/lib/carriers/darb-assabil-areas-data.json` (regions only), counts (444 uploaded, 10 confirmed…), TN sample (Navex, 50 to_be_returned, cities). Anonymise customer names (use the Arabic/French names style seen in the app, not real phones).
3. Write `Ordra/docs/prototypes/entrepot-redesign.html` — single file, inline CSS + vanilla JS, no external requests (artifact CSP): tokens copied from `src/app/globals.css` (`--bg-page #F6F6F7`, `--bg-card #fff`, `--border #E1E3E5`, `--text-primary #1A1A1A`, `--text-secondary #6D7175`, `--brand #15803D`, `--brand-bg #E9F6EE`, `--oms-ok/warn/bad/info` + `-bg`, `--oms-ink-1/2/3`, radius 10 px, font Inter → system stack, 14 px base); dark sidebar #1A1A1A 240 px with the real nav groups; six screens as `<section data-screen>`; JS state `{market, role, screen, orders[], stock[], journal[]}`; interactions: tab nav, market/role switch, Préparation selection + scan simulation (Enter → success/error tile, row moves, KPIs update), Remise confirm, Retours decision, Stock modals (réception/inventaire/transfert append to journal), Journal filter, side panel, toasts. Light + dark theme tokens per artifact rules (dark = tokens only, page still reads as Ordra).
4. Write `Ordra/docs/prototypes/entrepot-redesign.md` — the spec (sections 1–5 above, tightened) with a "what would change in code" appendix: new `inventory_log` reasons (`reception`, `count_adjustment`, `transfer_out_carrier`), new `carrier_stock_transfers` + `handover_manifests` tables, Darb sticker-bind endpoint (**open**: which Darb endpoint rebinds `reference` — not in `INTEGRATION_GUIDE.md`; flag for the implementation phase), region-colour setting.
5. Publish the HTML with the `Artifact` tool (private, favicon 📦, stable title "Entrepôt Redesign").

## 7. Verification
- Open the HTML with the Playwright MCP at 1440 × 900 and 1280 × 800: screenshot each of the six screens × {Libye, Tunisie} × {Manager, Agent}; assert no horizontal page scroll; run the scan simulation (success + each error path), a réception modal, a retour decision, a remise — journal rows appear, KPIs update.
- Visual check against the three reference screenshots (KPI card anatomy, table header style, badge tints, segmented control) — same family, not denser.
- Confirm the artifact URL renders in both themes; no console errors.
- Hand back: artifact link + repo paths + the open questions (Darb bind endpoint, region colours, moving Suivi transporteur / Tableau livraison out of the group).
