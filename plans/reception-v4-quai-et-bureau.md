# Réception v4 — le quai et le bureau

> Maquette : `prototypes/reception-marchandises-v4.html`. Elle est la spécification.
> Remplace la structure de `plans/reception-parite-maquette.md` (v2/v3), pas le modèle
> de stock, qui ne change pas.

## Le constat

En production, le 3 octobre 2026 :

| | |
|---|---|
| Réceptions créées | **1** — `REC-LY-2026-0001`, fournisseur `firas`, BL `qd`, 1 oct 22 h 57 |
| Lignes dessus | **0** — abandonnée avant le premier produit |
| Réceptions validées | **0**. Paiements : 0. Lignes de registre `reason='reception'` : **0** |
| Comment le stock est réellement entré | 10 lignes en 5 mois : 7 × `initial_stock` (+3 116), 3 × `manual_adjustment` (+800) |
| `product_site_stock` | **0 ligne**, pour 3 bâtiments |
| Ce qu'on a écrit pour remplacer ces 10 lignes | migration de 663 lignes, 3 tables, 4 RPC, 9 routes, ~3 900 lignes de TypeScript |

L'abandon a une explication bénigne — la recherche produit renvoyait `[]` à un
super_admin jusqu'au correctif du 3 octobre. Le rapport, non.

## Les sept défauts que la v4 corrige

1. **L'entité est fausse.** Recevoir est un *comptage* ; on l'a modélisé comme un
   *document*. Le dialogue de création réclame bâtiment, fournisseur, numéro de BL et
   date avant d'accepter une seule unité. La réalité physique est un homme à côté d'une
   camionnette avec un carton.
2. **L'écart n'a pas de membre gauche.** `expected_qty` suppose une annonce ; il n'y a
   ni bon de commande, ni ASN, ni déclencheur de réassort. Toute ligne qui existera un
   jour affichera donc « non annoncé » — et on a dépensé une colonne, le filet de
   progression, la puce « hors bon » et une cible tactile sur une comparaison vide.
3. **La séparation des tâches est importée d'une entreprise qui n'existe pas ici.**
   2 `warehouse_agent` actifs, 2 super_admins, 6 managers — et `permissions.ts` accorde
   *déjà* le brouillon ET la validation au manager. Un deuxième clic de la même personne
   n'est pas un contrôle : c'est un rite qui apprend que le premier ne veut rien dire.
4. **On a construit l'ancrage exprès.** `ReceptionCountFlow.tsx:366` — un geste pour
   adopter le chiffre du fournisseur. Toute réception sérieuse fait l'inverse :
   **comptage à l'aveugle**, l'attendu caché jusqu'à ce que le compte soit engagé.
5. **La case à cocher des coûts est une politique comptable déguisée en caprice.**
   `p_adopt_costs` réécrit `products.unit_cogs`, que le P&L lit en direct et que
   `investor_order_facts` lit aussi. La base de coût devient fonction de l'attention de
   celui qui valide à 23 h.
6. **Les frais d'approche n'existent pas.** Zéro occurrence de transport, douane ou
   dédouanement dans la migration. Tout COGS adopté depuis une réception est donc
   **systématiquement trop bas**, ce qui gonfle la marge de chaque produit, le seuil de
   rentabilité et les relevés investisseurs.
7. **Le bloc paiement est une comptabilité fournisseurs sans comptes.**
   `reception_payments` est lu par trois routes et la projection — **rien dans Finances**.
   Ni table fournisseurs, ni bon de commande, ni facture, ni total dû. « Combien je dois
   à مكتبة الرسالة » est inrépondable : donnée captée à un grain qui n'agrège pas.

Et le défaut connu : le sélecteur envoie `variant_id: NULL`, donc 50 M + 50 L entrent
comme 100 unités nues dans le *non ventilé*, que `scan_order_out` refusera ensuite.

## L'inversion

**Une réception n'est pas créée. Elle est soldée.**

```
LE QUAI (téléphone, 2 champs)          LE BUREAU (desk, hebdomadaire)
l'agent enregistre des ARRIVAGES   →   le propriétaire SOLDE le groupe
le stock entre immédiatement           l'argent entre ici
aveugle par construction               fournisseur · prix · frais · rapprochement
aucune paperasse                       la référence REC-… naît ici
```

- **Le stock existe au moment où le carton est au sol**, parce que c'est à ce moment
  qu'il est vrai. L'état `submitted` de la v3 était une fenêtre où la marchandise est
  sur l'étagère et où Ordra dit qu'elle n'existe pas — quelqu'un la vendra.
  **Réel-mais-non-chiffré est un mensonge bien plus sûr que réel-mais-invisible.**
- **Aveugle par construction** : la surface du quai n'a aucune attente à montrer.
- **Le contrôle qui remplace la deuxième signature n'est pas une signature, c'est un
  rapprochement.** Une réception soldée doit s'équilibrer contre une pièce externe — le
  total de la facture fournisseur. Un désaccord produit une **exception**, pas une note
  en texte libre. Et quand le système peut expliquer l'écart lui-même (2 abîmées
  facturées × 85,000 = exactement 170,000), il le propose.
- **Recevoir depuis le manque, pas depuis le fournisseur.** 1 632 commandes en 30 jours :
  le système sait ce qui s'épuise. La suggestion de réassort *crée* le bon de commande,
  et l'écart se mesure alors contre **notre propre plan**, plus utile que contre le
  papier du fournisseur.

## Modèle — le delta

Rien du modèle de stock à trois niveaux ne change. Ce qui change :

### Statuts
```
open ──(le bureau solde)──► settled ──► reversed
 │
 └─ le stock bouge DÈS la première ligne, pas ici
```
`draft`, `submitted`, `posted`, `cancelled` disparaissent. `receptions.reference`
devient **nullable** : la référence est frappée au soldage, parce que le numéro est
l'identité du *document*, et le document naît au bureau.

### Tables nouvelles
```sql
suppliers (id, market_id, name, phone, note, is_active, created_at)      -- enfin
purchase_orders (id, market_id, supplier_id, warehouse_id, reference,
                 expected_at, status 'open|received|cancelled', created_by, …)
purchase_order_lines (id, po_id, product_id, variant_id, qty, unit_cost)
reception_costs (id, reception_id, kind 'freight|customs|clearing|handling|other',
                 label, amount, basis 'value|units')                     -- frais d'approche
supplier_claims (id, reception_id, supplier_id, amount, reason, status, …) -- l'abîmé agit
```

### Colonnes
- `receptions.supplier_id` → `suppliers` (garder `supplier_name` en secours)
- `receptions.purchase_order_id` → `purchase_orders`, nullable
- `receptions.invoice_total numeric` — ce que dit le papier du fournisseur
- `receptions.settled_at / settled_by`, `reference` nullable
- `reception_lines.landed_unit_cost numeric` — prix + frais répartis, **le chiffre qui
  devient COGS**
- `inventory_log.reason` : `+ 'arrival'`, `+ 'arrival_correction'`
  (`reception` / `reception_reversal` restent pour les 0 lignes existantes)
- `settings` : `costing_update_on_settle boolean` — **un seul réglage**. Pas d'énumération de
  politiques (« dernier prix payé » est une moyenne pondérée en pire) et pas d'option pour
  exclure les frais d'approche, qui ne serait qu'une façon d'avoir tort.

### RPC
- `record_arrival(p_product, p_variant, p_qty, p_damaged, p_warehouse, p_actor)` —
  trouve-ou-crée la réception `open` de (bâtiment, jour), écrit la ligne, crée la ligne
  `product_site_stock`, écrit **une** ligne de registre `reason='arrival'`. C'est le seul
  chemin d'entrée de stock du quai.
- `correct_arrival(p_line, p_new_qty, p_actor)` — append-only : écrit le delta en
  `arrival_correction`. Refusé dès que la réception est `settled`.
- `settle_reception(p_reception, p_supplier, p_invoice_total, p_costs jsonb, p_actor)` —
  répartit les frais au prorata, écrit `landed_unit_cost`, applique **la politique de
  coût du marché** (plus de booléen d'appel), frappe la référence, crée le dû, et
  **refuse** si `|total calculé − invoice_total|` dépasse le seuil sans justification.
- `split_reception(p_reception, p_line_ids[], p_actor)` — deux fournisseurs le même jour
  dans le même bâtiment : le bureau scinde avant de solder.
- `reverse_reception` — inchangé dans l'esprit.

`post_reception` est **supprimée** (0 appel en production, donc aucune donnée à migrer).

## Les surfaces

| § maquette | Écran | Ce qui est neuf |
|---|---|---|
| 1 | Le parcours | l'inversion quai / bureau |
| 2 | **Le quai** — téléphone, 5 écrans, arabe RTL | 2 champs, variantes, aveugle, reçu de stock, correction |
| 3 | Entrepôt › Stock › Réceptions | segments `À solder (n) / Soldées`, deux espèces de ligne, colonne argent « non chiffré » |
| 4 | **Solder une réception** | 3 blocs : d'où ça vient · chiffrage + frais d'approche · rapprochement |
| 5 | Le rapprochement | la barrière, réduite à une phrase, trois chiffres et **deux choix qui portent chacun leur conséquence chiffrée** — pas de formulaire de motifs |
| 6 | Réception à l'aveugle | le BC né du manque ; écart révélé **après** le compte |
| 7 | **Finances › Achats** | 3 indicateurs (dû, retard, achats 30 j), puis **l'échéancier « À payer »** — la seule liste sur laquelle on agit — puis 3 chiffres par fournisseur (dû, livre complet, délai) |
| 8 | Paramètres › Coûts | **un seul interrupteur**, pas trois options : mettre à jour le coût de revient au soldage, frais d'approche inclus et non négociables |
| 9 | Niveaux | le marqueur « stock non chiffré » |
| 10 | Bilan v3 → v4 | ce qui change, ce qui est supprimé |

### Correction de palette — la v3 était « jolie et fausse »

La v3 reproche à la v2 d'inventer ses couleurs, puis invente les siennes : elle déclare
`--bg:#F6F7F5`, `--ink-1:#1B1D1A`, `--ok:#0E7A45`, `--bad:#B23A2E`. Les vraies valeurs
de `src/app/globals.css` sont `#F6F6F7`, `#1A1A1A`, `#15803D`, `#D72C0D` — un gris
neutre et le vert de marque, pas un gris chaud et un vert sourd. **Aucune des couleurs
de la v3 n'existe dans le produit.**

Et surtout : l'entrepôt a depuis le 2 octobre (PR #56, en production) une famille par
métier de la journée. Recevoir a la sienne — `--job-receive:#4D7C0F` / `-bg:#EEF5E1` /
`-ink:#3F6212`, un vert mousse. La v4 l'emploie pour les marqueurs d'étape, les
vignettes produit et la plaque d'onglet active ; les couleurs de statut restent des
couleurs de statut.

## Ordre de construction (TDD, test qui échoue d'abord)

1. `suppliers` + `Finances › Achats` (dû, dépense, taux de service, délai). **D'abord**,
   parce que c'est ce qui rend répondable tout ce qu'on capte déjà, et parce que ça ne
   touche à aucun stock.
2. Comptage à l'aveugle : retirer la puce d'ancrage, révéler l'écart après engagement.
   Quelques heures, supprime le pire défaut.
3. Variantes dans le sélecteur du quai. C'est un bug de justesse, pas une fonction.
4. `reception_costs` + `landed_unit_cost` + la politique de coût dans les réglages.
   Protège le P&L et les relevés investisseurs.
5. `record_arrival` + l'écran du quai ; `settle_reception` + l'écran du bureau ;
   bascule des statuts. Le gros morceau.
6. `purchase_orders` nés du réassort, et l'écart contre notre plan. **FAIT** — voir
   « Étape 6, telle qu'elle a été construite » plus bas.
7. `supplier_claims` — l'abîmé devient une action, proposée par le système quand
   `damaged_qty × unit_cost` explique exactement l'écart de facture.
8. Docs : `docs/reception-de-marchandises.md`, la liste des chemins de stock de
   `CLAUDE.md` (l'arrivage devient le chemin 6), `docs/database-schema.md` §8.

## Vérification

- Un arrivage de 150 unités sur Tripoli fait monter `products.current_stock`,
  `product_variants.current_stock` **et** crée la ligne `product_site_stock` — une seule
  ligne de registre `reason='arrival'`, et « Non ventilé » baisse d'exactement 150.
- Avant soldage : le stock est là, `landed_unit_cost` est NULL, Niveaux porte le
  marqueur « non chiffré », et `unit_cogs` n'a pas bougé.
- Un soldage avec 1 500,000 de frais répartis par valeur sur 18 720,000 de marchandises
  donne 4,808 LYD/unité en moyenne et la somme des frais répartis est exactement
  1 500,000 (prorata, pas d'arrondi perdu).
- Une facture à 18 890,000 contre 18 720,000 calculés **bloque** le soldage et propose
  « 2 abîmées facturées × 85,000 = 170,000 ».
- Un `warehouse_agent` ne voit ni prix, ni frais, ni rapprochement — **absents de la
  réponse de l'API**, pas masqués en CSS.
- 390 × 844 en arabe pour les cinq écrans du quai (page en LTR, seule la scène est
  miroir — le harnais de capture RTL se bride à ~500 px).

## Hors périmètre, volontairement

Emplacements de rangement, plaques de palette, lots et péremption, numéros de série,
matrices de tolérance de sur-réception, ASN/EDI, couches FIFO. C'est pour 10 000
références ; il y en a onze.

## Étape 6, telle qu'elle a été construite (4 octobre 2026)

### Pourquoi une table d'allocation et pas une colonne `received_qty`

`purchase_order_receipts` est un REGISTRE : une ligne signée par rattachement,
en ajout seul, comme `inventory_log`. Un compteur sur la ligne de commande ne
sait faire ni l'un ni l'autre des deux cas réels sans réécrire du passé :

- un arrivage de 120 unités solde une commande de 100 **et entame la suivante** ;
- une correction de comptage (100 → 94) doit rendre 6 unités « en route ».

Ce qu'une ligne de commande a reçu est donc toujours la SOMME, et la vue
`purchase_order_line_progress` est la seule définition de « reçu » et de
« outstanding » dans tout le système.

### Le comptage à l'aveugle tient aux trois étages

| Étage | Ce qui l'empêche |
|---|---|
| Base | `purchase_orders` n'a **aucune** politique RLS pour `warehouse_agent` |
| Route | `canViewPurchaseOrders` refuse le rôle avant toute requête |
| Écran | la surface du quai n'affiche l'écart que par la **valeur de retour** de `record_arrival`, après l'écriture |

La RLS est le garde-fou réel, et c'est pour cela que `src/lib/receptions/ordered.ts`
n'écrit **aucun** filtrage par rôle : il serait le deuxième endroit où la règle
vit, et donc celui qui finirait par mentir.

### Une commande ne se clôt pas toute seule quand la livraison est courte

La base clôture automatiquement quand **toutes** les lignes sont servies, et
seulement alors. Une livraison courte est le cas NORMAL : le bon reste ouvert, et
c'est l'acheteur qui décide d'arrêter d'attendre le reste
(`close_purchase_order`). Cette RPC choisit alors entre `closed` et `cancelled` —
une commande dont **rien** n'est arrivé ne pèse pas sur le taux de service du
fournisseur, parce qu'elle ne dit rien sur sa capacité à servir, seulement sur la
nôtre à changer d'avis.

Symétriquement, une correction à la baisse ou une contre-passation **rouvre** une
commande que la base avait clôturée — mais jamais une que quelqu'un avait
clôturée à la main (`closed_by IS NOT NULL`) : cette décision-là reste la sienne.

### `expected_qty` est mort, et l'écart a changé de référence

`reception_lines.expected_qty` est NULL partout en production et le restera :
personne n'écrit un attendu dans un formulaire vide. L'écart d'une réception se
mesure désormais contre **notre propre plan** — les lignes de commande auxquelles
le quai a rattaché ses comptages — ce qui est plus utile que contre le papier du
fournisseur. La colonne reste en base (la supprimer est une migration sans
bénéfice) ; plus rien ne la lit.

Au passage, **l'ancre a été retirée du bureau aussi** :
`ReceptionLineEditor` offrait encore un bouton qui adoptait la quantité attendue
d'un seul doigt. C'était le défaut nommé par la critique, et un test assure
maintenant son absence.

### Deux défauts trouvés en appliquant les migrations sur la base locale

1. **`20261003180000_quai_et_bureau.sql` s'arrêtait au milieu** sur toute base
   portant une réception validée : son propre déclencheur d'immuabilité refuse la
   bascule de statut. 46 réceptions en local, zéro en production — donc rien ne
   se serait vu avant le jour où ça compterait. Corrigé par un
   `DISABLE TRIGGER` ceinturé autour du seul remplissage.
2. **`ALTER DEFAULT PRIVILEGES` du projet accorde EXECUTE à `anon`,
   `authenticated` ET `service_role`** sur toute fonction neuve. Le
   `REVOKE … FROM PUBLIC, anon` habituel de tout le dépôt laissait donc les deux
   helpers internes — qui ne portent AUCUN contrôle d'acteur — appelables par
   n'importe quel compte connecté.

### Ce que l'étape 6 n'a pas fait

- **Fiabilité du prix** (« deux factures sur six ne tombaient pas sur le prix
  annoncé ») : la maquette la montre, et elle est calculable — `unit_cost` de la
  ligne de commande contre celui de la ligne de réception. Pas branchée.
- **Plusieurs produits dans un seul bon de commande depuis l'écran.** La RPC
  l'accepte (`p_lines` est un tableau) ; le dialogue de réassort naît d'UN manque
  et n'en envoie qu'un. Grouper par fournisseur est l'amélioration évidente.
- **Une liste des bons de commande en cours.** Ils se voient par fournisseur sur
  Achats (« 200 en commande ») et par produit sur Niveaux ; il n'y a pas d'écran
  qui les liste. `GET /api/purchases/orders` existe et est testé.
