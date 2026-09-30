# Motifs de rejet — CRUD admin + le motif lisible d'un coup d'œil

**Date**: 2026-09-19
**Statut**: livré et appliqué en production le 2026-09-19

## Le problème, en deux moitiés

### 1. Aucune surface admin
La taxonomie des rejets est **codée en dur** dans `src/lib/orders/rejection-taxonomy.ts` —
5 groupes × 18 sous-motifs — doublée d'un enum Postgres (`rejection_reason`) et d'une
contrainte CHECK (`orders_rejection_subreason_check`). Ajouter un motif = une migration
plus un déploiement. Personne ne peut le faire depuis l'application.

### 2. « Rejeté » ne dit pas pourquoi
La file de l'agent affiche déjà le motif au lieu du mot « Rejeté »
(`lib/queue/agent-status.ts` — *« a rejection says why, not that it happened »*).
Mais la **page Commandes du manager**, l'**archive** et le **panneau de détail** passent
par `OrderStatusBadge`, qui reçoit un libellé déjà traduit et ignore tout des motifs.
Résultat : une pastille rouge « Rejeté » sur 28 % des lignes, sans information.

## Décisions (validées par le propriétaire, 2026-09-19)

| Question | Décision |
|---|---|
| Profondeur du CRUD | **Sous-motifs : CRUD complet.** Groupes : fixes, mais libellé + couleur éditables. Aucune chirurgie sur l'enum Postgres. |
| Suppression | **Retrait doux si utilisé, suppression franche si inutilisé.** Le dialogue annonce le cas et le nombre de commandes concernées. |
| Pastille | **Couleur du groupe + sous-motif court.** Cinq teintes séparables en colonne. |

### Décision complémentaire (non posée, tranchée ici)
La couleur d'un groupe se choisit parmi les **six teintes nommées** du design system
(`neutral`, `amber`, `violet`, `teal`, `green`, `red`) — pas un hex libre comme
`status_configs.color`. Raison : les pastilles de statut tirent leurs tons de
`--hue-*`, qui sont déjà accordés clair/sombre et RTL. Un hex libre choisi dans un
formulaire casse ce contrat et produit des paires texte/fond illisibles.

## Modèle de données

Table `rejection_reason_configs` — l'arbre entier dans une table, par marché.

```
id           uuid pk
market_id    uuid not null → markets(id) on delete cascade
parent_key   text null        -- null = ligne de GROUPE ; sinon la clé du groupe parent
key          text not null    -- 'refus_client' ou 'prix_eleve'
label_fr     text not null    -- libellé long (sélecteur agent)
label_ar     text not null
short_fr     text not null    -- libellé court (pastille) — « Faux n° », « Hors zone »
short_ar     text not null
hue          text not null default 'red'   -- n'a de sens que sur une ligne de groupe
sort_order   int  not null default 0
is_active    bool not null default true    -- false = retiré du sélecteur, l'historique reste lisible
requires_note bool not null default false  -- vrai pour « autre » seulement
created_at, updated_at
unique (market_id, key)
check (hue in ('neutral','amber','violet','teal','green','red'))
check (key ~ '^[a-z][a-z0-9_]*$')
```

- Les 5 lignes de groupe et les 18 lignes de sous-motif sont **semées** depuis la
  taxonomie actuelle, pour chaque marché, libellés FR/AR repris de `messages/*.json`.
- `orders_rejection_subreason_check` est **supprimée** : la liste devient dynamique,
  une contrainte statique ne peut plus la décrire.
- **Pas de clé étrangère depuis `orders`.** Tentante, mais elle ajouterait une
  vérification sur le chemin d'admission des webhooks (table chaude) et ferait
  remonter une violation FK brute là où l'API sait déjà compter les usages.
  La validation vit dans la route de rejet.

### Couleurs par défaut des groupes
| Groupe | Teinte | Pourquoi |
|---|---|---|
| `refus_client` | `red` | le client a dit non — la vraie perte |
| `injoignable` | `amber` | problème de joignabilité, encore actionnable |
| `livraison_impossible` | `violet` | problème de couverture / logistique |
| `commande_invalide` | `neutral` | il n'y a jamais eu de commande ; ce n'est pas une perte |
| `autre` | `neutral` | non classé |

## RLS
Mêmes politiques que `status_configs` : lecture pour tout le marché (l'agent en a
besoin pour son sélecteur), écriture pour `super_admin` et le `market_manager` du
marché. Les helpers sont enveloppés — `(SELECT get_user_role())` — sinon la policy
se réévalue à chaque ligne (piège InitPlan déjà rencontré).

## Découpage

### Phase 1 — données + API
1. Migration : table, seed, RLS, suppression du CHECK.
2. `src/types/rejection-config.ts` — type + regex de clé.
3. `src/lib/orders/rejection-config.ts` — construction de l'arbre, `validatePair`. **Tests d'abord.**
4. `/api/settings/rejection-reasons` (GET, POST) et `/[id]` (PATCH, DELETE). **Tests d'abord.**
   - DELETE compte `orders.rejection_subreason = key` : 0 → suppression, sinon `is_active = false`.

### Phase 2 — la pastille
5. `src/lib/orders/rejection-presentation.ts` — `presentRejection()` → `{ hue, short }`,
   avec repli statique quand la config n'est pas chargée et pour les 4 groupes hérités
   (`faux_numero`, `prix`, `doublon`, `non_serieux`). **Tests d'abord.**
6. `OrderStatusBadge` accepte un `rejection` optionnel ; la teinte et le libellé priment.
7. `orders/list` sélectionne `rejection_subreason` ; `useOrdersList` et `OrderRow` le passent.

### Phase 3 — écran admin
8. `RejectionReasonsSection` — groupes repliables, sous-motifs éditables en ligne,
   ajout, retrait, réordonnancement. **Tests d'abord.**
9. Onglet « Motifs de rejet » dans `GeneralSettingsGroups` (Système › Paramètres).

### Phase 4 — le sélecteur suit la config
10. Hook `useRejectionReasons(marketId)` ; `RejectionReasonSelect` lit la config au lieu
    des constantes.
11. La route `/api/orders/[id]/reject` valide contre la config du marché.

## Invariants à ne pas casser
- Un groupe ne se supprime pas et sa clé ne se renomme pas — l'enum Postgres et
  1 800 lignes d'historique en dépendent.
- `autre` garde `requires_note = true` : c'est la seule chose qui empêche la taxonomie
  de retomber dans l'état où le motif le plus vague était le plus rapide à cliquer.
- Un sous-motif retiré doit **continuer à s'afficher** sur les commandes passées.
- La file de l'agent affiche déjà le motif : son rendu ne doit pas régresser.

## Déploiement — fait le 2026-09-19

Migration appliquée sur le projet `OMS` (`vshynigvgrlihngozuwb`), enregistrée côté
Supabase sous `rejection_reason_configs`. Le fichier local garde son nom
`20261003000001_…` : ce dépôt applique déjà ses migrations via MCP, qui leur
attribue son propre horodatage (la dernière, `merge_orders`, est
`20261002000002` en local et `20260917140504` à distance).

État vérifié après application :

| Vérification | Résultat |
|---|---|
| Lignes semées | 46 = 23 × 2 marchés (10 groupes, 36 sous-motifs) |
| `orders_rejection_subreason_check` | supprimée |
| RLS | activée, 4 politiques |
| Sous-motifs orphelins (parent manquant) | 0 |
| Commandes dont le sous-motif ne résout pas dans leur marché | 0 |
| Advisories Supabase nommant la nouvelle table | 0 |

Tests RLS sous un vrai JWT (pas en propriétaire — c'est le piège déjà payé) :

- agent TN : voit 23 lignes, toutes TN, **0 ligne LY** ;
- agent TN : `INSERT` refusé (`insufficient_privilege`) ;
- manager LY : `INSERT` accepté dans LY, **refusé dans TN** ;
- toutes les sondes ont été annulées par `rollback` — 46 lignes, 0 résidu.

Un sous-motif inédit (`promo_terminee_probe`) est désormais acceptable dans
`orders.rejection_subreason`, ce que le CHECK interdisait — testé puis annulé.

### Volumes réels au moment de l'application
2 725 commandes rejetées, dont 1 281 portent un sous-motif. La Libye concentre
presque tout : `non_serieux` 325, `pas_de_reponse` 312, `numero_invalide` 141,
`changement_avis` 138, `prix_eleve` 99. La Tunisie n'en a que 7 au total.
Conséquence concrète pour la suppression : `frais_livraison`,
`paiement_impossible` et `adresse_invalide` ne sont utilisés nulle part et
seront donc supprimés pour de bon, tandis que `non_serieux` en LY sera retiré en
douceur.
