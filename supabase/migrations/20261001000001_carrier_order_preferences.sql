-- Politique admin sur les six options de commande Darb.
--
-- WHY. Les options (ramassage, ouverture du colis, fragile, paiement par carte,
-- essai, remplacement) sont aujourd'hui un choix par commande, avec des défauts
-- codés en dur dans DarbAssabilDispatchModal.tsx:242. Rien ne permet à un
-- super_admin de dire « chez nous l'essai ne s'offre jamais » ou « l'ouverture
-- du colis est la norme ». Cette table porte cette politique.
--
-- DEUX CONTRÔLES, PAS UN. `default_value` est la valeur d'ouverture de la case ;
-- `can_override` dit si l'agent peut encore y toucher. Une option verrouillée
-- disparaît du modal et part à `default_value` — qui peut être `true`. Le piège
-- à ne jamais confondre : « masquée » ≠ « envoyée à false ».
--
-- PAR TRANSPORTEUR, PAS PAR MARCHÉ. Darb Tripoli et Darb Benghazi sont deux
-- lignes `carriers` distinctes (même code `darb_assabil`) et rien ne garantit
-- qu'elles partageront une politique.
--
-- L'ABSENCE DE LIGNE EST LE DÉFAUT ACTUEL. Aucune donnée n'est semée : tant
-- qu'un admin n'a rien configuré, lib/carriers/order-preferences.ts retombe sur
-- les défauts codés et le comportement d'aujourd'hui est strictement préservé.

create table if not exists public.carrier_order_preferences (
  id            uuid primary key default gen_random_uuid(),
  carrier_id    uuid not null references public.carriers(id) on delete cascade,
  option_key    text not null,
  default_value boolean not null default false,
  can_override  boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint carrier_order_preferences_option_key_check check (
    option_key in (
      'is_pickup',
      'allow_inspection',
      'is_fragile',
      'allow_card_payment',
      'allow_testing',
      'is_replacement'
    )
  ),
  constraint carrier_order_preferences_unique unique (carrier_id, option_key)
);

comment on table public.carrier_order_preferences is
  'Politique super_admin sur les options de commande Darb, par transporteur. Ligne absente = défaut codé.';
comment on column public.carrier_order_preferences.default_value is
  'Valeur d''ouverture de la case dans le modal de dispatch.';
comment on column public.carrier_order_preferences.can_override is
  'false = la case disparaît du modal et default_value est forcé (y compris true).';

create index if not exists carrier_order_preferences_carrier_idx
  on public.carrier_order_preferences (carrier_id);

alter table public.carrier_order_preferences enable row level security;

-- Lecture : tout utilisateur authentifié du marché du transporteur. Le modal de
-- dispatch en a besoin pour un agent, donc la lecture ne peut pas être réservée
-- au super_admin. Les helpers sont enveloppés en (SELECT f()) — sans quoi ils se
-- réévaluent par ligne (cf. 20260928000006 et docs/mastery-guide.md).
drop policy if exists carrier_order_preferences_select on public.carrier_order_preferences;
create policy carrier_order_preferences_select on public.carrier_order_preferences
  for select to authenticated
  using (
    (select public.get_user_role()) = 'super_admin'
    or exists (
      select 1 from public.carriers c
      where c.id = carrier_order_preferences.carrier_id
        and c.market_id = (select public.get_user_market_id())
    )
  );

-- Écriture : super_admin uniquement. Décision du 2026-09-16 — un market_manager
-- ne gagne aucun accès ici.
drop policy if exists carrier_order_preferences_insert on public.carrier_order_preferences;
create policy carrier_order_preferences_insert on public.carrier_order_preferences
  for insert to authenticated
  with check ((select public.get_user_role()) = 'super_admin');

drop policy if exists carrier_order_preferences_update on public.carrier_order_preferences;
create policy carrier_order_preferences_update on public.carrier_order_preferences
  for update to authenticated
  using ((select public.get_user_role()) = 'super_admin')
  with check ((select public.get_user_role()) = 'super_admin');

drop policy if exists carrier_order_preferences_delete on public.carrier_order_preferences;
create policy carrier_order_preferences_delete on public.carrier_order_preferences
  for delete to authenticated
  using ((select public.get_user_role()) = 'super_admin');

drop trigger if exists carrier_order_preferences_touch on public.carrier_order_preferences;
create trigger carrier_order_preferences_touch
  before update on public.carrier_order_preferences
  for each row execute function public.update_updated_at();
