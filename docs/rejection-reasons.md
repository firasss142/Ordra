# Motifs de rejet — la taxonomie configurable et la pastille

Deux choses, liées par une seule table : **ce qu'un agent peut répondre** quand une
commande n'aboutit pas, et **ce que le manager lit** ensuite dans la colonne Statut.

## 1. Le modèle

La taxonomie est à deux niveaux, et les deux niveaux n'ont pas les mêmes droits.

| Niveau | Clé | Ajout / suppression | Éditable |
|---|---|---|---|
| Groupe | valeur de l'enum `rejection_reason` | **non** | libellé, couleur, ordre |
| Sous-motif | `orders.rejection_subreason` (texte) | **oui** | tout sauf la clé |

Les groupes sont figés parce que leur clé est une valeur d'un enum Postgres que
2 725 commandes rejetées portent déjà (mesuré le 2026-09-19), et Postgres ne sait
pas retirer une valeur d'enum.
Les sous-motifs étaient, eux, décrits par une contrainte CHECK statique
(`orders_rejection_subreason_check`) : la migration
`20261003000001_rejection_reason_configs.sql` la supprime, puisqu'une liste que les
managers éditent ne peut pas être décrite par un CHECK.

### `rejection_reason_configs`
Une ligne par nœud de l'arbre, par marché. `parent_key IS NULL` = un groupe.

Colonnes qui méritent une explication :

- **`label_*` et `short_*`** — les deux longueurs sont stockées, pas dérivées.
  « Le numéro est à quelqu'un d'autre » est ce qu'il faut dans le sélecteur de
  l'agent ; « Mauvais n° » est ce qui tient dans une colonne de 120 px. Aucune
  troncature automatique ne produit la seconde à partir de la première.
- **`hue`** — une des six teintes *nommées* du design system, jamais un hex libre.
  Les pastilles tirent leurs tons de `--hue-*`, déjà accordés clair/sombre et RTL ;
  un hex choisi dans un formulaire casse ce contrat. Elle n'a de sens que sur une
  ligne de groupe : un sous-motif hérite de la couleur de son parent, sans quoi un
  même groupe porterait quatre couleurs et la couleur ne voudrait plus rien dire.
- **`is_active`** — le retrait doux. Voir §3.
- **`requires_note`** — vrai pour `autre` seulement. C'est la seule chose qui
  empêche la taxonomie de retomber dans l'état mesuré avant sa refonte : `autre`
  représentait 36 % de tous les rejets, dont 68 % sans aucune note.

Pas de clé étrangère depuis `orders` : elle ajouterait une vérification sur le
chemin d'admission des webhooks (table chaude) et ferait remonter une violation FK
brute là où l'API sait déjà compter les usages avant de supprimer.

## 2. Où ça vit dans le code

| Rôle | Fichier |
|---|---|
| Arbre + validation (sans React, sans Supabase) | `lib/orders/rejection-config.ts` |
| Couleur + mots d'une commande rejetée | `lib/orders/rejection-presentation.ts` |
| Taxonomie compilée — semis et repli | `lib/orders/rejection-taxonomy.ts` |
| Lecture SWR | `hooks/useRejectionReasons.ts` |
| Adaptateur pastille (locale + traductions) | `hooks/useRejectionBadge.ts` |
| Écran admin | `components/settings/general/RejectionReasonsSection.tsx` |
| Sélecteur agent | `components/queue/RejectionReasonSelect.tsx` |
| API | `app/api/settings/rejection-reasons/` |

`rejection-taxonomy.ts` **n'est pas mort**. Il reste le semis de la migration, le
repli tant que le fetch n'a pas abouti, et la réponse pour les quatre valeurs de
groupe héritées (`faux_numero`, `prix`, `doublon`, `non_serieux`) qui survivent dans
l'enum sans être proposées nulle part.

## 3. La suppression, qui n'en est pas toujours une

Supprimer un motif que des commandes portent déjà rendrait leur historique
illisible — `non_serieux` en Libye en compte 325.
`DELETE /api/settings/rejection-reasons/[id]` compte donc d'abord :

- **0 commande** → la ligne est supprimée pour de bon. Réponse `{ mode: "deleted" }`.
- **≥ 1 commande** → la ligne passe `is_active = false`. Elle quitte le sélecteur de
  l'agent et **continue de s'afficher** sur les commandes passées. Réponse
  `{ mode: "retired", usage }`.

Un groupe renvoie toujours `409`. L'écran affiche le décompte réel *avant* de
demander confirmation ; il le lit via `GET .../[id]`, qui renvoie la ligne et son
`usage`.

Un motif retiré reste visible sur l'écran admin, marqué et réactivable — le cacher
est le meilleur moyen de le voir recréé sous une deuxième clé.

## 4. La pastille

Avant : « Rejeté », en rouge, sur 28 % des lignes. La couleur ne distinguait rien et
le mot ne disait rien que la croix ne disait déjà.

Maintenant, deux encodages :

- **la teinte** dit *quel genre* d'échec, depuis le groupe ;
- **les mots** disent le sous-motif court, jamais le mot « Rejeté ».

Couleurs par défaut, et le raisonnement derrière — ce ne sont pas cinq nuances de
rouge, parce qu'un rejet recouvre quatre problèmes commerciaux différents :

| Groupe | Teinte | Ce que ça veut dire |
|---|---|---|
| `refus_client` | rouge | le client a entendu l'offre et a dit non — la vraie vente perdue |
| `injoignable` | ambre | personne n'a décroché ; un meilleur numéro peut encore sauver la commande |
| `livraison_impossible` | violet | joignable et d'accord, mais non livrable — problème de couverture, pas de vente |
| `commande_invalide` | ardoise | il n'y a jamais eu de commande ; la compter comme une perte fausse tous les taux |
| `autre` | ardoise | non classé — la note de l'agent tient lieu de motif |

Ordre de priorité du libellé (`presentRejection`) :
1. le `short_*` du sous-motif, **même s'il a été retiré depuis** ;
2. la note de l'agent, pour un groupe `requires_note` ;
3. le `short_*` du groupe ;
4. la traduction embarquée, si la config n'a pas encore chargé ;
5. rien — et l'appelant garde son « Rejeté ». 93 lignes en base sont `rejected` avec
   un motif nul ; elles précèdent l'obligation et il n'y a rien d'honnête à en dire.

Une clé absente à la fois de la config et des messages renvoie `null` plutôt que le
chemin de traduction : `orders.rejectionSubreasonsShort.motif_invente` dans une
colonne de 120 px est pire que le « Rejeté » qu'on remplace.

### Surfaces
- **File de l'agent** — le faisait déjà, via `lib/queue/agent-status`.
- **Commandes (manager)** — `OrderStatusBadge` accepte `rejection={{ hue, text }}`,
  résolu une fois par tableau par `useRejectionBadge` (pas une fois par ligne).
- **Archive** — la colonne « Motif » montre le sous-motif au lieu du groupe.

`OrderStatusBadge` ignore un `rejection` sur un statut qui n'est pas `rejected` :
garder la garde sur le statut plutôt que sur la prop évite qu'une charge périmée
recolore une ligne qui a depuis avancé.

## 5. Validation

`POST /api/orders/[id]/reject` valide contre la config **du marché de la commande**
(pas de l'acteur — un super_admin rejette dans des marchés qui ne sont pas le sien),
sur l'arbre `activeOnly` : on n'écrit jamais un motif retiré, même si on continue de
l'afficher.

La règle conservée de l'ancienne implémentation : **un groupe seul n'est pas une
réponse** tant qu'il a des sous-motifs à offrir. Deux échappatoires, étroites :
- un groupe `requires_note` ne prend jamais de sous-motif ;
- un groupe dont tous les sous-motifs ont été retirés accepte le groupe nu, sinon
  retirer le dernier sous-motif rendrait le groupe impossible à choisir.

Si la table est vide (le code peut être déployé avant la migration), la route
retombe sur `isValidPair` et la taxonomie compilée. C'est ce qui évite de refuser
tous les rejets pendant cette fenêtre.

## 5 bis. État en production (2026-09-19)

Table appliquée et semée : 46 lignes, 23 par marché. Isolation vérifiée sous un
vrai JWT — un agent TN ne voit aucune ligne LY, n'écrit rien ; un manager LY
écrit dans LY et se fait refuser TN. Détail des vérifications dans
`plans/rejection-reasons-crud-and-badge.md`.

Volumes : 1 281 commandes portent un sous-motif, presque toutes en Libye
(`non_serieux` 325, `pas_de_reponse` 312, `numero_invalide` 141). Trois
sous-motifs ne sont utilisés nulle part (`frais_livraison`,
`paiement_impossible`, `adresse_invalide`) et se supprimeraient donc pour de bon.

## 6. Ce qui reste ouvert

- Les surfaces de statistiques (`/api/orders/archive/summary`, `/api/metrics`)
  agrègent toujours par **groupe**. Elles fonctionnent, mais elles ne profitent pas
  encore des sous-motifs — c'est là que se trouve la réponse à « perd-on ces
  commandes au prix, aux faux numéros, ou à un concurrent ? ».
- Les libellés de la config ne sont pas repris dans les exports CSV.
- Un marché qui renomme un groupe ne renomme rien dans `messages/*.json` ; les deux
  coexistent, la config gagne partout où elle est chargée.
