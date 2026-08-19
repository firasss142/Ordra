# Entrepôt — référence visuelle

La refonte de l'Entrepôt suit **cinq maquettes validées** (19 août 2026). Ce dossier est la
source de vérité pour cette section ; il **remplace `docs/design-system.md` pour les routes
`/[locale]/warehouse/**` uniquement**. Partout ailleurs, la console claire reste la règle.

## Les fichiers

Déposez les cinq PNG dans `screenshots/` sous ces noms exacts — `entrepot-spec.md` y renvoie :

| Fichier attendu | Écran |
|---|---|
| `01-aujourdhui.png` | Aujourd'hui — bandeau KPI, actions prioritaires, activité, classement |
| `02-preparation.png` | Préparation — file + station de scan |
| `03-retours-a.png` | Retours — variante « Décision retour » (étapes scan → décision → journal) |
| `04-retours-b.png` | Retours — variante retenue (compteurs à zéros, sparkline, aperçu des décisions) |
| `05-journal.png` | Journal — registre filtrable |

> **Les images ne sont pas dans le dépôt.** Elles ont été fournies en pièce jointe de
> conversation ; aucun outil ne permet de les écrire sur disque depuis là. `entrepot-spec.md`
> transcrit chaque écran composant par composant, avec ses valeurs, pour que le travail soit
> possible sans elles — mais déposez les PNG ici dès que possible : une capture reste plus
> rapide à consulter qu'une transcription.

## Ce qui change par rapport au reste de la console

- **Fond sombre.** L'Entrepôt est un poste de travail physique, souvent sur écran mural ou
  tablette en atelier ; le reste de l'OMS est une console claire de bureau. Les tokens sont
  donc **scopés** (`--wh-*`), sur le modèle de `--fin-*` (Finances) et `--ads-*` (Dépenses pub)
  qui font déjà exactement cela dans `src/app/globals.css`.
- **La page Stock ne change pas.** Elle est seulement **déplacée** du groupe Finances vers le
  groupe Entrepôt dans la barre latérale. Aucune retouche visuelle.
