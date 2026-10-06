-- ============================================================
-- 20261006100100_lead_source_recovery_values.sql
--
-- Deux nouvelles sources de prospects, créées par prospects_daily_tick :
--   rejected_order — un refus « rattrapable », N jours après le rejet ;
--   repeat_buyer   — un ancien client, N jours après sa livraison.
-- Seules dans leur fichier : une valeur d'enum ajoutée ne peut pas être
-- UTILISÉE dans la transaction qui l'ajoute.
-- ============================================================

ALTER TYPE public.lead_source ADD VALUE IF NOT EXISTS 'rejected_order';
ALTER TYPE public.lead_source ADD VALUE IF NOT EXISTS 'repeat_buyer';
