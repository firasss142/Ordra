# Produits — spécification de composants (v4)

Prototype exécutable : `prototypes/products-ui-v4.html`
Prédécesseur : `prototypes/products-cards-v3.html`

Cette spec couvre **tous** les composants des trois surfaces produit : liste, fiche, édition.
Elle n'introduit **aucun changement fonctionnel** — même hiérarchie, même placement, mêmes
actions. Seule la présentation change.

Toutes les valeurs viennent de `docs/design-system.md` / `src/app/globals.css`. Les quatre
seuls ajouts v4 sont des **échelles**, pas des couleurs : rayon, élévation, porte-icône, filet.

---

## 0 · Jetons

### 0.1 Échelle de rayon (nouveau — remplace des valeurs ad hoc entre 4 px et 15 px)

| Jeton | Valeur | Usage |
|---|---|---|
| `--r-xs` | 8 px | puces, badges de rang |
| `--r-sm` | 10 px | boutons `sm`, porte-icône, onglets de segment |
| `--r-md` | 12 px | boutons, champs, vignettes, cartes internes |
| `--r-lg` | 16 px | cartes de premier niveau, barre d'outils |
| `--r-xl` | 20 px | réservé aux modales |

### 0.2 Élévation

| Jeton | Valeur | Usage |
|---|---|---|
| `--e-card` | `0 1px 2px rgba(16,24,40,.03), 0 1px 1px rgba(16,24,40,.02)` | carte au repos — quasi invisible, sépare de `--bg-page` |
| `--e-row` | `0 1px 2px rgba(16,24,40,.04)` | CTA primaire, pilule de segment active |
| `--e-panel` | `0 4px 16px rgba(16,24,40,.06)` | **hover** de carte produit |
| `--e-float` | `0 8px 24px rgba(16,24,40,.10)` | menus, modales |

> La règle « zéro ombre au repos » du design system visait les ombres **décoratives**.
> `--e-card` est à 3 % d'opacité : sur `#F6F6F7` elle ne se lit pas comme une ombre mais
> comme une limite de carte. Le vrai saut visuel reste réservé au hover.

### 0.3 Couleur — inchangée

Aucune couleur nouvelle. Rappel de la frontière qui gouverne tout ce document :

- **Vert de marque** (`--brand #15803D`) = *où je suis / ce que j'appuie* — CTA, onglet actif, filtre actif, focus.
- **Teintes de statut** = *ce qu'une chose est* — rupture, perte, retard, en cours.

Un chiffre positif utilise `--brand-pos #16A34A` (résultat), jamais `--brand` (chrome).

### 0.4 Taux de livraison — définition arrêtée

**Dénominateur = tout ce qui a été uploadé.** Les commandes encore chez le transporteur
comptent comme non-livrées.

```
taux de livraison (produit) = livrées / uploadées
taux de livraison (agent)   = livrées / confirmées
```

La question à laquelle il répond est « **quelle part du parti est arrivée à ce jour** », pas
« le transporteur livre-t-il bien ». Deux conséquences à assumer et à ne pas corriger après coup :

- le taux **monte** quand le stock en vol se règle, sans qu'aucune performance ait changé ;
- il **baisse** mécaniquement quand le volume d'upload accélère, puisque les commandes
  récentes n'ont pas encore atterri.

Le chiffre sur les commandes réglées (79,4 % pour le produit de référence) reste affiché dans
le bandeau de la fiche comme **valeur de convergence** — c'est vers lui que le taux tend — mais
il ne pilote aucun seuil de couleur ni aucun tri.

Seuils de couleur recalés en conséquence (le meilleur produit du catalogue est à 47,7 %) :

| Mesure | Vert | Ambre | Rouge |
|---|---|---|---|
| Taux de confirmation (produit) | ≥ 50 % | ≥ 35 % | < 35 % |
| Taux de livraison (produit) | ≥ 40 % | ≥ 25 % | < 25 % |
| Taux de confirmation (agent) | ≥ 55 % | ≥ 40 % | < 40 % |
| Taux de livraison (agent) | ≥ 30 % | ≥ 20 % | < 20 % |

### 0.5 Typographie

| Rôle | Taille | Graisse | Interlettre | Couleur |
|---|---|---|---|---|
| Titre de page | 30 px | 600 | −0.03em | `--ink-1` |
| Titre de fiche | 23 px | 600 | −0.024em | `--ink-1` |
| Titre de section de formulaire | 15.5 px | 600 | −0.014em | `--ink-1` |
| Étiquette de section (`.sec h2`) | 11.5 px | 700 | +0.10em, majuscules | `--ink-2` |
| Micro-étiquette (`.lab`) | 10.5 px | 600 | +0.06em, majuscules | `--ink-3` |
| Valeur XL (`.val-xl`) | 27 px | 700 | −0.032em | héritée |
| Valeur L (`.val-lg`) | 21 px | 700 | −0.03em | héritée |
| Valeur M (`.val-md`) | 15 px | 700 | −0.02em | héritée |
| Corps | 14 px | 400 | 0 | `--ink-1` |
| Secondaire (`.sub`) | 11.5 px | 400 | 0 | `--ink-2` |

Chiffres : `font-variant-numeric: tabular-nums` sur **toute** donnée numérique.

### 0.6 ⚠️ Correctif bidi — obligatoire, s'applique à toute la console

Le symbole LYD `د.ل` est RTL fort. Deux défauts distincts, tous deux visibles en production :

1. **Contamination** — collé à du texte latin, il réordonne les segments voisins.
   `+94 د.ل · 72,8 %` s'affichait **`+72,8 د.ل · 94 %`**. Les deux nombres sont échangés.
2. **Signe déplacé** — dans un isolat à direction déduite (FSI), le symbole est le premier
   caractère fort, donc l'isolat résout en RTL et renvoie le `+` / `−` à l'autre bout :
   `+10.708 د.ل` s'affichait **`د.ل 10.708+`**.

`Intl.NumberFormat("ar-LY", {style:"currency"})` place en plus le symbole **avant** le
montant et y insère des marques RLM. Le correctif recompose le format et l'isole en **LRI**
(`U+2066`, LTR imposé — pas FSI) :

```js
const LRI = "⁦", PDI = "⁩", NBSP = " ";
const CTRL = /[‎‏؜]/g;              // RLM / LRM / ALM insérés par CLDR

function amount(fmt, n, withSign) {
  const p = fmt.formatToParts(Math.abs(n));
  const pick = t => p.filter(x => t.includes(x.type)).map(x => x.value).join("").replace(CTRL, "");
  const sym = pick(["currency"]);
  const val = pick(["integer", "group", "decimal", "fraction"]);
  const sign = withSign ? (n > 0 ? "+" : n < 0 ? "−" : "") : "";
  return LRI + sign + val + NBSP + sym + PDI;      // → « +10.708 د.ل »
}
```

Doublé côté CSS pour protéger l'élément lui-même :

```css
.tnum  { font-variant-numeric: tabular-nums; unicode-bidi: isolate; direction: ltr; }
.money { unicode-bidi: isolate; direction: ltr; white-space: nowrap; }
```

**Les deux sont nécessaires** : le CSS isole l'élément, les marqueurs isolent les segments
concaténés à l'intérieur d'un même élément.

> **À porter dans l'app.** `src/lib/format.ts::formatCurrency` produit aujourd'hui la forme
> brute. Tout écran LTR (interface française) est exposé. À traiter comme un correctif à part
> entière, avec un test qui assert l'ordre des caractères — pas comme un détail de ce chantier.

---

## 1 · Atomes partagés

### 1.1 Porte-icône `.ico`

Rectangle arrondi teinté qui porte une icône de 13–15 px. Remplace les icônes nues, qui se
perdaient à 13 px sur fond blanc.

| Aspect | Valeur |
|---|---|
| Layout | 30 × 30 px, `--r-sm`, `display:grid; place-items:center`, `flex:none`. Variantes : `.ico-sm` 24 px / `--r-xs`, `.ico-lg` 44 px / `--r-md` |
| Couleurs | 5 tonalités = fond de statut + encre de statut : `brand` `--brand-bg`/`--brand` · `info` `--action-bg`/`--action` · `warn` `--warning-bg`/`--warning` · `bad` `--critical-bg`/`--critical` · `neutral` `--neutral-bg`/`--ink-2` |
| Typo | — |
| A11y | `aria-hidden="true"` sur le SVG. Le porte-icône ne porte jamais l'information seul : il double toujours une étiquette texte |

```html
<span class="ico ico-brand ico-sm">
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
</span>
```

```css
.ico{width:30px;height:30px;border-radius:var(--r-sm);display:grid;place-items:center;flex:none}
.ico-brand{background:var(--brand-bg);color:var(--brand)}
.ico-sm{width:24px;height:24px;border-radius:var(--r-xs)}
```

### 1.2 Puce `.chip`

| Aspect | Valeur |
|---|---|
| Layout | hauteur 24 px, `padding:0 10px`, `--r-xs`, `inline-flex`, `gap:5px`, `white-space:nowrap` |
| Couleurs | `ok` marque · `off` neutre · `warn` ambre · `bad` rouge · `info` bleu · `sku` `--sunken` + bordure `--line-subtle`, monospace |
| Typo | 11.5 px / 600. Variante `sku` : 11 px / 500 / `ui-monospace` |
| A11y | Contraste ≥ 4.5:1 pour chaque paire encre/fond — vérifié par `src/lib/orders/status-contrast.test.ts` |

### 1.3 Bouton `.btn`

| Variante | Fond | Bordure | Encre | Usage |
|---|---|---|---|---|
| par défaut | `#FFF` | `--line` | `--ink-1` | action secondaire |
| `.btn-primary` | `--brand` | `--brand` | `#FFF` | **une seule par écran** |
| `.btn-ghost-brand` | `--brand-tint` | `--brand-bg` | `--brand` | action constructive tertiaire (« Remplacer ») |
| `.btn-ghost-bad` | `--critical-bg` | `--critical-bg` | `--critical` | action destructive tertiaire (« Retirer ») |
| `[disabled]` | `--sunken` | `--line-subtle` | `--ink-3` | `cursor:not-allowed`, pas d'ombre |

Layout : hauteur 40 px (`sm` : 33 px), `--r-md` (`sm` : `--r-sm`), `gap:8px`, icône 15 px avant le
libellé. Typo 13.5 px / 500 ; `primary` et `ghost-*` en 600.

```css
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;
  padding:0 16px;border-radius:var(--r-md);border:1px solid var(--line);background:#fff;
  font-size:13.5px;font-weight:500;transition:background .12s,border-color .12s,color .12s}
.btn:hover{background:var(--sunken);border-color:var(--line-strong)}
.btn-primary{background:var(--brand);border-color:var(--brand);color:#fff;font-weight:600;box-shadow:var(--e-row)}
.btn-primary:hover{background:var(--brand-hover);border-color:var(--brand-hover)}
```

A11y : `aria-label` sur tout bouton icône seule (`.btn-icon`, `.pmenu`). Anneau de focus
`2px solid var(--brand)` avec `outline-offset:2px` — l'offset fait tomber l'anneau sur le fond
de page plutôt que sur le vert du bouton, ce qui préserve les 3:1 exigés par WCAG 2.4.11.

### 1.4 Jauge `.track`

| Aspect | Valeur |
|---|---|
| Layout | hauteur 4 px (9 px pour la cascade de coûts), `--r-xs` / 2, `overflow:hidden` |
| Couleurs | piste `--sunken` ; remplissage `--brand` par défaut, `.warn` `--warning`, `.bad` `--critical`, `.info` `--action`, `.pos` `--brand-pos` |
| A11y | Purement décoratif : **le pourcentage est toujours écrit en toutes lettres à côté**. Aucun `role="progressbar"` — ce n'est pas une progression, c'est un ratio déjà énoncé |

### 1.5 Étiquette de section `.sec`

Porte-icône `sm` + titre + méta alignée en fin de ligne (`margin-inline-start:auto`).
Le `<h2>` est un vrai `h2` : la fiche produit se parcourt au clavier par titres.

---

## 2 · Écran 1 — liste produits

### 2.1 En-tête de page

| Aspect | Valeur |
|---|---|
| Layout | `flex`, `gap:16px`. Porte-icône `lg` (44 px) + bloc titre ; actions poussées en fin par `margin-inline-start:auto`. `flex-wrap` pour les écrans étroits |
| Couleurs | fond hérité `--bg-page` ; porte-icône `ico-brand` |
| Typo | `h1` 30 px / 600 / −0.03em ; sous-titre 14 px / `--ink-2` |
| A11y | `h1` unique par écran |

### 2.2 Barre d'outils

Passe d'une rangée nue à une **carte** : elle contient recherche + facettes + tri + densité,
et devient un objet unique au lieu de quatre contrôles flottants.

| Aspect | Valeur |
|---|---|
| Layout | carte `--r-lg`, `padding:11px 13px`, `flex`, `gap:12px`, `flex-wrap`. Recherche `flex:1; max-width:400px`. Tri/densité poussés en fin |
| Couleurs | `--bg-card` + `--line-subtle` + `--e-card` |
| Typo | contrôles 13–14 px |

### 2.3 Champ de recherche

Hauteur 42 px, `--r-md`, icône loupe 16 px en `--ink-3` positionnée à 13 px, `padding-left:40px`.
Focus : bordure `--brand` + halo `0 0 0 3px var(--brand-bg)`.
A11y : `type="search"` + `aria-label` (le placeholder ne suffit pas).

### 2.4 Facettes `.fchip`

| Aspect | Valeur |
|---|---|
| Layout | pilule `border-radius:999px`, hauteur 38 px, `padding:0 15px`, `gap:7px`, compteur à droite |
| Couleurs | repos : `#FFF` / `--line` / `--ink-2`. Actif **neutre** : `--brand-tint` / `--brand-bg` / `--brand`. Actif **exception** : la facette garde sa teinte de statut — `Rupture` et `Perte` en `--critical-bg`/`--critical`, `Sans ventes` en `--warning-bg`/`--warning` |
| Typo | 13 px / 500 ; actif 600. Compteur 11.5 px / 700 |
| A11y | `aria-pressed` (pas `aria-selected` : ce n'est pas un tablist). Groupe enveloppé dans `role="group"` + `aria-label` |

> Le fait que « Rupture » actif reste **rouge** et non vert est délibéré : la couleur y décrit
> l'état du catalogue, pas la sélection. Une facette d'exception qui devient verte une fois
> choisie inverse son propre message.

### 2.5 Carte produit `.pcard` — le composant central

Quatre bandes séparées par des filets 1 px, jamais par des espaces : la carte lit comme une
fiche, pas comme quatre tuiles empilées.

```
┌────────────────────────────────────────────────┐
│ [58]  nom du produit                     [···] │  identité
│       [Actif] [sku]                            │
├────────────────────────────────────────────────┤
│ COMMANDES     CONFIRMÉES     LIVRÉES           │  entonnoir
│ 866           453            108               │
│ reçues        52,3 %         79,4 %            │
│ ▬▬▬▬▬▬▬       ▬▬▬▬           ▬▬▬▬▬▬            │
├────────────────────────────────────────────────┤
│ CA LIVRÉ      PROFIT BRUT   ┌ PROFIT NET ─────┐│  argent
│ 14.738 د.ل    +11.938 د.ل   │ +10.708 د.ل     ││
│ 112 unités    COGS 2.800    │ marge 72,7 %    ││
├───────────────────────────  └─────────────────┘┤
│ 📦 216 en stock · seuil 20     [🚚 229 en cours]│  stock
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬                      │
└────────────────────────────────────────────────┘
```

| Aspect | Valeur |
|---|---|
| Layout | grille `repeat(auto-fill, minmax(408px, 1fr))`, `gap:18px`. Carte en `flex-column`, `--r-lg`, `overflow:hidden`. Bandes : identité `15px 17px 14px` · entonnoir `13px 17px 15px` (3 colonnes, `gap:16px`) · argent `13px 17px` (`1fr 1fr 1.08fr`, `gap:10px`) · pied `12px 17px 14px` |
| Couleurs | `--bg-card` / `--line-subtle` / `--e-card`. **Hover** : `--line-strong` + `--e-panel` + `translateY(-2px)`. **Inactif** (`[data-off=true]`) : fond `#FCFCFD`, vignette et nom à `opacity:.6`. **Perte** (`[data-loss=true]`) : rail `::before` de 3 px en `--critical` sur le bord inline-start |
| Typo | nom 14.5 px / 600, `-webkit-line-clamp:2` ; valeurs d'entonnoir `.val-lg` ; valeurs d'argent `.val-md` |
| A11y | `tabindex="0"` + `role="link"` + activation à `Enter` sur la carte cliquable. Le menu `···` intercepte le clic (`e.target.closest('.pmenu')`) pour ne pas déclencher la navigation |

**Pourquoi le rail n'existe que pour la perte.** En v3 il était vert sur toute carte rentable.
Un rail vert présent sur 5 cartes sur 8 ne distingue plus rien et consomme le vert de marque
pour décrire un état — exactement ce que §1 du design system interdit. Il ne reste que là où
il déclenche une action.

**Cellule « profit net ».** Encart teinté `--brand-tint` bordé `--brand-bg`, `--r-md`, en
retrait négatif (`margin:-9px -3px`) pour déborder proprement de la bande. Trois états :

| État | Classe | Fond | Encre du chiffre |
|---|---|---|---|
| bénéfice | `.hero` | `--brand-tint` | `--brand-pos` |
| perte | `.hero.loss` | `--critical-bg` | `--critical` |
| aucun CA | `.hero.flat` | `--sunken` | `--ink-2` |

L'état `flat` existe parce qu'un `0` sur fond de marque se lit comme un résultat obtenu, alors
qu'il signale une absence de résultat. Sa légende passe de « marge x % » à
« coûts engagés, rien d'encaissé ».

### 2.6 Pied de carte — stock + en vol

Jauge de stock calée sur `seuil × 4` (le seuil vaut donc 25 % de la barre : la zone d'alerte
est lisible d'un coup d'œil). Teinte : `--critical` si stock ≤ 0, `--warning` si ≤ seuil.

Pilule « en cours » : `border-radius:999px`, `--action-bg`/`--action`, `--neutral-bg`/`--ink-3` à zéro.
Elle porte le **compte d'uploads non encore réglés** — la mesure sans laquelle le taux de
livraison n'est pas interprétable.

### 2.7 État vide de carte

Porte-icône `neutral` de 46 px en cercle + phrase en `--ink-3`, `padding:34px 20px`.
Les bandes argent et entonnoir sont **omises**, pas remplies de zéros : un zéro affirme une
mesure, l'absence de bande dit qu'il n'y a rien à mesurer.

---

## 3 · Écran 2 — fiche produit `/products/[id]`

Remplace le tiroir `?open=<id>`. Le bouton « fiche complète » disparaît : il n'y a plus qu'une
fiche. Ordre des sections, **inchangé sauf l'insertion d'Agents** :
en-tête → entonnoir → **argent** → **agents (nouveau)** → stock → coûts → fiche agent → historique.

### 3.1 Fil d'Ariane

12.5 px / `--ink-2`, chevrons 13 px `aria-hidden`, `<nav aria-label>`, dernier élément
`aria-current="page"` et non cliquable.

### 3.2 En-tête de fiche

| Aspect | Valeur |
|---|---|
| Layout | carte, `padding:20px 22px`, `flex`, `gap:20px`. Vignette 88 px `--r-lg`. Actions en fin. Rangée de 5 mesures rapides en dessous, `gap:30px` |
| Typo | `h1` 23 px / 600 ; mesures `.lab` + `.val-md` |
| A11y | vignette `role="img"` + `aria-label` ; nom en `dir="auto"` (produits arabes dans une UI française) |

### 3.3 Entonnoir 5 étapes

Cinq cartes indépendantes, pas une grille jointe : chaque étape est une mesure autonome.

| # | Étape | Porte-icône | Remplissage |
|---|---|---|---|
| 1 | Commandes | `neutral` panier | `--brand`, 100 % |
| 2 | Traitées | `neutral` personne | `--brand` |
| 3 | Confirmées | `brand` coche | `--brand` |
| 4 | **Uploadées** | `info` flèche haut | **`--action`** |
| 5 | Livrées | `brand` camion | `--brand-pos` |

L'étape 4 est **bleue et non verte** : un upload n'est pas un résultat acquis. Sa légende porte
le nombre encore en vol (`229 encore en cours`) — c'est-à-dire la part de son propre chiffre
qui n'a pas encore basculé dans l'étape 5. L'étape 5 énonce son dénominateur en toutes lettres
(`25,1 % des 431 uploadées`) : les deux cartes se lisent l'une par l'autre.

### 3.4 Bandeau d'explication `.callout`

`--action-bg`, bordure `#D6E4FB`, `--r-md`, `padding:12px 15px`, encre `#1F4E8C` (**7.1:1**),
porte-icône blanc circulaire de 26 px. Un `<p>`, pas un `role="note"` — c'est du texte courant,
pas une alerte.

C'est le seul endroit où la règle du §0.4 est écrite en toutes lettres, et il porte les deux
chiffres : le taux courant (25,1 % sur 431 uploadées) **et** sa valeur de convergence
(79,4 % sur les 136 déjà réglées). Sans le second, un lecteur conclut que trois quarts des
colis se perdent.

### 3.5 Section Argent

Deux colonnes `352px 1fr`.

**Carte héros** — `--brand-tint` / bordure `--brand-bg` / `--r-lg` / `padding:20px 22px`.
Chiffre 35 px / 700 / −0.034em en `--brand-pos`. Variante `.loss` → `--critical-bg` + `--critical`.
Sous-grille 2 × 2 de cartes blanches `--r-md` : CA, profit brut, marge nette, net/livraison.

**Cascade de coûts** — `grid-template-columns:136px 1fr 130px`, barres de 9 px.
Palette **fixe et non sémantique**, une teinte par poste, reprise du tiroir v3 pour que la
lecture reste la même : COGS `#D72C0D` · livraison `#E08909` · retours `#E5847E` ·
emballage `#8C9196` · publicité `#2C6ECB` · traitement `#BEC3CA`.
Ligne de total séparée par un filet, 15 px / 700.
Les lignes à zéro sont **conservées** : une barre absente dirait « ce coût ne s'applique pas »,
une barre à zéro dit « il s'applique et vaut zéro ».

### 3.6 Section Agents (nouveau)

Quatre tuiles puis le tableau de classement.

**Tuiles** — `repeat(4, 1fr)`, `gap:14px`, cartes `--r-lg`, `padding:16px 18px`.
Porte-icône `sm` + `.lab` sur une ligne, puis `.val-xl`, puis une légende qui porte **toujours
le dénominateur** :

| Tuile | Valeur | Légende |
|---|---|---|
| Appels | 1 450 | sur **519** commandes appelées · **2,79** appels / commande |
| Traitées | 770 | **89 %** des 866 commandes · **8** créées à la main |
| Confirmées | 453 | **52,3 %** des commandes · 58,8 % des traitées |
| Livrées | 108 | **25,1 %** des 431 uploadées · 229 encore en vol |

**Tableau `.rank`** — 12 colonnes, `overflow-x:auto` sur un conteneur dédié (le corps de page
ne défile jamais horizontalement).

| Colonne | Alignement | Rendu |
|---|---|---|
| # | gauche | badge 24 px `--r-xs` ; 1er en `--brand` sur blanc |
| Agent | gauche | avatar 30 px `--r-sm` (initiales) + nom 13 px/600 + rôle 11 px/`--ink-3` |
| Appels, Traitées, Créées, Confirmées, Livrées, Retours | droite | `tabular-nums` ; zéro rendu `—` en `--ink-3` ; retours > 0 en `--critical` |
| App./traitée | droite | 2 décimales, `--ink-2` |
| Taux conf. / Taux liv. | droite | pourcentage 700 coloré par seuil + mini-jauge 62 × 4 px |
| CA généré | droite | montant 700, colonne de tri par défaut |

Seuils de couleur : voir §0.4. Pour l'agent, `Taux liv.` = **livrées / confirmées** — la
transposition du taux produit : les commandes qu'il a envoyées vers l'upload et qui ne sont pas
encore arrivées comptent contre lui. Un agent qui vient de confirmer un gros lot est donc
pénalisé tant que ce lot est en vol, ce que la note de bas de tableau énonce explicitement.

En-têtes triables : `<th>` porte `aria-sort="ascending|descending"` uniquement sur la colonne
active ; le libellé est un `<button>` (activable au clavier) avec un chevron plein si trié,
une double flèche à 45 % d'opacité sinon.

Managers et administrateurs sont sortis du classement dans un groupe `tr.grp` : ils confirment
en masse sans appeler, et les laisser dans le tri fausse la comparaison entre agents.

Un `<caption class="sr">` décrit le tableau pour les lecteurs d'écran, et une note de bas de
tableau énonce les trois règles d'attribution (traitées ≠ exclusives, livrées attribuées au
dernier confirmateur, taux de livraison sur les réglées).

### 3.7 Grille clé-valeur `.kv`

`repeat(3, 1fr)`, `gap:12px`, cartes `--r-md`, `padding:13px 16px`, `.lab` + `.val-md`.
Sert aux sections Stock et Modèle de coût.

### 3.8 État vide `.zero-state`

Bordure `1px dashed --line-strong`, fond `--sunken`, `--r-lg`, `padding:30px 22px`, centré.
Porte-icône circulaire 46 px, titre 14 px/600, texte `max-width:460px`, puis **un CTA**.
Un état vide sans action est un cul-de-sac : celui de la fiche agent mène à l'écran d'édition.

---

## 4 · Écran 3 — édition

Écrit aujourd'hui en styles inline (`border-radius:4`, bouton noir, colonne de 600 px) : seule
surface de la console encore hors système. Passage aux jetons, sans changer un seul champ,
une seule route ni une seule règle de permission.

### 4.1 Structure

`grid-template-columns: 1fr 366px`. Colonne principale = sections empilées ;
colonne latérale = aperçus `position:sticky; top:74px`.
Sous 1280 px la latérale repasse sous le formulaire.

### 4.2 Section de formulaire `.fsec`

Carte `--r-lg`, `padding:21px 23px`, `margin-bottom:18px`.
En-tête : porte-icône 30 px + `h3` 15.5 px/600 + **puce de permission** poussée en fin
(`Super admin` en ambre, `Manager du marché` en bleu). La permission est ainsi lisible avant
d'essayer de taper, au lieu d'être découverte au refus d'enregistrement.
Suivi d'un `.fhint` 12.5 px `--ink-2`.

### 4.3 Champs

| Aspect | Valeur |
|---|---|
| Layout | `--r-md`, `padding:10px 13px`, largeur 100 %. Paires en `.frow` (`1fr 1fr`, `gap:16px`). `textarea` `min-height:74px`, `resize:vertical` |
| Couleurs | bordure `--line` ; hover `--line-strong` ; focus `--brand` + halo `0 0 0 3px var(--brand-bg)` ; désactivé `--sunken` / `--ink-3` |
| Typo | 13.5 px ; libellé 12.5 px / 600 ; aide 11.5 px / `--ink-3` |
| A11y | `<label for>` explicite sur **chaque** champ. Aide reliée par `aria-describedby`. L'astérisque de champ requis est `aria-hidden` et doublé d'un `<span class="sr">obligatoire</span>` |

`select` : flèche native supprimée (`appearance:none`) et remplacée par un chevron SVG en
`data:` URI positionné à 12 px, `padding-right:38px`.

Suffixe d'unité `.unit .u` : `position:absolute`, `right:13px`, `pointer-events:none`,
`padding-right:56px` sur l'input.

### 4.4 Compteur de caractères

`flex` avec `justify-content:space-between` : l'aide à gauche, le reste à droite.
`aria-live="polite"` pour que le décompte soit annoncé sans voler le focus.

### 4.5 Sélecteur d'image

Vignette 86 px `--r-md` + deux boutons `sm` : « Remplacer » en `.btn-ghost-brand`,
« Retirer » en `.btn-ghost-bad`. Enveloppés dans `role="group"` + `aria-labelledby`
pointant sur le libellé « Image ».

### 4.6 Onglets

`role="tablist"` / `role="tab"` / `role="tabpanel"`, `aria-controls` + `aria-labelledby`
croisés, panneaux masqués par l'attribut `hidden`.
Navigation ← / → entre onglets, `tabIndex` roving (seul l'onglet actif est dans l'ordre de
tabulation). Actif : `--brand` + soulignement 2 px `--brand` + 600.

Regroupe composition / utilisation / contre-indications, trois champs longs rarement remplis
ensemble — la section passe de trois zones de texte empilées à une seule visible.

### 4.7 Interrupteur

`<button role="switch" aria-checked>` — **pas** une `div` : opérable au clavier par défaut.
Piste 40 × 23 px, bouton 18 px, `--brand` à l'état activé, `--line-strong` sinon,
transition 160 ms. Libellé 13 px/600 + explication 11.5 px/400 dans le même bouton.

### 4.8 Aperçu de marge (colonne latérale)

Rangées `justify-content:space-between`, total séparé par un filet, 17 px / 700 en
`--brand-pos` (ou `--critical` si négatif). Recalculé à chaque frappe sur prix, COGS,
emballage, traitement.
La ligne « livraison » utilise le **frais moyen réel observé** sur les livraisons du produit
(`shipFee / delivered` = 10,093 د.ل), pas une constante.

### 4.9 Aperçu agent

Reproduit le bloc que l'agent voit pendant l'appel : bandeau de brief dont le fond suit le ton
choisi (`info` bleu / `warning` ambre / `critical` rouge) + corps des notes.
Se met à jour en direct depuis les champs « Brief » et « Ton du brief ».

### 4.10 Barre d'enregistrement fixe

`position:fixed; bottom:0`, fond `rgba(255,255,255,.94)` + `backdrop-filter:blur(8px)`,
bordure supérieure `--line`, ombre `0 -4px 16px`.
Le bouton d'enregistrement est **désactivé tant que rien n'a changé** ; à la première
modification le message passe de « Aucune modification en attente » (`--ink-2`) à
« Modifications non enregistrées » (`--warning`, icône triangle).

---

## 5 · Accessibilité — récapitulatif

| Exigence | Traitement |
|---|---|
| Contraste texte | Toutes les paires viennent de jetons déjà mesurés. `--ink-3 #9CA3AF` (4.6:1) est réservé aux **micro-étiquettes majuscules et aux valeurs nulles**, jamais au corps de texte |
| Contraste non-textuel | Anneau de focus 5.0:1 sur `--bg-page` ; bordures de contrôle `--line #E1E3E5` doublées d'un fond distinct |
| Focus visible | `:focus-visible{outline:2px solid var(--brand);outline-offset:2px}` global, jamais supprimé |
| Clavier | Cartes cliquables `tabindex="0"` + activation `Enter` ; onglets en flèches avec roving tabindex ; interrupteur en `<button role="switch">` ; en-têtes de tri en `<button>` |
| Lecteurs d'écran | `aria-label` sur boutons icône seule ; `aria-pressed` sur facettes ; `aria-sort` sur la colonne triée ; `<caption class="sr">` sur le tableau ; `aria-live="polite"` sur le compteur |
| Couleur non porteuse seule | Chaque jauge est doublée du pourcentage écrit ; chaque puce de statut porte son libellé ; le rail de perte double un chiffre déjà rouge |
| RTL | Propriétés logiques partout (`margin-inline-start`, `inset-inline-start`, `padding-inline`) ; `dir="auto"` sur tout nom de produit |
| Mouvement | `@media (prefers-reduced-motion:reduce){*{transition:none!important}}` |
| Sémantique | `<main>` par écran, un seul `h1`, sections en `<section>` avec `h2`, `<nav aria-label>` sur le fil d'Ariane |

---

## 6 · Ce qui n'a pas changé

- Toutes les routes, actions et permissions.
- L'ordre des sections de la fiche, à l'insertion d'Agents près.
- Les formules de rentabilité — `lib/calculations/product-profitability.ts` reste la source.
- Les colonnes exportées en CSV.
- Le modèle d'intégrité du stock : l'édition ne touche toujours pas `current_stock`.

## 7 · Suites

1. **Porter le correctif bidi** dans `src/lib/format.ts` avec un test d'ordre de caractères — indépendant de ce chantier, et plus urgent.
2. La colonne « Créées » est presque vide en production (6 et 2 sur le produit de référence, 855 des 866 commandes venant du webhook). À garder ou à retirer — décision produit, pas technique.
3. Le taux de livraison en option B bouge quand le volume bouge (§0.4). Si un jour il sert à comparer deux **périodes**, il faudra le figer sur une cohorte d'upload plutôt que sur une fenêtre de dates, sinon la comparaison mesure le rythme d'upload et non la livraison.

**Tranché** — dénominateur du taux de livraison : option B, tout ce qui a été uploadé (§0.4).
