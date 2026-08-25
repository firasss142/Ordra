# Entrepôt mobile — la vue de l'agent d'entrepôt

Les quatre maquettes de cette page (`01-dashboard.png` … `04-returns.png`) sont
**la référence** pour la coque agent. Elles ont été fournies en pièce jointe de
conversation le 24 août 2026 et versionnées immédiatement : la même section
avait déjà été reconstruite deux fois de mémoire après un compactage du
contexte, d'où deux livraisons « terminées » qui ne correspondaient pas.

> Ne travaillez plus jamais sur cette coque sans avoir rouvert ces quatre PNG.

## Qui voit quoi

`(warehouse)/layout.tsx` choisit une coque **par rôle** :

| Rôle | Coque | Navigation |
|---|---|---|
| `warehouse_agent` | `WarehouseMobileShell` — pensée pour le téléphone | barre basse 4 onglets + bouton Scan flottant |
| `market_manager`, `super_admin` | console bureau inchangée | barre latérale ENTREPÔT |

L'agent travaille **debout, une main sur le téléphone, l'autre sur un colis**.
Tout découle de là : la navigation est en bas là où le pouce arrive, le scan
flotte au-dessus, et chaque cible fait au moins 44 px.

L'ancienne bande d'onglets horizontale (`WarehouseTabBar`) est **supprimée** :
elle était en haut de l'écran, hors d'atteinte du pouce, et ne servait plus
qu'à ce rôle.

## Ce que les maquettes demandent, et ce que ça devient

Les maquettes montrent beaucoup de chiffres que le système ne produisait pas.
Contrairement à la refonte précédente, qui les avait **retirés**, ceux-ci ont
été **construits** — mais uniquement là où une définition honnête existait.

| Maquette | Métrique réelle | Source |
|---|---|---|
| Today's Scans / Goal + barres | scans du jour vs `goal_daily_scanned`, 14 jours | `get_warehouse_day_stats`, `get_warehouse_trend` |
| Pending Returns | file des retours | `get_warehouse_queue_stats.returns_inbox` |
| Low Stock N Items | produits sous le seuil | `/api/warehouse/stock` |
| Scanning Speed /hr | scans par heure **de présence** | `get_operator_prep_stats.rate_per_hour` ⟵ nouveau |
| Last Hour Scans | scans sur les 60 dernières minutes | `get_operator_prep_stats.scans_last_hour` ⟵ nouveau |
| Accuracy % | **exactitude du dernier comptage physique** | `get_count_accuracy` ⟵ nouveau |
| Avg processing time | `avg_cycle_seconds` | `get_operator_prep_stats` |
| Sparkline par produit | niveau de stock quotidien | `get_product_stock_series` ⟵ nouveau |
| Stock 150 / Goal 200 | `products.stock_goal` (nullable) | colonne ⟵ nouvelle |
| Stepper retour en 3 étapes | déjà `picked → decision → done` | `ReturnsConsole` |
| 3 décisions | `restock` / `damage` / `redeliver` | existant, correspondance exacte |

### Les trois règles qui n'ont pas plié

1. **`stock_goal` est NULLABLE.** Un objectif que personne n'a fixé s'affiche
   comme « seuil d'alerte », jamais comme « Objectif : 0 » — ce qui peindrait
   tout le catalogue en surstock catastrophique.
2. **`accuracy` est NULL tant que personne n'a compté.** « Jamais vérifié » et
   « vérifié et juste » sont des faits opposés et ne partagent pas un nombre.
   La maquette affiche 99,5 % ; nous affichons « jamais compté ».
3. **`rate_per_hour` est NULL sans scan.** Zéro voudrait dire « cet agent ne
   bouge pas », ce qui est une autre affirmation.

### Ce que les maquettes montrent et qui n'existe pas

| Élément | Statut |
|---|---|
| Critical Tasks avec échéance (« Deadline: 2:00 PM ») | **Retiré.** Aucun modèle de tâche ni d'échéance n'existe. Les vraies urgences sont déjà les files (préparation, retours) et l'âge du plus ancien colis. |
| « Accuracy » par ligne scannée | **Remplacé.** Il n'y a pas de vérité de référence au moment du scan ; l'exactitude n'a de sens qu'au comptage physique. |

## L'état réel des données (24 août 2026)

À la livraison, l'entrepôt **n'avait jamais scanné une seule fois** :
`order_history` ne contient aucun événement `scanned`, `inventory_log` compte
19 lignes au total et **zéro** comptage physique. Les écrans sont donc dessinés
pour leurs états vides, qui sont aujourd'hui l'état principal :

* Aujourd'hui, Scannées, Cadence, Exactitude → vides, avec leur explication ;
* Retours → 50 colis réels (tous tunisiens ; la file libyenne est vide) ;
* Stock → 5 produits actifs par marché, dont 1 à découvert.

## Les jetons

Rien de nouveau : la palette `--wh-*` de `entrepot-light.html` est reprise telle
quelle. Deux utilitaires sont ajoutés dans `globals.css` parce qu'ils n'ont de
sens que sur téléphone :

| Classe | Rôle |
|---|---|
| `.wh-safe-bottom` / `.wh-safe-top` | dégagent l'encoche et la barre de geste iOS |
| `.wh-grid-ground` | le fond quadrillé 24 px des maquettes, en `--wh-grid` |

Les deux vivent en CSS et pas en style inline : jsdom ne sait pas lire `env()`
dans un attribut `style`, ce qui rendait le comportement intestable.

## Captures

`report/shots/mobile/` (agent libyen, arabe RTL) et `report/shots/mobile-tn/`
(agent tunisien, français) — 390 × 844, via :

```
node scripts/capture-warehouse-screens.mjs --phone \
  --market=ly --email=warehouse.ly@oms.local --out=report/shots/mobile
```
