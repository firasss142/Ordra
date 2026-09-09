# Affecter un agent d'entrepôt à son bâtiment

## Context

Le modèle à deux sites (Tripoli, Benghazi) est **déjà en base et déjà correct** :
les deux comptes Darb Assabil sont rattachés à leur bâtiment, et les 405 colis
libyens en cours sont ventilés sans ambiguïté (352 Tripoli, 53 Benghazi). La garde
de scan est écrite, testée en production, et rend bien `WRONG_SITE`.

Il manque **le dernier maillon** : `users.warehouse_id` existe mais **aucun chemin
de code ne l'écrit jamais**. Le formulaire de création (`CreateUserPanel.tsx:21-26`)
n'expose que `username, password, role, market_id` ; la route POST
(`/api/users/route.ts:97-102`) ne whiteliste pas `warehouse_id` ; et il n'existe
**aucun formulaire d'édition d'utilisateur** — `/api/agents/[id]` ne connaît que
`deactivate | reactivate | reset_password | update_avatar`.

Conséquence mesurée aujourd'hui :

| Agent | Site | Ce qu'il voit | Garde au scan |
|---|---|---|---|
| `adel` | benghazi (posé à la main en session) | 53 colis | armée |
| `tarek` | **aucun** | **les 405, deux bâtiments mêlés** | **inerte** |

La garde ne s'arme que si l'agent **et** la commande ont un site
(`20260922000013:66-68`), et `resolveSiteFilter` élargit un agent non affecté au
marché entier (`site-scope.ts:50`). Donc aujourd'hui **non affecté = non
restreint** : exactement l'erreur que le système est censé empêcher, ouverte en
grand pour tout agent que personne n'a affecté.

Objectif : rendre l'affectation administrable depuis l'UI, et inverser le défaut —
non affecté doit vouloir dire *rien*, pas *tout*.

## Décisions prises

| Question | Décision |
|---|---|
| Agent sans site | **Ne voit rien**, bancs vide explicite, scan refusé |
| Granularité | **Le bâtiment seul** — un agent, un entrepôt. Pas de zones, pas de multi-site |
| Emplacement | **Sur l'utilisateur**, dans Utilisateurs (admin) |

Le bâtiment seul suffit parce que c'est la frontière physique *et* la frontière du
compte Darb : les deux coïncident, il n'y a rien à découper plus fin.

---

## 1 — Écrire l'affectation

### `PATCH /api/agents/[id]` — nouvelle action `set_warehouse`

Le fichier est déjà un répartiteur d'actions (`:65-174`), donc on suit le patron
existant plutôt que d'inventer une route.

```ts
case "set_warehouse": {
  // null = désaffecter. Sinon le site doit exister, être actif,
  // et appartenir au MÊME marché que l'agent — sinon on créerait
  // un agent libyen rattaché à Tunis.
}
```

Gardes, dans l'ordre :
- acteur `super_admin` ou `market_manager` de ce marché (patron `:76-118`) ;
- cible de rôle `warehouse_agent` — les autres rôles n'ont pas de bâtiment
  (le commentaire de `20260922000010:71-76` le dit déjà) ;
- `warehouse_id` NULL, ou un site `is_active` dont le `market_id` = celui de la cible ;
- écrit `{ warehouse_id }`, rien d'autre.

Ajouter `warehouse_id` à `USER_COLS` dans `/api/users/route.ts:10-11` **et**
`/api/agents/route.ts`, sinon la liste ne peut pas afficher l'état courant.

### `POST /api/users` — accepter le site à la création

Whitelist `warehouse_id` (`:97-102`), valider comme ci-dessus, l'insérer (`:157-169`).
Un agent créé est ainsi affecté immédiatement, sans deuxième geste.

### Types

`UserWithStats` (`src/types/index.ts:13-28`) gagne `warehouse_id: string | null`.

---

## 2 — L'UI

### Création — `src/components/admin/CreateUserPanel.tsx`

Un select **Entrepôt** qui n'apparaît que quand `role === "warehouse_agent"`,
juste sous le select Marché, alimenté par les sites du marché choisi. Requis dans
ce cas : on ne crée plus d'agent orphelin.

```
Rôle       [Agent entrepôt  ▾]
Marché     [Libye           ▾]
Entrepôt   [Benghazi        ▾]   ← n'apparaît que pour agent entrepôt
```

### Édition — la carte utilisateur

Il n'y a **aucun formulaire d'édition** aujourd'hui. Plutôt que d'en construire un
générique (hors sujet), on ajoute le seul champ éditable dont on a besoin,
directement sur `UserCard.tsx` dans la section `warehouse_agent` : une ligne
« Entrepôt » avec un select en place, qui appelle `setWarehouse` et `mutate()`.
C'est le même geste que les actions existantes (désactiver, réinitialiser), au même
endroit, sans nouvelle page.

Un agent non affecté porte un **badge d'avertissement** « Aucun entrepôt » — c'est
ce qui rend `tarek` visible au lieu d'être un trou silencieux.

### Source des sites

`GET /api/warehouse/sites` **existe déjà** et n'est consommé par personne. Il rend
`{sites, mine, pinned}` avec le nom dans la bonne langue. Deux ajustements :
- il est gardé par `canScanWarehouse` — l'admin Utilisateurs doit pouvoir le lire,
  donc élargir aux rôles qui administrent (ou ajouter `?market_id=` pour le super_admin
  qui n'a pas de marché propre) ;
- nouveau hook `useWarehouseSites(marketId)` en SWR, à côté de `useUsersWorkspace`.

### Hook

`useUsersWorkspace.ts` gagne `setWarehouse(id, warehouseId | null)`, sur le modèle
exact de `updateAvatar` (`:74-88`).

---

## 3 — Inverser le défaut : non affecté = rien

C'est le cœur sécurité du lot, et c'est un changement de comportement à annoncer.

### `src/lib/warehouse/site-scope.ts`

`SiteFilter` gagne un troisième état. Aujourd'hui deux cas (site / marché entier) ;
il en faut trois :

```ts
export interface SiteFilter {
  warehouseId: string | null;
  pinned: boolean;
  /** Agent entrepôt que personne n'a affecté : il ne doit rien voir. */
  unassigned: boolean;
}
```

Le commentaire actuel (`:48-50`) qui justifie « voit tout le marché » est à
remplacer par le raisonnement inverse : un banc vide qui s'explique vaut mieux
qu'un banc juste qui mélange deux bâtiments.

### Les routes qui filtrent déjà

`to-label`, `scanned`, `stock/count`, `sites` : quand `unassigned`, rendre une page
**vide** avec un drapeau `siteUnassigned: true` plutôt que des données du marché.

### La garde SQL

`precheck_scan_out` (`20260922000013:66-68`) exige aujourd'hui les deux sites non
nuls. Nouvelle migration : un agent `warehouse_agent` **sans** site est refusé avec
un code dédié `NO_SITE_ASSIGNED`. Même traitement dans `unscan_order`
(`20260922000030:105-117`) et `record_stock_count` (`20260922000012:165-174`).

*Ordre de déploiement obligatoire : affecter `tarek` AVANT de déployer, sinon il
est bloqué à sa prochaine prise de poste.*

---

## 4 — Le bug `WRONG_SITE` (déjà identifié, à corriger ici)

`WRONG_SITE` est levé par trois fonctions SQL mais **absent** de `RPC_CODE_STATUS`
(`scan-out/route.ts:67-86`) et sans traduction. Le refus se dégrade donc en erreur
générique : l'agent lit « une erreur est survenue » au lieu de « ce colis appartient
à Tripoli », alors que le RPC **calcule déjà `warehouse_name`** et le jette.

- ajouter `WRONG_SITE: 409` et `NO_SITE_ASSIGNED: 409` à `RPC_CODE_STATUS` ;
- les propager dans `ScanErrorCode` et `errorLabelKey`
  (`src/lib/preparation/scan-outcome.ts`) ;
- clés i18n fr + ar, avec le nom du bâtiment en paramètre :
  `« Ce colis appartient à l'entrepôt {warehouse}. Ne le scannez pas ici. »`
  `« هذا الطرد يخص مستودع {warehouse}. لا تمسحه هنا. »`

---

## 5 — Nommer le bâtiment à l'écran

Le plateau de couleur (`BenchHome.tsx:295`, `ScanSheet.tsx:148`) affiche
`toBranchGroup`, la branche de **destination**. Ce n'est pas le compte. Deux colis
de comptes différents allant à Sebha affichent tous deux `SB` : rien à l'écran ne
distingue les deux bâtiments.

En-tête du banc : le nom du site où se tient l'agent, en clair — une ligne, pas un
badge de plus par carte. Pour un manager (non épinglé), le même emplacement devient
le **sélecteur de site**, ce qui donne enfin un consommateur à `/api/warehouse/sites`.

```
┌──────────────────────────────────┐
│ 🏭 بنغازي · 53 طرد               │  agent : fixe
│ 🏭 [Benghazi ▾] · 53 colis       │  manager : sélecteur
└──────────────────────────────────┘
```

---

## Fichiers touchés

| Fichier | Changement |
|---|---|
| `src/app/api/agents/[id]/route.ts` | action `set_warehouse` |
| `src/app/api/users/route.ts` | whitelist + insert `warehouse_id`, `USER_COLS` |
| `src/app/api/warehouse/sites/route.ts` | lisible par l'admin Utilisateurs |
| `src/lib/warehouse/site-scope.ts` | 3ᵉ état `unassigned` |
| `src/app/api/warehouse/{to-label,scanned}/route.ts` | page vide si non affecté |
| `src/app/api/warehouse/scan-out/route.ts` | `WRONG_SITE`, `NO_SITE_ASSIGNED` |
| `src/lib/preparation/scan-outcome.ts` | les deux codes → libellés |
| `src/components/admin/{CreateUserPanel,UserCard}.tsx` | le select |
| `src/hooks/useUsersWorkspace.ts` | `setWarehouse` |
| `src/hooks/useWarehouseSites.ts` | **nouveau** |
| `src/components/warehouse/bench/BenchHome.tsx` | en-tête site / sélecteur |
| `src/types/index.ts` | `warehouse_id` sur `UserWithStats` |
| `src/messages/{fr,ar}.json` | libellés site + les deux refus |
| `supabase/migrations/20260923000001_no_site_guard.sql` | **nouveau** |

## Tests d'abord (TDD)

| Fichier | Assertion |
|---|---|
| `src/lib/warehouse/__tests__/site-scope.test.ts` | agent sans site → `unassigned:true` ; avec site → épinglé ; manager → libre |
| `src/app/api/agents/[id]/route.test.ts` | `set_warehouse` : site d'un autre marché → 400 ; cible non-entrepôt → 400 ; manager d'un autre marché → 403 ; `null` désaffecte |
| `src/app/api/warehouse/to-label/route.test.ts` | non affecté → 0 ligne + `siteUnassigned` |
| `src/app/api/warehouse/scan-out/route.test.ts` | `WRONG_SITE` → 409 + nom du bâtiment ; `NO_SITE_ASSIGNED` → 409 |
| `src/components/admin/__tests__/CreateUserPanel.test.tsx` | select visible pour `warehouse_agent` seulement, requis |
| `src/components/warehouse/bench/__tests__/BenchHome.test.tsx` | banc vide expliqué ; sélecteur pour manager, figé pour agent |

## Vérification

```bash
npm run typecheck
npx vitest run src/lib/warehouse src/app/api/agents src/app/api/warehouse src/components/admin
npm run build
```

Parcours manuel :
1. Admin → Utilisateurs → `tarek` porte « Aucun entrepôt » → l'affecter à Tripoli.
2. Se connecter `tarek` → le banc montre **352** colis Tripoli, jamais les 53 de Benghazi.
3. `adel` → 53 colis, en-tête « بنغازي », pas de sélecteur.
4. Désaffecter `tarek` → banc vide expliqué, scan refusé `NO_SITE_ASSIGNED`.
5. Manager LY → sélecteur de site, bascule Tripoli ⇄ Benghazi.
6. Forcer un colis Tripoli chez `adel` → « Ce colis appartient à l'entrepôt Tripoli ».

Contrôle SQL final : plus aucun `warehouse_agent` actif avec `warehouse_id IS NULL`.

## Risques

- **`tarek` doit être affecté avant le déploiement**, sinon il est bloqué. C'est le
  seul ordre imposé.
- `/api/warehouse/sites` est gardé par `canScanWarehouse` : élargir l'accès sans
  ouvrir la lecture inter-marchés (le super_admin n'a pas de `market_id`).
- Le défaut inversé est un **changement de comportement visible** : un agent non
  affecté passe de « voit tout » à « voit rien ». C'est voulu, à annoncer aux équipes.
- Les routes retours/stock/historique restent **marché-large** (non filtrées par site).
  Hors périmètre ici, mais elles resteront incohérentes avec le banc — à traiter
  dans un lot suivant.
