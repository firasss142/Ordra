# Finances — rebuild of the whole section in « Aurore » (2026-10-04)

Branch `feat/finances-redesign` (worktree `.claude/worktrees/finances-redesign`, off origin/main ddc61bd).

The owner asked to rebuild the six Finances pages from scratch — new structure, new design, new
layout — in the language of `prototypes/commandes-v4.html` (Aurore), simple and not dense. Produits
& marges keeps its structure and gets the new look; P&L global, Stock & inventaire, Achats and
Investisseurs are fully restructured after question rounds; for Dépenses pub I proposed approaches
as an expert and the owner chose. Prototypes use **sample data only** (owner's instruction: wireframe
purpose, no data-accuracy work), fictional names — the repo is public.

---

## Phase 0 — prototypes (gate: nothing in `src/` or `supabase/` before the owner says yes)

One self-contained file per page, FR desktop first (`.claude/skills/design` method). The sidebar's
Finances links point at the sibling files, so the section can be walked like the app.

| Page | File | Presets |
|---|---|---|
| P&L global | `prototypes/finances-pnl-v1.html` | `?m=2026-09` (closed month, default) · `?m=2026-10` (month in progress) · `?drawer=pub` |
| Produits & marges | `prototypes/finances-produits-v1.html` | `?screen=list\|sheet\|edit\|new` · `?fix=0` (all fixes off = new look only) |
| Stock & inventaire | `prototypes/finances-stock-v1.html` | `?win=7\|28\|90` · `?p=<product>` (drawer) |
| Achats | `prototypes/finances-achats-v1.html` | `?tile=pay\|settle\|po\|sup` · `?role=mm` · `?open=pay\|settle\|po\|sup-new` |
| Dépenses pub | `prototypes/finances-pub-v1.html` | `?p=<product>` (campaign drawer) · `?win=today\|7d\|30d` |
| Investisseurs | `prototypes/finances-investisseurs-v1.html` | `?inv=<key>` (investor drawer) |

Revisions go to `-v2` files, never overwrite. Arabic and phone come after the owner likes v1
(Achats first — Libyan managers read it in Arabic).

---

## The owner's answers (binding)

**Section**

- Market managers may open **Achats** (own market) + **Produits & marges as today** (no money).
  P&L, Stock, Pub and Investisseurs stay super_admin.

**P&L global**

- One question: **what I earned this month** — the month's result and where the money went.
- Basis: **delivered in the month** (accounting view; a closed month never moves; matches investor
  statements; differs from Produits & Pub, which follow orders received — the page says so).
- Bottom line: rename « Profit net » to **« Bénéfice brut »** for now. Commissions, fixed costs and
  the investors' share are *not* taken off yet ("I will look").
- Blocks under the hero (two at most): **Où est votre argent** + **Mois par mois**.

**Stock & inventaire**

- Job: **the money asleep in stock + what to rebuy**. Units, counts and movements stay in Entrepôt › Stock.
- Value: **shown as if it were right** (no trust level, no « estimé » badges) — *against my recommendation*.
- Reordering (bons de commande) **moves to Achats**; Stock says what to rebuy and links there.
- **One block per warehouse** (Tripoli, Benghazi) — *against my recommendation* (market total + split inside).
- Stock not yet attached to a building: **a small « pas encore dans un entrepôt » line** until counted.

**Achats**

- They buy **both** locally (printers, wholesalers) and by **import** (deposit up front, balance before
  shipping, weeks of transit).
- First question: **what I owe, to whom, by when** — with a « Payer » on each line.
- **All office work moves to Achats** (prices, invoice, landed fees, settling, payments, disputes).
  The dock (Entrepôt › Recevoir) only counts what arrived.
- Users: **owner + market managers**.

**Investisseurs**

- **1 to 3** investors → one card each, no search, no filters.
- Job: **follow how their money works** (per investor and per deal: capital, earned, trend).
- Deal kinds: **% of one product's profit** (today) + **fixed return = X % of the capital per month**.
- Payouts: **monthly by default**, the owner can change an investor's rhythm at any time.

**Dépenses pub**

- Build **level A (the product pilot) now, and start B's campaign capture at the same time**.
- The owner runs the ads himself, **every day in Ads Manager** → the page opens on today + 7 days.
- Opens on **one card per product with its verdict** (Augmenter / Garder / Réparer / Couper).
- Platforms: **Meta, TikTok, Snapchat** (Meta synced; TikTok CSV only today; Snapchat unsupported).

**Produits & marges**

- **New look on all four screens** (list, product sheet, edit, new) + **3–4 small fixes the owner can
  switch off one by one** in the prototype.

---

## Decisions I made as the expert

1. **One money vocabulary for the section**, written once and used by every page:
   - *Payé par les clients* = Σ `orders.total_price` of delivered orders (the only revenue field).
   - *Encaissé* = payé − frais transporteur (Produits' headline, unchanged).
   - *Coût des produits*, *Livraison*, *Pub*, *Emballage* = the four variable costs.
   - *Bénéfice brut* = payé − those four. Sub-label everywhere: « avant salaires et charges fixes »,
     because an accountant reads "brut" as sales − product cost only.
2. **One money palette** (validated with the dataviz `validate_palette.js`, light, adjacent pairs, all
   checks PASS), in this fixed order everywhere — legend, waffle, stacked bars:
   Produits `#2563eb` · Livraison `#0d9488` · Pub `#ea6a1f` · Emballage `#a855f7` · Bénéfice brut `#15803d`.
   The first three and the last are Produits v6's approved hues; **packaging changes from pink
   `#e87ba4` to purple** — the pink failed normal vision against the ads orange (ΔE 14.2) and
   colour-blind vision against the delivery teal (ΔE 4.2), at 2.6:1 contrast. Add as design-system
   §4.25 « Money categories » in the build phase.
3. **Basis is said on every page** in one chip: P&L « livrées dans le mois », Produits & Pub
   « commandes reçues, suivies jusqu'à aujourd'hui ». Two bases are legitimate; hiding which one is
   the bug.
4. **One market at a time, its own currency.** Tunisia is dormant (1 order in 90 days); no
   consolidated view, no FX. « Tous les marchés » shows a choose-a-market state, never a silent default.
5. **P&L period = calendar months** (the month button: this month in progress, every past month, a
   custom range). The month in progress is labelled « en cours » and hatched in the trend.
6. **« Où est votre argent » is TODAY, not the month**, and says « hors caisse et banque — Ordra ne
   les voit pas ».
7. **Achats is a workbench page with four work tiles** (like Commandes v4): À payer (default) ·
   À solder · En commande · Fournisseurs. Each tile opens its list; no long scroll of five bands.
8. **Import deposits live on the purchase order** (acompte, solde avant expédition) — the reason the
   payments model must change (see build impact).
9. **Pub verdict = two clocks.** Fast (48 h): cost per lead and confirmation of fresh leads → a
   *projected* cost per delivered order. Slow (truth): the product's finished cohort. Verdict from the
   projection against the most the product can afford per delivered order: ≤ 70 % Augmenter ·
   70–100 % Garder · 100–120 % Réparer · > 120 % Couper; fewer than 30 leads = « Trop tôt »; a
   finished cohort that contradicts the projection wins. Platforms are neutral labels, never colours.
10. **Investor identity colours** reuse the agent ramps (indigo, pink, cyan) — one colour per person
    everywhere on the page. A fixed-return deal always shows its **coverage**: the named product's
    bénéfice brut ÷ what you pay (« couvert 3,1× »), because on that deal the house carries the risk.
11. **The investor portal is out of scope** (its numbers will follow the fixed engine).

## Accepted risks (owner chose against the recommendation — build it faithfully, don't re-argue)

- **Stock value shown as if right.** Nothing has been physically counted; Tunisia never scanned out
  (overstated); Libyan returns are not scanned back (understated). The headline will be confident and
  partly wrong until counts happen. Mitigation inside the design: the product drawer shows « dernier
  comptage » as plain information (no warning colour).
- **One block per warehouse.** Per-site stock exists only for goods received or counted since
  2026-10-01; the rest sits in « pas encore dans un entrepôt » until each building is counted once.

---

## Shared sample data (every prototype uses these figures so the pages agree)

Market **Libye · LYD (د.ل)** · today **dimanche 4 octobre 2026, 17:20**.

**Catalogue** (fictional, same names as Commandes v4)

| key | Produit | Prix | Coût unitaire | Type |
|---|---|---|---|---|
| tad | Tadabbur | 210 | 62 | livre |
| mem | Mémoriser facilement | 180 | 48 | livre |
| mal | Le mal et le remède | 170 | 41 | livre |
| cor | Coran couleurs | 230 | 70 | livre |
| sac | Sac de frappe | 260 | 95 | sport |
| gan | Gants de boxe | 150 | 38 | sport |
| tap | Tapis de prière | 190 | 55 | maison |

**P&L — septembre 2026 (livrées dans le mois, mois clos)**: 452 commandes livrées · panier moyen 225 ·
**Payé par les clients 101 640** · Coût des produits 28 460 (28) · Livraison 11 180 (11, dont 1 240
estimés — facture Darb pas encore reçue) · Pub 34 560 (34; Meta 28 340 · TikTok 4 490 · Snapchat 1 730)
· Emballage 3 050 (3) · **Bénéfice brut 24 390 (24 sur 100)**. Août : payé 88 400, bénéfice 17 680 (20) → **+4 pts**.

**Mois par mois** (payé / bénéfice brut): oct. 25 21 400/2 140 · nov. 26 800/3 480 · déc. 31 200/3 120 ·
janv. 26 35 600/4 980 · févr. 41 900/6 290 · mars 47 300/6 150 · avr. 55 800/9 490 · mai 62 400/11 230 ·
juin 70 100/12 620 · juil. 79 600/15 920 · août 88 400/17 680 · sept. 101 640/24 390 · oct. (en cours,
4 j) 12 860/2 960.

**September by product** (livrées · payé · coût produits · livraison · pub · emballage → bénéfice brut):
tad 120 · 27 960 · 7 780 · 2 970 · 9 200 · 810 → **7 200** · mem 78 · 15 580 · 3 940 · 1 930 · 5 400 · 530 →
**3 780** · mal 64 · 12 070 · 2 740 · 1 580 · 6 300 · 430 → **1 020** · cor 52 · 13 270 · 3 830 · 1 290 ·
4 700 · 350 → **3 100** · sac 70 · 20 200 · 6 990 · 1 730 · 6 100 · 470 → **4 910** · gan 40 · 6 660 · 1 570 ·
990 · 1 900 · 270 → **1 930** · tap 28 · 5 900 · 1 610 · 690 · 0 · 190 → **3 410** · pub non rattachée −960.
Totals = the P&L line by line. Livraison by site: Darb Tripoli 8 120 · Darb Benghazi 3 060.
Break-even: a delivered order leaves 130 before ads (225 − 63 − 25 − 7); September's ads cost 76 per
delivered order → 54 left (= 24 390 / 452).

**Où est votre argent — aujourd'hui**: chez Darb (livré, pas encore versé) **18 240** (126 colis, le
plus ancien livré il y a 9 j) · dans les colis en route, au prix d'achat **7 860** (284 colis) · en stock,
au prix d'achat **61 240** · acomptes versés, marchandise pas encore arrivée **9 600** (2 bons d'import)
= **96 940** · dû aux fournisseurs **−14 700** · dû aux investisseurs **−6 125** → **net 76 115**.

**Stock** (units × unit cost; days = units ÷ units shipped per day over 28 days):
61 240 au prix d'achat · **≈ 58 jours de ventes** (from the per-product rates; Tripoli ≈ 59, Benghazi ≈ 46) · valeur de
vente ≈ 214 000 · se vend bien **46 570** · dort **8 345** · à liquider **6 325**.

- **Tripoli 38 960**: tad 210 u 13 020 · mem 140 u 6 720 · mal 95 u 3 895 · cor 60 u 4 200 (2,9/j → 21 j —
  300 en commande, arrivée ≈ 25 oct.) · sac 55 u 5 225 (1,9/j → 29 j — 160 en commande, arrivée ≈ 5 nov.,
  rupture possible le 2 nov.) · gan 80 u 3 040 (dort — dernière vente il y a 9 j, 0,2/j) · tap 52 u 2 860
  (à liquider — aucune vente depuis 61 j). Bien 33 060 · dort 3 040 · liquider 2 860.
- **Benghazi 17 880**: tad 60 u 3 720 (3,5/j → 17 j → **commander 250 = 15 500**) · mem 45 u 2 160 ·
  mal 71 u 2 911 (dort, 0,7/j → 101 j) · cor 30 u 2 100 · sac 20 u 1 900 (0,9/j → 22 j → **commander 60 =
  5 700**, import 45 j) · gan 63 u 2 394 (dort — aucune vente depuis 38 j) · tap 49 u 2 695 (à liquider —
  aucune vente depuis 70 j). Bien 9 880 · dort 5 305 · liquider 2 695.
- **Pas encore dans un entrepôt 4 400**: tad 20 u 1 240 · mem 30 u 1 440 · sac 10 u 950 · tap 14 u 770.

**Achats**: dû **14 700** à 3 fournisseurs (en retard 4 200 · cette semaine 6 100 · plus tard 4 400):

- Imprimerie Al-Nour **4 200** — REC-LY-2026-0031, Tadabbur ×300 reçus le 12 sept. à Tripoli, facture
  18 600, payé 14 400, échéance 22 sept. → **12 j de retard**.
- Guangzhou Sports Co. **6 100** — BC-LY-2026-0012 (Sac de frappe ×160, total 13 000), acompte 6 900
  payé, **solde avant expédition dû le 7 oct.** (dans 3 j), arrivée ≈ 5 nov. par mer.
- Dar Al-Kitab **4 400** — REC-LY-2026-0034, Le mal et le remède ×186 reçus à Benghazi (6 abîmés),
  facture 7 626, payé 2 980, **246 retenus — litige ouvert**, échéance 22 oct. (dans 18 j).
- À solder (3 arrivages from the dock, not priced yet): Tripoli 3 oct. · Cartons Libya · cartons ×2 000 +
  scotch ×100 (hors commande) · Tripoli 1 oct. · Imprimerie Al-Nour · Mémoriser facilement ×200 ·
  Benghazi 29 sept. · Dar Al-Kitab · Coran couleurs ×30.
- En commande (4 bons, 2 arrivent cette semaine): BC-0012 Guangzhou (above) · BC-0013 **Cairo Print
  House** (import, Égypte) Coran couleurs ×300 = 9 000, acompte 2 700 payé, solde 6 300 à l'expédition,
  arrivée ≈ 25 oct. · BC-0014 Imprimerie Al-Nour Tadabbur ×500 = 31 000 → Tripoli, **arrive le 8 oct.**,
  paiement 30 j après réception · BC-0015 Dar Al-Kitab Le mal et le remède ×300 → Benghazi, 186 reçus,
  **reste 114 attendus le 10 oct.**. Acomptes = 6 900 + 2 700 = **9 600**.
- Fournisseurs (5): Imprimerie Al-Nour (local · Tripoli · livres) · Dar Al-Kitab (local · Benghazi ·
  livres) · Guangzhou Sports Co. (import · Chine · sport) · Cairo Print House (import · Égypte · livres) ·
  Cartons Libya (local · Tripoli · emballage).

**Pub — 7 derniers jours** (dépensé · leads · coût par lead · livrées projetées pour 100 leads → coût
projeté par livrée · max par livrée = ce qu'il reste avant pub):
market **8 120** (Meta 6 650 · TikTok 1 060 · Snapchat 410; aujourd'hui 812) · 864 leads · **9,4** ·
41 % des leads frais confirmés · 13/100 → **72**, max **130** → Rentable.

- Tadabbur 1 900 · 280 · 6,8 · 16 → 43 · max 137 → **▲ Augmenter** (max par lead 21,9).
- Sac de frappe 1 500 · 150 · 10,0 · 14 → 71 · max 156 → **▲ Augmenter** (max par lead 21,8).
- Mémoriser facilement 1 200 · 120 · 10,0 · 12 → 83 · max 117 → **= Garder** (max par lead 14,0).
- Coran couleurs 1 000 · 104 · 9,6 · **7** (29 % confirmés vs 44 % d'habitude) → 137 · max 149 →
  **✎ Réparer** — the leads, not the price.
- Le mal et le remède 1 540 · 100 · 15,4 · 9 → 171 · max 114 → **▼ Couper** (max par lead 10,3).
- Gants de boxe 340 · 18 → **Trop tôt** (< 30 leads) · Tapis de prière 0 · 9 commandes sans pub → **Sans pub**.
- **640 non rattachés** to a product. Campaign capture (B): 64 % of yesterday's orders carry their
  campaign (Meta 72 %, TikTok 51 %, Snapchat 0 % — liens à taguer); verdict per campaign from ≈ 25 oct.

**Investisseurs**: 3 people, **75 000** confiés · gagné (mois clos) **17 885** · versé **11 760** ·
**à verser 6 125** (fin octobre).

- **Ahmed B.** (indigo) — 30 000 · Tadabbur · 40 % du bénéfice brut · 1 mai 2026 → 31 mars 2027 ·
  Tadabbur's bénéfice mai 3 100 · juin 3 900 · juil. 4 600 · août 5 300 · sept. 7 200 → his share
  1 240 · 1 560 · 1 840 · 2 120 · 2 880 = **gagné 9 640** · versé 6 760 · **à verser 2 880** · mensuel.
- **Salem K.** (pink) — 25 000 · **rendement fixe 5 %/mois = 1 250** · rattaché à Sac de frappe (bénéfice
  brut sept. 4 910 → **couvert 3,9×**) · 1 mai 2026 → 30 avril 2027 · gagné 6 250 · versé 5 000 ·
  à verser 1 250 · mensuel.
- **Hana M.** (cyan) — 20 000 · Coran couleurs · 35 % du bénéfice brut · 1 août 2026 → 31 juil. 2027 ·
  août 910 · sept. 1 085 = gagné 1 995 · versé 0 · **trimestriel** (the owner changed it — shows the
  option): next payout 31 oct. for août → oct.

---

## Page specs (what each prototype shows)

### P&L global — « Ce que vous avez gagné »
1. Header: crumb Finances › P&L global; H1; sub « Libye · ventes livrées en septembre 2026 » + chip
   « Mois clos · ne bougera plus » (or « En cours · jusqu'au 4 oct. 17:20 »); month button; Exporter.
2. **Hero card** — waffle of 100 dinars in the money palette + sentence « Sur 100 د.ل payés par vos
   clients, **24 vous restent**. »; Payé par les clients and Bénéfice brut (with « avant salaires et
   charges fixes ») as the two big figures, trend vs August; the five lines (amount, per 100, trend);
   hovering a line highlights its squares; clicking opens a drawer (by product / by platform / by carrier).
3. **Mois par mois** — 12 months + the month in progress: column per month (payé, faint) with the
   bénéfice brut inside it (green), value label on the bénéfice, margin per month under it; click a
   month = open it; the month in progress hatched.
4. **Où est votre argent** — today: what you have (Darb owes, parcels on the road, stock, deposits) vs
   what you owe (suppliers, investors); one proportional bar per line; the net; each line links to its page.
5. A one-line footnote on the basis, linking Produits & marges.

### Stock & inventaire — « L'argent qui dort »
1. Header + demand window (7 / 28 / 90 j) + « au prix d'achat ».
2. **Hero**: 61 240 en stock · ≈ 58 jours de ventes · valeur de vente ≈ 214 000; one bar: se vend bien /
   dort / à liquider (severity vocabulary: good / warn / bad with words).
3. **One block per warehouse** (Tripoli, Benghazi), side by side: value, days, the same 3-part bar,
   then « À racheter » (product, days left, suggested qty, budget, « Commander → » to Achats) and
   « Dort » (product, days without a sale, value).
4. The « pas encore dans un entrepôt » line (4 400 · 4 produits).
5. Product drawer: per-site units and value, 28-day sales, days of cover, dernier comptage (plain),
   « Commander », « Mouvements → Entrepôt ».

### Achats — « Ce que vous devez »
1. Header + « + Bon de commande » (primary) + « + Fournisseur ».
2. Four work tiles: **À payer 14 700** (default; « dont 4 200 en retard ») · **À solder 3 arrivages** ·
   **En commande 4 bons** (« 2 arrivent cette semaine ») · **Fournisseurs 5** (« 1 litige ouvert »).
3. À payer: due-date strip (En retard · Cette semaine · Plus tard) + one row per bill with Payer.
4. À solder: arrival groups from the dock → « Solder » drawer (supplier, line prices pre-filled from the
   order, landed fees, invoice total, gap → réclamer / payer quand même, due date).
5. En commande: one card per purchase order — progress ordered/received, import payment schedule
   (acompte payé, solde avant expédition), expected arrival; suggestions from Stock « à racheter ».
6. Fournisseurs: one card per supplier — local/import, owed, open orders, delivered complete, delay.
7. Role toggle Vous / Manager (managers see everything here — it is their page too).

### Dépenses pub — « Ce que rapporte la pub »
1. Header + window (aujourd'hui · 7 j · 30 j) + platform chips (Meta synced / TikTok CSV / Snapchat CSV)
   + Importer + Nouvelle dépense.
2. Summary strip: dépensé 7 j (platform split), leads, coût par lead, coût projeté par livrée vs max.
3. **One card per product** with its verdict, the fast clock (CPL vs max, confirmation of fresh leads,
   projected cost per delivered order, headroom), the slow clock (finished cohort: cost per delivered,
   bénéfice brut), a 14-day CPL sparkline against the max line.
4. Campaign capture strip (level B): share of orders with their campaign, per platform, « liens à taguer ».
5. Campaign drawer per product: campaigns / ad sets with platform, spend, share, leads, Meta's
   « achats » vs real, and the greyed « livrées par campagne » column filling from the capture date.
6. Non rattachés line → mapping.

### Investisseurs — « Comment travaille leur argent »
1. Header + « + Contrat » + « + Investisseur ».
2. Overview: confié 75 000 · gagné 17 885 · versé 11 760 · à verser 6 125 (fin octobre).
3. **One card per investor** (identity colour, halo): capital, gagné (ring of return on capital),
   next payout + rhythm (editable), their deals (% or fixed), and for a fixed deal its coverage.
4. Investor drawer: money curve (capital + gains, payout dots), deals, monthly statements, payments,
   change rhythm.
5. A small « À faire » line only when something needs the owner (relevés de septembre à valider).

### Produits & marges — same structure, new look
List, sheet, edit, new — Produits v6 restyled in Aurore. Switchable fixes (studio bar):
1. « Profit net » → « Bénéfice brut » (the section's word).
2. The « stock pas encore compté » banner removed (consistent with the owner's stock decision).
3. « à réapprovisionner » becomes « Commander → » to Achats, pre-filled.
4. A basis chip next to the period: « commandes reçues, suivies jusqu'à aujourd'hui ».

---

## Build impact (for the plan after the prototypes are approved — not started)

- **P&L**: rebuild on calendar months, event-dated (the RPCs already are); add the « Où est votre
  argent » loader — needs Darb **paid-out per parcel** (Darb flags parcels as paid out; wallet API
  exists — to verify), stock value, PO deposits, supplier and investor payables. Fix the dead
  « Personnalisé », the wrong « Taux retour · % du CA » label, the UTC days.
- **Stock**: per-site value from `product_site_stock` + the unassigned remainder; move the reorder dialog
  to Achats; one definition of engagé/libre shared with Entrepôt (they differ today).
- **Achats**: supplier payments decoupled from receptions (deposits on purchase orders; one payment
  for several deliveries); supplier create/edit UI; the settle flow moves from the reception sheet;
  per-page permission so managers reach Achats; fix the dock blocker (no way to record an arrival when
  nothing is open) and the two « reste à payer » definitions.
- **Pub**: verdict engine (two clocks, min sample, maturity); `orders` gets campaign/ad set/ad capture
  at intake (UTM through the storefront — to check what Converty/Sheets can pass); TikTok and Snapchat
  sync; fix the CSV USD-as-dinars bug and the confirmed-phase list.
- **Investisseurs**: fixed-return deal kind (X % of capital per month); per-investor payout rhythm;
  fix the three engine bugs (early-exit preview writes; closed deals double-count; deliveries after
  maturity never count).
- **Produits**: restyle + the four fixes; money palette update (packaging purple).
- **Design system**: §4.25 Money categories; retire §4.21 `--fin-*` / `--ads-*` once pages migrate.

## Open — the owner will come back to it

- What comes off after « Bénéfice brut »: commissions, fixed costs, investors' share.

## Round 2 — owner feedback (2026-10-05) and v2 prototypes

- **P&L global**: owner kept only « Mois par mois »; the waffle, the five lines, « Où est votre argent » and the drawers \"tell me nothing\". Asked for calm, clear visuals and a pipeline. `prototypes/finances-pnl-v2.html`: one answer (bénéfice brut + one sentence), a six-column cascade from « payé par vos clients » to « bénéfice brut », then Mois par mois unchanged. « Où est votre argent » is dropped from the page (open: does it live anywhere else?).
- **Dépenses pub**: owner prefers the information layout of the LIVE page (/finance/ad-spend). `prototypes/finances-pub-v2.html` keeps its order (chain → CPL bars | cost stack → table by product) in Aurore, plus: « ≈ attendu » for parcels still in transit, table 11 → 8 columns, same product order in bars and table (a bar opens its campaigns), « Trop tôt » under 30 leads, the finished cohort overrides the projection, a confirmation lever, per-platform sync health, one « Ajouter » menu, « Profit net » → « Bénéfice brut », and platform as a split of spend, never a filter on verdicts.

## Round 3 — 2026-10-05

- **Dépenses pub v3** (`prototypes/finances-pub-v3.html`): \"previous design\" meant the LIVE page look (flat white cards, grey ground: AdSpendEconomics / ad-spend-v3), not the Aurore prototypes. v3 copies it exactly with sample data plus small fixes: products without spend fold into one line in the bars; « Trop tôt » under 30 leads; period switch and cohort maturity in the header; « + N en route » under delivered; clicking a bar opens that product in the table; sticky Produit and Verdict columns; every verdict explains itself on hover; a platform tag on each campaign; a sync strip for Meta, TikTok and Snapchat; « Profit net » → « Bénéfice brut ».
- **P&L global v3** (`prototypes/finances-pnl-v3.html`): the v2 column cascade was \"not clear\". It is replaced by one pipe: money paid comes in on the left, each cost leaves as a downward stream in its own colour, and what reaches the right end, in green, is the bénéfice brut. The pipe is always the same thickness (the 100 dinars paid), so months compare at a glance. Mois par mois is unchanged.
