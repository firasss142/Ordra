# Réglages transporteurs & préférences de commande

Rendre configurable, depuis **Système → Connexions → Transporteurs**, ce qui est
aujourd'hui soit codé en dur (les préférences de commande Darb), soit sans écran
(les sites d'entrepôt).

Décidé avec l'utilisateur le 2026-09-16. Portée : **super_admin uniquement**.

---

## 1. Ce qui existe déjà — ne pas reconstruire

L'audit préalable a montré que la moitié de la demande est déjà en place :

| Besoin exprimé | État réel |
|---|---|
| Activer / désactiver un transporteur | **Fait.** `carriers.is_active`, interrupteur à [`CarriersPanel.tsx:210`](../src/components/connections/CarriersPanel.tsx#L210) |
| Désactiver Dexpress | **Déjà désactivé en base** (`is_active = false`, marché `ly`) |
| Désactiver Darb Tripoli ou Benghazi séparément | **Possible côté transporteur** : ce sont deux lignes `carriers` distinctes, même `code = 'darb_assabil'` |
| Préférences de commande (open order, pay online…) | **Par commande uniquement**, défauts codés en dur à [`DarbAssabilDispatchModal.tsx:242`](../src/components/queue/DarbAssabilDispatchModal.tsx#L242) |
| Entrepôt Darb vs notre entrepôt | **Par commande uniquement** (`fulfil_from_carrier_warehouse`, [ligne 365](../src/components/queue/DarbAssabilDispatchModal.tsx#L365)) |
| Activer / désactiver un site physique | `warehouses.is_active` **existe et est respecté partout**, mais **aucun écran ne l'édite** |

Le vrai manque : **aucune politique au niveau admin** sur les options par commande,
et **aucun écran** pour les sites physiques.

## 2. Les six options de commande

Toutes vivent dans le tableau statique de
[`DarbAssabilDispatchModal.tsx:644-650`](../src/components/queue/DarbAssabilDispatchModal.tsx#L644-L650) :

| Clé | Libellé | Défaut actuel | Champ Darb |
|---|---|---|---|
| `is_pickup` | Ramassage | `true` | `isPickup` |
| `allow_inspection` | Ouverture du colis | `false` | `allowInspection` (par ligne) |
| `is_fragile` | Fragile | `false` | `isFragile` (par ligne) |
| `allow_card_payment` | Paiement par carte | `false` | `allowCardPayment` |
| `allow_testing` | Essai | `false` | `allowTesting` (par ligne) |
| `is_replacement` | Remplacement / échange | `false` | `isReplacement` |

`is_pickup` est déjà conditionnel : masqué en mode entrepôt transporteur, et masqué
quand le chauffeur est déjà passé (`pickupOffToday`). La politique doit **s'ajouter**
à ces règles, jamais les contredire.

## 3. Le modèle : défaut + autorisation

Décision : **deux contrôles par option**.

- `default_value` — la valeur d'ouverture de la case dans le modal.
- `agent_can_override` — si `false`, la case disparaît et la valeur forcée est
  `default_value`.

Conséquence à tenir : « masquée » ne veut pas dire « envoyée à `false` ». Une option
verrouillée sur `true` doit partir à `true`. C'est le piège principal de ce plan —
le modal ne doit pas confondre « non affiché » et « non coché ».

### Stockage

Nouvelle table `carrier_order_preferences`, une ligne par (transporteur, option) :

```
id            uuid pk
carrier_id    uuid → carriers  (on delete cascade)
option_key    text  -- CHECK dans la liste des six
default_value boolean not null default false
can_override  boolean not null default true
updated_at    timestamptz
unique (carrier_id, option_key)
```

Pourquoi par transporteur et non par marché : Tripoli et Benghazi sont deux lignes
`carriers`, et rien ne garantit qu'elles auront la même politique. L'absence de ligne
= le défaut codé actuel, donc **aucune migration de données n'est nécessaire** et le
comportement ne change pas tant que rien n'est configuré.

RLS : lecture pour tout rôle authentifié du marché (le modal en a besoin), écriture
`super_admin` seulement.

## 4. Sites d'entrepôt — le point à risque

Décision : désactiver un site touche **aussi** la ligne `warehouses`.

`warehouses.is_active` est déjà respecté par tout ce qui compte :
[`stock/route.ts:163`](../src/app/api/warehouse/stock/route.ts#L163),
[`pickup/route.ts:66`](../src/app/api/warehouse/pickup/route.ts#L66),
[`sites/route.ts:52`](../src/app/api/warehouse/sites/route.ts#L52).

**Le danger, mesuré en base :** Tripoli et Benghazi ont **chacun exactement un
warehouse_agent assigné**. Désactiver un site laisse son agent avec un `warehouse_id`
qui ne résout plus.

La règle CLAUDE.md est explicite : *un warehouse_agent sans site ne voit RIEN —
non assigné ne doit jamais vouloir dire non restreint.* Donc :

1. L'agent d'un site désactivé **ne voit rien**, avec un message explicite
   (« votre site est désactivé, contactez un administrateur ») — jamais un écran
   vide qui se lit comme un bug, et jamais un élargissement de périmètre.
2. La désactivation est **précédée d'un avertissement nommant les agents concernés**
   et le stock restant sur le site. On ne désactive pas un entrepôt par accident.
3. Un site `is_default = true` **ne peut pas** être désactivé sans qu'un autre site
   du marché devienne défaut d'abord. Tripoli (`ly`) et Tunis (`tn`) sont défaut
   aujourd'hui.

## 5. Découpage — TDD, test rouge d'abord à chaque étape

### Étape 1 — Table + RLS
Migration `carrier_order_preferences`. Tests : un `super_admin` écrit, un
`market_manager` ne peut pas, un agent lit celles de son marché uniquement.

### Étape 2 — Lecture de la politique
`src/lib/carriers/order-preferences.ts` : résout (transporteur) → politique
effective, en retombant sur les défauts codés quand la ligne manque. Fonction pure,
testée seule. **C'est ici que vit la distinction verrouillé-à-vrai / non-coché.**

### Étape 3 — Le modal obéit
`DarbAssabilDispatchModal` consomme la politique : les options non-surchargeables
disparaissent, les défauts s'appliquent à l'ouverture. Tests à écrire en premier :
- une option verrouillée sur `true` part bien à `true` dans le payload ;
- une option verrouillée n'est pas rendue ;
- `is_pickup` verrouillé ne réapparaît pas en mode entrepôt transporteur ni quand
  `pickupOffToday` — les règles existantes gagnent toujours.

### Étape 4 — L'écran des préférences
Sous l'onglet Transporteurs existant, par transporteur : les six options, deux
contrôles chacune. `docs/design-system.md` gouverne (console claire, vert `#15803D`
pour le chrome, couleur fonctionnelle sur statut uniquement).

### Étape 5 — L'écran des sites
Liste des `warehouses` du marché : nom, défaut, actif, agents assignés, stock.
Interrupteur `is_active` avec l'avertissement de §4 et le garde-fou « défaut ».

### Étape 6 — Vérification
`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
Relecture ciblée : `rls-reviewer` sur la nouvelle table, `i18n-reviewer` sur les deux
écrans (fr + ar, RTL).

## 6. Hors périmètre

- ~~**`fulfil_from_carrier_warehouse` reste par commande.**~~ **Revenu dessus le
  2026-09-16, à la demande.** La distinction que la première version ratait :
  la *disponibilité du stock* est bien per-commande (la tuile se grise déjà toute
  seule via `/api/orders/[id]/warehouse-availability`), mais « offrons-nous ce
  mode du tout » est une décision d'administration. Les deux se composent. Livré
  comme deux interrupteurs indépendants — voir docs §3 bis.
- **Pas de changement de rôle.** `market_manager` ne gagne aucun accès ici.
- **Le doublon d'écran transporteurs** (`settings/carriers` et `system/connections`)
  n'est pas traité ici. Il est réel et mérite sa propre décision.
