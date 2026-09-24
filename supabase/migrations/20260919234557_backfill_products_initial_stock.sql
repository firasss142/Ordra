-- ============================================================
-- 20261003000008_backfill_products_initial_stock.sql
-- Rendre à `products.initial_stock` la valeur qu'il aurait dû porter.
--
-- `POST /api/products` écrivait la quantité d'ouverture dans `current_stock`
-- seulement et laissait `initial_stock` à son DEFAULT 0. Neuf produits vivants
-- sur treize portaient donc du stock réel avec une ouverture à zéro, et
-- `product_inventory_view.real_inventory` (`initial_stock − livré`) sortait
-- négatif pour chacun d'eux. Le chemin d'écriture est corrigé dans le même
-- lot ; cette migration soigne les lignes déjà en base, que le correctif de
-- code ne peut pas atteindre.
--
-- DEUX SOURCES, PAS UNE — et c'est le cœur de cette migration.
--
--   1. Le registre. Même en oubliant la COLONNE, la route écrivait bien une
--      ligne `inventory_log` (reason = 'initial_stock', change = +N). Ce
--      registre est append-only : personne n'a jamais pu le corriger ni
--      l'effacer. Pour SEPT produits, l'ouverture d'origine n'a donc jamais
--      été perdue — seulement rangée ailleurs. On la lit et on la restitue.
--
--      Exemple : « كتاب الداء والدواء » a ouvert à 200 et n'en a plus que 147.
--      Écrire 147 comme ouverture effacerait les 53 sortis. On écrit 200.
--
--      Exemple inverse : « Biovera » a ouvert à 1 000 et en compte 1 003
--      aujourd'hui — des retours rentrés, ou une correction manuelle. Une
--      ouverture PEUT être inférieure au stock courant ; c'est précisément
--      pourquoi les deux nombres ne sont pas interchangeables.
--
--   2. Rien. DEUX produits portent du stock sans aucune ligne 'initial_stock'
--      au registre — créés autrement qu'en passant par la route :
--        · دميه ملاكمه حجم كبير   → 600
--        · دميه ملاكمه حجم متوسط  → 200
--      Leur ouverture n'est écrite nulle part. On pose le comptage du jour
--      comme ouverture, et ON LE DIT ICI : ces deux valeurs sont une remise à
--      zéro datée du 2026-09-20, pas une mesure. Quiconque lira leur
--      `real_inventory` dans un an doit pouvoir distinguer les sept restitués
--      des deux reconstruits.
--
-- Ce qui n'est PAS touché : `current_stock` (donc aucun déclenchement de
-- `trg_products_total_covers_sites`), `inventory_log` (append-only : on ne
-- fabrique pas de faux mouvement, puisque rien ne bouge physiquement), et les
-- produits déjà corrects — la clause WHERE rend la migration ré-exécutable
-- sans effet.
-- ============================================================

UPDATE public.products p
   SET initial_stock = COALESCE(
         -- 1. L'ouverture réelle, telle que le registre l'a enregistrée.
         (SELECT SUM(il.change)::INTEGER
            FROM public.inventory_log il
           WHERE il.product_id = p.id
             AND il.reason = 'initial_stock'),
         -- 2. Faute de registre : le comptage du jour, assumé comme tel.
         p.current_stock
       ),
       updated_at = NOW()
 WHERE p.initial_stock = 0
   AND p.current_stock > 0;

COMMENT ON COLUMN public.products.initial_stock IS
  'Solde d''ouverture : la quantité avec laquelle le produit est entré dans le '
  'système. Ne bouge plus jamais ensuite — `current_stock` est le solde '
  'courant. Peut être INFÉRIEUR à current_stock (retours, corrections). '
  'Backfill du 2026-09-20 : restitué depuis inventory_log pour 7 produits, '
  'remis au comptage du jour pour 2 sans trace au registre.';
