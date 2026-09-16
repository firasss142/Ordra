-- Les deux modes d'expédition rejoignent `carrier_order_preferences`.
--
-- WHY. Une option de commande décrit ce qui arrive AU COLIS (fragile, ouvrable,
-- payable par carte). Un mode dit D'OÙ IL PART :
--   mode_home_warehouse    = « Notre entrepôt » — nous détenons le stock, Darb
--                            vient le chercher. Le mode qui marche toujours.
--   mode_carrier_warehouse = « Entrepôt Darb Assabil » — ils détiennent le
--                            stock et le prélèvent eux-mêmes.
--
-- Même table, parce que c'est la même chose : une politique par transporteur,
-- écrite par un super_admin, lue par le modal de dispatch. Les policies RLS
-- posées par 20261001000001 couvrent donc déjà ces lignes.
--
-- `default_value` porte ici « ce mode est proposé ». `can_override` n'est pas lu
-- pour ces deux clés : un mode est offert ou ne l'est pas, l'agent ne le
-- rallume pas.
--
-- LES DEUX ÉTEINTS sont refusés côté applicatif (route PUT + UI) plutôt que par
-- une contrainte : la règle porte sur DEUX lignes, ce qu'un CHECK de ligne ne
-- peut pas exprimer. Un trigger le pourrait, mais il refuserait alors l'ordre
-- d'écriture intermédiaire d'un upsert parfaitement légitime.

alter table public.carrier_order_preferences
  drop constraint if exists carrier_order_preferences_option_key_check;

alter table public.carrier_order_preferences
  add constraint carrier_order_preferences_option_key_check check (
    option_key in (
      'is_pickup','allow_inspection','is_fragile',
      'allow_card_payment','allow_testing','is_replacement',
      'mode_home_warehouse','mode_carrier_warehouse'
    )
  );
