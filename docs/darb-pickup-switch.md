# Le ramassage du jour — « le chauffeur est passé »

Livré le 2026-09-12. Plan : `plans/darb-pickup-day-switch.md`.

## Le problème

Toute montée Darb part avec `isPickup: true` — bon défaut, Darb vient chercher
les colis chez nous. Mais une commande montée **après** le passage physique du
chauffeur inscrit malgré tout un ramassage, et le fait revenir pour des colis
qui n'existaient pas quand il était là.

## Le modèle

Un interrupteur **par site** (`warehouses.id`), pas par marché : Tripoli et
Benghazi sont deux bâtiments, deux comptes Darb, deux chauffeurs qui passent
séparément. Le site d'une montée se déduit de `carriers.warehouse_id`.

| | |
|---|---|
| Stockage | `settings`, clé `darb_pickup_disabled:<warehouse_id>` |
| Valeur | `{ "disabled_at": "<ISO>", "by": "<user_id>" }` |
| Remis à `true` | À minuit **heure locale du marché**, par comparaison à la lecture |

**Aucun cron.** On ne stocke pas un booléen à remettre à `true` la nuit, mais
l'**instant** de la pression. `isPickupDisabledNow()` le compare au jour local
courant : un horodatage d'hier n'est pas aujourd'hui, donc le ramassage revient
à son défaut tout seul. Une tâche nocturne aurait pour mode de défaillance un
ramassage coupé un jour de trop — exactement le problème qu'on corrige.

Réactiver avant minuit **efface** l'horodatage (`value = {}`) au lieu d'écrire
`false` : l'absence de pression **est** le défaut, et il n'y a qu'une forme à lire.

## Où c'est appliqué — un seul endroit

`performDispatch` (`src/lib/carriers/perform-dispatch.ts`), passage obligé des
**trois** chemins de montée : modale agent, montée en lot, cron
`dispatch_scheduled`. Il écrase `extra.is_pickup` à `false` quand l'interrupteur
du site est coupé.

Décider côté client ne tiendrait pas : `POST /api/orders/[id]/dispatch` recopie
`body.extra` tel quel, donc un `is_pickup: true` forgé passerait ; et les
chemins lot/cron n'envoient aucun drapeau. Une seule vérification les couvre.

**Exempté** : `fulfil_from_carrier_warehouse`. La marchandise est dans
l'entrepôt de Darb, ils se servent eux-mêmes — leur propre client désactive le
commutateur dans ce mode. Notre chauffeur n'y change rien.

L'adaptateur est inchangé : il lit déjà `extra.is_pickup !== false`
(`darb-assabil-adapter.ts:128`) et force déjà `true` en mode entrepôt
transporteur (`:254`).

## Qui presse quoi

`canTogglePickup()` — les deux sens ne sont **pas** symétriques :

| | Couper | Rallumer avant minuit |
|---|---|---|
| `warehouse_agent` | Oui, **son site uniquement** | **Non** |
| `market_manager` | Oui | Oui |
| `super_admin` | Oui | Oui |

Couper est une **observation** : l'agent a vu le chauffeur charger et partir, il
est le seul dans le bâtiment, il doit pouvoir le dire. Rallumer **contredit**
cette observation et reconvoque un chauffeur : c'est une décision de
responsable, pour qu'une mauvaise pression ne soit pas défaite en silence par
celui qui l'a faite.

Un agent sans `warehouse_id` ne touche à rien — non affecté n'est jamais
non restreint.

## Les surfaces

| Où | Composant |
|---|---|
| Banc agent (mobile) | `PickupSwitch variant="bench"` dans `BenchHome` |
| Console responsable | `PickupSwitch variant="console"` dans `BenchConsole` |
| Modale de montée Darb | La case « Ramassage » disparaît, remplacée par `optionPickupDisabledToday` |
| API | `GET`/`POST /api/warehouse/pickup` |

Libye uniquement : Darb est le transporteur qui réserve un ramassage à la
montée ; les transporteurs tunisiens n'ont pas cette notion.

## Le piège du fuseau

`marketTimezone()` ne résout **que l'UUID** du marché ; le code nu (`"ly"`)
tombe sur `Africa/Tunis`, une heure d'écart — de quoi déplacer minuit et
réinitialiser l'interrupteur au mauvais moment. `pickup-window.ts` accepte donc
les deux formes (`toMarketId`), et un test le verrouille.

## Fichiers

| | |
|---|---|
| Logique + permissions | `src/lib/carriers/pickup-window.ts` |
| Application | `src/lib/carriers/perform-dispatch.ts` |
| API | `src/app/api/warehouse/pickup/route.ts` |
| Composant | `src/components/warehouse/pickup/PickupSwitch.tsx` |
| Hook modale | `src/hooks/useDarbPickupState.ts` |
| Tests | `src/lib/carriers/__tests__/pickup-{window,permissions}.test.ts`, `perform-dispatch-pickup.test.ts` |
