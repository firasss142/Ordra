-- Le canal d'une campagne, et l'exécution qui partage l'audience (2026-09-15).
--
-- Première partie : comment on contacte les gens. Jusqu'ici une campagne
-- signifiait toujours « un agent appellera ». Le manager peut désormais
-- envoyer un message WhatsApp d'abord, et ne faire appeler que ceux qui n'ont
-- pas répondu.
--
-- wa_sender = 'agent' est le défaut parce que c'est ce qu'Ordra sait faire
-- aujourd'hui : le prospect arrive dans la file de l'agent avec un lien wa.me
-- prérempli, un geste et le message part de son propre numéro. Le mode 'api'
-- existe dans le modèle mais aucune intégration WhatsApp Business n'est
-- branchée ; l'écran le dit.
--
-- Seconde partie : rpc_run_prospect_campaign relit la même définition
-- d'audience que preview_campaign_audience. Les deux lisaient cinq clés de
-- filter_json et la maquette en propose quatorze — si l'exécution ignorait les
-- neuf autres, le manager verrait un compte et obtiendrait un autre lot.

alter table prospect_campaigns
  add column if not exists channel text not null default 'call'
    check (channel in ('call', 'wa', 'wa_call')),
  -- Le message envoyé au client. Écrit dans SA langue, pas dans celle de
  -- l'interface : un agent francophone doit pouvoir écrire en arabe à un
  -- client libyen. Voir src/lib/delivery/whatsapp-templates.ts.
  add column if not exists wa_message text,
  add column if not exists wa_image boolean not null default false,
  add column if not exists wa_sender text not null default 'agent'
    check (wa_sender in ('agent', 'api')),
  -- Créneau d'envoi, « 10-20 » pour dix heures à vingt heures.
  add column if not exists wa_window text,
  -- Messages par heure et par agent. Au-delà, WhatsApp bloque le numéro.
  add column if not exists wa_rate int check (wa_rate is null or wa_rate > 0),
  -- Pour wa_call : au bout de combien d'heures sans réponse l'agent appelle.
  add column if not exists wa_follow_up_hours int
    check (wa_follow_up_hours is null or wa_follow_up_hours > 0);

comment on column prospect_campaigns.channel is
  'call | wa | wa_call — comment les prospects de cette campagne sont contactés.';
comment on column prospect_campaigns.wa_sender is
  'agent = lien wa.me depuis la file de l''agent (le seul branché). api = WhatsApp Business, non connecté.';

-- Un message est exigé dès qu''il y a un canal WhatsApp : une campagne wa sans
-- texte ne produirait rien qu'un agent puisse envoyer.
alter table prospect_campaigns
  drop constraint if exists chk_prospect_campaigns_wa_message;
alter table prospect_campaigns
  add constraint chk_prospect_campaigns_wa_message
  check (channel = 'call' or (wa_message is not null and btrim(wa_message) <> ''));

-- ---------------------------------------------------------------------------
-- L'exécution, sur la même audience que l'aperçu.
--
-- Ce que la version de 2026-06-15 faisait et qui est conservé :
--   • les leads naissent avec source = 'campaign' et le status_key initial du
--     marché, lu dans status_configs ;
--   • ON CONFLICT (campaign_id, source_order_id) rend l'appel idempotent —
--     relancer une campagne ne double personne ;
--   • raw_payload garde la trace de la commande d'origine.
-- Ce qui change : l'audience vient de preview_campaign_audience, donc les
-- quatorze conditions comptent, garde-fous compris.

create or replace function public.rpc_run_prospect_campaign(
  p_campaign_id uuid,
  p_actor_id uuid,
  p_actor_type text default 'manager'
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign     prospect_campaigns%ROWTYPE;
  v_initial_key  text;
  v_inserted     int := 0;
  v_matched      int := 0;
begin
  if p_actor_type not in ('system', 'agent', 'manager', 'super_admin') then
    raise exception 'invalid actor_type: %', p_actor_type;
  end if;

  select * into v_campaign from prospect_campaigns where id = p_campaign_id;
  if v_campaign.id is null then
    raise exception 'Campaign not found: %', p_campaign_id;
  end if;

  select key into v_initial_key
  from status_configs
  where market_id = v_campaign.market_id
    and scope = 'prospect'
    and is_initial = true;
  if v_initial_key is null then
    raise exception 'No initial prospect status configured for market %', v_campaign.market_id;
  end if;

  -- La même audience que celle affichée, recalculée au moment de l'exécution :
  -- entre l'aperçu et la validation, un client a pu commander ou un agent a pu
  -- ouvrir une fiche, et il ne doit pas être appelé pour autant.
  with audience as (
    select * from public.campaign_audience_rows(v_campaign.market_id, v_campaign.filter_json)
    where excluded_by is null
  ),
  inserted as (
    insert into leads (
      market_id, source, status_key, customer_name, customer_phone,
      customer_city, customer_address, campaign_id, source_order_id, raw_payload
    )
    select
      v_campaign.market_id, 'campaign'::lead_source, v_initial_key,
      coalesce(a.customer_name, 'Client'), a.customer_phone,
      a.customer_city, a.customer_address,
      p_campaign_id, a.source_order_id,
      jsonb_build_object(
        'campaign_id',     p_campaign_id,
        'campaign_name',   v_campaign.name,
        'source_order_id', a.source_order_id,
        'channel',         v_campaign.channel,
        'spawned_at',      now()
      )
    from audience a
    on conflict (campaign_id, source_order_id)
      where campaign_id is not null and source_order_id is not null
    do nothing
    returning id
  )
  select (select count(*) from audience), (select count(*) from inserted)
    into v_matched, v_inserted;

  return json_build_object(
    'campaign_id', p_campaign_id,
    'inserted',    v_inserted,
    'skipped',     v_matched - v_inserted
  );
end;
$$;

grant execute on function public.rpc_run_prospect_campaign(uuid, uuid, text) to authenticated;
