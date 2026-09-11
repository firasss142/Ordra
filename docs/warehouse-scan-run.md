# La tournée de scan, les filtres du scanné, et le stock par bâtiment

*Livré le 10 septembre 2026.* Source de vérité pour `/warehouse/scan`,
`ScannedList` / `ScannedTable`, et la carte de stock du téléphone.

## 1. Pourquoi une tournée

Le banc est une liste, et une liste repose la même question à chaque ligne :
quelle couleur, quelle carte, prendre, scanner, revenir à la liste. Sur le
terrain la réponse ne change pas pendant vingt colis d'affilée — le rouleau est
déjà dans la main, ou l'agent est déjà debout devant le rayon.

La tournée pose la question **une fois** :

1. **Par quoi commencer ?** Même produit, ou même couleur (Libye) / même région
   (Tunisie, par gouvernorat via `resolveGovernorate`).
2. **Quel lot ?** Un lot par produit ou par rouleau, avec son nombre de colis,
   ses unités, et l'âge du plus ancien.
3. Puis colis après colis : la photo et **toutes les lignes**, « C'est bien ce
   colis », le scanner, le résultat, le suivant.

Le banc n'a pas changé. `/warehouse/scan` est une deuxième porte sur la même
file et le même `/api/warehouse/scan-out`.

### Ce que la tournée refuse de faire

Pas de série, pas de record personnel, pas de score. Les quatre chiffres du
récapitulatif (liés, refusés, passés, durée) sont ceux que la tournée a
réellement mesurés, et la cadence n'apparaît que si au moins un colis a été lié
— zéro par minute n'est pas un agent lent, c'est une mesure absente. Un écran
d'entrepôt qui invente un chiffre est un écran qu'on cesse de croire, et
celui-ci porte un geste qui bouge du stock.

### Deux issues n'avancent jamais toutes seules

`bound` enchaîne après 1,4 s (annulable par « Rester sur ce colis »). Ces deux-là
attendent une lecture humaine :

| Issue | Pourquoi elle bloque |
|---|---|
| `bind_unverified` | Darb tient un **autre** numéro. Le colis part sous une référence que nous n'avons pas ; c'est exactement ce qui a laissé huit colis intraçables le 8 septembre. Le numéro de Darb est nommé à l'écran. |
| `bound_not_committed` | Vivant chez Darb, stock non bougé. Un responsable doit le savoir avant que le colis ne reparte. |

### Le pistolet code-barres

`createScannerInputHandler` (`src/lib/preparation/scanner-input.ts`) existait,
était testé, et n'était monté nulle part : une douchette ne fonctionnait que si
le bon champ avait le focus. `RunScanner` l'attache sur `document` pendant la
tournée. Le champ de saisie manuelle reste : le handler ne se déclenche que sur
une rafale plus rapide qu'une frappe humaine (80 ms entre touches).

## 2. Les colis à plusieurs produits

**C'était un vrai défaut de stock, pas un défaut d'affichage.**

`order_items` porte la vérité depuis juin 2026 : un colis peut contenir trois
produits différents. Les quatre RPC de l'entrepôt lisaient pourtant
`orders.product_id` / `orders.quantity` — un seul produit. Sur les 28 commandes
libyennes multi-produits, deux avaient déjà été scannées : le stock du premier
produit a bougé, celui des autres non. Le registre est en écriture seule, donc
l'écart ne se rattrape pas ; il se constate au comptage physique, des semaines
plus tard, sans explication.

`supabase/migrations/20260924000001_scan_multi_line_stock.sql` :

- `order_stock_lines(order_id)` est **la seule** définition de « ce que contient
  ce colis » : les lignes d'`order_items` quand il y en a, sinon la ligne
  dénormalisée. Quatre appelants, une implémentation.
- **Une ligne par PRODUIT, pas par ligne de commande.** Huit commandes en
  production portent le même produit sur plusieurs lignes (une, sur le banc, en
  a quatre). Boucler sur les lignes brutes ferait quatre `UPDATE` sur le même
  produit et inscrirait quatre `balance_after` dont trois seraient périmés à
  l'écriture. On agrège d'abord.
- `STOCK_UNDERFLOW` est vérifié sur **toutes** les lignes avant la première
  écriture. Déduire deux produits puis refuser le troisième laisserait un colis
  à moitié sorti du stock, sans statut pour le dire.
- `stock_after` reste celui de la ligne **principale** (`orders.product_id`),
  parce que la feuille de scan affiche « 12 ← 11 » pour le produit qu'elle vient
  de montrer à l'agent. La réponse gagne `lines` et `movements`.
- Un retour endommagé l'est **en entier** : chaque ligne alimente le
  `damaged_return_count` de son produit.

Vérifié en transaction sur les données de production (puis annulé) : un colis à
deux produits déduit les deux et écrit deux lignes de registre ; le colis aux
quatre lignes identiques écrit **une** ligne de −4 ; le dé-scan rend exactement
ce que le scan avait pris.

Côté affichage, `attachOrderLines` (une requête par page) pose `items[]` sur
chaque ligne de file, et `linesOf(row)` retombe sur la ligne dénormalisée quand
la commande est antérieure à `order_items`. Un lot **« Colis mixtes »** regroupe
les colis à plusieurs produits et passe **toujours en dernier** : les classer
sous leur premier produit, c'est ainsi qu'un préparateur emballe un article sur
trois — et le sticker est déjà sur le carton.

## 3. Les filtres du scanné

La liste des colis scannés n'avait **aucun filtre**, et le téléphone et le
bureau la **triaient différemment** : les mêmes cent lignes se lisaient dans deux
ordres selon l'appareil qu'on tenait.

- `src/lib/warehouse/scanned-filters.ts` : `sortScanned` (les colis dont Darb ne
  tient pas notre numéro d'abord, puis du plus récent au plus ancien),
  `applyScannedFilters`, `scannedFacets`.
- `useScannedView` porte l'état, partagé par `ScannedList` et `ScannedTable`.
- Segments (Tous / À vérifier / En attente / Remis) avec leur compte, recherche
  (sticker, **numéro que Darb tient à la place du nôtre**, client, produit),
  rail des rouleaux présents, produit, « scanné par ».
- `sticker_bind_state = null` n'est **pas** un problème : c'est « pas encore
  vérifié », l'état normal quelques secondes après un scan. Le traiter comme une
  anomalie mettrait chaque scan frais en tête de liste et enterrerait les vrais.
- « Aucun colis pour ces filtres » est distinct de « aucun colis scanné », avec
  un bouton pour tout effacer.

## 4. Le stock par bâtiment

`product_site_stock` ventile le total marché entre Tripoli et Benghazi depuis
septembre et **aucun écran ne le montrait** : un agent de Benghazi lisait le
rayon de Tripoli comme s'il était le sien.

- `/api/warehouse/stock` renvoie `sites[]` (bâtiment, nom, stock, dernier
  comptage) et `unallocated`.
- L'invariant est une **inégalité** : `somme(sites) <= products.current_stock`.
  L'écart est une quantité réelle que personne n'a ventilée, donc il est
  **nommé** (« Non ventilé ») et non caché. Il est ramené à zéro quand il n'y a
  pas de ventilation du tout — sinon, dans un marché à un seul entrepôt, tout le
  stock se lirait comme non ventilé, l'exact contraire de la vérité.
- Un marché à un seul bâtiment n'affiche **aucune** répartition : détailler une
  ligne unique est du bruit.
- La carte gagne aussi les 14 jours de niveau (`series`, envoyée depuis toujours
  et jamais dessinée), des segments filtrants (Tous / Sous le seuil / À
  découvert / Jamais comptés) et un tri.

## 5. Ce qui a été retiré

- `/warehouse/scan` ne redirige plus vers le banc. Le bouton « Mode scan » du
  bureau menait à une page qui renvoyait à celle qu'on venait de quitter.
- Le bouton flottant vise la tournée, plus `?scan=1`. La feuille du banc reste
  pour « Prendre » sur une carte.
- Pendant une tournée, la barre du bas et le bouton flottant disparaissent :
  quatre destinations sous le pouce sont quatre façons de perdre le lot en
  tenant un colis. La tournée porte sa propre sortie, nommée, en haut.

## 6. Les règles qui n'ont pas plié

- Couleur exacte de Darb, jamais teintée ; le nom ne s'écrit **jamais** sur la
  teinte ; le code d'agence sur plaque blanche opaque (16,97:1 sur les neuf
  couleurs) ; jaune et vert lime cerclés. Voir
  `plans/warehouse-agent-ux-critique.md` §3.7.
- La couleur n'est jamais le seul canal : chaque pastille garde son texte.
- Liaison chez Darb d'abord, écriture locale ensuite — inchangé.
- La photo du produit reste le dernier contrôle humain avant la caméra.
