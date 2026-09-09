# Entrepôt Libye — refonte du flux Darb Assabil (sites, statuts, scannés, garde-sticker)

> Copie durable : `plans/warehouse-darb-workflow-rebuild.md` à l'implémentation.

## Context

Le poste entrepôt libyen a été branché sur Darb Assabil en trois vagues successives
(scan-out, retours en file, gardes de scan) et chaque vague a laissé un morceau du
flux réel non modélisé. L'audit du 2026-09-09 — code, migrations et **données de
production** — trouve six manques qui coûtent de l'argent ou du stock aujourd'hui :

1. **Le colis disparaît après le scan.** `scanned` n'a aucune liste, aucune reprise,
   aucun retour arrière. La seule marche arrière est `manual_delete_orders`, qui tue
   la commande. Sur les 20 colis scannés le 8 septembre, **8 ont un problème visible
   en base et invisible à l'écran** (voir §Preuves).
2. **Le sticker n'est pas vérifié.** La liaison est un `PATCH` dont on ne lit que
   l'accusé. Le sticker `1633019` (commande `4622d937`) a répondu OK et Darb tient
   toujours `SH2171145` : le colis est parti avec un numéro que Darb ne connaît pas.
3. **Darb re-stickerise à la réception.** Les 7 colis Sebha/Koufra du 8 septembre
   portent aujourd'hui un numéro Darb différent du nôtre. Notre `carrier_sticker_ref`
   ment, et c'est le champ sur lequel le banc retrouve un retour.
4. **`scanned` est un trou noir de 6 statuts.** `booked`, `processing`, `on-branch`,
   `released`, `resent`, `delayed` ne changent rien chez nous. Une commande reste
   « Scannée » de la remise jusqu'à la livraison. `/in-delivery` ne voit aucun colis
   Darb — c'est pour ça qu'il a fallu lui construire une salle de contrôle à part.
5. **Deux entrepôts physiques, un seul stock.** Tripoli et Benghazi ont chacun leurs
   agents et leurs rayonnages ; `products.current_stock` est un total marché. Un
   scan à Benghazi décrémente le stock de Tripoli.
6. **Sept écrans manager pour trois questions**, dont deux orphelins de la
   navigation, treize composants morts et treize sous-espaces i18n morts.

Résultat visé : un banc qui dit la vérité sur chaque colis de la préparation à la
remise, un stock par site, des statuts qui suivent Darb, et une section manager en
trois onglets.

## Preuves (production, 2026-09-09)

| Fait | Chiffre |
|---|---|
| Colis `scanned` en attente de Darb | 20 — **tous** compte Benghazi |
| dont sticker confirmé par Darb | 12 |
| dont **re-stickerisés par Darb** à la réservation | **7** (Sebha, Koufra) |
| dont **jamais enregistrés** chez Darb | **1** (`1633019`, ref reste `SH2171145`) |
| Délai scan → `booked` chez Darb | ~17 h (08/09 17 h → 09/09 10 h) |
| Commandes LY `uploaded` mises de côté, sans écran | 84 (42 Tripoli + 42 Benghazi) |
| Commandes `uploaded` Dexpress mortes | 323 |
| Commandes annulées chez nous mais **`released` chez Darb** | 108 |
| Retours historiques sans crédit de stock | 103 (rapport déjà écrit) |
| Fichiers source lisant `products.current_stock` | 51 · fonctions SQL : 32 |

## Décisions prises avec l'utilisateur

| Question | Décision |
|---|---|
| Entrepôts | **Deux sites physiques** (Tripoli, Benghazi), agents et stock propres |
| Stock | **Par site, à côté du total marché** — le total reste la somme des sites |
| Statuts | **Nouveaux statuts calqués sur Darb** : `at_carrier`, `out_for_delivery`, `delivery_delayed`, `returning` |
| Après le scan | **Liste + dé-scan pour les agents** (et managers), re-liaison au transporteur |
| Garde-sticker | **Vérifier la liaison chez Darb** + **confirmation par photo produit** (pas d'imprimante, pas de code-barres) |
| IA manager | **3 onglets** : Banc · Retours · Stock |

---

## P0 — La vérité avant la beauté

Rien de visuel. Ce que le banc affiche doit d'abord être vrai.

### Migrations

`supabase/migrations/20260922000001_scan_rpc_hardening.sql`
- `inventory_log.reason` → `CHECK` sur le vocabulaire réel (`initial_stock`,
  `scanned`, `returned`, `damaged_writeoff`, `received_back`, `manual_adjustment`,
  `stock_count`, `manual_delete_reversal`, `deposit` hérité) **+ `scan_reversal`**.
- Triggers `BEFORE UPDATE OR DELETE` append-only sur `inventory_log` et
  `order_history` (aujourd'hui seule l'absence de policy RLS les protège ; le
  `service_role` et tout `SECURITY DEFINER` peuvent les réécrire). Modèle :
  `trg_investor_ledger_append_only` (`20260819000002:257`). `scripts/wh-test-fixture.ts`
  attend déjà de devoir en désactiver un.
- `auth.uid() = p_actor_id` dans `scan_order_out`, `scan_return_in`,
  `scan_received_in`, `record_stock_count` (exemption `service_role`), modèle
  `manual_delete_orders` (`20260520181559:41-44`).
- Codes SQLSTATE nommés à la place du texte : `scan_order_out` lève
  `USING ERRCODE='P0001', DETAIL='{"code":"GONE_AT_CARRIER",...}'`. `classifyRpcError`
  (`src/app/api/warehouse/scan-out/route.ts:61-91`) lit `DETAIL`, plus le message.
- `carriers_carrier_type_check` : élargir à `darb_assabil`, `cosmos` (ou supprimer).

`supabase/migrations/20260922000002_sticker_bind_state.sql`
- `orders.sticker_bind_state TEXT` `CHECK IN ('confirmed','restickered','not_registered','unknown')`
  + `orders.sticker_bind_checked_at TIMESTAMPTZ`.
  **Persisté, pas calculé** : la liste des scannés doit filtrer et trier dessus, et
  `darb_shipments` n'a de ligne que pour les envois appariés — un colis « jamais
  enregistré » est précisément celui qui n'a pas de miroir fiable.
- RPC `record_sticker_bind_state(p_order_id, p_state, p_darb_reference, p_checked_at)`
  `SECURITY DEFINER` (la policy UPDATE de `orders` n'a **aucun bras warehouse_agent** —
  même raison que `cache_darb_shipment_ref`).

### Serveur

- `src/lib/carriers/darb-assabil-reference.ts` : `verifyDarbReference(internalId, sticker, config)`
  → `GET /api/local/shipments/{_id}`, compare `data.results[0].reference` au sticker.
  Retourne `{verified, actualReference, rawStatus}`. Ne lève jamais.
- `src/app/api/warehouse/scan-out/route.ts` : après un `bindDarbReference` réussi,
  **vérifier avant de committer**. Non vérifié → `error_code: "BIND_UNVERIFIED"`,
  HTTP 409, `darb_bound: true`, **aucun `scan_order_out`**. L'ordre reste : Darb
  d'abord, commit ensuite (le raisonnement de l'en-tête du fichier tient toujours).
- `src/lib/preparation/scan-outcome.ts` : cinquième issue `bind_unverified`
  (ambre comme `bound_not_committed`, message propre : « Darb a accepté puis n'a pas
  gardé le numéro. Ne remettez pas ce colis. »).
- `src/lib/carriers/darb-sync-cycle.ts` : à chaque passage, pour toute commande
  `scanned`/`at_carrier`, comparer `p.reference` à `orders.carrier_sticker_ref` et
  appeler `record_sticker_bind_state` (`confirmed` | `restickered` | `not_registered`).
  Un `restickered` **met aussi à jour `tracking_number`** — ce que `promote_darb_status`
  fait déjà — donc `find_return_by_code` (`20260823000005:113`) retrouve le colis par
  le nouveau numéro sans changement.

### Tests d'abord

| Fichier | Assertion |
|---|---|
| `src/lib/carriers/__tests__/darb-assabil-reference.test.ts` | `verifyDarbReference` : référence égale → vérifié ; différente → non vérifié + `actualReference` ; envelope `status:false` → non vérifié |
| `src/app/api/warehouse/scan-out/route.test.ts` | liaison OK + vérif KO → 409 `BIND_UNVERIFIED`, `scan_order_out` **non appelé**, `darb_bound:true` |
| `src/lib/carriers/darb-sync-cycle.test.ts` | référence Darb ≠ sticker → `record_sticker_bind_state('restickered')` ; ref `SH…` → `not_registered` |
| `src/lib/preparation/__tests__/scan-outcome.test.ts` | `bind_unverified` mappe sur sa clé i18n |

### Vérification

```bash
npm run typecheck && npx vitest run src/lib/carriers src/app/api/warehouse/scan-out
node scripts/darb-sandbox.mjs   # mode `silent-bind` (nouveau, cf. P5)
```
Puis en production : `SELECT sticker_bind_state, count(*) FROM orders WHERE status='scanned' GROUP BY 1;`
→ attendu `confirmed 12`, `restickered 7`, `not_registered 1`.

---

## P1 — Deux sites, deux stocks

Le total marché reste la vérité pour la finance (51 fichiers, 32 fonctions). Les
lignes par site s'ajoutent à côté et **doivent sommer au total** — invariant vérifié
par trigger, pas par convention.

### Migrations

`20260922000010_warehouses.sql`
```
warehouses(id, market_id → markets, code, name_fr, name_ar,
           is_default BOOLEAN, is_active, created_at, updated_at)
UNIQUE (market_id, code) · UNIQUE (market_id) WHERE is_default
```
Seed : `ly/tripoli`, `ly/benghazi`, `tn/tunis` (défaut).
Colonnes : `users.warehouse_id`, `carriers.warehouse_id`, `orders.warehouse_id`
(toutes `NULL`-ables, FK `warehouses`).
Rattachement : carrier Tripoli → site Tripoli, carrier Benghazi → site Benghazi,
carriers TN → site Tunis. **Le site d'une commande = le compte Darb sur lequel elle
est montée** — écrit par `dispatch_order`, effacé par `delete_carrier_barcode` et
`reopen_order`. Les commandes `fulfil_from_carrier_warehouse=true` **n'ont pas de
site** : la marchandise est chez Darb, pas sur nos rayonnages.

`20260922000011_product_site_stock.sql`
```
product_site_stock(product_id, warehouse_id, current_stock, damaged_return_count,
                   last_counted_at, updated_at)  PK (product_id, warehouse_id)
inventory_log.warehouse_id → warehouses
```
Backfill : une ligne par (produit actif, site du marché) à 0 ; le total marché
n'est **pas** réparti automatiquement — la répartition vient du comptage physique
d'ouverture (ci-dessous). Trigger `trg_product_site_stock_matches_total` : après
chaque écriture, `SUM(product_site_stock.current_stock) = products.current_stock`,
sinon exception. Il ne se déclenche que pour les produits qui ont au moins une
ligne de site, donc la Tunisie non migrée reste intacte.

`20260922000012_site_aware_stock_rpcs.sql` — une transaction déplace **les deux**
compteurs :

| RPC | Changement |
|---|---|
| `scan_order_out` | `+ p_warehouse_id` résolu depuis `orders.warehouse_id` ; refuse si l'agent n'est pas de ce site (manager/SA exemptés) ; `−qty` sur la ligne de site **et** sur le total ; `inventory_log.warehouse_id` renseigné |
| `scan_return_in` / `scan_received_in` | `+qty` sur le site de la commande ; `damaged_return_count` par site |
| `record_stock_count` | signature `(p_product_id, p_warehouse_id, p_counted_qty, p_actor_id, p_note)` — **le comptage est par site**, le total marché est ajusté du même delta |
| `adjust_product_stock` | `+ p_warehouse_id` (obligatoire quand le produit a des lignes de site) |
| `manual_delete_orders` | la restauration depuis `scanned` recrédite le site |

`20260922000013_site_stock_reads.sql` : `get_low_stock_products`,
`get_product_stock_series`, `get_count_accuracy`, `/api/warehouse/stock` prennent
`p_warehouse_id` optionnel ; sans lui, ils rendent le total marché — **aucun appelant
existant ne casse**.

### Serveur / UI

- `src/lib/warehouse/scope.ts` : `resolveWarehouseScope` rend aussi `warehouseId`
  (site de l'agent ; pour un manager, un filtre explicite `?warehouse_id=`).
- Users admin (`src/app/[locale]/(dashboard)/users/UsersPageClient.tsx`) : un select
  « Entrepôt » visible pour le rôle `warehouse_agent`. `adel` et `tarek` doivent être
  affectés avant la mise en service.
- `WarehouseStockClient` : colonne « Site » et filtre ; le comptage écrit sur le site.
- RLS : `product_site_stock` lisible par le marché (même forme que
  `inventory_log_select`, `20260921000002`), écriture service_role/RPC seulement.

### Mise en service (ordre obligatoire)

1. Affecter les deux agents à leur site.
2. Comptage physique par site (`record_stock_count`) pour chaque produit actif LY —
   c'est **ce comptage** qui pose la répartition, pas une estimation.
3. Le trigger d'invariant n'est armé qu'après le dernier comptage.

### Tests d'abord

`src/lib/warehouse/__tests__/scope.test.ts` (site de l'agent, override manager),
`src/app/api/warehouse/stock/route.test.ts` (filtre site, total sans filtre),
`src/app/api/warehouse/scan-out/route.test.ts` (agent d'un autre site → 409
`WRONG_SITE`), plus un test SQL de l'invariant via le fixture.

---

## P2 — Les statuts que Darb dit réellement

### Correspondance retenue

| Slug Darb | `orders.status` | Libellé fr / ar |
|---|---|---|
| `pending` | (inchangé) `uploaded` | Téléchargé |
| `booked`, `processing` | **`at_carrier`** | Remis à Darb / تم التسليم لدرب السبيل |
| `on-branch` | `in_transit` | En transit |
| `released`, `resent` | **`out_for_delivery`** | En cours de livraison / خرجت للتوصيل |
| `delayed` | **`delivery_delayed`** | Livraison retardée / مؤجلة |
| `returning` | **`returning`** | En cours de retour — **non recevable au banc** |
| `returned` | `to_be_returned` | À retourner — recevable |
| `completed` | `delivered` | Livré |
| `cancelled` | `cancelled` | Annulé (transporteur) |

`dispatched` et `deposit` restent pour la Tunisie. `received` (issue « réexpédier »)
cesse d'être un cul-de-sac : **`received → confirmed`**, la commande repart à l'agent
pour un nouvel envoi (le stock a déjà été recrédité par `scan_received_in`).

### Migrations (deux fichiers — règle Postgres)

`20260922000020_order_status_darb_values.sql` — **uniquement** les quatre
`ALTER TYPE order_status ADD VALUE IF NOT EXISTS`. Une valeur d'enum ne peut pas
être utilisée dans la transaction qui l'ajoute (précédent : `20260601000001/2`).

`20260922000021_darb_status_model.sql`
- `promote_darb_status` : la table ci-dessus ; `v_in_flight` devient
  `uploaded, scanned, at_carrier, in_transit, out_for_delivery, delivery_delayed,
  dispatched, deposit, returning`. Un retour en arrière du transporteur
  (`out_for_delivery` → `at_carrier`) est **ignoré** : on ne recule pas un statut.
- `transition_order_status` : bras `scanned → at_carrier|deleted`,
  `at_carrier → in_transit|out_for_delivery|delivery_delayed|returning|to_be_returned|delivered|cancelled`,
  `out_for_delivery ↔ delivery_delayed`, `returning → to_be_returned|returned|cancelled`,
  `received → confirmed`.
- `fulfill_order_transition` (graphe concurrent hérité, `20260421_warehouse_rpcs.sql`)
  est **vivante** : `src/lib/orders/fulfillment.ts:25` l'appelle pour trois surfaces —
  `/api/orders/[id]/fulfillment` (le menu de statut du manager), le webhook Navex
  (Tunisie) et `src/lib/carriers/polling/poller.ts`. Son graphe ignore `unverified`,
  `received` et les quatre nouveaux statuts, et elle **applique du stock sur
  `returned`**, ce qui double-crédite avec `scan_return_in`.
  → `applyFulfillmentTransition` est **repointée sur `transition_order_status`**, puis
  `fulfill_order_transition` est supprimée. Conséquence assumée à annoncer : un manager
  qui force `to_be_returned → returned` depuis la console **ne crédite plus le stock** —
  c'est la règle d'intégrité du CLAUDE.md (le stock ne bouge que par les trois chemins
  de scan), et c'est ce qui supprime le double-crédit.
- `get_warehouse_day_stats` : « remis » = `status_to='at_carrier'` (aujourd'hui
  `dispatched`, jamais atteint en Libye → la case est à zéro depuis toujours).
- `get_warehouse_queue_stats` : `to_hand_over` = `scanned` (inchangé),
  nouveau `at_carrier` compté à part.

### TypeScript — une seule source

`src/types/order-status.ts` :
- ajouter les quatre valeurs et `new` (aujourd'hui absent → `canTransition('new', …)`
  **lève**) ;
- corriger `uploaded` (SQL n'autorise plus `delivered`/`returned`/`cancelled`) et
  ajouter le bras entrepôt-transporteur ;
- exporter **`CARRIER_PHASE_STATUSES`** et **`IN_FLIGHT_STATUSES`**, et faire lire
  ces constantes par les 14 listes qui les recopient aujourd'hui :
  `src/lib/orders/{sla,list-filters,status-presentation}.ts`,
  `src/lib/order-status-tone.ts`, `src/components/orders/OrdersFacetBar.tsx`,
  `src/lib/calculations/business-profitability.ts`,
  `src/lib/investors/facts/order-facts.ts`, `src/lib/cross-market-metrics.ts`,
  `src/app/api/warehouse/carrier-tracking/route.ts` (`PHASE_2_STATUSES`),
  `src/lib/agent-queue/buckets.ts` (qui ignore aussi `to_be_returned` dans
  `bucketFor` — corriger), `src/lib/carriers/polling/status-map.ts`,
  `src/lib/carrier-webhook-engine.ts`, `src/app/api/in-delivery/summary/route.ts`.
- `src/lib/order-engine.ts::validateTransition` (quatrième table) : supprimée au
  profit de `canTransition`.

i18n : `orders.statuses.{at_carrier,out_for_delivery,delivery_delayed,returning}`
dans `fr.json` et `ar.json`, plus les icônes/teintes dans `status-presentation.ts`
(phase transporteur = teal, `delivery_delayed` = ambre).

### Retours entrepôt-transporteur

Une commande `fulfil_from_carrier_warehouse=true` n'a jamais touché nos rayonnages.
Elle est **exclue de la file du banc** et fermée automatiquement
`to_be_returned → returned` sans mouvement de stock, note système, comptée à part
dans les stats retours. *(Hypothèse retenue faute de question posée ; une ligne existe
aujourd'hui dans la file LY.)*

### Backfill (une fois, après la migration)

`SELECT promote_darb_status(id, carrier_status_slug, tracking_number)` pour toute
commande LY en vol dont le slug est connu. Effet attendu immédiat : les 20 `scanned`
deviennent 17 `at_carrier` + 2 `delivery_delayed` + 1 reste `scanned` (celui que Darb
ne connaît pas).

### Tests d'abord

`src/types/__tests__/order-status.test.ts` (nouveau : chaque valeur a un bras, aucune
n'est orpheline, `received` sort), `src/lib/agent-queue/__tests__/buckets.test.ts`
(les quatre nouveaux statuts tombent dans le bon seau),
`src/lib/carriers/darb-sync-cycle.test.ts` (chaque slug → statut cible ; recul ignoré),
`src/lib/investors/facts/__tests__/order-facts.test.ts` (les nouveaux statuts comptent
comme en vol, pas comme livrés).

---

## P3 — La liste des scannés, la re-liaison, le dé-scan

C'est le manque que vous avez signalé en premier.

### Migration `20260922000030_scanned_list_and_unscan.sql`

```sql
get_scanned_orders(p_market_id UUID, p_warehouse_id UUID DEFAULT NULL,
                   p_limit INT DEFAULT 100,
                   p_cursor_created_at TIMESTAMPTZ DEFAULT NULL, p_cursor_id UUID DEFAULT NULL)
-- statut IN ('scanned','at_carrier'), archived_at IS NULL
-- rend : identité client, produit + quantité, carrier_sticker_ref, tracking_number,
--        carrier_status_slug, sticker_bind_state, sticker_bind_checked_at,
--        branch_group, warehouse_id, carrier_id, scanned_at (inventory_log),
--        scanned_by, heures depuis le scan
```

```sql
unscan_order(p_order_id UUID, p_actor_id UUID, p_note TEXT DEFAULT NULL) RETURNS json
```
Gardes, dans l'ordre : acteur = `auth.uid()` · rôle ∈ (warehouse_agent, market_manager,
super_admin) · même marché · **même site** (manager/SA exemptés) · `status='scanned'`
· `carrier_status_slug` ∈ (`pending`, NULL) — **un colis que Darb a déjà réservé ne
se dé-scanne pas**, il se traite chez Darb.
Effets : `+qty` sur la ligne de site et sur le total · un `inventory_log`
`reason='scan_reversal'` · `orders.status → 'uploaded'`, `carrier_sticker_ref → NULL`
(le numéro est brûlé, il reste dans la note d'historique) · un `order_history`
`scanned → uploaded`, note « Dé-scan · sticker 1633019 · <motif> ».
Le bras `scanned → uploaded` est ajouté à `transition_order_status` **et** à
`TRANSITIONS`.

### Routes

| Route | Verbe | Corps | Réponse |
|---|---|---|---|
| `/api/warehouse/scanned` | GET | `?warehouse_id&limit&cursor` | page + compteurs par état de liaison |
| `/api/warehouse/unscan` | POST | `{order_id, note}` | `{status, stock_after, sticker_released}` |
| `/api/warehouse/rebind` | POST | `{order_id, sticker_ref}` | re-`PATCH` + vérification + `record_sticker_bind_state` ; ne touche ni le stock ni le statut |

### UI

- **Agent** (`src/components/warehouse/bench/BenchHome.tsx`) : `SegmentedTabs`
  (`src/components/ui/SegmentedTabs`) en tête du banc — **À préparer · Scannés ·
  Remis à Darb**. Pas de cinquième onglet en bas.
- Nouveau `src/components/warehouse/bench/ScannedList.tsx` + `ScannedCard.tsx` :
  photo produit, client · ville, sticker en chiffres tabulaires, pastille d'état de
  liaison (vert « confirmé » · ambre « Darb a changé le numéro : 1279049 » · rouge
  « jamais enregistré »), âge depuis le scan. Actions par ligne : **Revérifier**,
  **Re-lier** (ouvre la feuille de scan en mode re-liaison), **Dé-scanner** (feuille
  de confirmation avec l'effet de stock annoncé, motif obligatoire).
- **Manager** : même liste dans l'onglet Banc (P5), colonnes desk + filtre site +
  export CSV.
- i18n : nouveau sous-espace `warehouse.scanned.*` (fr + ar), et
  `warehouse.scan.errBindUnverified`.

### Tests d'abord

`src/components/warehouse/bench/__tests__/ScannedList.test.tsx` (les trois états de
liaison rendus, dé-scan masqué quand Darb a réservé),
`src/app/api/warehouse/unscan/route.test.ts` (slug `booked` → 409 ; site étranger →
409 ; succès → stock rendu + sticker libéré),
`src/app/api/warehouse/scanned/route.test.ts` (isolation marché, curseur).

---

## P4 — La feuille de scan confirme le colis

Sans imprimante et sans code-barres, le seul témoin disponible est **la photo du
produit**, déjà attachée à chaque ligne (`src/lib/warehouse/product-images.ts`,
commit `ca17b3f`).

`src/components/warehouse/bench/ScanSheet.tsx` — un pas de plus avant la caméra :

```
┌───────────────────────────────┐
│  [photo produit 160px]        │
│  دميه ملاكمه حجم صغير × 2       │  produit + quantité, 17px
│  محمد علي · طرابلس              │  client · ville
│  ▌ الرولة الحمراء        [TR]  │  bande couleur + plaque
│  [   هذا هو الطرد — تأكيد    ]  │  48px, primaire
│  [ رجوع ]                      │
└───────────────────────────────┘
```
La caméra et le champ numérique n'apparaissent **qu'après** ce tap. Le tap est
enregistré en état local (`confirmedFor: orderId`) et réinitialisé à chaque
changement de colis en main. Une préférence `readScannerPrefs().skipPhotoConfirm`
(défaut `false`) reste possible pour un agent aguerri, réglable dans Réglages.

Tests : `ScanSheet.test.tsx` — la caméra n'est pas montée avant confirmation ;
changer de colis ré-arme la confirmation ; le mode re-liaison (P3) saute l'étape
(le colis est déjà identifié par son sticker existant).

---

## P5 — Trois onglets, et le ménage

### Navigation (`src/components/layout/Sidebar.tsx`, `NAV_SECTIONS.logistique`)

| Onglet | Route | Contenu |
|---|---|---|
| **Banc** | `/warehouse` | Segments : À préparer · Scannés · Remis à Darb · Mis de côté (manager). Station de scan intégrée. Filtre site. |
| **Retours** | `/warehouse/returns` | File `to_be_returned` + décisions. `returning` refusé avec la copie stricte. |
| **Stock** | `/warehouse/stock` | Niveaux par site, comptages, **Journal en sous-onglet** |

`Suivi transporteur` reste sous *Livraison*.

Pages supprimées, avec redirection permanente dans `next.config.mjs` :
`/warehouse/preparation` → `/warehouse`, `/warehouse/scan` → `/warehouse?scan=1`,
`/warehouse/history` → `/warehouse/stock?tab=journal`, l'aperçu « Aujourd'hui »
(`WarehouseOverviewClient`, `TodayOverview`) → `/warehouse`.
`/warehouse/dispatch` : la seule page qui listait des commandes post-scan ; ses actions
(dispatch groupé, picklist PDF) sont reprises par le segment **Scannés**, puis la page
et la redirection `/to-ship` sont retirées.

**Mis de côté** : les 84 commandes `bench_cleared_at`, aujourd'hui invisibles.
`restore_bench_orders` devient appelable par un manager (RPC `SECURITY DEFINER`,
garde de rôle), plus une action « clôturer » qui passe par `manual_delete_orders`.

### Suppressions (vérifiées sans référence)

Composants : `ReturnsQueue`, `ToLabelQueue`, `WarehouseHistoryClient`,
`ReturnsDecisionCard`, `ScanFeedbackTile`, `WarehouseInboxBanner`, `LowStockBanner`,
`PrintActivityDashboard`, `WarehousePagination`, `shell/{WarehouseShell,
WarehouseKpiStrip,WarehouseFilterBar}`, `shared/{LogisticsKpiStrip,ScanModeToggle}`,
`console/WhSpark`, `returns/ScanFirstReturnsStage`, `console/ScanModeClient`,
`console/PreparationConsole` (fusionné dans le Banc) — **et leurs tests**.
Endpoints : `/api/warehouse/to-scan` (appelle `get_to_scan_orders`, qui filtre encore
`status='confirmed'` — mort depuis le modèle `uploaded`), `/api/warehouse/stats`,
`/api/warehouse/stock/accuracy`. La fonction SQL `get_to_scan_orders` est supprimée.
i18n : les treize sous-espaces morts sous `warehouse.*` (`returns`, `returns.batch`,
`returns.decision`, `returns.errors`, `history`, `preparation`, `toScan`, `toLabel`,
`filters`, `scanner`, `pagination`, `errors`, `lowStock`, `banner`, `activity`,
`loading`) dans `fr.json` **et** `ar.json`.

### Bac à sable et fixture

`scripts/darb-sandbox.mjs` :
- nouvelle route `GET /api/local/shipments/:id` (forme `data.results[0]`) — sans elle
  la vérification de liaison n'est pas testable ;
- comportements post-liaison par scénario : `apply` (défaut), **`silent`** (répond OK,
  garde `SH…` → reproduit `1633019`), **`reref`** (applique puis remplace par un autre
  numéro à la réservation → reproduit les 7 de Sebha).

`scripts/wh-test-scenarios.mjs` : trois scénarios de plus — `q` liaison silencieuse,
`r` re-stickerisé par Darb, `s` dé-scan (scanné, slug `pending`) — et un champ `site`
sur chaque commande. `wh-test-fixture.ts seed` crée les deux sites et affecte l'agent
de test.

---

## Décisions de données encore ouvertes

À trancher **après** la mise en service, chacune est un lot séparé :

| Sujet | Volume | Question |
|---|---|---|
| Commandes Dexpress `uploaded` | 323 | Fermer en masse (`deleted`) ou laisser mortes ? Dexpress n'expédie plus depuis mai 2026 |
| Mises de côté | 84 | Restaurer sur le banc, ou clôturer ? |
| Annulées chez nous, `released` chez Darb | 108 | Colis réellement livrés ou retournés côté Darb pendant qu'ils étaient « annulés » chez nous — réconcilier le chiffre d'affaires ? |
| Retours sans crédit de stock | 103 | Rapport déjà écrit (`report/ly-returns-without-stock-credit.csv`) ; crédit manuel ou abandon ? |

---

## Vérification de bout en bout

```bash
npm run typecheck
npx vitest run src/components/warehouse src/app/api/warehouse src/lib/carriers src/types
node scripts/darb-sandbox.mjs &                       # terminal 1
npm run dev                                           # terminal 2
node_modules/.bin/vite-node scripts/wh-test-fixture.ts seed --apply
# se connecter adel@oms.local / adel, viewport téléphone, /ar/warehouse
node_modules/.bin/vite-node scripts/wh-test-fixture.ts status
```

Parcours manuel obligatoire (agent libyen, arabe, 390 px) :
1. Banc → prendre un colis → **la caméra n'ouvre pas** avant la confirmation photo.
2. Scanner (scénario `a`) → lié, vérifié, stock du site décrémenté, total marché aussi.
3. Scénario `q` → « liaison non vérifiée », **aucun stock bougé**, le colis reste à préparer.
4. Scénario `r` → après une passe de sync, la ligne Scannés porte « Darb a changé le numéro ».
5. Scénario `s` → dé-scanner : stock rendu, sticker libéré, commande de retour au banc.
6. Marquer `booked` chez Darb → le colis passe **Remis à Darb**, le dé-scan disparaît.
7. Retours : scanner un colis `returning` → refus strict ; un `to_be_returned` → les
   trois décisions, effet de stock sur le bon site.
8. Manager : trois entrées seulement dans Entrepôt ; filtre site ; « Mis de côté » liste 84.

Contrôles SQL de production après chaque phase (P0 : états de liaison ; P1 : somme des
sites = total pour chaque produit LY ; P2 : plus aucune commande LY en vol au statut
`scanned` avec un slug `booked`).

---

## Risques

- **`ALTER TYPE … ADD VALUE`** ne peut pas servir dans sa propre transaction — d'où
  deux migrations en P2. Une seule inversion et le déploiement casse.
- **`orders` UPDATE n'a aucun bras `warehouse_agent`** : toute écriture agent passe
  par un `SECURITY DEFINER`. Un `update` de session touche zéro ligne **sans erreur**.
- **L'invariant stock** doit être armé après le comptage d'ouverture, jamais avant,
  sinon chaque scan lève.
- **17 h de décalage** entre notre scan et le `booked` de Darb : le dé-scan a une
  fenêtre réelle large, mais la liste doit dire *pourquoi* il disparaît.
- **Faits investisseurs** (`src/lib/investors/facts/order-facts.ts`) lisent les
  statuts : les quatre nouveaux doivent y compter comme « en vol », sinon un mois de
  résultats bouge.
- **24 tests unitaires échouent déjà sur `main`** (14 fichiers) et `npm run lint` ne
  peut pas tourner (pas d'ESLint installé) — ne pas les imputer à ce travail.
- Sessions concurrentes : `git stash -u` d'une autre session a déjà emporté des
  fichiers non commités le 2026-09-08. Commiter par petits pas.
