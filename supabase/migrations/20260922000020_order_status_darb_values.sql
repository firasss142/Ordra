-- Les statuts que Darb dit réellement.
--
-- Une commande libyenne restait « Scannée » de la remise jusqu'à la livraison :
-- booked, processing, on-branch, released, resent et delayed ne changeaient rien
-- chez nous, puis le statut sautait d'un coup à livré ou à retour. dispatched,
-- deposit et in_transit n'étaient jamais occupés par un colis Darb — c'est
-- précisément pourquoi /in-delivery ne voyait aucun colis libyen et qu'il a
-- fallu lui construire une salle de contrôle séparée.
--
-- Quatre valeurs, placées dans l'ordre du parcours réel pour que tout ORDER BY
-- status raconte le voyage du colis :
--   … uploaded, scanned, at_carrier, dispatched, deposit, in_transit,
--     out_for_delivery, delivery_delayed, unverified, returning, to_be_returned …
--
-- Une valeur d'enum ne peut pas être UTILISÉE dans la transaction qui l'ajoute :
-- ce fichier ne fait donc que les ajouter, et 20260922000021 s'en sert.

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'at_carrier' AFTER 'scanned';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'out_for_delivery' AFTER 'in_transit';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'delivery_delayed' AFTER 'out_for_delivery';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'returning' BEFORE 'to_be_returned';
