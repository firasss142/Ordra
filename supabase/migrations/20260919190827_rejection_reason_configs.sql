-- Motifs de rejet configurables — la taxonomie sort du code et entre en base.
--
-- Avant ce changement, ajouter un motif de rejet demandait une migration plus un
-- déploiement : les 5 groupes vivaient dans un enum Postgres, les 18 sous-motifs
-- dans `orders_rejection_subreason_check`, et les libellés dans messages/*.json.
-- Aucun manager ne pouvait décrire une nouvelle façon de perdre une commande.
--
-- Ce que cette migration change, et ce qu'elle ne change PAS :
--
--   * les SOUS-MOTIFS deviennent pleinement éditables (ajout, retrait, renommage,
--     réordonnancement) — d'où la suppression du CHECK, qui ne peut pas décrire
--     une liste dynamique ;
--   * les GROUPES restent fixes. Leur clé est une valeur de l'enum
--     `rejection_reason` et 2 725 commandes rejetées en portent une ; Postgres ne
--     sait pas retirer une valeur d'enum. Seuls leur libellé, leur couleur et
--     leur ordre s'éditent.
--
-- Pas de clé étrangère depuis `orders` : elle ajouterait une vérification sur le
-- chemin d'admission des webhooks (table chaude) et remonterait une violation FK
-- brute là où l'API sait déjà compter les usages avant de supprimer.

create table if not exists rejection_reason_configs (
  id            uuid primary key default gen_random_uuid(),
  market_id     uuid not null references markets(id) on delete cascade,

  -- null = ligne de groupe ; sinon la clé du groupe qui possède ce sous-motif.
  -- L'arbre entier tient dans une table, ce qui rend le tri et le RLS uniformes.
  parent_key    text,
  key           text not null,

  -- Long pour le sélecteur de l'agent, court pour la pastille. Les deux sont
  -- stockés : « Le numéro est à quelqu'un d'autre » ne rentre pas dans une
  -- colonne de 120px, et « Mauvais n° » ne suffit pas dans un sélecteur.
  label_fr      text not null,
  label_ar      text not null,
  short_fr      text not null,
  short_ar      text not null,

  -- Une des six teintes nommées du design system, pas un hex libre : les
  -- pastilles tirent leurs tons de --hue-*, déjà accordés clair/sombre et RTL.
  -- N'a de sens que sur une ligne de groupe ; un sous-motif hérite de son parent.
  hue           text not null default 'red',

  sort_order    integer not null default 0,

  -- Le retrait doux. Un motif utilisé par des commandes passées n'est jamais
  -- supprimé : il disparaît du sélecteur et continue de s'afficher sur
  -- l'historique. Sans cela, 1 281 commandes deviendraient illisibles.
  is_active     boolean not null default true,

  -- Vrai pour « autre » seulement : c'est la seule chose qui empêche la
  -- taxonomie de retomber dans l'état où le motif le plus vague était le plus
  -- rapide à cliquer (36% des rejets, dont 68% sans note).
  requires_note boolean not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint rejection_reason_configs_key_format check (key ~ '^[a-z][a-z0-9_]*$'),
  constraint rejection_reason_configs_hue_check
    check (hue in ('neutral', 'amber', 'violet', 'teal', 'green', 'red')),
  constraint rejection_reason_configs_market_key_unique unique (market_id, key)
);

comment on table rejection_reason_configs is
  'Taxonomie des motifs de rejet, par marché. parent_key null = groupe (fixe, lié à l''enum rejection_reason) ; sinon sous-motif (CRUD complet).';

create index if not exists rejection_reason_configs_market_idx
  on rejection_reason_configs (market_id, parent_key, sort_order);

-- ── Semis : la taxonomie actuelle, pour chaque marché ────────────────────────
-- Libellés repris tels quels de messages/fr.json et messages/ar.json, pour que
-- rien ne bouge à l'écran le jour du déploiement.
insert into rejection_reason_configs
  (market_id, parent_key, key, label_fr, label_ar, short_fr, short_ar, hue, sort_order, requires_note)
select m.id, v.parent_key, v.key, v.label_fr, v.label_ar, v.short_fr, v.short_ar, v.hue, v.sort_order, v.requires_note
from markets m
cross join (values
  (NULL, 'refus_client', 'Refus client', 'رفض العميل', 'Refus', 'رفض', 'red', 0, false),
  ('refus_client', 'prix_eleve', 'Prix trop élevé', 'السعر مرتفع', 'Prix', 'السعر', 'red', 0, false),
  ('refus_client', 'frais_livraison', 'Frais de livraison refusés', 'رفض رسوم التوصيل', 'Livraison', 'رسوم التوصيل', 'red', 1, false),
  ('refus_client', 'achete_ailleurs', 'Acheté ailleurs', 'اشترى من مكان آخر', 'Ailleurs', 'مكان آخر', 'red', 2, false),
  ('refus_client', 'changement_avis', 'A changé d''avis', 'غيّر رأيه', 'Changé d''avis', 'غيّر رأيه', 'red', 3, false),
  ('refus_client', 'produit_non_voulu', 'Veut un autre produit', 'يريد منتجاً آخر', 'Autre produit', 'منتج آخر', 'red', 4, false),
  (NULL, 'commande_invalide', 'Commande non réelle', 'الطلب غير حقيقي', 'Non réelle', 'غير حقيقي', 'neutral', 1, false),
  ('commande_invalide', 'non_commande', 'N''a pas commandé', 'لم يطلب المنتج', 'Pas commandé', 'لم يطلب', 'neutral', 0, false),
  ('commande_invalide', 'doublon', 'Commande en double', 'طلب مكرر', 'Doublon', 'مكرر', 'neutral', 1, false),
  ('commande_invalide', 'simple_info', 'Simple demande d''info', 'استفسار فقط', 'Info', 'استفسار', 'neutral', 2, false),
  ('commande_invalide', 'non_serieux', 'Commande non sérieuse', 'طلب غير جاد', 'Non sérieux', 'غير جاد', 'neutral', 3, false),
  (NULL, 'injoignable', 'Injoignable', 'تعذر الاتصال', 'Injoignable', 'تعذر الاتصال', 'amber', 2, false),
  ('injoignable', 'pas_de_reponse', 'Ne répond pas', 'لا يرد', 'Sans réponse', 'لا يرد', 'amber', 0, false),
  ('injoignable', 'numero_invalide', 'Numéro faux ou inexistant', 'رقم خاطئ أو غير موجود', 'Faux n°', 'رقم خاطئ', 'amber', 1, false),
  ('injoignable', 'numero_hors_service', 'Éteint ou hors service', 'مغلق أو خارج الخدمة', 'Hors service', 'خارج الخدمة', 'amber', 2, false),
  ('injoignable', 'mauvais_interlocuteur', 'Le numéro est à quelqu''un d''autre', 'الرقم لشخص آخر', 'Mauvais n°', 'شخص آخر', 'amber', 3, false),
  ('injoignable', 'raccroche', 'Raccroche au téléphone', 'يغلق الخط', 'Raccroche', 'يغلق الخط', 'amber', 4, false),
  (NULL, 'livraison_impossible', 'Livraison impossible', 'تعذر التوصيل', 'Non livrable', 'تعذر التوصيل', 'violet', 3, false),
  ('livraison_impossible', 'hors_couverture', 'Hors zone de livraison', 'خارج نطاق التغطية', 'Hors zone', 'خارج التغطية', 'violet', 0, false),
  ('livraison_impossible', 'paiement_impossible', 'Moyen de paiement indisponible', 'وسيلة الدفع غير متاحة', 'Paiement', 'الدفع', 'violet', 1, false),
  ('livraison_impossible', 'adresse_invalide', 'Adresse invalide', 'عنوان غير صحيح', 'Adresse', 'العنوان', 'violet', 2, false),
  ('livraison_impossible', 'absent_ville', 'Absent de la ville', 'خارج المدينة', 'Absent', 'خارج المدينة', 'violet', 3, false),
  (NULL, 'autre', 'Autre', 'أخرى', 'Autre', 'أخرى', 'neutral', 4, true)
) as v(parent_key, key, label_fr, label_ar, short_fr, short_ar, hue, sort_order, requires_note)
on conflict (market_id, key) do nothing;

-- ── La contrainte statique s'en va ───────────────────────────────────────────
-- Elle énumérait les 18 sous-motifs. Une liste que les managers éditent ne peut
-- pas être décrite par un CHECK ; la validation vit désormais dans
-- /api/orders/[id]/reject, qui lit la config du marché.
alter table orders
  drop constraint if exists orders_rejection_subreason_check;

comment on column orders.rejection_subreason is
  'Sous-motif de rejet. Valide contre rejection_reason_configs du marché (plus de CHECK statique — la liste est éditable depuis Système › Paramètres).';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Lecture pour tout le marché : l'agent en a besoin pour son sélecteur.
-- Écriture pour super_admin et le market_manager de son marché.
--
-- Les helpers sont enveloppés dans un SELECT — `(select get_user_role())` — sans
-- quoi Postgres les réévalue à chaque ligne au lieu d'une fois par requête
-- (piège InitPlan déjà payé sur d'autres tables).
alter table rejection_reason_configs enable row level security;

drop policy if exists rejection_reason_configs_select on rejection_reason_configs;
create policy rejection_reason_configs_select
  on rejection_reason_configs for select to authenticated
  using (
    (select get_user_role()) = 'super_admin'
    or market_id = (select get_user_market_id())
  );

drop policy if exists rejection_reason_configs_insert on rejection_reason_configs;
create policy rejection_reason_configs_insert
  on rejection_reason_configs for insert to authenticated
  with check (
    (select get_user_role()) = 'super_admin'
    or ((select get_user_role()) = 'market_manager' and market_id = (select get_user_market_id()))
  );

drop policy if exists rejection_reason_configs_update on rejection_reason_configs;
create policy rejection_reason_configs_update
  on rejection_reason_configs for update to authenticated
  using (
    (select get_user_role()) = 'super_admin'
    or ((select get_user_role()) = 'market_manager' and market_id = (select get_user_market_id()))
  )
  with check (
    (select get_user_role()) = 'super_admin'
    or ((select get_user_role()) = 'market_manager' and market_id = (select get_user_market_id()))
  );

drop policy if exists rejection_reason_configs_delete on rejection_reason_configs;
create policy rejection_reason_configs_delete
  on rejection_reason_configs for delete to authenticated
  using (
    (select get_user_role()) = 'super_admin'
    or ((select get_user_role()) = 'market_manager' and market_id = (select get_user_market_id()))
  );
