# Commandes — rénovation « Aurore » de tout l'espace Commandes

Status: **BUILT 2026-10-04 from v4** (owner: "follow it exactly, remove the old"; panel for everyone, old deleted; one PR). Reference: docs/commandes.md. Earlier status: Phase 0 — prototype v4 (2026-10-04). Earlier: `commandes-v1/v2/v3.html`.
Worktree `.claude/worktrees/orders-redesign`, branch `feat/orders-redesign` (off origin/main 866c897).
Prototype: `prototypes/commandes-v1.html` — dummy data, FR + AR, top bar: Écran (Commandes · Archivées · Doublons),
Avant / Après (key B), Langue, « Ouvrir » (an order to call · confirmed · on the road · delivered · new).
URL: `?screen=list|archive|dup &lang=ar &before=1 &open=<réf> &create=1 &tile=un|re|se|to`.
« Avant » shows `prototypes/commandes-v1-avant/*.jpg`: the live page (origin/main) captured on the LOCAL test database —
no real customer — so the owner compares each change side by side.

## 1. What the owner asked

"Rebuild the orders page following the same design principles. For now, I like it how it is. I don't like too many
changes, but I would love your professional point of view. Ask me, don't assume anything. Mostly visual enhancements and
UX optimization. Simplicity, clarity, ease of use. Not information density."

| Question (2026-10-04) | Answer | My recommendation |
| --- | --- | --- |
| What does the rebuild cover? | **Whole Commandes area**: the list, the order panel's layout, Archivées, Doublons, « Nouvelle commande » | List only (panel untouched) |
| The numbers above the list | **Work shortcuts**: Non assignées · À rappeler · Confirmées à envoyer · Reçues aujourd'hui | same |
| One order row | **Same columns, signals in words**, age coloured only when late, « Source » → « Boutique » | same |
| Search and filters | **One calm line**: search + dates, then Statut · Agent · Boutique, the rest under « Plus » | same |
| Who gets the new panel | **Everyone, managers first**, agents about a week later | same |
| Inside the panel | **Same content, calmer** | same |
| Archivées | **A list to put finished orders away**; the analysis leaves (Performance › Commandes answers it) | same |
| Doublons | **One card per group**, the copies as rows | same |

## 2. What changes, screen by screen

**Commandes (list).**
- Header: « Commandes » (workbench H1 24/800) · market · « en direct ». The live dot replaces the bottom-right footer
  (« Temps réel » / « Reconnexion… »). The actions are unchanged: Exporter, Nouvelle commande.
- Four **work shortcuts**, all counted right now. Each one opens exactly the list it counts:
  - Non assignées: `pending` with no agent;
  - À rappeler: `attempt_1..3` + `callback_scheduled`, with the hint « dont N rappels en retard »;
  - Confirmées à envoyer: `confirmed`;
  - Reçues aujourd'hui: created today.
- Gone from this page:
  - the confirmation rate, Téléchargées, Rejetées and Livrées (each has its home in Performance › Commandes);
  - the « Pipeline » legend line;
  - the second total (« 1 748 au total »).
- **One line of search + the date button.** It is the same date button as Accueil and Performance, with « Toutes les
  dates » first. The search hint line is merged into the placeholder.
- **One line of filters:** Statut (call and delivery in one menu, two sections) · Agent · Boutique · Plus de filtres.
  « Plus » holds Ville, Produit, Transporteur and « Afficher les commandes supprimées ».
  - Each value shows its facet count.
  - Active filters show as one row of chips with « Tout effacer ».
  - The active shortcut is a chip too.
- **Rows:** one glass container holding plain white rows with hairlines and no motion. Columns are unchanged: Commande
  · Montant · Statut · Âge · Agent · Boutique · ⋯.
  - At most two tags, in words:
    - « Doublon ×2 », red with « · déjà envoyé » when a copy has already shipped;
    - « Déjà rejeté 2 fois » (AR « حساس · 2 مرفوض », the owner's own wording);
    - « Client fidèle · 3 livrées ».
  - The red dot that repeated « ⚠ 295 » is gone.
  - Status words are kept. Only these change:
    - `attempt_N` reads « Appel N/3 »;
    - `callback_scheduled` reads « Rappel 18:10 », or « Rappel en retard » in red;
    - a rejection shows its sub-reason with its group's icon, as today.
  - The age turns amber only while a human still owes the order something, and only past the SLA (2 h); it turns red
    past 24 h.
  - The **Boutique** column is the store's dot in its Accueil colour + name; the platform shows in the tooltip.
  - The presence ring on the assignee is kept.
- Pagination, page size, select-all, the bulk bar (Assigner ▾ · Envoyer au transporteur · Réouvrir · Annuler) and the
  row menu are unchanged. The bulk bar is white glass, never dark.

**Order panel.** Same sections in the same order, calmer. It is 600 px wide and opaque.
- Top line: status · « reçue … » · SLA chip when late · reference with copy · close.
- Client: the name on one line; the phone with copy and the reliability chip; « + Ajouter un 2e téléphone »; WhatsApp ·
  Appeler.
- Facts as quiet label/value lines instead of a boxed grid: Ville (« Non renseignée · Définir la ville ») · Adresse ·
  Total · Agent · Transporteur · **Boutique** (new line).
- Tabs on a soft track:
  - Articles: lines, add product, merge, totals;
  - Livraison: tracking number, « Chez Darb », a carrier timeline, or the carrier recommendation before upload;
  - Historique: a timeline;
  - Messages: the WhatsApp thread, **only here**.
- One short notice per problem, pinned above the footer: rupture de stock, ville manquante, a shipped copy, « Réouvrez
  la commande pour modifier ses détails. ».
- Footer per status: the call outcomes / Envoyer au transporteur / Fermer.

**Nouvelle commande.** The same drawer and the same fields (téléphone +218, nom, ville, adresse, note, boutique, produit,
variante, quantité, prix unitaire, total calculé + « Modifier le total »), in Aurore.

**Archivées.**
- Kept:
  - the auto-archive rule, made compact: « Ranger tout seul au bout de [30] jours » plus its one-line meaning;
  - the three tabs with counts (Prêtes à ranger · Déjà rangées · Encore récentes);
  - search, dates, Issue / Agent / Boutique filters;
  - the same rows and panel;
  - bulk « Ranger », and « Remettre dans Commandes » on Déjà rangées (the `unarchive` action already exists in
    `/api/orders/archive`).
- Gone: the five analysis blocks (« Ce que ça a donné », « Pourquoi on perd des commandes », « Commandes à rattraper »,
  villes, délais). A door points to Performance › Commandes.

**Doublons.**
- One card per group. The header has the client, phone and city, a confidence chip, « N commandes · écart … » and the
  differences (adresses, produits).
- The copies are rows, each marked one of three ways: « ★ Garder », ☑ Supprimer, or « Envoyée » (locked).
  ☆ moves the « Garder ».
- « Supprimer N copies » per group, « Fusionner » when the products differ, and the bulk « Supprimer la sélection ».
- High-confidence copies stay pre-ticked.

## 2b. v2 — the owner's adjustments (2026-10-04)

- **Doublons = duplicated orders + repeat buyers.** Same page, two large tiles: « Commandes en double » (unchanged group
  cards) and « Clients qui reviennent ». A returning customer is a phone with 2+ orders (a duplicate group counted once)
  and one order in the last 7 days.
  - One card per customer: name, phone and city; a reliability chip; counts (commandes · livrées · non livrées).
  - The **trail**: one pill per order, oldest to newest, coloured by outcome. Hover shows the details; a click opens the
    panel.
  - The orders still in progress, as rows.
  - « Voir ses N commandes dans la liste » searches Commandes by phone.
  - A risky customer with an order in progress gets « Confirmez l'adresse et l'intention avant d'envoyer ».
  - Sub-filters: Tous · À risque · Fiables.
  - Reliability: **À risque** = 2+ rejected/returned and more of them than delivered; **Fiable** = delivered and nothing
    lost; otherwise **Moyen**.
  - The list's « Déjà rejeté » / « Client fidèle » tags and the panel's chip read the same history, and their tooltips
    point to this view.
  - Build: one query of past orders by `customer_phone` (or `customers` id).
- **Deleted orders live in Archivées › Supprimées** (4th tab, count in the header, bulk « Restaurer » back to the call
  stage). The « Afficher supprimées » filter is gone from Commandes; « Plus de filtres » keeps a link to that tab.

## 2c. v3 — the owner's adjustments (2026-10-04)

- **Shortcuts, in this order:**
  1. Reçues aujourd'hui.
  2. Non assignées.
  3. À rappeler.
  4. **Téléchargées aujourd'hui** (orders sent to the carrier since midnight, whatever they became since). It replaces
     « Confirmées à envoyer ».
  The confirmed orders still waiting are not lost: the 4th tile's line says « + N confirmées à envoyer ». Build: count
  by the upload time (`order_history` → uploaded today), not by the current status.
- **« Doublons » is renamed « Clients récurrents »** (sidebar, page, tag tooltips). Both cases are the same client
  ordering more than once: by mistake (a duplicate) or because they came back.
- **New layout, one client at a time:**
  - four filter tiles: Tous les clients · En double · À risque · Fidèles;
  - left, the list of clients, newest first: name, summary, a mini trail of dots, ×N when duplicated, a reliability
    label;
  - right, the selected client:
    - a header with phone, city, address, reliability and « Voir dans Commandes »;
    - four numbers: commandes · livrées · refusées ou retournées · LYD payés;
    - a red note when they are at risk;
    - the duplicate block when there is one (Garder / Supprimer / Envoyée, « Supprimer N copies », « Fusionner »);
    - « Son parcours »: the trail of pills;
    - their orders « En cours ».
  - A first-time client with only a duplicate shows no numbers: there is nothing to judge yet.

## 2d. v4 — the owner's adjustments (2026-10-04)

- **Renamed « Commandes répétées »** (« repeated is much easier »). The page and sidebar are « Commandes répétées »,
  Arabic « الطلبات المتكررة ».
- **Tile order:** **Répétées** (default) · En double · À risque · Fidèles. « Tous » is gone, because Répétées is the
  overview.
- **« En double » is a cleanup screen, not a browse.** Deleting duplicates used to take one click per copy, client by
  client. Now:
  - A sticky bar at the top: « N copies cochées sur M », how many LYD of fake orders leave the numbers, « Tout cocher /
    Tout décocher », and one red **« Supprimer N copies »**. In the prototype, 6 copies go in one click.
  - **Sûrs** (same product, quantity and price within 24 h): every copy already ticked. Nothing to do but press the
    button.
  - **À vérifier:** one line per client, the copies side by side as small cards.
    - Click a card to tick it; Space or Enter does the same.
    - ★ keeps another copy instead.
    - ↗ opens the order.
    - One-click « C'est un doublon », « Fusionner » (different products) or « Pas un doublon » (the group never comes
      back).
  - A copy to delete shows struck through in red, the kept one in green, a shipped copy locked.
  - The kept copy is the first order, or the one already at the carrier.
  - Deleted copies go to Archivées › Supprimées and can be restored. The empty state says « tout est propre ».
  - Build: `ignored` needs a store (`duplicate_dismissals` or a flag on the group anchor). The bulk delete reuses the
    existing duplicate delete RPC in one call.

## 3. Bugs in the live page (origin/main), confirmed on the local DB

1. **« Non assignées » shows 14 but opens 347 orders.** The count is `pending` + no agent. The filter is « any status, no
   agent », so delivered orders come too. The new shortcuts share one predicate for the count and the list.
2. **The « Assignation » board can never open.** The tile sets `agentId = "unassigned"`, which makes
   `hasActiveFilterChips` true, which forces the table view (`OrdersPageClient.tsx` `boardActive`). Decision: drop the
   board and the view toggle; bulk assignment stays.
3. **The same filter shows as two chip rows** (« Non assigné » and « Agent : Sans agent ») with different words.
4. The market label reads « Libya » (English `markets.name`) for the super admin. This was already noted in Accès.

## 4. Decisions I made as the expert

- Default view (all orders, newest first), 25 per page, realtime, CSV export, bulk actions: unchanged.
- Status words and colours unchanged; only the pill shape changes (wash + 1 px edge, §4.19). « ☎ 1/3 » becomes
  « Appel 1/3 ».
- « Non assignées » opens the list; the dead board goes.
- The « Nouvelle commande » form keeps its fields.
- Workbench density per design-system §1.1: H1 24, hero numbers 26, glass on containers never on rows, no row motion,
  row hover = wash.
- Arabic numbers are bidi-isolated (« 1 679 » otherwise reads « 679 1 »).
- Store colours = the five validated Accueil hues + slate (see plans/dashboard-redesign.md §3), so one store has one
  colour everywhere.

## 5. Build notes (after approval, TDD)

- `/api/orders/status-counts`: add `toSend` (confirmed). Drop the windowed tiles and the confirmation-rate call from this
  page's fetch.
- Boutique filter: `storefront_id` in the list API (`?boutique=`), plus a facet count. The store accent colour comes from
  the `storefronts.accent_color` column proposed in the Accueil plan. Build it once, for both pages.
- Panel: layout changes in `components/queue/OrderDetailPanel/*`. The panel is shared with the agent queue, so the
  rollout goes behind a per-role switch: managers first, agents about a week later. Never two panels for good.
- Archivées: delete the analysis blocks and the summary fetch. Rule, tabs, list and `archive`/`unarchive` stay.
- Doublons: layout only; the RPCs and confirm dialog are unchanged.
- Px units, never rem (root font 14 px). Arabic is Noto Sans Arabic at 400/500/600.
- Delete `OrdersKpiStrip`, `OrdersViewToggle`, the AssignBoard path in the page, and the tests that pin the old look.
- Screenshot every prototype state next to the app on seeded local data before calling it done
  (`prototype-is-the-spec`).

## 6. Phases

0. Prototype review ← here. Revisions go to `commandes-v2.html`.
1. List page: shortcuts, the search + dates line, filters, rows, chips.
2. Order panel, behind the role switch.
3. Archivées.
4. Doublons.
5. « Nouvelle commande » skin.
6. Switch the agents' panel (+1 week).
7. Cleanup of dead components and old-look tests.

## 7. Risks I raised

- **The panel is the agents' working tool.** The owner chose to include it. Mitigated: same content and order, call
  outcomes in the same places, managers first.
- « Whole area » means four screens to review. The prototype's « Avant » makes each change visible, so the review can
  approve them one screen at a time.
