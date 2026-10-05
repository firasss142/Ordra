# Entrepôt — the « Aurore » rebuild (desk first)

> Phase 0 deliverable: `prototypes/entrepot-desk-v1.html` (+ `entrepot-desk-v1-avant/`, screenshots of the
> live screens on the LOCAL test DB). No React before the owner approves it.
> Visual reference: `prototypes/commandes-v4.html` (uncommitted, worktree `orders-redesign`).

## Owner answers (2026-10-04)
- Own buildings will ship again → **Sortir stays the lead job**.
- **Desk first** (managers + super admin, French); the agent phone shell follows with the same structure.
- **Keep the four jobs, simplify each page.**
- **Whole section in one prototype.**
- Mid-build: "focus on reception", "the four pages easy to read, understand, use, in the new style".

## Facts that shaped it (prod, read-only, 2026-10-04)
- Since 2026-09-30 every Libyan upload went to Darb's own warehouse (`warehouse_id` null); last scan-out 10-01.
- 32 `to_be_returned` waiting at Darb (Tripoli 14, Benghazi 7, no site 11); no return scanned since 08-18.
- Tripoli bench still 351 `uploaded` (323 Dexpress, dead since May).
- `product_site_stock` 0 rows; 1 reception, `open`, never settled.

## Structure
Sidebar Entrepôt: **Aujourd'hui · Sortir · Rentrer · Recevoir · Stock** (Recevoir promoted from a Stock tab;
Compter and Journal live in Stock). Every page: header + building switch, 3–4 counted tiles that filter,
one search line, one list, detail in a floating drawer. No KPI tiles that repeat the list.

| Page | One question | Main gesture |
|---|---|---|
| Aujourd'hui | what does the warehouse owe today? | 4 job cards → À décider (3 lines max) → one card per building |
| Sortir | which parcels leave now? | Prendre → scan bar armed → bind, auto-next on the same roll; pickup switch lives here only |
| Rentrer | what has Darb got back for us? | Réceptionner → Intact / Abîmé (+cause); Relivrer in the drawer foot |
| Recevoir | ordered → arrived → settled | « C'est arrivé » / Enregistrer un arrivage (blind count) → Solder against the invoice |
| Stock | how much is free, where? | product drawer; Compter (type first, Ordra's figure revealed after) |

## Decisions I made as the expert
- Reception follows v4 « quai et bureau » exactly: arrival = building + products + quantities, stock enters at
  once, the ordered quantity is never shown before the count; settling reconciles the invoice and proposes the
  cause when `damaged × price` explains the gap (→ supplier claim). No model change.
- Count run is blind too (the expected figure appears only after « Valider le compte »).
- Job hues from design-system §4.20 on icon holders and job cards only; red/amber = severity only; a Darb
  roll colour is always written next to its dot.
- No DB or RPC change is needed for this redesign; the stock ledger, the five stock paths and the scan RPCs are
  out of scope.

## Next
1. Owner review of v1 → revisions go to `entrepot-desk-v2.html`.
2. Then Arabic + the agent phone shell (`entrepot-agent-v1.html`, opaque ground).
3. React: one screen per commit in this worktree; delete the duplicated console/mobile components rather
   than restyling them; px units (14 px root).

## Built — 2026-10-05 (branch feat/entrepot-aurore, 6 commits, not pushed)
Owner: "follow the prototype and make the actual changes". Desk only; the agent phone shell is unchanged.
- `src/components/warehouse/desk/` — the prototype's stylesheet scoped under `.ent` (px, 14 px root), shared
  primitives, and one component per screen: TodayDesk, OutDesk, ReturnsDesk, ReceiveDesk (+ ArrivalDrawer,
  SettleDrawer), StockDesk (products, product drawer, Journal), CountDesk. 27 tests.
- New page `/warehouse/receive`; sidebar gains « Recevoir »; `stock?tab=receptions` redirects there for the desk.
- No migration. Additive API changes: returns route gives building + days at Darb and `?state=way`;
  sites/pickup routes expose `nameFr`/`nameAr` (a French desk says « Tripoli »).
- Bugs found and fixed: the Journal ignored `arrival`/`arrival_correction` (every dock arrival invisible);
  the history API rejected `kind=reception|count` (400 — the live Journal's two chips were empty).
- Deviations, on purpose: Rentrer's « Ce que Darb a noté » column → « Valeur » (Darb sends no reason);
  an unexplained invoice gap offers « Réclamer » / « Accepter » instead of a dead end; no « Annuler en lot »
  for set-aside parcels (no such action exists — links to Commandes); Journal has no building switch
  (the API cannot filter by building); settled receptions open the existing full sheet (payments, reversal).
- Removed: BenchConsole, PreparationConsole, ScannedTable, ScanStation, ReturnsConsole.

## Revision 2 — 2026-10-05 (owner: pagination, the scan run, a last UX pass)

- **Pagination, 25 rows a page, everywhere a list can grow**: Sortir (à sortir + sortis), Rentrer
  (chez Darb, en route, rentrés), Recevoir (each of the three columns), Stock (products), Compter (the
  to-count list, which turns its page on its own as the count advances) — client-side over the loaded
  rows, via `pageOf` (lib/warehouse/desk.ts) + `usePaged`/`Pager` (desk/ui.tsx). A filter change goes
  back to page 1; one page hides the pager. The Journal pages ON THE SERVER with the history API's
  cursor (`StepPager`: back/next, no total). Aujourd'hui has no list that grows — nothing to page.
- **The scan run (/warehouse/scan) rebuilt in Aurore** — it was still the old mobile `wm-*` look and
  nothing on the desk linked to it. « Commencer une tournée » on Sortir now opens it (« Tournée Rouge »
  when a roll is filtered, carrying `?roll=` and `?warehouse_id=`). Same logic and tests; new: a track
  with one mark per parcel, « Ensuite » preview, a dashed scan zone in the roll's colour, the camera opens
  first only on a touch device (desk = gun/keyboard), Enter on a result moves on, warnings BEFORE the
  sticker is peeled for short stock and for a parcel with no Darb reference, the counter no longer jumps
  to « 16 / 16 » while a bound parcel's result is on screen.
- UX pass fixes: Aujourd'hui named the buildings in Arabic on the French desk (now the reader's
  language, from the pickup API); `.res` class clash; summary buttons squashed on phone.
