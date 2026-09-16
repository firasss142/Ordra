# Réglages transporteurs, préférences de commande et sites

Où l'on active un transporteur, où l'on décide ce que l'agent peut cocher au
moment d'envoyer une commande, et où l'on éteint un bâtiment.

Livré le 2026-09-16. Plan : `plans/carrier-and-order-preferences-settings.md`.

---

## 1. Un seul écran : Système → Connexions → Transporteurs

Il y avait **deux** surfaces super_admin pour les transporteurs, chacune avec son
propre interrupteur actif/inactif :

| Écran | Composant | Sort |
|---|---|---|
| Système → Connexions → Transporteurs | `components/connections/CarriersPanel.tsx` | **Gagne** — tout est là |
| Paramètres → Transporteurs | `components/settings/CarriersSection.tsx` | Route repliée en redirection |

`/[locale]/settings/carriers` **redirige** désormais vers
`/[locale]/system/connections?tab=carriers`. La route est conservée plutôt que
supprimée : dans ce projet une page absente de la navigation n'est pas une page
morte, et des signets pointent dessus.

`CarriersSection.tsx` **n'est pas supprimé** : sa suite de tests couvre des flux
(ajout, édition, guide d'intégration) que `CarriersPanel` n'a pas encore. Le
supprimer aurait fait disparaître cette couverture avec lui. C'est une dette
assumée, pas un oubli.

## 2. Activer / désactiver un transporteur

`carriers.is_active`, interrupteur dans la liste. Rien de neuf — cela existait.

En Libye, **Darb Tripoli et Darb Benghazi sont deux lignes `carriers`** avec le
même `code = 'darb_assabil'`, une par compte. On peut donc en éteindre une sans
toucher à l'autre. Dexpress (`ly`) est inactif depuis mai 2026.

## 3. Préférences de commande

**Table :** `carrier_order_preferences` — migration
`20261001000001_carrier_order_preferences.sql`.
**Résolution :** `src/lib/carriers/order-preferences.ts` (fonction pure).
**API :** `GET`/`PUT /api/carriers/[id]/order-preferences`.
**UI :** `components/connections/OrderPreferencesSection.tsx`, dans le tiroir du
transporteur.

Six options, deux contrôles chacune :

| Clé | Libellé agent | Défaut codé |
|---|---|---|
| `is_pickup` | Ramassage | **true** |
| `allow_inspection` | Ouvrir le colis (inspection) | false |
| `is_fragile` | Fragile | false |
| `allow_card_payment` | Paiement par carte | false |
| `allow_testing` | Autoriser l'essai | false |
| `is_replacement` | Remplacement / échange | false |

- `default_value` — la valeur d'ouverture de la case dans le modal de dispatch.
- `can_override` — à `false`, la case **disparaît** de l'écran de l'agent.

### Le piège : masquée ≠ fausse

Une option verrouillée sur `true` est **absente du modal ET envoyée à `true`**.
C'est le seul vrai piège de ce chantier. Il est désamorcé en un seul endroit,
`effectiveOptions` dans `DarbAssabilDispatchModal.tsx`, qui écrase l'état de
l'agent avec `lockedOptionValues(policy)` juste avant de construire le payload —
pour que l'affichage et l'envoi ne puissent pas diverger.

### Rien n'est semé

**L'absence de ligne = le défaut codé.** Aucune donnée n'a été insérée par la
migration : tant qu'un admin n'a rien configuré, le comportement est exactement
celui d'avant. C'est aussi ce qui rend la lecture tolérante aux pannes — si
l'appel échoue, `useCarrierOrderPreferences` rend les défauts codés et le modal
s'ouvre normalement.

`is_pickup` garde ses deux règles existantes, qui **priment sur la politique** :
masqué en mode entrepôt transporteur, et masqué quand le chauffeur est déjà
passé (`useDarbPickupState`).

## 3 bis. Les deux modes d'expédition

**Clés :** `mode_home_warehouse`, `mode_carrier_warehouse` — même table, migration
`20261001000002_carrier_fulfilment_mode_keys.sql`.
**Résolution :** `resolveFulfilmentModes()` + `isFulfilmentModeChangeValid()`.

| Mode | Écran agent | Sens |
|---|---|---|
| `mode_home_warehouse` | « Notre entrepôt » | Nous détenons le stock, Darb vient le chercher |
| `mode_carrier_warehouse` | « Entrepôt Darb Assabil » | Darb détient le stock et le prélève lui-même |

Un interrupteur par mode, **indépendants**. Un mode désactivé **disparaît** de
l'écran de l'agent — il n'est pas grisé, parce que grisé dirait « indisponible
pour cette commande » alors qu'il n'est simplement pas proposé ici.

`default_value` porte « ce mode est proposé » ; `can_override` n'est pas lu pour
ces deux clés.

### Les deux éteints sont refusés

Un transporteur sans aucun mode n'a plus d'endroit d'où expédier. Le refus est
posé à trois niveaux : l'interrupteur du dernier mode actif est désactivé dans
l'UI, `isFulfilmentModeChangeValid()` le rejette, et la route `PUT` renvoie 400.
Pas de contrainte SQL : la règle porte sur **deux lignes**, ce qu'un CHECK de
ligne ne sait pas exprimer.

### Ce qui reste par commande

Le mode est désormais une politique, mais **la disponibilité reste par
commande** : la tuile « Entrepôt Darb » se grise toute seule quand Darb ne
détient pas le stock de cette commande précise
(`/api/orders/[id]/warehouse-availability`). Les deux questions se composent —
la politique dit ce qui est *offert*, la disponibilité ce qui est *possible*
maintenant. Quand la politique masque la tuile, le message d'indisponibilité est
masqué avec elle : il n'explique plus rien.

Le modal ne reste jamais sur un mode exclu : il s'ouvre sur « home », et bascule
sur « carrier » si la politique a désactivé « home ».

> **Note d'historique.** La première version de ce chantier avait écarté ce
> réglage en le jugeant purement per-commande. C'était faux : la disponibilité
> de stock est per-commande, mais « offrons-nous ce mode » est bien une décision
> d'administration. Les deux cohabitent.

## 4. Sites d'entrepôt

**API :** `GET`/`PATCH /api/admin/warehouse-sites`.
**Règles :** `src/lib/warehouse/site-deactivation.ts` (fonction pure).
**UI :** `components/connections/WarehouseSitesPanel.tsx`, sous la liste des
transporteurs — en Libye chaque site correspond à un compte Darb, les séparer
aurait fait perdre le lien.

`warehouses.is_active` était **déjà respecté partout** (stock, ramassage, sites,
scan) ; il n'avait simplement aucun écran pour l'éditer.

Deux garde-fous :

1. **Le site par défaut est indésactivable.** Tripoli (`ly`) et Tunis (`tn`) le
   sont aujourd'hui. Aucune confirmation ne débloque ce refus — il faut d'abord
   désigner un autre défaut.
2. **Les agents affectés sont nommés avant.** Tripoli et Benghazi ont chacun
   **exactement un** warehouse_agent. Désactiver le site le laisse avec un
   `warehouse_id` qui ne résout plus. Conformément à la règle du projet, il
   **ne voit alors rien** — non assigné ne doit jamais vouloir dire non
   restreint — et la désactivation exige une confirmation qui dit qui est mis à
   l'arrêt et combien d'unités restent sur place.

Le stock restant ne disparaît pas du total marché (`products.current_stock`) ;
il disparaît des écrans d'entrepôt. L'invariant `sum(sites) <= total marché`
tient toujours.

## 5. Qui peut quoi

**super_admin uniquement**, en écriture comme en lecture de l'écran — décision du
2026-09-16. `canManageCarriers()` était déjà `role === "super_admin"`.

La **lecture** de `carrier_order_preferences` est en revanche ouverte aux
utilisateurs du marché du transporteur : le modal de dispatch d'un agent en a
besoin pour savoir quoi afficher. Les policies enveloppent les helpers en
`(SELECT f())` — sans quoi ils se réévaluent par ligne.
