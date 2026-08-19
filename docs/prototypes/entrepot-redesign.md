# Entrepôt — refonte (spécification)

Prototype interactif : [`entrepot-redesign.html`](./entrepot-redesign.html) — un seul fichier,
FR/LTR, bascule **Libye / Tunisie** et **Manager / Agent entrepôt** dans la barre « Prototype »
en bas à droite.

Ce document remplace `design.md` pour la section Entrepôt. Il décrit ce que la section
*mesure* et *permet*, pas seulement son apparence.

---

## 1. Pourquoi refaire

L'Entrepôt actuel s'est construit page par page : **six écrans qui affichent chacun leur
propre table de commandes**, sur des tranches de statut qui se recouvrent
(`uploaded`, `scanned`, phase 2 en vol, `to_be_returned`, historique).

| Écran actuel | Table affichée | Problème |
|---|---|---|
| `warehouse` (aperçu) | KPI + activité récente | invisible pour l'agent (redirection) |
| `warehouse/preparation` | backlog + plateau + scans | trois listes sur un même écran |
| `warehouse/dispatch` | `ToShipCockpit` | ce n'est pas de l'entrepôt : c'est l'**envoi au transporteur**, un geste d'agent de confirmation |
| `warehouse/returns` | file des retours | ok sur le fond, noyée dans le reste |
| `warehouse/carrier-tracking` | colis bloqués par transporteur | suivi post-remise, pas du travail d'entrepôt |
| `warehouse/history` | journal | ok |
| `dashboard/stock` (Finances) | position + capital | réservé au super admin, absent de l'entrepôt |

Deux constats de production (18 août 2026) fixent le cap :

- **444 commandes libyennes sont en `uploaded`** — téléchargées chez Darb, jamais scannées
  chez nous. Le sticker était collé et scanné *dans l'application Darb*. Notre stock est donc
  surévalué d'autant, et aucun écran ne le dit.
- **Deux modes de livraison coexistent en Libye** : ~90 % depuis notre entrepôt (nous
  emballons, nous collons le sticker Darb), ~10 % depuis l'entrepôt de Darb
  (`fulfil_from_carrier_warehouse`) où aucun scan n'aura jamais lieu.

---

## 2. Architecture — six sous-sections, une par question

| # | Sous-section | Question à laquelle elle répond |
|---|---|---|
| 1 | **Aujourd'hui** | Que doit faire l'entrepôt maintenant, et sommes-nous en retard ? |
| 2 | **Préparation** | Quels colis emballer, et comment les sortir du stock ? |
| 3 | **Remise transporteur** | Quels colis scannés partent, avec quel transporteur, sous quel manifeste ? |
| 4 | **Retours** | Que devient chaque colis revenu ? |
| 5 | **Stock** | Combien avons-nous, où, et qu'est-ce qui entre ? |
| 6 | **Journal** | Que s'est-il passé, par qui, pour quel motif ? |

**Sortent du groupe Entrepôt** (pages inchangées, déplacées sous un groupe « Livraison ») :
*Suivi transporteur* et *Tableau livraison* — ils décrivent des colis qui ne sont plus chez
nous. **Rejoint le groupe** : *Stock*, aujourd'hui sous Finances et réservé au super admin ;
Finances garde l'analyse en dinars (capital immobilisé, valeur dormante), l'Entrepôt prend les
unités et les gestes.

**Rôles** — `warehouse_agent` : bande d'onglets sans barre latérale, les six sous-sections,
« Aujourd'hui » devient « Ma journée ». `market_manager` / `super_admin` : barre latérale
complète, plus les cartes de pilotage (débit par agent, sélecteur de marché).

---

## 3. Logique métier — un flux, deux sources de scan

Le pipeline de statuts ne change pas :

```
uploaded ──scan de sortie──▶ scanned ──remise──▶ dispatched ──▶ … ──▶ to_be_returned
                                                                          │
                                                        décision ─────────┼──▶ returned  (stock +q)
                                                                          ├──▶ endommagé (compteur dégâts +q)
                                                                          └──▶ received  (re-livrable)
```

**Le stock est débité au scan de sortie, pas à la remise.** Un colis scanné est déjà sorti du
registre ; la remise ne fait que le confier au transporteur. Cette phrase figure telle quelle
dans l'interface, parce que c'est la confusion la plus coûteuse sur le terrain.

| Étape | Libye — notre entrepôt (Darb Assabil) | Tunisie (Navex & co.) |
|---|---|---|
| Impression | liste de picking seulement — Darb fournit le sticker | **étiquette** (PDF existant : code-barres transporteur + notre QR) |
| Identification du colis | l'agent **prend** la commande à l'écran (bouton *Prendre*) | l'agent **scanne notre QR** — aucune sélection préalable |
| Scan | **sticker Darb** → liaison du numéro à l'expédition (remplace la réf. `SH…`) **+** sortie de stock | **notre QR** → sortie de stock |
| Garde-fous | statut `uploaded` · sticker jamais utilisé · colis en main obligatoire · échec API ⇒ le colis reste à préparer, **stock intact** | statut `uploaded` · étiquette imprimée |
| Remise | groupée par compte Darb (Tripoli / Benghazi) | groupée par transporteur |
| Commandes servies par Darb | n'apparaissent **jamais** en Préparation — visibles dans Stock › Chez Darb | — |

**Pourquoi « prendre puis scanner » en Libye.** Le sticker sort d'un rouleau : hors du
rouleau, ce n'est qu'un numéro. Darb accepte n'importe quel numéro sans vérifier qu'il nous
appartient — un chiffre saisi de travers lie silencieusement le colis d'un autre marchand.
L'ordre *coller, puis scanner, sur une commande déjà désignée à l'écran* est le seul qui rende
un mauvais appariement impossible.

**Rouleaux par région.** Les stickers sont colorés **par région**, pas par ville. La
Préparation regroupe donc la file par région et réserve l'emplacement de la pastille de
couleur — laissée vide (`couleur à définir`) tant que la correspondance n'est pas confirmée
avec Darb. Le découpage régional du prototype (Ouest / Est / Sud, à partir des 25 villes de
`darb-assabil-areas-data.json`) est **provisoire**.

### Mouvements de stock
| Geste | Effet | Motif journalisé |
|---|---|---|
| Scan de sortie | −q | `scanned` |
| Retour remis en stock | +q | `returned` |
| Retour endommagé | 0, compteur dégâts +q | `damaged_writeoff` + motif |
| **Réception** | +q | `reception` *(nouveau)* |
| **Inventaire** | ±écart | `count_adjustment` *(nouveau)* + motif obligatoire |
| **Transfert vers Darb** | −q chez nous, +q chez le transporteur | `transfer_out_carrier` *(nouveau)* |

---

## 4. Écrans

Chaque écran suit la même partition : *en-tête → bande de 3 à 5 cartes KPI → une zone de
travail principale → un panneau secondaire*. **Une seule table par écran.**

**1 · Aujourd'hui** — KPI : à préparer · sorties scannées · à remettre · retours à traiter ·
stock bas. Puis le **flux du jour** (à préparer → scanné → remis, avec l'âge du plus ancien),
la liste **À traiter en priorité** (chaque alerte porte son bouton d'action), et à droite
l'activité sur 14 jours + le débit par agent. En vue agent : trois KPI et deux gros boutons.

**2 · Préparation** — à gauche la file groupée par région (LY) ou par transporteur (TN), avec
recherche et filtres d'âge ; sélection multiple → barre collante (*Imprimer les étiquettes* /
*Liste de picking*). À droite, collé en haut, le **panneau de scan** : colis en main, champ de
scan large (la douchette écrit dedans, Entrée valide), tuile de retour verte ou rouge avec le
stock avant/après, et les huit derniers scans.

**3 · Remise transporteur** — une carte par compte transporteur avec ses colis prêts et le
bouton *Remettre N colis* → récapitulatif, nom du chauffeur, manifeste PDF. À droite,
l'historique des manifestes.

**4 · Retours** — la file à gauche ; à droite la **carte de décision** : *Remettre en stock* /
*Endommagé* (motif obligatoire + photo pour le dossier litige) / *Re-livrable*. La validation
reste inactive tant que la décision — et son motif — ne sont pas complets.

**5 · Stock** — une ligne par produit avec sa **barre de position** (libre / engagé sur le
registre total), sa couverture, son verdict ; boutons *Réception*, *Inventaire*, *Transfert*
par ligne et en tête de page. À droite, **Chez Darb Assabil** (relevé transporteur : réservé /
disponible / total) et les derniers mouvements. Aucun montant en dinars.

**6 · Journal** — filtres par type, recherche, export CSV, lignes groupées par jour avec
l'auteur et le solde de stock après chaque mouvement. En écriture seule : une erreur se
corrige par une ligne de plus, jamais par une modification.

### KPI retenus
Aujourd'hui : à préparer, sorties du jour (± vs hier), à remettre, retours à traiter, stock
bas, âge du plus ancien `uploaded`, confirmées non téléchargées.
Préparation : file, scannées / objectif, sélection, progression du lot, erreurs de scan.
Remise : à remettre par compte, remis du jour, manifestes, attente moyenne scan → remise.
Retours : à traiter, traités, taux de retour 28 j, dépréciés.
Stock : produits sous seuil, couverture minimale, unités chez le transporteur, réceptions 28 j.
Journal : événements du jour, anomalies, traçabilité.

---

## 5. CRUD de l'agent entrepôt

| | Gestes |
|---|---|
| **Créer** | scan de sortie · remise + manifeste · décision de retour · **réception** · **inventaire** · **transfert vers Darb** · impression / réimpression d'étiquettes · liste de picking |
| **Lire** | les six sous-sections, limitées à son marché |
| **Modifier** | `products.is_active` ; toute correction de quantité passe par un inventaire motivé |
| **Supprimer** | rien — « annuler » écrit une ligne inverse avec motif |

Manager : idem + sélecteur de marché et pilotage d'équipe. `adjust_product_stock` brut reste
au super admin.

---

## 6. Langage visuel

Les deux écrans les plus fréquentés — **Aujourd'hui** et **Préparation** — reprennent
littéralement l'anatomie des écrans Ordra existants, composant par composant :

| Emprunt | Écran d'origine | Où il sert ici |
|---|---|---|
| Tuile d'en-tête : porte-icône teinté + chiffre + libellé capitales + glose, badge de variation à côté du chiffre | Commandes (*Non assignées*, *Taux de confirmation*) | Aujourd'hui et Préparation, en tête de page |
| Bande **Pipeline** : libellé capitales + glose légère, cartes à porte-icône et jauge fine en pied | Commandes | Aujourd'hui : à préparer → scannés → remis → retours → stock bas |
| **Actions prioritaires** : porte-icône, titre, sous-ligne, valeur alignée à droite, chevron ; total en tête de carte | Stock & inventaire | Aujourd'hui : la file des choses à rattraper |
| **Classement** : rang, avatar, mesures en ligne, débit à droite avec jauge et cible « x / 3,0 » | Performance équipe | Aujourd'hui : sorties par heure active |
| Recherche pleine largeur + raccourci `/` + ligne d'aide des champs cherchés | Commandes | Préparation |
| Puces de filtre à icône et chevron, ouvrant un menu | Commandes (*Appel*, *Livraison*, *Agent*…) | Préparation : Âge · Région · Produit |
| Table : en-têtes minuscules capitales, vignette produit, nom en gras + référence · ville, pastilles d'état, âge coloré | Commandes | Préparation |
| Ligne de compte (« 955 commandes ») au-dessus de la table | Commandes | Préparation |

La colonne *Étiquette* n'existe qu'en Tunisie : en Libye le sticker vient du rouleau Darb,
il n'y a rien à imprimer.



Repris tel quel de `src/app/globals.css` — aucun token nouveau :

- fonds `--bg-page #F6F6F7` / cartes `#FFFFFF`, bordures `#E1E3E5`, rayon 10 px, sans ombre au repos
- encres `--oms-ink-1/2/3` (`#1B1917` / `#5C5852` / `#78726A`)
- vert de marque `--brand #15803D` réservé aux actions primaires et aux états actifs
- couleur fonctionnelle sur les badges uniquement : `--oms-ok` `--oms-warn` `--oms-bad` `--oms-info` `--oms-accent`
- barre latérale sombre `#1A1A1A`, 240 px ; vert `#10B981` réservé au fond sombre
- cartes KPI : intitulé 10,5 px capitales, chiffre 30 px tabulaire, pied à 2–3 sous-mesures séparées par des filets
- chiffres en `tabular-nums` partout ; noms arabes isolés en `<bdi>` pour ne pas casser la ponctuation latine

**Deux couleurs de données seulement**, et elles sont validées : `#15803D` (libre / sorties) et
`#6E56CF` (engagé / retours) — écart normal 29,6 · deutan 23,4 · tritan 8,0, toutes les six
vérifications au vert. Le couple vert/sarcelle utilisé aujourd'hui par la console Stock
échouait le seuil de vision normale (ΔE 7,8 : indiscernables même sans déficience). Variantes
sombres : `#0EA871` / `#8B7CF0`. Le registre n'a pas de couleur : c'est la piste entière.

Le prototype embarque un thème sombre complet (jeu de tokens redéfini, pas une inversion).

---

## 7. Ce qu'il faudra côté code (hors périmètre du prototype)

1. **Nouveaux motifs `inventory_log`** : `reception`, `count_adjustment`, `transfer_out_carrier`.
2. **Nouvelles tables** : `handover_manifests` (lot, transporteur, agent, chauffeur, horodatage)
   et `carrier_stock_transfers` (produit, quantité, entrepôt destinataire, bon de transfert).
3. **RPC** : `record_reception`, `record_stock_count`, `record_carrier_transfer` — mêmes gardes
   de rôle et de marché que `scan_order_out`.
4. **Liaison du sticker Darb — point ouvert.** L'`INTEGRATION_GUIDE.md` du transporteur ne
   documente aucun endpoint qui remplace la référence `SH…` par un numéro de sticker
   (`PATCH /api/local/shipments/modify/:id` ne couvre pas la référence). À confirmer avec Darb
   avant de développer l'étape 5 ; sans lui, le scan reste une écriture locale et la référence
   ne se répare qu'au prochain passage de `promote_darb_status`.
5. **Correspondance région → couleur de rouleau** : un réglage par marché, à alimenter quand
   Darb aura confirmé.
6. **Rattrapage des 444 `uploaded`** : décider s'ils sont scannés rétroactivement (le stock
   baisse d'un coup) ou soldés par un inventaire. C'est une décision d'exploitation, pas une
   fonctionnalité.
7. **Découpage régional** : le prototype propose Ouest / Est / Sud ; à valider.

---

## 8. Décisions à trancher

- Sortir *Suivi transporteur* et *Tableau livraison* du groupe Entrepôt — proposé, pas fait.
- La Tunisie garde-t-elle le code-barres du transporteur **et** notre QR sur la même étiquette ?
  (C'est déjà le cas dans le PDF actuel ; la refonte n'y touche pas.)
- Pour les produits détenus par Darb, `products.current_stock` devient le cache d'un chiffre qui
  ne nous appartient pas — question d'architecture déjà soulevée par la refonte de la page Stock.
