# Variantes produit

Référence du modèle à deux axes : ce qu'est une variante, ce qui porte du
stock, par où ça passe, et ce qui reste à faire.

## 1. Pourquoi

Les variantes n'étaient pas absentes — elles étaient **simulées**. Le catalogue
porte la même doudoune de boxe en trois produits séparés (صغير / متوسط / كبير,
COGS 25 / 20 / 30, prix 129 / 179 / 199), plus une quatrième ligne retirée pour
la *même* taille à un autre prix. `src/lib/carriers/carrier-warehouse.ts`
portait déjà un avertissement : la correspondance transporteur ne doit jamais se
faire par nom, « parce que notre catalogue porte deux "دميه ملاكمه حجم كبير" à
des prix différents ». Le contournement avait déjà fait mal une fois.

En parallèle, trois mécanismes à moitié construits coexistaient :

1. `product_variants` existe depuis `001_initial_schema.sql`, signifiait
   **palier de quantité**, était lue par la fiche agent et `CreateOrderModal`,
   et avait des routes POST/PATCH **que rien n'appelait**.
2. `order_items.variant_id`, `orders.product_variant_id`,
   `storefront_product_mappings.product_variant_id` et
   `carrier_product_mappings.product_variant_id` existaient tous. En production :
   **0 commande sur 8 581 et 0 ligne sur 4 381** portaient une variante.
3. Les boutiques envoyaient de vraies variantes
   (`القرآن-تدبر-وعمل-حجم-كبير`, `أكمام…(white, 4 قطع ب 149 دل)`) et l'intake
   les aplatissait : `product-resolver.ts` écrivait `product_variant_id: null`
   en dur sur ses chemins SKU et nom.

## 2. Les deux axes

Pas de matrice d'options. Deux natures, portées par `product_variants.kind` :

| `kind` | Ce que c'est | Porte du stock ? | Exemple |
|---|---|---|---|
| `attribute` | Un objet physique distinct | **Oui** — son stock, son coût, son SKU | Petit / Moyen / Grand |
| `pack` | Une façon de vendre le même objet | **Non** — il en consomme `quantity` fois | « Pack 2 » |

Ajouter une 4ᵉ taille ajoute **une** ligne, pas douze. Le défaut de la colonne
est `'pack'`, ce qui laisse aux deux lignes préexistantes exactement le sens
qu'elles avaient.

Une ligne de commande vendue en palier porte **les deux** colonnes :
`order_items.variant_id` = la taille qui sort du rayon,
`order_items.pack_variant_id` = l'offre vendue (pour répondre à « combien de
Pack 2 avons-nous vendus »). Le stock n'a besoin d'aucune colonne de plus : un
palier, c'est déjà `order_items.quantity`.

## 3. Les trois niveaux de stock

```
products.current_stock            ← total marché, ce que lisent les finances
  └─ product_variants.current_stock   ← la part d'une taille
       └─ product_site_stock          ← par bâtiment, clé (produit, variante, site)
```

`product_site_stock` est keyée
`UNIQUE NULLS NOT DISTINCT (product_id, variant_id, warehouse_id)` : une
`variant_id` nulle signifie « le stock du produit sans variante ».

Les règles sont des **INÉGALITÉS**, jamais des égalités :

- `somme(variantes d'attribut) <= products.current_stock`
- `somme(sites d'une variante) <= cette variante`
- `somme(tous les sites d'un produit) <= products.current_stock`

Ce qui n'a pas été ventilé reste au niveau du dessus plutôt que d'inventer une
répartition. C'est pour cela que le modèle est **inerte** tant que personne n'a
créé de variante ni compté de site.

### La règle du « non ventilé »

Corollaire direct, et la chose la plus facile à rater : **ce qui part sans
variante nommée ne peut sortir que du stock non encore attribué**, soit
`total − somme(variantes)`. Sur un produit ventilé à 100 %, un colis « produit
nu » est refusé — la question « quelle taille le client a-t-il reçue ? » n'a
pas de réponse. `scan_order_out` et `adjust_product_stock` le contrôlent à
l'entrée ; les déclencheurs différés restent le filet pour toute écriture
directe.

### Les invariants sont DIFFÉRÉS

Les quatre déclencheurs (`trg_variant_stock_within_total`,
`trg_products_total_covers_variants`, `trg_variant_site_within_variant`,
`trg_variant_covers_its_sites`) sont `DEFERRABLE INITIALLY DEFERRED` : ils ne
s'évaluent qu'au COMMIT, parce qu'une opération en plusieurs écritures traverse
forcément des états intermédiaires incohérents.

Deux conséquences pratiques :

- **Un test encadré d'un ROLLBACK ne les déclenche jamais.** C'est exactement
  ainsi que `assert_site_stock_within_total` a été « vérifié en production » le
  2026-09-09 alors qu'il plantait sur toute écriture de `products`
  (20260909195032). Voir `supabase/tests/` pour la façon correcte.
- **Ils branchent sur `TG_RELID` (l'OID), jamais sur `TG_TABLE_NAME`** : dans un
  déclencheur différé le nom ne résolvait pas, `NEW.product_id` était lu sur
  `products` qui n'a pas cette colonne, et tout scan mourait au COMMIT.

## 4. Par où le stock passe

`order_stock_lines(order_id)` reste la seule définition de « que contient ce
colis ». Elle rend désormais une ligne par **(produit, variante d'attribut)** et
alimente `scan_order_out`, `unscan_order`, `scan_return_in`,
`scan_received_in` et `manual_delete_orders`.

Trois choses qu'elle fait et qu'il faut connaître :

1. **Elle normalise les paliers à NULL.** Une `order_items.variant_id` qui
   désigne un `kind='pack'`, ou une variante d'un autre produit, est ramenée au
   produit. Sans cela on déduirait le stock d'une ligne qui n'en a jamais eu.
2. **Elle désigne UNE SEULE ligne principale** (`row_number()`). Au grain
   produit une seule pouvait porter `orders.product_id` ; au grain variante deux
   le peuvent, et `stock_after` dépendrait de l'ordre de la boucle.
3. **Elle n'est exposée à personne** — ni `anon`, ni `authenticated`. Elle ne
   prend pas d'acteur : publiée, un id de commande suffirait à lire le contenu
   de n'importe quelle commande des deux marchés. Les RPC l'atteignent par leur
   privilège de définisseur.

### Un mouvement, une ligne de registre — par variante

20260910155554 écrivait « un produit, un mouvement » en agrégeant par produit.
On écrit désormais **une ligne par (produit, variante)** : une commande Petit ×3
+ Grand ×2 laisse deux lignes. Les soldes restent exacts (les UPDATE sont
séquentiels dans la même transaction) et **`balance_after` reste le total marché
du produit**, jamais celui de la variante, pour que les finances lisent la même
grandeur qu'avant. Deux paliers du même produit, eux, restent agrégés : ils
désignent le même objet.

### Qui fait l'arithmétique

Les RPC n'écrivent que `products`. Le trigger `inventory_log_apply_to_site`
applique chaque ligne de registre à `product_variants` **et** à
`product_site_stock`. Une RPC qui toucherait aussi `product_variants`
compterait deux fois.

L'exception est `record_stock_count` : le trigger s'arrête sur
`reason = 'stock_count'` — un comptage **pose** une valeur, il ne se propage
pas — donc la RPC reporte l'écart elle-même.

**Un comptage de site ne pose pas le total de la variante.** Il pose la valeur
DU SITE et reporte un **écart** sur la variante puis sur le produit. Confondre
les deux ferait disparaître le stock des autres bâtiments à chaque comptage.

**Quel écart — le réservoir du non ventilé (2026-10-02,
`20261002190000_record_stock_count_draws_from_pool`).** Jusque-là l'écart était
`compté − valeur du site`, et un bâtiment jamais compté valait 0 : Benghazi
comptant 900 Corans sur un registre de 943 portait le total à 1 843. Chaque
premier comptage doublait le stock. La règle, au grain produit × variante :

1. ce qu'un bâtiment compte **en plus** de ce qu'il tenait sort d'abord du non
   ventilé (niveau − somme des bâtiments) ; le total ne monte que de
   l'excédent ;
2. une **baisse** à un bâtiment est une perte : le total baisse d'autant ;
3. quand **tous les bâtiments actifs** du marché ont compté
   (`last_counted_at`), le niveau vaut **exactement** la somme des bâtiments ;
   ce qu'aucun n'a trouvé est l'écart de comptage. Un marché à un bâtiment
   (Tunisie) : compter le bâtiment, c'est compter le marché.

La RPC rend en plus `site_delta`, `from_pool` et `closed` ; `delta` reste
l'écart du total marché. Prouvé par `supabase/tests/stock_count_pool_test.sql`.

### Sous-débit : deux grains

Passer au grain variante ouvre un trou qui n'existait pas. Avec un produit à 5
unités, une ligne Petit ×3 et une ligne Grand ×3 passent **chacune** le test
« 5 − 3 >= 0 », et le total tombe à −1. `scan_order_out` contrôle donc :

1. le **produit**, sur la SOMME de ses lignes ;
2. chaque **variante**, ligne par ligne ;
3. le **non ventilé**, pour les lignes sans variante.

Verrous pris produits d'abord (par id), variantes ensuite (par id) : ordre
global identique pour tous les scans, donc pas d'interblocage.

## 5. Le SKU : un seul espace de noms par marché

`products.sku` et `product_variants.sku` partagent **une** unicité par marché,
gardée par un trigger croisé (`assert_sku_unique_in_market`). Sans lui, la
recherche unique de SKU de l'intake aurait silencieusement préféré le produit —
la classe d'erreur exacte contre laquelle `carrier-warehouse.ts` mettait en
garde. Le conflit remonte en `23505` et les routes le traduisent en 409.

Ordre de résolution de l'intake (`product-resolver.ts`), du plus fort au plus
faible :

1. `storefront_product_mappings` (correspondance explicite)
2. **SKU de variante** — `kind='attribute'` seulement, borné au marché : résout
   le produit ET la taille
3. SKU de produit
4. nom ILIKE → `needs_review`
5. rien → `unmatched`

## 6. Privilèges — le piège vérifié

- **`CREATE OR REPLACE FUNCTION` CONSERVE les privilèges.**
- **`DROP FUNCTION` + `CREATE FUNCTION` les REMET À ZÉRO**, et le défaut
  PostgreSQL est `EXECUTE` pour `PUBLIC` — donc pour `anon`, donc sans
  connexion.

Toute migration qui change la signature d'une RPC doit donc re-révoquer
explicitement. 20260924130000 le fait pour `order_stock_lines`,
`record_stock_count` et `adjust_product_stock`, puis **l'affirme** : un bloc
final échoue la migration si l'une d'elles est restée ouverte.

Autre piège, côté table : les privilèges de `product_variants` sont accordés
**colonne par colonne**. Une colonne ajoutée n'hérite de rien, et
`select("*, product_variants(*)")` part alors en « permission denied » pour tout
le monde sauf le service role.

## 7. Permissions

Créer, modifier et supprimer une variante est **super_admin seul**
(`canManageProducts`), comme les coûts et le stock. Managers et agents la
**lisent** (quatre politiques RLS préexistantes, plus fines que « super_admin
pour tout » : lecture manager sur son marché, lecture agent sur produit actif ET
variante active).

Le note agent par variante (`agent_note`) reste ouvert au market_manager via
`update_variant_agent_note` — c'est le discours de vente, pas le modèle.

## 7 bis. Deux failles trouvées en auditant ce travail

Ni l'une ni l'autre n'est née ici — les deux ont été trouvées en relisant le
périmètre, et corrigées avec lui.

### L'acteur n'était pas lié à la session

`scan_return_in` et `scan_received_in` lisaient `users` par **`p_actor_id`**,
l'argument, sans vérifier qu'il s'agissait bien de la session. Or c'est cette
lecture qui décide du MARCHÉ. Le scénario n'est pas celui qu'on imagine :
passer l'id de quelqu'un de l'autre marché ne mène nulle part (la garde
s'évalue alors contre ce marché-là et refuse). Le trou est l'inverse —
**emprunter l'identité de quelqu'un du marché visé**. Un agent d'entrepôt
libyen passant l'id du super_admin tunisien clôturait un retour tunisien,
inscrit au registre en écriture seule au nom de quelqu'un qui n'avait rien fait.

`20260909132021` annonçait pourtant que ces deux fonctions recevraient « le
même contrôle d'acteur dans 20260922000012 ». **Cette migration n'a jamais
existé** ; seule `record_stock_count` l'a obtenu. Les deux autres ont été
réécrites deux fois depuis sans jamais l'avoir. Corrigé dans 20260924130000,
avec `adjust_product_stock` au passage (déjà réservée au super_admin, mais le
registre est en écriture seule : une ligne signée du mauvais nom ne se corrige
jamais).

La garde ne mord que si `auth.uid()` n'est pas NULL : le webhook et les tâches
planifiées tournent sans session et doivent continuer à passer.

### Un market_manager pouvait supprimer une variante

`product_variants_delete_sa_mm` datait du schéma initial.
`20260427221856_product_stock_lockdown.sql` a resserré INSERT et UPDATE à
super_admin, et le DELETE de `products` — mais **jamais le DELETE de
`product_variants`**. Comme `authenticated` porte le privilège DELETE sur la
table, un manager pouvait appeler PostgREST directement et contourner d'un coup
le verrou super_admin de la route, son contrôle de stock et son contrôle de
références. Le plus grave : `order_items.variant_id`,
`orders.product_variant_id` et `storefront_product_mappings.product_variant_id`
sont tous `ON DELETE SET NULL`, donc l'historique perdait le lien **en
silence**. Seul `inventory_log.variant_id` est protégé en base.

Corrigé par `20260924140000_product_variants_delete_lockdown.sql`, qui remplace
la politique et **vérifie** ensuite qu'aucune politique de suppression ne nomme
encore `market_manager`. La LECTURE est intacte : une politique
`FOR ALL ... super_admin` posée à la place aurait retiré les paliers de la fiche
agent en plein appel.

## 8. Supprimer une variante

`DELETE /api/products/[id]/variants/[variantId]`, sur le précédent des motifs de
rejet (`docs/rejection-reasons.md`) :

- **409** tant que `current_stock > 0` ou `damaged_return_count > 0` — supprimer
  laisserait ces unités dans le total marché sans plus rien pour dire de quelle
  taille elles sont ;
- **retrait en douceur** (`is_active = false`) si une commande, une ligne de
  commande, une ligne de registre ou une correspondance boutique s'y réfère —
  une commande passée sur « Grand » doit continuer à dire « Grand » ;
- **suppression franche** sinon.

L'écran dit lequel des deux a eu lieu : annoncer « supprimé » puis réafficher la
ligne grisée est la façon la plus sûre de faire croire que l'écran est cassé.

Ces trois règles vivent dans la route, donc au-dessus de la base. Ce qui les
rendait contournables — le DELETE direct d'un market_manager — est fermé depuis
20260924140000 ; il reste qu'un super_admin déterminé peut toujours écrire sur
la table à la main. Un `ON DELETE RESTRICT` sur les trois colonnes actuellement
en `SET NULL` serait la ceinture correspondante, et n'a pas été posé ici :
changer le comportement de suppression de `order_items` et `orders` dépasse le
périmètre des variantes.

## 9. Où c'est

| Sujet | Fichier |
|---|---|
| Schéma des variantes | `supabase/migrations/20260920162309_variant_stock_axis.sql` |
| RPC de stock au grain variante | `supabase/migrations/20260924130000_variant_stock_rpcs.sql` |
| Tests SQL (invariants inclus) | `supabase/tests/stock_variant_axis_test.sql` |
| Résolution à l'intake | `src/lib/storefronts/product-resolver.ts` |
| API variantes | `src/app/api/products/[id]/variants/` |
| Écran d'édition | `src/components/products/ProductVariantsEditor.tsx` |
| Fiche agent (paliers seuls) | `src/app/api/orders/[id]/product-sheet/route.ts` |
| Plan et historique | `plans/product-variants.md` |

## 10. Ce qui reste

- **Les adaptateurs boutique gardent `items[0]`.** `shopify-adapter.ts:95`,
  `woocommerce-adapter.ts:85`, `lightfunnels-adapter.ts:119`,
  `easy-orders-adapter.ts:91`, `buybox-adapter.ts:95` jettent tous les lignes
  2..n, et Buybox empile les upsells dans `customer_note`. C'est un chantier à
  part : il faut d'abord que le webhook écrive `order_items`, ce qu'il n'a
  jamais fait (`src/lib/orders/webhook-handler.ts` n'insère que dans `orders`).
- ~~`order-lines.ts` ne lit pas `variant_id`~~ — **fait le 2026-09-25.**
  `variant_label` est un INSTANTANÉ de texte : renommer « Grand » en « Large »
  laissait toutes les commandes en cours afficher l'ancien mot, et deux lignes
  au même libellé étaient indiscernables. Le libellé reste affiché — c'est ce
  que l'agent a vendu — mais l'identité vient de `variant_id`. La ligne
  dénormalisée de repli porte `variant_id: null`, honnêtement :
  `WarehouseOrderRow` n'a jamais sélectionné d'identifiant de variante, et une
  commande d'avant `order_items` n'en a aucun à sélectionner.
- ~~`isMixed` à revisiter~~ — **réexaminé le 2026-09-25, et la règle TIENT**,
  pour une meilleure raison qu'à l'origine. Elle a été écrite quand les tailles
  étaient simulées en produits séparés, ce qui aurait rendu « mixte » tout colis
  à deux tailles. Maintenant qu'une taille est une variante d'UN produit, deux
  tailles sont vraiment un seul rack : grouper par `product_id` envoie le
  préparateur à un seul endroit. Keyer sur la variante pousserait chaque colis
  à deux tailles dans le panier « mixte » et jetterait ce bénéfice — sans rien
  gagner, puisque `RunParcel` affiche déjà chaque ligne avec son libellé.
- **`get_stock_position`** reste au grain produit, et c'est correct pour ce
  qu'elle mesure.
- ~~`ProductCreateForm` sans étape variantes~~ — **fait le 2026-09-25.** Un
  interrupteur « Ce produit se décline », **éteint par défaut** parce que 12 des
  13 produits n'en ont pas et ne doivent pas payer le prix de la nouveauté.
  Allumé, le coût, le prix, le SKU et le stock **quittent le produit** pour le
  tableau des tailles : ils ne peuvent pas vivre aux deux endroits, sinon
  personne ne sait lequel fait foi — et c'est le produit que lisent les
  finances quand aucune variante n'est nommée.

  `POST /api/products` accepte `variants[]` et fait la séquence côté serveur
  (produit → variantes → registre). Orchestrer depuis le navigateur
  multiplierait les fenêtres d'échec : un produit créé, deux variantes sur
  trois, et rien pour dire où ça s'est arrêté. Si une variante échoue malgré
  tout, la route rend **207** avec ce qui a été créé, et l'écran emmène
  l'auteur sur la fiche produit avec le message — plutôt que de le laisser
  croire que rien n'existe et recommencer.

  L'ordre d'écriture n'est pas libre : le produit naît avec le total COMPLET,
  puis les variantes montent depuis zéro. L'inverse casserait l'inégalité
  `somme(variantes) <= total` au COMMIT.
