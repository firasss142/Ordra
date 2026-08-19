# Entrepôt — spécification visuelle

Transcription des cinq maquettes validées. Chaque section décrit un écran composant par
composant : c'est la référence à suivre quand les PNG ne sont pas sous la main.

---

## 0. Fondations — la console sombre

L'Entrepôt est le seul écran sombre de l'OMS. Le poste est physique (atelier, tablette,
écran mural), pas bureautique. Les tokens sont scopés `--wh-*` et ne fuient pas ailleurs.

| Rôle | Token | Valeur |
|---|---|---|
| Fond de page | `--wh-bg` | `#0A0B0D` |
| Carte | `--wh-surface` | `#121417` |
| Carte surélevée / ligne survolée | `--wh-surface-2` | `#181B1F` |
| Creux (en-tête de tableau, groupe) | `--wh-sunken` | `#0E1013` |
| Bordure | `--wh-border` | `#22262C` |
| Bordure marquée | `--wh-border-strong` | `#2E343C` |
| Encre 1 (chiffres, noms) | `--wh-ink-1` | `#F2F4F6` |
| Encre 2 (libellés, sous-lignes) | `--wh-ink-2` | `#9BA3AD` |
| Encre 3 (méta, en-têtes de colonne) | `--wh-ink-3` | `#6B7280` |

Couleurs fonctionnelles — **chacune porte une teinte de fond et une bordure assorties** :

| Sens | Trait | Fond | Bordure |
|---|---|---|---|
| Vert — succès, sorties, objectif tenu | `#22C55E` | `#0E2818` | `#1B4D2E` |
| Ambre — retard, anomalie, à justifier | `#F59E0B` | `#2A1F0A` | `#5A3F12` |
| Rouge — erreur, perte, rupture | `#EF4444` | `#2A1315` | `#5A2326` |
| Violet — scans, sorties de stock | `#8B5CF6` | `#1B1630` | `#382B63` |
| Cyan — retours, transferts, remises | `#14B8A6` | `#0C2523` | `#17504A` |

Règles reprises des maquettes :

- **Rayon** 12 px sur les cartes, 10 px sur les tuiles internes, 8 px sur les boutons et
  puces, plein arrondi sur les pastilles.
- **Le bouton primaire vert porte une lueur** : `box-shadow: 0 0 0 1px #22C55E33, 0 4px 20px -4px #22C55E66`.
  C'est le seul effet lumineux de l'interface, réservé à l'action principale et au champ de scan actif.
- **Les chiffres sont tabulaires** partout, et les numéros de sticker/code-barres sont en
  police à chasse fixe.
- **Porte-icône** : carré 36–40 px, rayon 10 px, fond teinté + bordure 1 px de la même famille,
  glyphe à la couleur de trait. Présent devant chaque KPI et chaque action.
- **Bande latérale de sévérité** : 3 px à gauche de la ligne (rouge, ambre) pour ce qui exige
  une action. Jamais décorative.

---

## 1. Aujourd'hui — `01-aujourdhui.png`

**En-tête** — « Entrepôt » 26 px, sous-titre « Vue opérationnelle · Libye · Darb Assabil ».
À droite : `Journal` (bouton sombre bordé) et `Préparer` (vert, avec lueur).

**Bandeau KPI — une seule carte, cinq cellules séparées par des filets verticaux.**
Chaque cellule : porte-icône · grand chiffre (34 px) · libellé en capitales 11 px · une puce
de contexte · une jauge fine (3 px) en pied.

| Cellule | Porte-icône | Puce | Jauge |
|---|---|---|---|
| 17 À PRÉPARER | ambre | `Plus ancien : 4 j` (contour ambre) | ambre, partielle |
| 11 SCANNÉES | violet | `+3 vs objectif` (contour vert) | violet |
| 14 REMIS | vert | — | vert |
| 6 RETOURS | cyan | — | cyan |
| 0 STOCK BAS | gris, éteint | — | remplacée par une pastille ✓ |

La cinquième cellule est **volontairement éteinte** : rien à faire, donc rien qui attire l'œil.

**Actions prioritaires** — en-tête « Actions prioritaires », à droite
`TOTAL À RATTRAPER` en capitales 10 px + `478` en 20 px.
Ligne : bande de sévérité (la première seulement) · porte-icône · titre gras · sous-ligne
grise · valeur alignée à droite (`427` + unité `cmdes` en petit gris) · chevron.

**Activité** — titre + `(14 derniers jours)` en gris. Légende à pastilles carrées.
Graphe : axe Y à 0 / 10 / 20 / 30, grille pointillée, aire verte sous une courbe verte
lumineuse, courbe violette pointillée pour les retours, **point final cerclé**.
Sous l'axe : `5 août` à gauche, `aujourd'hui` à droite.

**Classement** — titre + icône (i). Ligne : rang · avatar rond à initiales (fond teinté,
une couleur par personne) · nom gras · sous-ligne `38 sorties · 4,8/h · 4 h actives` ·
à droite le débit `4,8 /h` en 20 px puis une **jauge portant un repère blanc à l'objectif**.
Sous les lignes 2 et 3 : l'écart au premier (`−1,5 /h vs Salima`) en petit gris.
Pied de carte : `| Objectif : 3,0 /h`.

**Aujourd'hui vs hier** — carte à trois cellules séparées : libellé, grand chiffre, et une
variation à triangle (`▲ 27 %` vert, `▼ −14 %` rouge).

---

## 2. Préparation — `02-preparation.png`

**En-tête** — « Préparation », sous-titre « Emballer, étiqueter, scanner la sortie · Libye ».
À droite `Liste de picking`.

**Trois cartes KPI** (séparées, pas un bandeau) : porte-icône en haut à gauche, libellé
capitales, grand chiffre, sous-ligne.
- `FILE DE PRÉPARATION 17` — violet — `3 régions · 17 commandes`
- `SCANNÉES AUJOURD'HUI 11` — vert — puce `+ 28 %` · **barre de progression** · `11 / 40 objectif quotidien`
- `COLIS EN RETARD 5` — ambre — **bordure de carte ambre** · `Plus ancien : 16 h` en ambre

**Recherche** pleine largeur : loupe, `Rechercher un client, une référence, un produit ou un
sticker…`, et à droite les touches `⌘` `K` en pastilles.

**Puces de filtre** : `Âge`, `Région`, `Produit` (sombres, à chevron) puis **`En retard 5`**
en ambre — puce active avec son compteur.

**Tableau** — en-têtes `COMMANDE · PRODUIT · ENCAISSER · ÂGE · STOCK`.
Ligne de groupe : pastille ronde colorée + `OUEST — المنطقة الغربية`, compte à droite
(`9 commandes`).
Ligne : case à cocher (verte cochée) · **vignette photo du produit** · nom arabe gras +
`C-0101 · طرابلس` · produit · `179,00 LYD` · pastille d'âge (grise / ambre / rouge) ·
stock + **pastille ronde de niveau** (verte, rouge) · bouton `Prendre`.
**Une ligne sélectionnée porte une bande verte à gauche et un fond légèrement teinté.**

**Barre de sélection** collée en bas : case verte + `2 sélectionnées`, à droite
`Tout prendre` et `Créer un lot (2)`.

**Station de scan** (colonne droite, collante) :
1. En-tête `Scanner les stickers Darb` + `un sticker = un colis`.
2. `COLIS EN MAIN` avec, à droite, la **pastille de région** (`OUEST`, violette).
   Nom arabe 18 px, `C-0111 · الخمس`, `Sac de frappe · moyen × 1`, puis
   `Sticker : 000000542713` en chasse fixe.
3. **Champ de scan** : icône code-barres, bordure verte **lumineuse**, curseur visible.
4. **Tuile de succès** : bordure verte, pastille ✓, `STICKER SCANNÉ` en capitales,
   le numéro en chasse fixe 20 px, puis `Stock : 200 → 199`.
5. `DERNIERS SCANS` : par ligne, pastille ✓/✗, numéro en chasse fixe, heure `11:24:31`,
   et la transition `200 → 199` (flèche verte). Une ligne en échec est rouge : `Non trouvé`.
6. Pied : ⚠ « Ne jamais saisir un numéro à la main : le transporteur accepte n'importe quel
   numéro sans vérifier qu'il nous appartient. »

---

## 3. Retours — `04-retours-b.png` (variante retenue) et `03-retours-a.png`

**Quatre cartes KPI**, chacune avec une icône en haut à droite et un pied séparé d'un filet.
Le chiffre est un **compteur à zéros de tête en chasse fixe** — `0006`, `0001`, `0000` —
qui donne au poste un air de terminal ; la couleur porte l'état (ambre en file, vert traité,
gris déprécié).

| Carte | Icône | Contenu | Pied |
|---|---|---|---|
| DANS LA FILE | sablier | `0006` ambre · `Le plus ancien : 14 j` | `VALEUR EN FILE — 0,00 LYD` |
| TRAITÉS AUJOURD'HUI | ✓ | `0001` vert · `1 remis en stock • 0 déprécié` | `VALEUR TRAITÉE` |
| TAUX DE RETOUR | — | `21 %` + puce rouge `↑ +4.2 pts` · `Sur 28 jours, livraisons + retours` | **sparkline rouge** `S-4 → S-1` |
| DÉPRÉCIÉS | bouclier | `0000` gris · `Aucune perte enregistrée sur 28 j` | `VALEUR DÉPRÉCIÉE` |

**Répartition par raison** — bande de puces : `Injoignable 2`, `Refus 2`, `Adresse 1`,
`Non retiré 1`, chacune avec son icône et son compteur.

**File des retours** — en-tête + `Tri : par ancienneté (âge)` avec les flèches de tri.
Ligne : **cloche rouge** si en retard · nom arabe + `C-0129 • الزاوية` · produit · montant ·
pastille de raison · pastille d'âge (rouge > 7 j, ambre au-delà de 3 j) · bouton `Traiter`.

**Décision** (colonne droite) :
- En-tête `Décision` + `Aucun colis sélectionné`.
- Champ de scan à bordure verte lumineuse : `Scannez le colis retourné…`.
- **Fil d'étapes** : `① Scanner ⋯ ② Décision ⋯ ③ Journal`, l'étape active en vert,
  reliées par des pointillés.
- `Aperçu des décisions possibles` : trois cartes à **icône en trait** —
  `Remettre en stock` (vert), `Endommagé / déprécié` (rouge), `Rélivrer au client` (cyan) —
  chacune avec sa phrase d'explication, **toutes éteintes** tant qu'aucun colis n'est scanné.
- Pied : 🔒 « Scannez un colis pour activer les actions. »

De la variante `03-retours-a.png`, on retient l'**état vide** : un grand cercle en pointillés
avec une icône de colis, `Scannez un colis retourné` et sa phrase d'aide.

---

## 4. Journal — `05-journal.png`

**Trois cartes KPI**, chacune avec un pied à deux cellules sous un filet :
- `ÉVÉNEMENTS AUJOURD'HUI` — `7` + `aujourd'hui` en gris — pied `4 sorties` / `10 mouvements de stock`
- `ANOMALIES` — `1` ambre, **carte à accent ambre** — pied `-2 u écart cumulé` / `1 à revoir`
- `TRAÇABILITÉ` — `100 %` vert — pied `3 opérateurs` / `0 sans auteur`

**Filtres** : pastilles `Tout` (verte, active) · `Sorties` · `Remises` · `Retours` ·
`Réceptions` · `Inventaires` · `Transferts` · `Impressions`. Puis la recherche avec `⌘K`.

**Tableau** — `HEURE · TYPE · ÉVÉNEMENT · OPÉRATEUR · Δ → SOLDE` (avec une icône (i)) et une
colonne de **boutons copier**.
Ligne de groupe : icône calendrier + `AUJOURD'HUI` + compteur (`7`).
`TYPE` est une pastille colorée à icône : Sortie (violet), Remise (cyan), Retour (ambre),
Réception (vert +), Inventaire (vert ✓), Transfert (cyan), Impression (gris).
`ÉVÉNEMENT` : `Sortie scannée • دیمة ملاكمة حجم متوسط` — le libellé, une puce, puis l'objet.
`Δ → SOLDE` : `-1 → 200`, la variation colorée, le solde en gris.
**La ligne d'anomalie porte une bande ambre à gauche** et une puce `à justifier`.
Pied de carte : « Trié par date et heure décroissantes. Le solde reflète l'état après chaque
événement. » et la **légende des pastilles** de type.

---

## 5. Ce que les maquettes ne montrent pas

- **Remise transporteur** : aucune maquette. À construire dans le même langage —
  une carte par compte transporteur, la liste des colis prêts, un bouton de remise, et
  l'historique des manifestes.
- **Stock** : explicitement **inchangé**, simplement déplacé sous Entrepôt.
- **Vue agent entrepôt** (sans barre latérale) : à dériver, mêmes écrans.
- Les **états vides, de chargement et d'erreur** de chaque écran.

---

## 6. État de l'implémentation

Branche `feat/entrepot-redesign`. Ce que la première tranche pose :

| Livré | Où |
|---|---|
| Tokens `--wh-*` scopés + entrée Tailwind `wh-*` | `src/app/globals.css`, `tailwind.config.ts` |
| Vocabulaire de tons et helpers (`WH_TONE`, `WH_CARD`, `padCounter`) | `src/components/warehouse/console/tokens.ts` |
| Primitives : `WhKpiStrip`, `WhKpiCell`, `WhActionRow`, `WhCard`, `WhPill`, `WhHolder` | `src/components/warehouse/console/primitives.tsx` |
| Écran **Aujourd'hui** | `src/components/warehouse/console/TodayOverview.tsx` |
| Fond sombre de la section (layout, bande d'onglets) | `src/app/[locale]/(warehouse)/layout.tsx`, `shell/WarehouseTabBar.tsx` |
| **Stock & inventaire** déplacé de Finances vers Entrepôt | `src/components/layout/Sidebar.tsx` |
| Série sombre du graphe re-calibrée | `src/components/warehouse/WarehouseTrendChart.tsx` |

`WarehouseOverviewClient` passe de 370 lignes de hex en dur à 105 lignes de tokens.

### Deux chiffres de la maquette ne sont pas branchés — volontairement

- **« Remis aujourd'hui »** : aucune agrégation des remises n'existe côté serveur.
- **« Classement »** : `/api/warehouse/operator-stats` est *scopé à l'utilisateur courant*
  (`get_operator_prep_stats(p_actor_id)`), il ne peut pas classer une équipe.

Les deux demandent un nouvel agrégat SQL. Un nombre plausible mais faux sur un écran
d'entrepôt coûte plus cher qu'une case absente : ils attendent leur source.
En revanche **« Aujourd'hui vs hier » est réel** — `WarehouseSummary.kpis.*` porte déjà
`previous`, `delta` et `deltaPct`.

### Reste à faire

Préparation, Retours, Journal et Remise transporteur portent encore la peau claire.
Leur logique (scan, décision, filtres, pagination) est intacte et ne bouge pas : le travail
restant est de les reposer sur `console/primitives.tsx`, écran par écran.
