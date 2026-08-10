-- Rejection reasons, part 2 of 3: move the 1798 existing rejections onto the
-- two-level model. Separate migration because part 1's new enum values cannot
-- be used in the transaction that created them.
--
-- Every legacy value maps to (group, sub-reason) without losing information:
--
--   prix         -> refus_client      / prix_eleve
--   faux_numero  -> injoignable       / numero_invalide
--   doublon      -> commande_invalide / doublon
--   non_serieux  -> commande_invalide / non_serieux
--   injoignable  -> injoignable       / pas_de_reponse
--   refus_client -> refus_client      / (null — the old value said only "no")
--   autre        -> unchanged; rejection_note keeps whatever detail exists
--
-- `refus_client` deliberately gets no sub-reason. 339 rows carry it with zero
-- notes, so any sub-reason we picked would be invented data. Null means "we
-- never asked", which is true and which the UI renders as the group label.

update orders
set rejection_reason = 'refus_client', rejection_subreason = 'prix_eleve'
where status = 'rejected' and rejection_reason = 'prix';

update orders
set rejection_reason = 'injoignable', rejection_subreason = 'numero_invalide'
where status = 'rejected' and rejection_reason = 'faux_numero';

update orders
set rejection_reason = 'commande_invalide', rejection_subreason = 'doublon'
where status = 'rejected' and rejection_reason = 'doublon';

update orders
set rejection_reason = 'commande_invalide', rejection_subreason = 'non_serieux'
where status = 'rejected' and rejection_reason = 'non_serieux';

update orders
set rejection_subreason = 'pas_de_reponse'
where status = 'rejected'
  and rejection_reason = 'injoignable'
  and rejection_subreason is null;
