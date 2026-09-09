# Entrepôt — les deux bâtiments et les statuts du transporteur

Refonte du 2026-09-09. Ce document est la référence pour le modèle de site, les
statuts Darb et la boucle après le scan. Le plan complet est dans
`plans/warehouse-darb-workflow-rebuild.md`.

---

## 1. Deux bâtiments, et pourquoi ce n'est pas un filtre

La Libye prépare et remet ses colis depuis **deux entrepôts**, Tripoli et
Benghazi, chacun avec ses agents et ses rayonnages. Un site **est** un compte
Darb Assabil : une commande montée sur le compte Benghazi doit être remise à
Darb Benghazi — remise à Tripoli, elle n'existe pas dans leur système.

| Table / colonne | Rôle |
|---|---|
| `warehouses` | Le bâtiment. Un par défaut par marché (`is_default`) |
| `carriers.warehouse_id` | Le site d'où ce compte transporteur expédie |
| `orders.warehouse_id` | Le site qui prépare le colis — **écrit par trigger** depuis `carrier_id`, jamais à la main |
| `users.warehouse_id` | Le bâtiment où travaille un agent d'entrepôt |
| `product_site_stock` | La ventilation de `products.current_stock` |
| `inventory_log.warehouse_id` | Où le mouvement a eu lieu |

Une commande `fulfil_from_carrier_warehouse = true` **n'a pas de site** : la
marchandise est chez Darb, elle n'a jamais touché nos rayonnages.

### Le stock : une ventilation, pas un remplacement

`products.current_stock` reste la vérité pour l'argent — 51 fichiers source et
32 fonctions SQL le lisent, dont la finance, le P&L et les faits investisseurs.
`product_site_stock` **ventile** ce total, et l'invariant est une **inégalité** :

```
somme(product_site_stock.current_stock)  <=  products.current_stock
```

Une égalité serait fausse pendant toute la migration : la table naît vide et ne
se remplit qu'au comptage physique d'ouverture. L'inégalité est vraie à chaque
instant, et la différence a un nom honnête — des unités qu'on sait posséder sans
savoir encore où elles sont. Le garde attrape le vrai danger : un ajustement qui
abaisse le total sous ce que les sites déclarent détenir.

### La ventilation se déduit du registre

Six RPC déplacent du stock. Leur ajouter à chacune l'arithmétique par site,
c'est six occasions de la faire différemment. Or chacune écrit **exactement une
ligne d'`inventory_log` par mouvement** : un trigger y branche le mouvement du
site (`20260922000012`). Une seule implémentation, atomique par construction.

Deux règles à connaître avant d'y toucher :

* **Le signe de `change` n'est pas fiable sur les lignes endommagées.**
  `scan_return_in` écrit `+qty` pour une casse, `adjust_product_stock` écrit
  `−qty` pour la même chose. Le trigger lit `is_damaged` d'abord et prend
  `ABS(change)`.
* **Le trigger n'agit que si la ligne (produit, site) existe.** Seul un comptage
  physique la crée. Tant que l'entrepôt n'a pas compté, le modèle est **inerte**
  et aucun scan ne peut être bloqué par lui.

### Mise en service

1. Rattacher chaque agent à son bâtiment (Utilisateurs).
2. Comptage physique **par site** de chaque produit actif — c'est ce comptage,
   pas une estimation, qui pose la répartition.

---

## 2. Les statuts que Darb dit réellement

| Slug Darb | `orders.status` | Sens |
|---|---|---|
| `pending` | `uploaded` | Créée, pas encore réservée |
| `booked`, `processing` | **`at_carrier`** | Remis : le colis est chez eux |
| `on-branch` | `in_transit` | Centre de tri |
| `released`, `resent` | **`out_for_delivery`** | Sorti avec un livreur |
| `delayed` | **`delivery_delayed`** | « Pas aujourd'hui », avec le motif du livreur |
| `returning` | **`returning`** | Revient — **pas encore recevable au banc** |
| `returned` | `to_be_returned` | Arrivé : le banc peut le scanner |
| `completed` | `delivered` | Livré |
| `cancelled` | `cancelled` | Annulé par le transporteur |

`dispatched` et `deposit` restent pour la Tunisie ; Darb ne les occupe jamais.

**On ne recule pas un statut.** Darb réémet parfois un état antérieur.
`order_status_rank` l'empêche ; `out_for_delivery` et `delivery_delayed`
partagent le même rang et gardent donc leurs allers-retours légitimes.

**`received` n'est plus un cul-de-sac.** Il n'avait aucune sortie : un colis
revenu que le client voulait toujours ne pouvait plus jamais bouger, n'atteignait
aucun statut terminal et disparaissait des dénominateurs de livraison. Il repart
maintenant vers l'agent (`received → confirmed`).

**Une seule liste, pas quatorze.** `CARRIER_PHASE_STATUSES`,
`IN_FLIGHT_STATUSES` et `CARRIER_BOARD_STATUSES` (`src/types/order-status.ts`)
remplacent les copies qui avaient dérivé dans quatorze fichiers.

---

## 3. Après le scan : la liste, la re-liaison, le dé-scan

Un colis scanné disparaissait. Aucune liste, aucune vérification, aucun retour
en arrière — la seule marche arrière était `manual_delete_orders`, qui tue la
commande, et `recover_deleted_order` refuse ensuite de la ressusciter.

`get_scanned_orders` couvre les deux moments où le colis nous regarde encore :
`scanned` (sur le banc) et `at_carrier` (parti, rien ne bouge encore).

### Le dé-scan

`unscan_order(order_id, actor_id, note)` — autorisé tant que Darb n'a **pas**
réservé le colis (`carrier_status_slug` ∈ `pending`, NULL). La fenêtre réelle est
large : environ 17 h entre notre scan et leur réservation.

Effets : `+qty` sur le site et sur le total · une ligne `inventory_log`
(`scan_reversal`) · `orders.status → uploaded` · `carrier_sticker_ref → NULL`
· une ligne `order_history`. Le motif est **obligatoire**.

Le sticker est **brûlé** : il est collé sur un carton et Darb le connaît
peut-être déjà. Il est libéré de la commande pour que l'index unique n'interdise
pas d'en recoller un, mais le numéro reste dans la note d'historique.

---

## 4. La garde du sticker

Voir `docs/darb-warehouse-workflow.md` § « Ce que Darb fait au sticker » pour les
mesures. En bref :

* Après chaque liaison, le scan **relit** l'expédition et réessaie une fois.
* L'état atterrit sur `orders.sticker_bind_state` : `confirmed` · `restickered`
  (+ leur numéro dans `carrier_reference_actual`) · `not_registered`.
* Une liaison non confirmée **ne bloque pas** le scan : le colis est déjà
  étiqueté et la réception Darb récupère le numéro physique. Bloquer
  l'immobiliserait et le laisserait sans sticker, donc introuvable au retour.
* Chaque passage de sync refait la comparaison et n'écrit que si l'état change.
* Sans imprimante ni code-barres, la **photo du produit** est le dernier
  contrôle humain : la caméra ne s'ouvre qu'après « c'est bien ce colis ».

---

## 5. La section, en trois onglets

| Onglet | Route | Contenu |
|---|---|---|
| **Banc** | `/warehouse` | À préparer · Scannés. Station de scan incluse |
| **Retours** | `/warehouse/returns` | File `to_be_returned` + décisions |
| **Stock** | `/warehouse/stock` | Niveaux, comptages, **Journal en sous-onglet** |

`Suivi transporteur` reste sous *Livraison*. `/warehouse/preparation`,
`/warehouse/scan` et `/warehouse/history` redirigent vers leur nouvel hôte.
