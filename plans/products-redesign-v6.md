# Produits v6 — list, product sheet, edit page, and the numbers behind them

> **STATUS (2026-10-04): BUILT — Phases 1–8 on `feat/products-redesign-v6`.** The owner approved the prototype on 2026-10-03 ("I like the prototype. Follow it exactly.") and chose **Plus Jakarta Sans**. Waiting on the owner for: the production SQL paste (§9.3), the PR review, and — separately — reading the Darb history dry run before the backfill (§9.4).
> Prototype: `prototypes/products-v6.html` (private artifact: https://claude.ai/artifact/LuRFqDMNrJPSfShvKvESLY).
> Worktree `.claude/worktrees/products-redesign`, branch `feat/products-redesign-v6`, cut from `origin/main` b40604d.
> Supersedes the presentation of `plans/products-ui-redesign-spec.md` (v4/v5, August 2026). The v5 data layer is replaced, not reused.

The owner asked for product pages that are easy to understand, spot and read, elegant, modern and colourful, with a better font. He also asked for a better chart and pipeline on `/products/[id]`, an edit page with a clean structure, and a data accuracy check. He said "feel free to ask questions, don't assume anything", so every money and definition rule below comes from his answers (§3), not from me.

---

## 1. Data accuracy check — what the screens say vs. the truth

Product `qr-01` (القرآن تدبر وعمل), orders created 2026-09-04 → 2026-10-03, read-only SQL on production. The screenshot's numbers were reproduced exactly from the current formulas first (573 / 162 / 180 / 72), so each gap below is a formula problem, not a data glitch.

| Screen shows | Truth | Root cause |
|---|---|---|
| Uploadées **180** > Confirmées 162 | **158** uploaded of 581 received (155 distinct on the old basis) | counts `order_history` ROWS with `status_to='uploaded'` — a re-uploaded parcel counts twice. `api/profitability/product/[productId]/route.ts:88`, `lib/products/metrics.ts:168` |
| Confirmées **133 %** / Livrées **200 %** (boxing dolls rows) | 50 % / 0 % | confirmations counted by event date, orders by creation date: two different groups of orders divided by each other. Same two files |
| « **0** en cours » (sheet) · « **108** en cours » (list) · « **52** en cours » (edit) | **8** with Darb | three formulas: `agent-performance.ts:70` (`IN_FLIGHT_STATUSES = ["uploaded"]` only), `ProductRow.tsx:126` (upload events − delivered − returned), `products/[id]/edit/page.tsx:87` (current `status='uploaded'`). None uses the canonical `IN_FLIGHT_STATUSES` in `types/order-status.ts` |
| « 100 % des commandes réglées ont été livrées » | **55 %**: 77 delivered, 63 failed | a Darb-cancelled parcel is neither `returned` nor in flight: it vanished. Libya had **0** `returned` events in 30 days |
| Tab « Aujourd'hui » highlighted | data is 30 days | `components/shared/PeriodSelector.tsx:59` — `useState("today")`, never reads the `period` prop |
| Livraison 720 (72 × 10 LYD) | **1 816** billed by Darb (23.6 per parcel, 10–50 by city) | flat `carriers.delivery_fee`. Darb's invoice says « رسوم الشحن يتحملها المرسل » (borne by the sender) |
| Retours 0,000 | 0 — correct | owner: a failed Darb parcel costs nothing. Darb's `return_fee` of 5 LYD is wrong everywhere else it is used |
| Emballage 81 (162 confirmed × 0.5) | 78 (156 parcels that left × 0.5) | `lib/calculations/product-profitability.ts:90` charges packaging at confirmation |
| Chiffre d'affaires 18 077 | Encaissé **17 357** (paid 19 173 − Darb 1 816) | revenue included Darb's cut; plus 5 parcels Darb delivered are `cancelled` in Ordra |
| Profit net +3 789,808 | **+3 633** | sum of the above, on the cohort |
| Edit « Marge par livraison 198,500 » | **+47.2** after ads (184.4 before ads) | ignores ad spend (137 LYD per delivery) and uses the flat fee |
| Commandes 573 | **581** | 8 orders hold this product as a second line and were not counted |
| Stock 943 | never counted | 158 parcels left in 30 days, 56 were scanned out, no return scanned since 2026-08-18. `product_site_stock` has no count for any product |
| Agents: « 415 appels sur 143 commandes · 64 sur 253 traitées » | — | three vocabularies on one row; replaced by Salle de contrôle's (Assignées · Tentatives · Uploadées · Rejetées) |

**Not a bug, but visible:** Libya received no order after **Tue 29 Sept 17:30** and spent nothing on ads after the same day. The pages will say so plainly; the cause is outside Ordra as far as the data shows.

## 2. Beyond products — the Darb « cancelled » sync

`promote_darb_status` maps Darb `cancelled` to Ordra's terminal `cancelled` (`supabase/migrations/20260909134734_darb_status_model.sql:83`). Darb keeps working the parcel afterwards, and Ordra never hears about it. Across Libya, all time:

- **37** orders `cancelled` in Ordra are `completed` at Darb. **32** of them were already paid out: **7 571 LYD** of revenue Ordra does not count (6 120 on qr-01).
- **445** were handed back through Darb's returns desk (« رواجع جاهزة للتسليم » → `released`). That is a physical return the warehouse never scanned and stock never received.
- 273 parcels were cancelled by Darb after upload in the last 30 days alone.

Also: the `order_carrier_cost` view (`20260817141817_order_carrier_cost_view.sql:20`) LEFT JOINs every Darb shipment of an order. A re-sent parcel therefore yields two rows, and any SUM over the view double-counts.

**Coordination:** a parallel session (Transporteurs prototype, `prototypes/transporteurs-v1.html` in the main checkout) found the same root cause from the carrier side, and the owner gave it the same answers: failures cost nothing, returns come back. Both pages must share ONE definition of a failed parcel (§4) — build it once, in one module.

## 3. Owner's answers (2026-10-03) — binding

1. Darb sync: **fix it**, and prepare a **dry run** of the historical orders before anything is written.
2. Delivery cost: **delete the flat fee for Darb, app-wide**, and use Darb's invoice per parcel. Settled investor statements stay as they are. Tunisia keeps its flat fee until its carriers send invoices.
3. A failed Darb parcel **costs nothing**.
4. Revenue headline = **« Encaissé »** = paid by customers − Darb fee. The paid amount is shown as a smaller line.
5. Funnel **and** money on a **cohort**: orders received in the period, followed to today.
6. Mixed orders: **each product counts the order +1**. Revenue = that product's own line price. The parcel's Darb fee and packaging are **shared by line price**.
7. Packaging: **per parcel that leaves** the warehouse.
8. Confirmation rate: **Salle de contrôle's** — uploaded ÷ (uploaded + rejected).
9. Font: **whole app**, chosen in the prototype's live switcher.
10. List = **table with visual cells**. Sheet charts = **outcome flow + « où vont 100 د.ل »**.
11. Edit page = **tabs, one section at a time** (my recommendation was a single scroll; his call). **One save** for the whole product.

## 4. Definitions — one module, used by list, sheet, edit, Transporteurs

**Cohort.** An order belongs to the window when it was *created* in it. A product is in an order if it is `orders.product_id` or any `order_items.product_id`.

**Outcome of one order** (evaluated today, Darb's latest shipment status overriding Ordra's when Ordra says `cancelled`):

| Bucket | Rule |
|---|---|
| rejetée / supprimée / annulée | never uploaded, status `rejected` / `deleted` / `cancelled` |
| en appel | never uploaded, `pending`, `attempt_*`, `callback_scheduled` |
| à uploader | never uploaded, `confirmed`, `dispatch_scheduled` |
| **livrée** | uploaded, and `delivered` or Darb `completed` |
| **échouée** | uploaded, picked up by Darb (`assigned` timeline event), and ends `returned` / `to_be_returned` / `returning` / Darb `released` / `cancelled` |
| **chez Darb** | uploaded, in `IN_FLIGHT_STATUSES` (types/order-status.ts) |
| annulée avant envoi | uploaded, then cancelled / rejected / deleted before Darb picked it up |

**Rates.** Confirmation = uploaded ÷ (uploaded + rejected). Delivery = delivered ÷ (delivered + failed), flagged « provisoire » when more than 10 % of uploaded parcels are still with Darb. « Résultat définitif » = 1 − (en appel + à uploader + chez Darb) ÷ received.

**Money (cohort, delivered orders only).** Paid = Σ line share × `orders.total_price` (the order total is conserved, per the CLAUDE.md revenue rule). Darb = the billed amount of the order's *completed* shipment, else `orders.delivery_cost_quoted` (it equals the bill on 67 of 73 qr-01 parcels), else the 30-day market average, labelled; shared by line share. Encaissé = paid − Darb. Product cost = Σ unit cost × units. Packaging = `packing_cost` × parcels that left, shared by line share. Ads = `ad_spend` of the window. Net = Encaissé − product cost − packaging − ads.

**Stock cover.** Units that left in 30 days ÷ 30 = daily rate; cover = stock ÷ rate. The « à réapprovisionner » signal fires when cover < `supplier_lead_time_days` (default 14). Stock shows « Jamais compté » until `record_stock_count` has run for the product.

## 5. Decisions I made as the expert (veto them at review)

- **List**: Actifs / Inactifs / Tous + signal chips shown only when non-zero (à réapprovisionner, en perte, sans commande). Zero-count chips, « Marge faible » and the density menu are gone; sorting is by column header. KPI strip of five: reçues, confirmation, livraison, encaissé, profit net.
- **Sheet** order: header → period → 5 KPIs → outcome flow with « pourquoi elles se perdent » (rejection *groups* in red with their group icon, the badge rule; Darb `cancellation_cause` for failures) → money bar + ledger (period and per delivery) + two plain sentences (ad cost per delivery, break-even) → day-by-day small multiples on one time axis, no dual axis → agents → stock + agent sheet.
- **Agents table** groups by `orders.assigned_to` (Salle de contrôle's definition of ownership), not by "last confirmer" as `agent-performance.ts` does today.
- **Money format**: whole dinars in KPIs, one decimal per delivery, space grouping in both languages. `ar-LY` groups with a dot, so « 17.357 د.ل » reads as 17 dinars 357 dirhams.
- **Colour**: outcomes reuse the status hues (green delivered, red failed and rejected, teal with Darb, amber calling, grey deleted). Money reuses the §4.21 cost stack (Darb teal, product blue, packaging pink, ads orange, profit green). No new palette.
- **Edit** (tabs per his answer): Général · Prix & coûts · Variantes · Stock · Fiche agent. A tab with unsaved changes gets an amber dot; a tab with an error gets a red dot, and Save jumps to it (the old form refused tabs because a required field could hide; this is the mitigation). The rail holds a live per-delivery calculator (price − Darb average invoice − cost − packaging = before ads; − ads per delivery = net) plus the break-even. A market manager sees only « Fiche agent ».
- **Copy**: SKU hint drops "webhook"; packaging hint says « par colis qui part »; « COGS unitaire » becomes « Coût d'achat ».
- **Font**: default proposal Plus Jakarta Sans + IBM Plex Sans Arabic. IBM Plex Arabic ships weights up to 700; Noto Sans Arabic is loaded at 400–600 today, so Arabic bold currently renders at 600.

## 6. Build phases (start only after the prototype is approved)

Every phase: TDD, `npm run typecheck`, translate-first (fr + ar keys), px units (root font is 14px), screenshot pairs against the prototype on seeded local data, and RTL checked.

**Phase 1 — definitions + data layer.** A pure `src/lib/products/cohort.ts` (bucket an order, aggregate per product, rates, money) with tests per bucket and per rule in §3. One loader serving list, sheet and edit; an RPC if a 30-day window exceeds ~1.5 s. The loader replaces `lib/products/metrics.ts`, the product profitability route and the in-flight readers. `PeriodSelector` becomes controlled by its `period` prop. Shared with the Transporteurs work for the failure definition.

**Phase 2 — Darb real cost, app-wide.** One row per order: `order_delivery_cost` (completed shipment's bill → quote → null, with the average applied at read time). This also fixes the duplicate-shipment rows. Repoint `get_profitability_summary` / `_daily`, `/api/ad-spend/economics`, investor accrual (new statements only) and the dashboard. Darb carriers lose the delivery/return fee fields in settings. Prod DDL goes to the owner as paste-ready SQL with the `schema_migrations` INSERT (MCP `apply_migration` always declines here).

**Phase 3 — Darb sync + history dry run.** `promote_darb_status`: a Darb `cancelled` after pickup becomes non-terminal; `released`/`returned` land in the warehouse returns inbox (`to_be_returned`); `completed` promotes to `delivered` even from a Darb-driven cancellation. Then a dry run over the 482 historical orders: revenue added, stock that should come back, investor statements touched. **Nothing is written before the owner approves the dry run.**

**Phase 4 — font, app-wide.** `next/font` swap in `app/[locale]/layout.tsx` + `globals.css`, then a screenshot sweep of the main screens in fr and ar.

**Phase 5 — list. Phase 6 — sheet. Phase 7 — edit.** Copy the approved prototype exactly. Show one screen first (preview link), get a yes, then do the rest.

**Phase 8 — docs.** Cohort and money rules into `docs/business-logic.md`; the Darb cost model into `docs/darb-assabil-sync.md`; a one-line pointer in `CLAUDE.md`.

## 7. Verification

After Phases 1–3, recompute qr-01, DA2 and th-01 in SQL and compare with the API to the unit. These are the prototype's numbers: received 581 / 492 / 176; encaissé 17 357 / 22 427 / 7 343; net +3 633 / +12 292 / +3 390. Run the full suite against an `origin/main` baseline, since pre-existing failures exist there.

## 8. Risks and things to watch

- **P&L global, investors and Dépenses pub numbers will change** when Darb invoices replace the flat fee (≈ +13.5 LYD per delivered Libyan parcel). Settled investor statements do not move, so new and old periods will be on different cost bases; the statement should say so.
- 7 of 77 delivered qr-01 parcels have no completed-shipment bill yet; the quote is used and labelled.
- The cohort view moves until orders settle; « Résultat définitif » shows how far.
- Stock stays « Jamais compté » until someone counts. The page can only say so, not fix it.
- Prototype data: the agents, day-by-day, reasons and stock movements are loaded for qr-01 only.


## 9. Build log (2026-10-03 → 04)

### 9.1 What was built
- **Definitions.** `src/lib/products/cohort.ts` (buckets, counts, rates, cover, signals, agents, why),
  `src/lib/calculations/product-cohort.ts` (money, per delivery, break-even, cost shares, ads sentence),
  `src/lib/products/period.ts` (market-day periods; the lit pill is derived, never remembered),
  `src/lib/products/format.ts` (space thousands, comma decimals, LTR isolates). Reference: `docs/products-cohort.md`.
- **Shared parcel outcome.** `carrier_parcel_outcome` (`20261004090000`) — written by the Transporteurs
  session from §4's rules (two evidence-based refinements accepted: `released` behind a cancel is a failure
  even when Ordra still says out for delivery; pickup also counts at_carrier history for parcels older than
  the timeline mirror). Byte-identical in both PRs.
- **Read path.** `get_product_cohort` (`20261004100100`) → `lib/products/overview.ts` →
  `/api/products/overview` (list) and `/api/products/[id]/overview` (sheet, and the edit page's 30-day rail).
- **Screens.** `src/components/products/v6/*` — list, sheet (outcome flow SVG, money bar + ledger, day by day,
  agents, stock, agent sheet), edit (tabs with amber/red dots, one save bar with discard confirmation, live
  per-delivery rail, agent preview). Prototype CSS scoped under `.pv6`; `products.v6` i18n = prototype DICT.
- **Font.** Plus Jakarta Sans + IBM Plex Sans Arabic app-wide; Arabic pages set the Arabic face first.
- **Darb at its real price** (`20261004100000`, `…100200`): `order_delivery_cost`, `market_avg_delivery_cost`,
  `order_carrier_cost` rebuilt (one row per order, invoice → quote → average, Darb return 0, security_invoker),
  P&L summary/daily repointed, dashboard and carrier true cost fixed through the view, Dépenses pub on
  invoices, investor facts: failed Darb parcel = 0 and final, Réglages: no fee for a Darb account.
- **Darb sync** (`…100300`): cancel after pickup → returning; released behind a cancel → to_be_returned;
  `/api/darb-assabil/sync-market` keeps polling Darb-cancelled parcels.
- **Removed** (dead once the pages moved): the old list/sheet/edit components, `lib/products/metrics.ts`,
  `agent-performance.ts`, `list-filters.ts`, `calculations/product-profitability.ts`,
  `business-profitability.ts`, `PeriodSelector`, the `/api/products/list(+previous)`,
  `/api/products/[id]/agents`, `/api/products/[id]/profitability`, `/api/profitability/product/[id]` routes.

### 9.2 Deviations from the prototype and the plan, on purpose
- The prototype's dictionary defined `f_active` twice, so its filter tab read « Produit actif »; the app
  reads « Actifs » (the switch keeps « Produit actif » as `f_active_sw`).
- The prototype's Arabic flow-chart labels overlapped (tspans with dx in a right-to-left run); the app
  draws them as a left-to-right run anchored at its end.
- Styling is the prototype's stylesheet scoped under `.pv6`, not re-typed into Tailwind utilities
  (src/components/CLAUDE.md prefers Tailwind) — 311 rules re-typed by hand would drift from the spec.
- Variants keep their per-row save inside the Variantes tab (each size has its own stock); everything
  else on the edit page is one save.
- P&L global stays event-dated and keeps packaging per confirmation; only the price of a Darb delivery
  and return changed there. Moving the P&L to the cohort basis is a separate decision.
- The verification targets of §7 moved with live data (Darb kept updating parcels after the snapshot):
  on 2026-10-03 evening qr-01 was 77 delivered / 67 failed / 4 in flight, money unchanged.

### 9.3 Production SQL (the owner pastes it; `apply_migration` always declines here)
One file, four migrations, one transaction, `schema_migrations` rows included, a check at the end:
`…100000`, `…100100`, `…100200`, `…100300`. `20261004090000` is NOT in it: PR #65 merged and the
owner pasted it (seen in prod `schema_migrations` on 2026-10-04). The pages need it before the PR merges.

### 9.4 Darb « cancelled » history — dry run done, backfill NOT run
`supabase/scripts/darb-cancelled-history-dry-run.sql` on prod, 2026-10-03 (Libya, 595 orders Ordra closed
as cancelled after Darb took them): 476 → to_be_returned (95 406 LYD of orders, 485 units Darb handed
back), 38 → delivered (7 770 LYD, 32 already paid out), 40 → returning, 2 → delivery_delayed, 39 stay
cancelled. Three investor statements settled on 2026-08-18 (period 20 May → 31 Jul) cover some of them;
they do not move. `…-apply.sql` writes it in one transaction, un-archives the handed-back parcels into
Entrepôt › Retours, and drops the WhatsApp messages the status change would queue. Run it only on the
owner's word. 2026-10-04: its history rows are now dated at Darb's own event, not at the run — the
view takes a delivery's date from the first `delivered` row and the P&L books revenue on it, so a
row dated today would have put the 38 recovered deliveries (7 770 LYD) into October.
