# Réception de marchandises

État au 30 septembre 2026 · branche `feat/goods-reception` · worktree `.claude/worktrees/goods-reception`

## Pourquoi

Le stock ne pouvait monter que par trois portes, et aucune ne décrit une livraison :

| Porte | Qui | Par site | Lignes écrites depuis toujours |
|---|---|---|---|
| `initial_stock` à la création d'un produit | super_admin | non | 7 |
| `adjust_product_stock` (+ `manual_adjustment`) | super_admin | non | 3 |
| `record_stock_count` (comptage absolu) | agent / manager / SA | oui | **0** |

Une livraison fournisseur était donc un nombre tapé dans une fiche produit. Pas de
fournisseur, pas de bon de livraison, pas d'écart entre l'attendu et le reçu, pas de
coût, pas de bâtiment. « D'où viennent ces 40 unités » n'avait pas de réponse, et le
registre — ce qui rend tous les autres mouvements auditables — recevait un
`manual_adjustment` nu.

Le besoin avait déjà été spécifié (`docs/prototypes/entrepot-redesign.md` §7 :
`record_reception`, motif `reception`) puis abandonné **deux fois**
(`docs/design/entrepot/README.md`, `plans/entrepot-light-rebuild.md`) pour une raison
écrite noir sur blanc : « ces flux n'existent pas dans le modèle de données ».

## Le workflow professionnel, et ce qu'on en a retenu

La pratique standard sépare **trois documents** que l'intuition confond :

| Document | Question | Stock | Argent |
|---|---|---|---|
| Bon de commande | ce qu'on a commandé | non | non |
| **Réception** | ce qui est arrivé, est-ce acceptable | **oui** | non |
| Facture + paiements | ce qu'on doit, ce qu'on a payé | non | **oui** |

Ils divergent en permanence : on commande 500, 480 arrivent, on est facturé 500, on
paie en deux fois. L'écart entre 1 et 2 attrape les manquants ; entre 2 et 3, la
surfacturation (le *rapprochement à trois voies*).

**Décision prise** : on construit le document 2 en entier, avec le coût. Le document 1
est remplacé par une réception « attendue » (statut `draft` portant les quantités
prévues), qui est un bon de commande léger et suffit à produire « en route ». Le
document 3 est réduit à une liste de paiements attachée à la réception — choix assumé,
dont la limite est nommée plus bas.

## Le modèle (construit, testé)

`supabase/migrations/20260930120000_goods_reception.sql`

```
receptions          market, warehouse, reference (REC-LY-2026-0042), supplier_name,
                    supplier_ref, status, expected_at, photo_url,
                    supplier_invoice_id (nullable, sans cible — la porte laissée
                    ouverte pour une comptabilité fournisseur),
                    reverses_reception_id, submitted_at/by, posted_at/by
reception_lines     product_id, variant_id, expected_qty, received_qty,
                    damaged_qty, unit_cost
reception_payments  paid_at, amount, method, note
inventory_log       + reception_id, + motifs `reception` et `reception_reversal`
```

```
draft ──(l'agent a compté)──► submitted ──(le manager valide)──► posted ──► reversed
  └──────────► cancelled ◄────────┘          ↑ SEUL ce geste écrit le registre
```

Un manager peut valider directement depuis `draft` : il est à la fois déclarant et
validateur, aucune raison de le faire cliquer deux fois.

### Les cinq décisions structurantes

1. **La validation CRÉE la ligne `product_site_stock`.** Le déclencheur de ventilation
   (`inventory_log_apply_to_site`) fait un `UPDATE`, jamais un `upsert` : sans création
   préalable, une réception sur un (produit, variante, site) jamais compté bougerait le
   total marché et **manquerait le bâtiment en silence**. Une livraison est la meilleure
   preuve de l'endroit où sont les unités. La ligne naît à 0 et le déclencheur ajoute,
   donc aucune répartition n'est inventée pour les unités non apportées. *C'était le vrai
   piège, et c'est l'assertion centrale du test SQL.*

2. **Abîmé à l'arrivée n'entre pas en stock** et n'est **pas** `damaged_return_count`,
   qui veut dire « revenu cassé d'un client » et alimente le taux de retour. Des unités
   arrivées cassées n'ont jamais été vendables : c'est un litige fournisseur. Elles vivent
   sur la ligne, la valeur reçue les exclut, deux fausses lignes de registre sont évitées.

3. **Le coût est capturé toujours, propagé jamais tout seul.** `products.unit_cogs` est un
   scalaire *courant* qu'un P&L fenêtré sur événements et `investor_order_facts` lisent en
   direct : le réécrire recalcule la marge des commandes **déjà livrées**.
   `reception_lines.unit_cost` garde le prix pour toujours ; `p_adopt_costs` (faux par
   défaut, et qui doit arriver à `true` strictement) est le seul chemin vers `unit_cogs`.

4. **Le paiement est une liste, pas une case.** « payé / partiellement payé » se déduit de
   `somme(paiements)` contre la valeur reçue. Deux acomptes sur une livraison marchent
   d'emblée et le reste à payer ne peut pas se désynchroniser de ses lignes.

5. **« En retard » est un calcul, pas un statut** : `expected_at < aujourd'hui` sur une
   réception non validée. Un drapeau stocké demanderait un cron et serait faux le jour où
   il ne tourne pas.

### Sécurité

- `post_reception` exige `auth.uid() = p_actor_id` sous la forme **stricte** (refus si
  `auth.uid()` est NULL), contrairement à `record_stock_count` dont la forme
  `IS NOT NULL AND <>` laisse passer un appel anon — alors que `p_actor_id` décide du
  **marché**.
- Les trois RPC sont `REVOKE`ées de `PUBLIC` et d'`anon` avant d'être accordées à
  `authenticated`.
- RLS sur les trois tables, helpers enveloppés en `(SELECT …)` pour rester dans l'InitPlan.
- `reception_payments` n'est lisible que par manager/SA — un paiement est une information
  d'argent.
- **Le coût est retiré côté serveur** pour un `warehouse_agent`, pas masqué en CSS : en
  production `unit_cogs` est accordé à `authenticated` malgré ce qu'affirme la doc, donc
  masquer côté client ne serait pas un contrôle. Les routes d'écriture forcent aussi
  `unit_cost` à NULL quand l'appelant est un agent.

## Ce qui est fait

| Étape | État | Où |
|---|---|---|
| Migration (3 tables, 2 motifs, 2 RPC, RLS, immutabilité) | ✅ | `supabase/migrations/20260930120000_goods_reception.sql` |
| Test SQL — 9 sections sous un vrai JWT | ✅ vert | `supabase/tests/goods_reception_test.sql` |
| Règles dérivées (paiement, écart, retard, moyenne pondérée) | ✅ 26 tests | `src/lib/receptions/derive.ts` |
| Permissions par rôle | ✅ 11 tests | `src/lib/receptions/permissions.ts` |
| Projection par rôle (le coût retiré) | ✅ 19 tests | `src/lib/receptions/project.ts` |
| 6 routes API | ✅ 16 tests sur `post` | `src/app/api/warehouse/receptions/**` |
| Maquette v1 puis v2 | ✅ | `prototypes/reception-marchandises-v{1,2}.html` |

**72 tests JS + 9 sections SQL au vert.** `npm run typecheck` propre.

Le test SQL a attrapé un bug réel : la contre-passation naissait `posted` et le
déclencheur d'immutabilité refusait d'insérer ses lignes. Elle naît maintenant en
brouillon et se valide à la fin — elle respecte la règle au lieu de s'en exempter.

## Ce qui reste

1. **Le hook SWR** `useReceptions` dans `src/hooks/` — les écrans Stock appellent
   `useSWR` en ligne aujourd'hui ; ne pas en ajouter un quatrième.
2. **Les composants React** : `ReceptionsConsole` (liste), `ReceptionSheet` (feuille
   plein écran, `?reception=<id>`), le dialogue de validation, la création. Plus le
   troisième segment dans `StockConsole.tsx`.
3. **Traductions** `fr.json` + `ar.json`, et la relecture RTL à 390 × 844.
4. **Le Journal** : ajouter la pastille `Réception` — **et d'abord corriger ce qu'il
   cache**. `src/lib/warehouse/history-fetch.ts:252` ne liste que quatre motifs, donc
   `stock_count`, `received_back` et `initial_stock` sont invisibles dans le Journal et
   son export. Ajouter un motif à une vue qui ment déjà par omission n'est pas acceptable.
5. **« En route »** sur l'onglet Niveaux = Σ `expected_qty` des réceptions non validées.
   `null` quand il n'y a rien en cours, jamais `0`.
6. **Les docs** : `docs/reception-de-marchandises.md`, la liste des chemins de stock dans
   `CLAUDE.md` (la réception devient le chemin 6), la liste fermée de
   `docs/database-schema.md` §8, et retirer les mentions « n'existent pas dans le modèle
   de données » de `docs/design/entrepot/README.md`.

## Décisions prises (30 sept 2026)

1. **Devise = celle du marché** (TND / LYD). Pas de colonne `currency` ni `fx_rate` — ne
   pas en ajouter par anticipation. Si des imports commencent, la migration est petite
   mais **toutes les surfaces de coût doivent être relues**.
2. **Le double geste reste** : l'agent déclare, le manager valide.
3. **Pas de table fournisseurs** — nom libre + leur référence.
4. **Pas de bon de commande** — la réception « attendue » en tient lieu.
5. **Pas de couches FIFO** — l'historique par ligne les rend constructibles sans reprise.
6. **Paiements attachés à la réception**, pas de facture fournisseur.

## La limite connue du choix 6

**Un seul versement couvrant trois livraisons n'a pas sa place dans ce modèle.** C'est la
conséquence directe d'avoir attaché les paiements à la réception plutôt qu'à une facture.
Deux acomptes sur *une* livraison marchent ; une facture groupée non.

Quand cela arrivera, la sortie est déjà ménagée : `receptions.supplier_invoice_id` existe,
nullable et sans cible. Créer `supplier_invoices` et y repointer les lignes de paiement
existantes est additif — aucune réécriture de ce qui est construit ici.

## Vérification

- `supabase/tests/run.sh goods_reception_test.sql` — base **locale** uniquement (ces tests
  écrivent pour de vrai et ne nettoient pas ; pas de ROLLBACK, sinon les déclencheurs
  `DEFERRABLE INITIALLY DEFERRED` ne s'évaluent jamais).
- `npx vitest run src/lib/receptions src/app/api/warehouse/receptions`
- `npm run typecheck`. **`npm run lint` ne fait rien** dans ce dépôt (pas de config
  ESLint) — ne jamais annoncer « lint propre ».
- Sur la base locale, en `ly_warehouse` puis `ly_manager` : annoncer une réception de
  3 lignes sur Tripoli, en déclarer 2 courtes et 1 abîmée, valider, puis vérifier en SQL
  que les trois niveaux ont bougé de la quantité reçue et qu'il existe **une** ligne
  `inventory_log` par ligne avec `reason='reception'` et le bon `warehouse_id`.
- Vérifier qu'un produit jamais compté sur Tripoli obtient sa ligne
  `product_site_stock` par la seule réception, et que « Non ventilé » baisse d'autant.
- Contre-passer, vérifier le retour des trois niveaux et les deux lignes de registre.
- Vérifier que les champs de coût sont **absents** du corps de réponse pour un agent.

### Note sur la suite de tests complète

`npx vitest run` donne **8107 passants / 24 échecs** sur 692 fichiers. Les 14 fichiers en
échec (leads, metrics, carriers dexpress, storefronts buybox, sidebar, settings,
DatePicker, market-scope, webhook-handler, label-prints, DarbStatusSection) sont
**antérieurs à ce travail** : aucun n'importe quoi que ce soit de `src/lib/receptions`, et
`src/app/api/leads/campaigns/preview/route.test.ts` échoue à l'identique sur le commit de
base `8e0f8cc`, vérifié par `git checkout`. Ne pas les attribuer à la réception, et ne pas
les « corriger » au passage : chacun est une décision, pas une coquille.
