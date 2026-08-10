-- Rejection reasons, part 1 of 3: widen the vocabulary.
--
-- Measured on the live database before this change:
--
--   autre         651   <- 36% of ALL rejections, the single most-used reason
--   refus_client  339
--   injoignable   260
--   non_serieux   233
--   faux_numero   118
--   (null)         93
--   prix           69
--   doublon        35
--
-- and **68% of the `autre` rows carry no note at all** — 440 orders whose
-- rejection reason is now permanently unknowable. A taxonomy whose escape hatch
-- is the most popular answer is not measuring anything.
--
-- The replacement is two-level: five groups an agent picks in one keystroke,
-- then a specific sub-reason. Every sub-reason below was read out of the 211
-- free-text notes agents actually wrote under `autre` — "اشترى من مكان آخر",
-- "الرقم لشخص آخر", "قال اني مش طالب", "يغلق الخط", "خارج التغطية" — rather
-- than invented.
--
-- The four legacy values (faux_numero, prix, doublon, non_serieux) stay in the
-- enum: history must keep rendering, and Postgres cannot drop an enum value
-- without recreating the type. They are removed from the picker in part 2.

-- Two new groups. `ADD VALUE` is transactional in PG12+, but the value cannot be
-- *used* in the same transaction — hence the backfill lives in part 2.
alter type rejection_reason add value if not exists 'commande_invalide';
alter type rejection_reason add value if not exists 'livraison_impossible';

alter table orders
  add column if not exists rejection_subreason text;

-- A check constraint rather than a second enum: sub-reasons will keep moving as
-- agents find new ways for an order to die, and widening a check is one line
-- where widening an enum is a migration plus a deploy ordering problem.
alter table orders
  drop constraint if exists orders_rejection_subreason_check;

alter table orders
  add constraint orders_rejection_subreason_check
  check (
    rejection_subreason is null
    or rejection_subreason in (
      -- refus_client — the customer said no, and why
      'prix_eleve', 'frais_livraison', 'achete_ailleurs', 'changement_avis', 'produit_non_voulu',
      -- commande_invalide — the order was never real
      'non_commande', 'doublon', 'simple_info', 'non_serieux',
      -- injoignable — could not reach a person
      'pas_de_reponse', 'numero_invalide', 'numero_hors_service', 'mauvais_interlocuteur', 'raccroche',
      -- livraison_impossible — reachable, willing, undeliverable
      'hors_couverture', 'paiement_impossible', 'adresse_invalide', 'absent_ville'
    )
  );

comment on column orders.rejection_subreason is
  'Specific reason within rejection_reason (the group). Null on legacy rows and on group=autre, where rejection_note carries the detail.';

create index if not exists orders_rejection_subreason_idx
  on orders (rejection_subreason)
  where rejection_subreason is not null;
