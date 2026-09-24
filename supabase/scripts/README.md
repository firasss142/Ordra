# supabase/scripts

Des scripts SQL à lancer **à la main**, jamais rejoués par `supabase db reset`.

`perf_seed_data.sql` vivait dans `supabase/migrations/` alors que son propre
en-tête disait « Run this in Supabase SQL Editor (not as a tracked migration) ».
Il n'a jamais été appliqué en production — il n'apparaît pas dans
`schema_migrations` — mais il cassait toute reconstruction locale, parce que
`supabase start` applique sans distinction tout ce que contient le dossier des
migrations. Déplacé ici le 2026-09-20.

Un fichier n'a sa place dans `supabase/migrations/` que s'il doit être rejoué,
dans l'ordre, sur une base vide pour reproduire le schéma de production.
