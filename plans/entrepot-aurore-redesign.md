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
