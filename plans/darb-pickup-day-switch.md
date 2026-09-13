# Le ramassage du jour — couper `isPickup` quand le chauffeur est déjà passé

Décidé le 2026-09-12. Ce document est la référence de la fonctionnalité ; le
contexte Darb vit dans `docs/darb-assabil-sync.md`, le modèle à deux sites dans
`docs/warehouse-sites-and-statuses.md`.

---

## 1. Le problème, tel qu'il se produit

Chaque montée Darb part avec `isPickup: true`. C'est le bon défaut : Darb vient
chercher les colis chez nous. Mais quand un agent monte une commande **après**
le passage physique du chauffeur, le système de Darb inscrit malgré tout un
ramassage à faire — et force le chauffeur à revenir pour des colis qu'il ne
pouvait pas prendre, puisqu'ils n'existaient pas quand il était là.

Le défaut est juste ; ce qui manque, c'est de pouvoir dire « c'est fait pour
aujourd'hui ».

## 2. Ce qu'on construit

Un interrupteur **par site** : « le chauffeur est passé ». Une fois pressé,
toute montée Darb depuis ce site part avec `isPickup: false` jusqu'à la fin de
la journée locale. Au passage de minuit, `isPickup` reprend sa valeur par
défaut `true` — sans cron, sans tâche planifiée.

### Pourquoi par site

Tripoli et Benghazi sont deux bâtiments et **deux comptes Darb** :

| Compte Darb | `carriers.id` | Site |
|---|---|---|
| `darb_assabil` (Tripoli) | `4f1271c8…` | `tripoli` |
| `darb_assabil` (Benghazi) | `43077d36…` | `benghazi` |

Les deux chauffeurs passent séparément. Un interrupteur unique pour la Libye
marquerait Benghazi comme ramassé parce que Tripoli l'a été — exactement
l'erreur que le modèle à deux sites existe pour empêcher. Le site d'une montée
se déduit du compte utilisé : `carriers.warehouse_id`.

### La remise à zéro, sans cron

On ne stocke **pas** un booléen qu'il faudrait remettre à `true` la nuit. On
stocke **l'horodatage de la pression**, et chaque lecture le compare au jour
local du marché :

```
pickup_off  ⟺  todayInMarket(market) == todayInMarket(market, disabled_at)
```

Un horodatage d'hier n'est plus d'aujourd'hui : le ramassage est donc réactivé
de lui-même à minuit, heure d'Afrique/Tripoli. Rien à planifier, rien qui puisse
échouer et laisser le ramassage coupé un jour de trop. `todayInMarket()` existe
déjà dans `src/lib/dates/market-day.ts`.

## 3. Décisions prises

| Question | Décision |
|---|---|
| Portée | **Par site** (Tripoli et Benghazi indépendants) |
| Dérogation agent | **Blocage dur** — la case par commande disparaît, personne ne rallume pour une commande |
| Qui coupe | `warehouse_agent`, `market_manager`, `super_admin` |
| Qui rallume avant minuit | **`market_manager` et `super_admin` seulement** — un agent ne défait pas une pression |
| Remise à zéro | Minuit local, **calculé à la lecture** |
| Stock chez Darb (`fulfil_from_carrier_warehouse`) | **Non concerné** — `isPickup` reste forcé à `true` : la marchandise est chez eux, notre chauffeur n'y change rien (leur propre client désactive le commutateur) |
| Emplacement | En-tête de `/warehouse` **et** page Réglages du marché |
| Modale de montée | Un message explicite remplace la case, jamais un silence |

## 4. Le stockage

Une ligne `settings` par site, sous une clé dérivée du site :

```
key   = "darb_pickup_disabled:<warehouse_id>"
value = { "disabled_at": "2026-09-12T14:31:07.000Z", "by": "<user_id>" }
```

`settings` est déjà unique sur `(market_id, key)` et déjà lisible par le marché.
Pas de table nouvelle : c'est un réglage de marché, avec une portée de site
portée par la clé.

## 5. Le point d'application — un seul

`performDispatch` (`src/lib/carriers/perform-dispatch.ts`) est le passage obligé
des **trois** chemins de montée :

| Chemin | Fichier |
|---|---|
| Modale agent | `POST /api/orders/[id]/dispatch` |
| Montée en lot | `POST /api/orders/bulk-dispatch` |
| Cron `dispatch_scheduled` | `/api/cron/dispatch-scheduled` |

La route de montée recopie aujourd'hui `body.extra` du client tel quel. Décider
côté client ne tiendrait donc pas : un `extra.is_pickup: true` forgé passerait.
`performDispatch` charge déjà la ligne `carriers` — donc le site — et **écrase**
`extra.is_pickup` à `false` quand l'interrupteur du site est coupé. Le cron, qui
n'envoie aucun drapeau, est couvert par la même ligne de code.

L'adaptateur reste inchangé : il lit déjà `extra.is_pickup !== false`
(`darb-assabil-adapter.ts:128`) et force déjà `true` en mode entrepôt
transporteur (`:254`).

## 6. Surfaces

| Surface | Rôle | Ce qu'on voit |
|---|---|---|
| En-tête `/warehouse` | `warehouse_agent` | Son site uniquement. Bouton « Le chauffeur est passé ». Une fois coupé : bandeau d'état, pas de bouton pour rallumer |
| En-tête `/warehouse` | `market_manager`, `super_admin` | Tous les sites du marché, coupure et réactivation |
| Réglages du marché | `market_manager`, `super_admin` | Même contrôle, par site |
| Modale de montée Darb | agent | Case ramassage remplacée par : « Ramassage désactivé aujourd'hui — le chauffeur est déjà passé (Tripoli) » |

## 7. Ordre d'implémentation (TDD)

1. `src/lib/carriers/pickup-window.ts` — lecture/écriture du réglage + la
   comparaison de jour local. Tests d'abord : hier ≠ aujourd'hui, minuit local
   et non UTC, absence de ligne = ramassage actif.
2. `performDispatch` — l'écrasement serveur. Tests : les trois chemins, le
   mode entrepôt transporteur épargné, un `extra` forgé sans effet.
3. `GET`/`POST /api/warehouse/pickup` — lecture par marché, écriture par site,
   avec la règle de rôle asymétrique (rallumer = manager/admin).
4. Surfaces : en-tête entrepôt, réglages, modale.
5. `fr.json` / `ar.json`, puis RTL.

## 8. Ce qu'on ne fait pas

- Aucun cron. La remise à zéro est une comparaison, pas une tâche.
- Aucun champ sur `orders`. L'état est celui du jour et du site, pas de la commande.
- La Tunisie n'est pas touchée : ses transporteurs n'ont pas cette notion.
