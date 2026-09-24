# Tests SQL

Ce que Vitest ne peut pas atteindre : les RPC `SECURITY DEFINER`, les
déclencheurs de contrainte différés, et les privilèges d'exécution. Un mock de
`supabase.rpc()` prouve qu'on a appelé la bonne fonction avec les bons
arguments ; il ne prouve rien de ce que cette fonction fait au stock.

```bash
supabase/tests/run.sh                          # tous les fichiers *_test.sql
supabase/tests/run.sh stock_variant_axis_test.sql
```

## Prérequis

La pile locale doit tourner. Le conteneur `storage` échoue sur le CLI 2.48.3
(« Migration optimize-existing-functions-again not found »), sans rapport avec
notre schéma, d'où la liste d'exclusion :

```bash
supabase start -x storage-api,imgproxy,studio,logflare,vector,supavisor,edge-runtime,realtime,mailpit
```

`supabase db reset --no-seed` rejoue les 294 migrations depuis zéro : c'est la
seule façon de vérifier qu'une migration s'applique vraiment dans la chaîne, et
pas seulement collée à la main sur une base déjà à jour.

## Trois règles apprises à la dure

**1. Jamais contre la production.** Ces tests écrivent pour de vrai et ne
nettoient pas : `inventory_log` et `order_history` sont en écriture seule par
déclencheur, donc un test propre y est impossible. La base locale est jetable.

**2. Jamais de ROLLBACK autour d'un invariant.** Les contraintes de stock sont
des `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` : elles ne
s'évaluent qu'au COMMIT. Un test encadré d'un ROLLBACK ne les déclenche
**jamais** — c'est exactement ainsi que `assert_site_stock_within_total` a été
« vérifié en production » le 2026-09-09 alors qu'il faisait échouer toute
écriture de `products` (voir `20260909195032_fix_site_stock_guard_relid.sql`).

Pour tester un refus différé, deux formes, et elles ne sont pas
interchangeables :

- `SET CONSTRAINTS <nom> IMMEDIATE` — **en nommant la contrainte**, pour
  l'attraper dans un `EXCEPTION WHEN`. `ALL IMMEDIATE` ferait contrôler des
  états intermédiaires qu'une opération en plusieurs écritures traverse
  forcément, et que le différé existe précisément pour ignorer.
- une transaction explicite dont on laisse le `COMMIT` échouer, puis
  l'assertion « rien n'a bougé ». Utile quand c'est l'effet qui compte.

Nommer la contrainte n'est pas du zèle : la première version du test 12 passait
au vert alors que c'était l'invariant des *sites* qui se déclenchait, pas celui
des variantes.

**3. Rien en dur qui puisse être régénéré.** Seuls les marchés ont des
identifiants stables (`…0001` Tunisie, `…0002` Libye). `supabase db reset`
régénère ceux des entrepôts, des boutiques et des transporteurs : un UUID figé
transforme toute ré-exécution en « ce site n'appartient pas au marché du
produit ». La fixture les résout, et échoue bruyamment si elle n'y arrive pas.

Chaque fichier se donne une fixture neuve (identifiants aléatoires, produit
préfixé `SQLTEST`) et ne mesure que des écarts relatifs, ce qui le rend
re-jouable sans remise à zéro.

## Écrire un test

`_helpers.sql` fournit `pg_temp.ok(cond, texte)`, `pg_temp.eq(obtenu, attendu,
texte)` et `pg_temp.err(sql)` qui rend le SQLSTATE ou `'NO_ERROR'`. Une
assertion ratée lève une exception ; `ON_ERROR_STOP` fait sortir psql en erreur
et `run.sh` propage le code.

Pas de pgTAP : l'extension est disponible mais l'installer ferait entrer une
extension de test dans le schéma d'une base de production.
