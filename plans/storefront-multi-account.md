# Boutiques : plusieurs comptes par plateforme (2026-10-04)

## Décisions du propriétaire
- Un compte Converty = **une boutique** (`storefronts` row, platform `google_sheets`)
  avec SA feuille + SON onglet. Pas de « une boutique, plusieurs feuilles ».
- Correspondances produit : **par compte** (pas de partage entre comptes frères).
- Ville Converty : **inchangée** (la colonne City est vide à 100 % ; l'agent choisit).
- L'ajout d'une feuille se fait dans le tiroir « Ajouter une boutique » existant, sans prototype.

## Ce que l'enquête a trouvé
1. Aucune voie UI pour créer une source Sheets. La seule source live a été câblée à la
   main dans `settings.google_sheets_sources`, et la ligne `storefronts.config` dit un autre
   onglet (`Orders` vs `converty-orders-bachir`). Deux vérités.
2. Archiver une boutique Sheets n'arrêtait PAS l'import (le moteur ne lisait que `settings`).
3. Une source `settings` sans boutique réelle échouait sur chaque ligne (FK orders.storefront_id).
4. Deux sources sur un même storefront_id partageaient un curseur.
5. Webhook : une livraison en `error` bloquait toutes ses relivraisons (dédoublonnage sans
   filtre de statut) → commande perdue ; `maybeSingle` sur plusieurs lignes désactivait le
   dédoublonnage.
6. `order.updated` écrasait la ville canonique Darb par la chaîne brute de la boutique.
7. `POST /api/storefronts` acceptait n'importe quelle plateforme.
8. Plusieurs feuilles : la première passait toujours en premier → les suivantes affamées.

## Le modèle livré
- Source de vérité d'une feuille : `storefronts.config = { spreadsheet_id, sheet_name, sheet_adapter }`.
- `settings.google_sheets_sources` reste lu comme SURCHARGE héritée pour une boutique
  existante (la prod continue sans SQL), jamais comme créateur de source.
- Création : l'API vérifie l'accès (compte de service), les en-têtes Converty, et pose le
  curseur (« nouvelles commandes seulement » par défaut, ou « tout l'historique »).
- Ordre des sources tourné à chaque passage de cron.

## Hors périmètre / ouvert
- Curseurs dans un seul JSON `settings` : écriture lecture-modification non atomique entre
  deux invocations concurrentes (cron + manuel). Le dédoublonnage (storefront_id, external_id)
  empêche les doublons ; le coût est du travail refait. Une RPC jsonb_set réglerait ça.
- `order.cancelled` passe la commande en `deleted`, pas `cancelled`. Décision, pas corrigée.
