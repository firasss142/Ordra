# Accès (/users) — refonte d'après la maquette v2

Demandé le 2026-10-03 : « suis le prototype, j'aime le design, implémente-le, merge sur main, déploie ».
La maquette `prototypes/acces-v2.html` est la spécification (structure de `acces-v1.html`, rendu de la v2).

## Phase 0 — maquettes (faites)
- `prototypes/acces-v1.html` : diagnostic de la page actuelle, structure, rationale.
- `prototypes/acces-v2.html` : palette par rôle, tuiles, fiche, création, dialogues. Approuvée.

## Ce qui ne change pas
Mêmes routes (`GET/POST /api/users`, `PATCH/DELETE /api/agents/[id]`, `/api/admin/audit-log`,
`/api/warehouse/sites`), mêmes données, mêmes règles de rôle (un manager ne voit et ne crée que
les agents et agents entrepôt de son marché ; seul le super admin supprime — jamais soi-même — et
lit le journal). Aucune migration.

## Phases
1. **Palette** — `--role-*` (teinte, fond, encre, bord) dans `globals.css`, classes `.tone-*`,
   couleur Tailwind `tone`. Test de contraste (encre/fond ≥ 4,5:1, teinte/fond ≥ 3:1) d'abord.
2. **Vue pure** — `src/lib/users/access-view.ts` : statut, identifiant, activité (en ligne →
   date), tri, filtres, tuiles, bandeau « sans entrepôt ». Testée d'abord.
3. **Composants** — `src/components/admin/access/` : tuiles, barre d'outils, table + ligne
   (pilule d'entrepôt, menu clavier), bandeau, fiche (faits, entrepôt en cartes, droits, journal en
   frise), création en trois étapes, dialogues désactiver / supprimer / mot de passe. Tests d'abord.
4. **i18n** — espace `users` réécrit en fr et ar, test de parité.
5. **Nettoyage** — supprimer `UserCard`, `UserRoleSection`, `UserAuditLog`, `PermissionsList`,
   `WarehouseAssignment`, `DeactivateUserFlow`, `DeleteUserFlow`, l'ancien `CreateUserPanel` ;
   retirer `?include_stats=true` et les deux champs de stats jamais renvoyés.
6. **Docs** — design-system §4.23 « Accès — une teinte par rôle ».
7. **Vérification** — tests, typecheck, captures de l'app locale à côté de la maquette.
8. **Livraison** — PR, aperçu Vercel ; le merge sur main est le clic du propriétaire.

## Décisions prises en expert
- La désactivation passe en une étape (la seconde n'affichait que « … commande(s) »).
- Ordre des rôles : agents, entrepôt, managers, investisseurs, super admins.
- Les photos de profil existantes restent affichées ; sinon les initiales à la teinte du rôle.
- Le toast reste le composant partagé `useToast` (le toast sombre de la maquette changerait
  toute la console).

## Trouvé en construisant
- Le journal disait « Système » pour chaque événement : il lisait `actor_name`, que la route
  ne renvoie pas (elle joint `actor:users!actor_id(full_name)`). La fiche lit la jointure.
- `warehouse_assigned` n'avait pas de libellé : « Entrepôt affecté » en fr et ar.

## Hors périmètre (signalé, pas fait)
- 8 caractères minimum pour le mot de passe (changement de comportement, non tranché).
- `POST /api/users` écrit `last_seen_at = now()` à la création.
- Comptes de test actifs en production.
