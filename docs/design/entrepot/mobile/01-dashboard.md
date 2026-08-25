# Dashboard — mesures relevées sur `01-dashboard.png`

Le PNG fait 408 × 732. Les valeurs ci-dessous sont **mesurées**, pas estimées :
un script a repéré les bandes de pixels verts et leurs hauteurs.

| Élément | Mesure | Traduction dans le code |
|---|---|---|
| Barres du KPI | bande verte **y 180–217 → 38 px** | `WhSpark height="h-[38px]"` |
| Barre de progression (Tâches) | bande verte **y 357–363 → 7 px** | `h-[7px]` |
| Sparkline du Résumé | bande **y 593–645 → 53 px** (avec le libellé) | `height="h-[34px]"` |
| Vert des aplats | `#147A47` (FAB, pastilles) | `--wm-accent` |
| Fond | `#F4F3ED` | `--wm-ground` |
| Carte | quasi identique au fond + filet | `--wm-card` `#FAFAF6`, `--wm-card-edge` `#BFD6C7` |

## L'anatomie qu'il ne faut pas re-inventer

Trois écarts avaient fait lire l'écran comme « une autre application », et
c'est ce qui a été corrigé :

1. **La carte KPI n'a AUCUNE icône.** Un libellé en casse normale, le chiffre,
   une sous-ligne, puis le graphique. Le porte-icône teinté de la console de
   bureau était le premier signal d'appartenance à l'autre design.
2. **Le graphique fait la moitié basse de la carte et est TOUJOURS dessiné.**
   Une série entièrement à zéro dessine une ligne de base plate
   (`emptyBaseline`), pas un trou : le trou se lit comme une carte cassée.
3. **Les cartes de tâche sont sur DEUX COLONNES**, titre → barre + `%` sur la
   *même* ligne → une seule ligne de légende. Pas de chiffre héros : il ne
   tient pas à côté d'un titre dans une demi-largeur de téléphone.

## Ce qui diffère de la maquette, et pourquoi

| Maquette | Ici |
|---|---|
| « Inventory Count - Aisle B », « Deadline: 2:00 PM » | Les vraies files (Préparation, Retours, Comptage). Aucun modèle de tâche ni d'échéance n'existe ; la légende porte le nombre en attente et l'âge du plus ancien. |
| `Accuracy 99.5 %` | L'exactitude du **dernier comptage physique**. NULL tant que personne n'a compté — « jamais vérifié » et « vérifié et juste » ne partagent pas un nombre. |
| `Scanning Speed 120/hr` | Réel (`rate_per_hour`), mais NULL sans scan : zéro voudrait dire « cet agent ne bouge pas ». |
| Barres sous « Low Stock » | Retirées. Nous n'enregistrons pas combien de produits étaient sous le seuil les jours passés, et emprunter les barres de scan mettrait une image du scan sous un chiffre de stock. |
