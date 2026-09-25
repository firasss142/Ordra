# Intake multi-lignes

Comment une commande boutique à plusieurs produits arrive enfin entière.

## 1. Le défaut

Deux troncatures se cumulaient.

**Les adaptateurs ne lisaient que la première ligne.** `shopify-adapter.ts`,
`woocommerce-adapter.ts`, `lightfunnels-adapter.ts` et `easy-orders-adapter.ts`
faisaient tous `items[0]` et jetaient le reste. `buybox-adapter.ts` faisait pire
en apparence et mieux en intention : il empilait les upsells dans
`customer_note`, lisible par l'agent, invisible pour tout le reste.

**Le webhook n'écrivait jamais `order_items`.** `webhook-handler.ts` posait un
seul produit dénormalisé sur `orders` et s'arrêtait. `order_items` porte la
vérité depuis juin 2026 — mais seulement pour les commandes créées DANS Ordra.

Résultat : un client qui achetait trois articles arrivait comme un. Le
préparateur en emballait un, `order_stock_lines` n'en trouvait qu'un, et le
stock ne bougeait que pour celui-là. L'écart ne se constatait qu'au comptage
physique, des semaines plus tard, sans rien pour l'expliquer.

## 2. Le modèle

`InternalOrderData` gagne `lines: InternalOrderLine[]`.

```
orders                      ← UNE ligne dénormalisée : la PREMIÈRE
  product_id, product_name, quantity, unit_price, variant_label
order_items                 ← TOUTES les lignes, une par produit vendu
  product_id, variant_id, product_name, variant_label,
  quantity, unit_price, line_total
```

**La ligne dénormalisée reste la première, et garde exactement son sens.** Une
cinquantaine d'endroits la lisent, et `order_stock_lines` s'en sert encore comme
repli pour les commandes antérieures à `order_items`. `lines[0]` reflète
toujours les champs plats : une commande à une ligne se comporte au mot près
comme avant.

**`lines` est OPTIONNEL.** Un adaptateur qui ne sait pas encore faire du
multi-lignes — ou une source qui n'en a qu'une, comme la feuille Converty —
l'omet, et le webhook retombe sur les champs plats. Une liste vide dirait « ce
colis ne contient rien » ; l'absence dit « je n'ai qu'une ligne à déclarer ».

## 3. Chaque ligne résout son propre produit

`resolveProduct` tourne une fois PAR LIGNE, avec le SKU et l'identifiant de
variante de cette ligne. Une commande peut donc mélanger une ligne reconnue par
correspondance explicite, une par SKU de variante, et une pas reconnue du tout.

**`mapping_status` est le PIRE de toutes les lignes**, plus la ville. Ce statut
alimente la file de revue humaine : une commande dont la deuxième ligne n'a pas
été reconnue doit s'y présenter. Prendre le résultat de la première ligne la
laisserait passer en silence.

Une ligne non résolue ne bouge pas de stock — `order_stock_lines` écarte les
lignes sans `product_id`. C'est le comportement prudent : on ne déduit pas un
produit qu'on ne sait pas nommer. Le statut de revue est là pour qu'un humain
tranche.

## 4. Les upsells Buybox sont des produits

Ils deviennent de vraies lignes. La note reste écrite — l'agent la lit encore en
appel — mais le tapis de prière vendu avec le Coran existe désormais dans le
colis que le préparateur voit.

**`total_price` n'est PAS recalculé.** Il reste `product.total_price`, comme
avant. Le revenu, c'est `orders.total_price` et rien d'autre ; si Buybox facture
les upsells à part, c'est une question à régler avec eux, pas un chiffre à
inventer ici. Un upsell sans prix est enregistré à 0 : la ligne existe pour dire
« mets ça dans le carton », pas pour redire l'argent.

## 5. Ce que ça change pour les investisseurs

Rien sur le total, quelque chose sur la répartition.

`attributeOrderRevenue` ventile `orders.total_price` entre les produits d'une
commande, au poids des `line_total`. Le total distribué est toujours exactement
`orders.total_price` : le revenu est conservé, jamais recalculé.

Avant, une commande boutique n'avait pas de `order_items` : le moteur retombait
sur `[{ productId: orders.product_id, lineTotal: orders.total_price }]` et
attribuait **100 % du revenu au premier produit**. Désormais il ventile entre
les vraies lignes.

C'est plus juste, et ça ne vaut **que pour les commandes à venir** — les
commandes existantes n'ont toujours pas de `order_items` et gardent leur
attribution. Aucun relevé passé ne bouge.

Cas particulier : un upsell Buybox sans prix pèse 0, donc reçoit ~0 % du revenu
et le produit principal garde ~100 %. C'est exactement ce qui se passait avant.

## 6. L'échec est toléré, délibérément

Si l'écriture de `order_items` échoue, la COMMANDE reste. Refuser le webhook
ferait perdre la vente — une boutique ne rejoue pas toujours. Sans
`order_items`, `order_stock_lines` retombe sur la ligne dénormalisée :
l'ancien comportement, dégradé mais cohérent.

L'appel est encadré d'un `try/catch` et pas seulement d'un test d'erreur : une
insertion qui *lève* remonterait hors du gestionnaire et le webhook répondrait
500 pour une commande déjà enregistrée. La boutique verrait un échec pour une
vente qu'on a gardée.

## 7. Ce qui reste

- **`create-order-from-data.ts`** (synchro Google Sheets / Converty) n'écrit pas
  `order_items`. La source est mono-ligne par construction, donc le repli sur la
  ligne dénormalisée est exact — c'est de l'uniformité qui manque, pas de la
  justesse. Laissé tel quel plutôt que de toucher une synchro qui marche.
- **Les commandes déjà en base** gardent une seule ligne. Rien n'est rétro-actif :
  les charges utiles d'origine sont dans `orders.raw_payload` si un jour on veut
  les rejouer, mais réécrire l'historique d'une table d'attribution
  d'investisseurs n'est pas une migration, c'est une décision.
- **`isMixed`** (`src/lib/warehouse/scan-buckets.ts`) va voir beaucoup plus de
  colis multi-produits qu'avant. Sa règle « deux tailles d'un même produit = un
  seul rack » n'est pas remise en cause, mais son volume, oui.

## 8. Où c'est

| Sujet | Fichier |
|---|---|
| Le type de ligne | `src/lib/storefronts/types.ts` |
| Les cinq adaptateurs | `src/lib/storefronts/*-adapter.ts` |
| Résolution par ligne + écriture | `src/lib/orders/webhook-handler.ts` |
| Ventilation du revenu | `src/lib/calculations/order-revenue-attribution.ts` |
| Ce que contient un colis | `docs/product-variants.md` §4 |
