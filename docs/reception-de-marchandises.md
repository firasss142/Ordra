# Réception de marchandises

> **État : migration APPLIQUÉE EN PRODUCTION le 2026-10-01** (projet
> `vshynigvgrlihngozuwb`). Le schéma, les 3 RPC, la RLS et les déclencheurs sont
> en place ; `anon` n'a ni EXECUTE ni SELECT, les deux gardes d'acteur refusent
> en 42501 sans session. **Le code React n'est pas déployé** : l'onglet reste
> invisible jusqu'à la fusion dans `main`. Aucune donnée existante n'a bougé
> (244 lignes de registre, 13 produits, 3 893 unités avant comme après).

Ce qui entre en stock est un document, pas un nombre tapé dans une fiche produit.

## Pourquoi ce domaine existe

Avant le 30 septembre 2026, le stock ne pouvait monter que par trois portes, et aucune
ne décrivait une livraison :

| Porte | Qui | Par site | Lignes écrites depuis toujours |
|---|---|---|---|
| `initial_stock` à la création d'un produit | super_admin | non | 7 |
| `adjust_product_stock` (+ `manual_adjustment`) | super_admin | non | 3 |
| `record_stock_count` | agent / manager / SA | oui | 0 |

Une livraison fournisseur n'avait donc ni fournisseur, ni bon de livraison, ni écart
entre l'attendu et le reçu, ni coût, ni bâtiment. « D'où viennent ces 40 unités » était
sans réponse, et le registre — ce qui rend tous les autres mouvements auditables —
recevait un `manual_adjustment` nu.

Le besoin était spécifié depuis longtemps (`docs/prototypes/entrepot-redesign.md` §7 :
`record_reception`, motif `reception`) et avait été abandonné **deux fois**
(`docs/design/entrepot/README.md`, `plans/entrepot-light-rebuild.md`) pour une raison
écrite noir sur blanc : « ces flux n'existent pas dans le modèle de données ».

## Le workflow professionnel, et ce qu'on en retient

La pratique standard sépare trois documents que l'intuition confond :

| Document | Question | Stock | Argent | Ici |
|---|---|---|---|---|
| Bon de commande | ce qu'on a commandé | non | non | une réception « attendue » |
| **Réception** | ce qui est arrivé, est-ce acceptable | **oui** | non | **complet** |
| Facture + paiements | ce qu'on doit, ce qu'on a payé | non | **oui** | une liste de versements |

Ils divergent en permanence : on commande 500, 480 arrivent, on est facturé 500, on paie
en deux fois. L'écart entre 1 et 2 attrape les manquants ; entre 2 et 3, la
surfacturation (le *rapprochement à trois voies*).

## Le cycle de vie

```
draft ──(l'agent a compté)──► submitted ──(le manager valide)──► posted ──► reversed
  └──────────► cancelled ◄────────┘          ↑ SEUL ce geste écrit le registre
```

Un manager peut valider directement depuis `draft` : il est à la fois déclarant et
validateur, aucune raison de le faire cliquer deux fois.

**Deux personnes, deux gestes.** L'agent d'entrepôt qui décharge le camion DÉCLARE ce
qu'il a compté ; un manager VALIDE, et la validation seule fait exister le stock.
Recevoir est le seul mouvement qui crée des unités à partir de rien sans document en
face — une sortie a sa commande, un retour a son colis. C'est aussi un **assouplissement**
de l'état antérieur (super_admin seul), pas un durcissement : l'agent gagne un chemin
d'écriture qu'il n'avait pas.

## Les tables

`supabase/migrations/20260930120000_goods_reception.sql`

| Table | Contenu |
|---|---|
| `receptions` | marché, bâtiment, `reference` (REC-LY-2026-0042), fournisseur (texte libre), `supplier_ref`, statut, `expected_at`, `photo_url`, `supplier_invoice_id` (nullable, **sans cible**), `reverses_reception_id`, `submitted_at/by`, `posted_at/by` |
| `reception_lines` | `product_id`, `variant_id`, `expected_qty`, `received_qty`, `damaged_qty`, `unit_cost` — unique sur (réception, produit, variante) `NULLS NOT DISTINCT` |
| `reception_payments` | `paid_at`, `amount`, `method`, `note` |
| `inventory_log` | `+ reception_id`, `+ reason IN ('reception','reception_reversal')` |

## Les six décisions structurantes

### 1. La validation CRÉE la ligne `product_site_stock`

`inventory_log_apply_to_site` fait un `UPDATE`, **jamais un upsert** : « pas de ligne =
ce produit n'a jamais été compté sur ce site ». Sans création préalable, une réception
sur un (produit, variante, site) jamais compté bougerait le total marché et **manquerait
le bâtiment en silence**.

Une livraison est la meilleure preuve de l'endroit où sont les unités — aussi bonne qu'un
comptage pour celles qu'elle apporte. `post_reception` insère donc la ligne à 0 et laisse
le déclencheur ajouter : aucune répartition n'est inventée pour les unités non apportées.
Le comptage physique n'est plus le seul acte qui fait entrer un produit dans le modèle
par site.

### 2. Abîmé à l'arrivée n'entre pas en stock

`damaged_qty` vit sur la ligne et nulle part ailleurs. Ce n'est **pas**
`damaged_return_count`, qui veut dire « revenu cassé d'un client » et alimente le taux de
retour. Des unités arrivées cassées n'ont jamais été vendables et ne sont pas un retour :
c'est un litige fournisseur. La valeur reçue les exclut, et le registre ne voit passer que
les unités vendables.

### 3. Le coût est capturé toujours, propagé jamais tout seul

`products.unit_cogs` est un scalaire **courant** qu'un P&L fenêtré sur événements et
`investor_order_facts` lisent en direct. Le réécrire recalcule la marge des commandes
**déjà livrées**.

`reception_lines.unit_cost` garde le prix payé pour toujours. `p_adopt_costs` (faux par
défaut) est le seul chemin vers `unit_cogs`, et la route exige `adopt_costs === true`
**strictement** : un corps vide, un champ absent ou une valeur vaguement vraie n'adoptent
rien. Le dialogue de validation montre l'arithmétique produit par produit avant de
l'appliquer, et un coût inchangé s'affiche sans rature.

Capturer ne coûte rien et ne perd rien : FIFO ou une vraie moyenne pondérée se
construiront plus tard sur cet historique, sans reprise de données.

### 4. Le paiement est une liste, pas une case

« payé / partiellement payé » se déduit de `somme(paiements)` contre la valeur reçue et
n'est stocké nulle part. Deux acomptes sur une livraison marchent d'emblée, et le reste à
payer ne peut pas se désynchroniser de ses lignes.

**Limite assumée** : un seul versement couvrant **trois** livraisons n'a pas sa place ici.
Il faudra une facture fournisseur, et ces lignes s'y rebrancheront sans être réécrites —
c'est à cela que sert `receptions.supplier_invoice_id`, nullable et sans cible.

### 5. « En retard » est un calcul, pas un statut

`expected_at < aujourd'hui` sur une réception non validée, évalué à la lecture. Un
drapeau stocké demanderait une tâche planifiée pour le maintenir et serait faux le jour
où elle ne tourne pas.

### 6. `null`, jamais `0`, quand on ne sait pas

- Valeur d'une réception attendue → « — » (rien n'est arrivé, rien n'a de valeur)
- Quantité annoncée absente → « non annoncé » (et **aucun écart** n'est affiché : un écart
  n'existe que si les deux nombres existent)
- Quantité pas encore comptée → champ en pointillés, « pas encore comptée »
- Coût non chiffré → « — »

## Sécurité

- `post_reception` exige `auth.uid() = p_actor_id` sous la forme **stricte** (refus si
  `auth.uid()` est NULL), contrairement à `record_stock_count` dont la forme
  `IS NOT NULL AND <>` laisse passer un appel anon — alors que `p_actor_id` décide du
  **marché**.
- Les trois RPC (`post_reception`, `reverse_reception`, `next_reception_reference`) sont
  `REVOKE`ées de `PUBLIC` et d'`anon` avant d'être accordées à `authenticated`.
- RLS sur les trois tables ; les helpers sont enveloppés en `(SELECT …)` pour rester dans
  l'InitPlan.
- `reception_payments` n'est lisible que par manager/super_admin.
- Immutabilité **après validation** par déclencheur : un brouillon reste modifiable, une
  réception `posted` ou `reversed` ne se modifie ni ne se supprime. La seule transition
  autorisée est `posted → reversed`, écrite par `reverse_reception`.
- **Le coût est retiré côté serveur** pour un `warehouse_agent`, pas masqué en CSS : en
  production `unit_cogs` est accordé à `authenticated` malgré ce qu'affirme la
  documentation, donc masquer côté client ne serait pas un contrôle. Les routes
  d'écriture forcent aussi `unit_cost` à NULL quand l'appelant est un agent.

## Les surfaces

| Où | Quoi |
|---|---|
| Entrepôt › Stock › **Réceptions** | La liste. Cinq filtres (`Toutes · Attendues · À valider · Validées · Impayées`), liseré de 3 px : rouge en retard, ambre attend un manager — porté seulement par ce qui bloque quelqu'un |
| La feuille (plein écran) | Vignettes, lignes, écarts, barre « saisie 4/5 lignes comptées », totaux, paiements |
| Le comptage téléphone | Une ligne à la fois : progression, champ de 52 px, raccourcis « l'attendu » / « zéro », abîmé séparé. S'ouvre tout seul sous 768 px |
| Le dialogue de validation | L'arithmétique des coûts, case décochée, l'avertissement sur le P&L |
| Le dialogue de contre-passation | super_admin seul, sur une réception validée |
| Entrepôt › Stock › Journal | Pastilles **Réceptions** et **Inventaires** |
| Entrepôt › Stock › Niveaux | « en route » par produit |

`ReceptionSheet` est plein écran et non la modale de 480 px du système : un document à
plusieurs lignes n'y tient pas, et un seul composant sert ainsi le bureau et le téléphone.

### Les quatre actions, et qui les porte

| Action | Qui | Depuis | Vers |
|---|---|---|---|
| Déclarer | agent, manager, super_admin | `draft` | `submitted` |
| **Renvoyer à l'agent** | manager, super_admin | `submitted` | `draft` |
| Valider | manager, super_admin | `draft` \| `submitted` | `posted` |
| **Contre-passer** | super_admin | `posted` | `reversed` |

**« Renvoyer à l'agent » est la troisième issue.** Sans elle, un manager qui voit une
erreur dans une déclaration n'a que deux choix : valider ce qui est faux, ou laisser la
réception bloquée dans sa file pour toujours. Rien n'a bougé en stock à ce stade — seule
la validation écrit le registre — donc il n'y a rien à annuler et aucune contre-passation
à écrire : la réception redevient un brouillon, et la trace de déclaration part avec le
statut, parce que « déclarée par Adel » sur un brouillon que personne n'a déclaré serait
un mensonge. C'est le geste de celui qui VALIDE : si l'agent pouvait rouvrir sa propre
déclaration, il corrigerait et redéclarerait sans qu'aucun manager ne voie passer la
version intermédiaire.

### La surface v3 (2 octobre 2026) — ce qui a été RETIRÉ

`prototypes/reception-marchandises-v3.html` est la référence de l'écran, et le
code en est la copie. La v3 est presque entièrement soustractive :

| Retiré | Pourquoi |
|---|---|
| Le fond teinté des lignes | Une ligne en retard portait un fond + un liseré + une puce + une étiquette + une puce de paiement : **cinq voix pour un fait**. Le liseré de 3 px se lit en balayant la colonne sans lire un mot. |
| La puce « sans objet » | Un libellé dont tout le contenu est « cette colonne ne me concerne pas ». Même règle que `null` plutôt que `0`. La clé `payNotApplicable` a été supprimée. |
| Trois colonnes sur huit | Le bâtiment rejoint la référence ; statut et paiement partagent « État », parce qu'on les lit d'un même regard. |
| Deux bandeaux sur trois | Les cinq faits libellé/valeur de l'en-tête sont la **légende** du document : une ligne grise suffit. La progression est un filet de 3 px. |
| L'encadré ambre sur chaque ligne | L'avarie est l'exception. Le réclamer partout finit par ne plus rien signaler : zéro est du texte gris au bureau, et un **geste** sur le téléphone. |
| Les coûts qui ne bougent pas | « 40,000 → 40,000 » deux fois cachait les deux vrais changements. Ils se **comptent** en une ligne. Et si aucun ne bouge, la case à cocher disparaît : proposer une décision sans conséquence n'est pas une précaution. |
| Le bloc paiement ouvert | Son titre porte déjà le fait entier — « acompte 40 % · reste 11 232,000 LYD ». On l'ouvre pour **agir**. |

Ajouté, en revanche : **le récapitulatif du téléphone**. Le parcours faisait
compter la dernière ligne et s'arrêtait — il n'existait aucun moment pour
déclarer. L'écran montre ce que l'agent va affirmer, **y compris la ligne qu'il a
sautée**, en gris : une réception déclarée avec une ligne non comptée est un fait
et non une erreur, mais il doit le savoir avant de signer. « Enregistrer d'abord,
déclarer ensuite » y vaut comme ailleurs.

### La recherche de produit

Le sélecteur de création cherche en direct, à partir de **deux** caractères.

- **Le panneau s'ouvre DANS le sélecteur**, pas par-dessus : il faut voir les
  lignes déjà posées en même temps que les résultats, sinon on ajoute deux fois le
  même produit — et l'index unique `(reception, produit, variante)` le refuserait
  à l'enregistrement, loin du geste.
- **Un produit déjà posé reste visible et dit pourquoi.** Il était retiré
  silencieusement de la liste : on tapait son nom, rien n'apparaissait, et on en
  concluait qu'il n'existait pas. Une absence inexpliquée est pire qu'une ligne
  barrée.
- **La référence est cherchable.** `/api/products/search` ne faisait un `ilike`
  que sur le *nom* alors que le panneau affiche le SKU sous chaque produit :
  taper `hm-01` était le geste naturel et ne renvoyait rien. Le filtre est
  maintenant un `.or(name.ilike, sku.ilike)`, et la virgule comme les parenthèses
  — la **syntaxe** de `.or()` — sont retirées de la saisie, parce qu'une virgule
  y ajouterait une condition et élargirait le filtre en silence.
- **La correspondance est en gras, pas surlignée en couleur** : dans cette
  section la couleur fonctionnelle appartient aux statuts.
- `↑` `↓` pour choisir, `↵` pour ajouter, `esc` pour fermer **la liste** et non la
  modale, et le champ se vide après chaque ajout pour enchaîner dix lignes sans
  lâcher le clavier.

**Ce qui n'est toujours pas possible : choisir la variante.** Le grain du stock
est `(produit, variante, bâtiment)` et `reception_lines.variant_id` existe, mais
le sélecteur envoie toujours `NULL` — recevoir 50 M et 50 L se déclare comme 100
« produit nu », qui entrera dans le **non ventilé**. À décider séparément.

### Le mot derrière le chiffre

La liste n'affiche jamais un nombre nu, parce que `totals.units` somme le REÇU : sur une
réception annoncée et pas encore comptée il vaut 0, et un 0 affiché se lit « rien n'est
arrivé » — le contraire de ce qu'on veut dire. `headlineQuantity` choisit donc le chiffre
ET son mot : `300 attendues` (promesse), `312 comptées` (déclaration), `1 000 unités`
(fait en stock), `80 annulées` (écriture retirée). Rien d'annoncé et rien de compté donne
`—`, pas `0`.

## Le bug corrigé au passage

Le Journal construisait sa liste de motifs **en ligne**, et pour « Tout » elle en nommait
**quatre** sur les douze que `inventory_log_reason_check` autorise. Étaient donc invisibles
dans le Journal et dans son export CSV : `stock_count`, `received_back`, `initial_stock`,
`scan_reversal`, `manual_delete_reversal`. Le stock d'ouverture d'un produit n'apparaissait
nulle part, et pas un seul comptage physique non plus.

Un registre qui affiche « Tout » et en cache la moitié est pire qu'absent : on l'ouvre pour
vérifier, et il confirme ce qu'on croyait déjà. La liste vit maintenant dans
`src/lib/warehouse/history-reasons.ts`, avec `kindForReason` qui classe une ligne depuis la
**même** table — une ligne ne peut plus être interrogée dans une famille et affichée dans
une autre — et un filet qui vérifie que l'union des familles recouvre tout le vocabulaire.

## Hors périmètre, volontairement

- **Pas de table fournisseurs** — nom libre + leur référence. Elle se justifiera quand
  quelqu'un demandera « qu'est-ce qu'on achète chez eux ».
- **Pas de bon de commande** — la réception « attendue » en tient lieu et suffit à
  alimenter « en route ».
- **Pas de facture fournisseur** — voir la limite de la décision 4.
- **Pas de couches de coût (FIFO)** — l'historique par ligne les rend constructibles.
- **Pas de devise étrangère** : `unit_cost` est dans la devise du marché (TND / LYD),
  comme `unit_cogs`. Si des imports commencent, la migration est petite mais **toutes les
  surfaces de coût doivent être relues**.
- **Pas de `carrier_stock_transfers`** — le `transfer_out_carrier` de l'ancienne spec est
  un autre mouvement, même motif, un autre jour.

## Vérification

```bash
supabase/tests/run.sh goods_reception_test.sql   # base LOCALE uniquement — 47 assertions
npx vitest run src/lib/receptions src/components/warehouse/receptions src/lib/warehouse
npm run typecheck && npm run build
```

`npm run lint` ne fait rien dans ce dépôt (pas de configuration ESLint) — ne jamais
annoncer « lint propre ».

Les tests SQL écrivent pour de vrai et ne nettoient pas : `inventory_log` est en écriture
seule, donc un test propre est impossible sur une base qui compte. Pas de `ROLLBACK` non
plus, sinon les déclencheurs `DEFERRABLE INITIALLY DEFERRED` ne s'évaluent **jamais** —
c'est exactement ainsi que `assert_site_stock_within_total` avait été « vérifié » alors
qu'il plantait sur toute écriture.

Parcours vérifié sur la base locale le 2026-10-01 : trois produits jamais comptés, une
réception de 3 lignes (une conforme, une courte de 6 avec 2 abîmées, une hors bon), puis
contre-passation. Les trois niveaux de stock bougent à la validation, les lignes de site
sont **créées**, `damaged_return_count` reste à 0, et la contre-passation ramène chaque
niveau à sa valeur de départ.
