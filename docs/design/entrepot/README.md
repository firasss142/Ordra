# Entrepôt — référence visuelle

## La source de vérité

**[`entrepot-light.html`](./entrepot-light.html)** — la maquette interactive complète
(21 août 2026), 827 lignes, autonome. Ouvrez-la dans un navigateur.

C'est **la** référence. Toute question de mise en page, d'espacement, de graisse ou
de couleur se tranche en lisant ce fichier, pas de mémoire.

Elle couvre quatre écrans : **Aujourd'hui · Préparation · Retours · Journal**.
Stock n'y figure pas : la page existante est conservée telle quelle, seule sa
section change (Finances → Entrepôt).

> **Pourquoi ce fichier existe.** La maquette n'avait été fournie qu'en pièce jointe
> de conversation. À chaque compactage du contexte, le balisage disparaissait et les
> écrans étaient reconstruits de mémoire — d'où deux livraisons « terminées » qui ne
> correspondaient pas. Le fichier est maintenant versionné : ne travaillez plus
> jamais sur cette section sans l'avoir relu.

## Ce qui est superseded

`entrepot-spec.md` transcrit les **cinq maquettes sombres** du 19 août. Elles sont
**abandonnées** — la console est claire. Le document est conservé pour l'historique
des décisions (anatomie des KPI, règles de sévérité) mais **ses couleurs et son fond
sombre ne s'appliquent plus**. En cas de contradiction, `entrepot-light.html` gagne.

## Les jetons

Le prototype définit sa palette dans `:root`. Elle est reprise dans
`src/app/globals.css` sous des jetons **scopés `--wh-*`**, consommés sous
`.wh-console` — sur le modèle de `--fin-*` (Finances) et `--ads-*` (Dépenses pub).
Re-thématiser la section est donc un changement de valeurs, pas de composants.

| Prototype | OMS | Valeur |
|---|---|---|
| `--ground` | `--wh-bg` | `#F6F7F5` |
| `--card` | `--wh-surface` | `#FFFFFF` |
| `--sunken` | `--wh-sunken` | `#EFF1ED` |
| `--line` | `--wh-border` | `#E5E7E2` |
| `--ink-1/2/3` | `--wh-ink-1/2/3` | `#1B1D1A` · `#585C54` · `#8B8F85` |
| `--green` | `--wh-ok` | `#0E7A45` |
| `--violet` | `--wh-scan` | `#6553C4` |
| `--amber` | `--wh-warn` | `#92600A` |
| `--red` | `--wh-bad` | `#B23A2E` |
| `--teal` | `--wh-move` | `#0C7180` |

Deux paires (vert ↔ turquoise, rouge ↔ ambre) sont à ΔE ≈ 10 et ne peuvent pas être
écartées davantage : **chaque puce porte donc toujours son libellé**. La couleur
n'est jamais le seul canal.

Les chiffres sont en **IBM Plex Mono** (`--font-mono`), tabulaires, partout.

## Écarts assumés entre le prototype et le produit

Le prototype montre des données inventées ; le produit n'en invente aucune.

| Élément du prototype | Statut en production |
|---|---|
| Retours › « Répartition par raison » | **Retiré.** Aucune source : le motif d'échec de livraison n'est stocké nulle part. |
| Journal › filtres Réceptions, Transferts | **Retirés.** Ces flux n'existent pas dans le modèle de données. |
| Journal › filtre Remises | Dérivé de `order_history` (`status_to = 'dispatched'`). |
| Classement, « Scannées », « Aujourd'hui vs hier » | Réels, mais à **zéro** tant que l'entrepôt n'a pas scanné : `order_history` ne contient aucun événement `scanned`. Les états vides sont donc dessinés, pas masqués. |
| Numéro de sticker Darb | Enregistré chez nous (`orders.carrier_sticker_ref`). Aucun appel à l'API Darb au moment du scan. |
