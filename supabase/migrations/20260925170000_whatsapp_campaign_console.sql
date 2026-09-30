-- ============================================================
-- 20260925170000_whatsapp_campaign_console.sql
-- WhatsApp campaigns — what the campaign sheet and card show (additive).
--
-- WHY: the sheet's template banner says « soumis il y a 12 min » and
-- « approuvé il y a 3 min »; the card says « Lancée hier 10:00 · 96 prospects ·
-- 60/h · 10–20 h » and « · 1 cap marketing »; « Modifier et resoumettre »
-- reopens the sheet prefilled. None of that was in the console payload, and
-- nothing recorded WHEN a campaign's launch status last moved: the template's
-- updated_at is touched by every sync, so it cannot say when Meta approved.
--
-- WHAT:
--   prospect_campaigns.wa_launch_status_at — stamped by trigger whenever
--     wa_launch_status changes (webhook, « Vérifier le statut », resubmit,
--     launch), and at insert. Existing rows are backfilled from launched_at,
--     else created_at.
--   get_prospect_console — the `whatsapp` object gains status_at,
--     launched_at, rate, window, follow_up_hours, message, image_url, filter
--     and skipped_marketing_cap. Still ONE round trip; still SECURITY INVOKER
--     (RLS on leads / whatsapp_outbox / whatsapp_messages is the isolation, the
--     function has no role or market check of its own).
-- ============================================================

ALTER TABLE public.prospect_campaigns
  ADD COLUMN IF NOT EXISTS wa_launch_status_at timestamptz;

UPDATE public.prospect_campaigns
   SET wa_launch_status_at = COALESCE(launched_at, created_at)
 WHERE wa_launch_status_at IS NULL;

ALTER TABLE public.prospect_campaigns
  ALTER COLUMN wa_launch_status_at SET DEFAULT now();

-- Plain trigger function (not DEFINER): it only stamps NEW.
CREATE OR REPLACE FUNCTION public.prospect_campaigns_stamp_launch_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.wa_launch_status IS DISTINCT FROM OLD.wa_launch_status THEN
    NEW.wa_launch_status_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prospect_campaigns_stamp_launch_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prospect_campaigns_launch_status_at ON public.prospect_campaigns;
CREATE TRIGGER trg_prospect_campaigns_launch_status_at
  BEFORE UPDATE OF wa_launch_status ON public.prospect_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.prospect_campaigns_stamp_launch_status();

-- ─────────────────────────────────────────────────────────────
-- get_prospect_console — 20260925150000's body plus nine keys in `whatsapp`
-- ─────────────────────────────────────────────────────────────
-- CREATE OR REPLACE with the same signature keeps the ACL; the REVOKE/GRANT
-- below restate it anyway so this file is correct on its own.
CREATE OR REPLACE FUNCTION public.get_prospect_console(p_market_id uuid, p_tz text DEFAULT 'Africa/Tripoli'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
with scope as (
  select l.* from leads l
  where l.market_id = p_market_id and l.status <> 'archived'
),
working as (
  select * from scope
  where status in ('new','assigned','attempt_1','attempt_2','attempt_3',
                   'callback_scheduled','qualified','won')
),
hot_window as (
  select coalesce(
    (select value::int from settings
      where market_id = p_market_id and key = 'lead_hot_window_minutes'
      limit 1), 60) as minutes
),
first_touch as (
  select l.id, l.created_at,
         (select min(h.created_at) from lead_history h
           where h.lead_id = l.id and h.status_to::text <> 'new') as touched_at
  from scope l
),
ttc as (
  select
    percentile_cont(0.5) within group (
      order by extract(epoch from (touched_at - created_at)) / 60
    ) filter (where touched_at is not null and created_at > now() - interval '30 days') as median_30,
    percentile_cont(0.5) within group (
      order by extract(epoch from (touched_at - created_at)) / 60
    ) filter (where touched_at is not null
                and created_at > now() - interval '60 days'
                and created_at <= now() - interval '30 days') as median_prev
  from first_touch
),
hot as (
  select s.* from scope s, hot_window w
  where s.source::text in ('whatsapp','facebook_comment','facebook_dm','instagram_dm','tiktok_comment')
    and s.callback_scheduled_at is null
    and s.status::text not like 'attempt_%'
    and s.status not in ('won','lost')
    and s.created_at > now() - make_interval(mins => w.minutes)
),
converted as (
  select s.id, s.converted_order_id, o.status as order_status, o.total_price
  from scope s join orders o on o.id = s.converted_order_id
  where s.converted_order_id is not null and s.updated_at > now() - interval '30 days'
),
agents as (
  select u.id, u.full_name from users u
  where u.market_id = p_market_id and u.role = 'agent' and u.is_active
),
today as (
  select h.actor_id, h.lead_id, h.status_to
  from lead_history h
  where h.created_at >= date_trunc('day', now() at time zone p_tz) at time zone p_tz
),
-- L'entonnoir : où s'arrête le stock. Chaque étage compte les prospects qui
-- l'ont atteint, pas ceux qui y sont restés.
funnel as (
  select
    (select count(*) from scope)                                               as created,
    (select count(*) from scope where assigned_to is null)                     as pool,
    (select count(*) from scope where assigned_to is not null)                 as assigned,
    (select count(*) from scope
      where status::text like 'attempt_%'
         or status in ('callback_scheduled','qualified','won','lost'))         as called,
    (select count(*) from scope
      where status in ('callback_scheduled','qualified','won'))                as reached,
    (select count(*) from scope where status = 'won')                          as conv,
    (select count(*) from converted where order_status = 'delivered')          as deliv
),
loss as (
  select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) as by_reason
  from (
    select lost_reason::text as reason, count(*)::int as n
    from scope where status = 'lost' and lost_reason is not null
    group by 1
  ) t
)
select jsonb_build_object(
  'metrics', jsonb_build_object(
    'new_7d',    (select count(*) from scope where created_at > now() - interval '7 days'),
    'new_prev_7d', (select count(*) from scope
                     where created_at > now() - interval '14 days'
                       and created_at <= now() - interval '7 days'),
    'hot_waiting', (select count(*) from hot),
    'oldest_hot_minutes', (select round(extract(epoch from (now() - min(created_at))) / 60)::int from hot),
    'median_first_contact_minutes', (select round(median_30)::int from ttc),
    'median_first_contact_prev',    (select round(median_prev)::int from ttc),
    'converted_30d', (select count(*) from converted),
    'delivered_30d', (select count(*) from converted where order_status = 'delivered'),
    'delivered_revenue_30d', (select coalesce(sum(total_price), 0) from converted where order_status = 'delivered'),
    'pool',       (select pool from funnel),
    'pool_campaigns', (select count(distinct campaign_id) from scope
                        where assigned_to is null and campaign_id is not null),
    'pool_oldest_days', (select round(extract(epoch from (now() - min(created_at))) / 86400)::int
                          from scope where assigned_to is null),
    'never_called', (select count(*) from working
                      where status in ('new','assigned')),
    'total',      (select count(*) from scope),
    'late_callbacks', (select count(*) from scope
                        where status = 'callback_scheduled'
                          and callback_scheduled_at < now()),
    'lost_30d',   (select count(*) from scope
                    where status = 'lost' and updated_at > now() - interval '30 days'),
    'calls_today',    (select count(*) from today where status_to::text like 'attempt_%'),
    'reached_today',  (select count(*) from today where status_to in ('callback_scheduled','qualified','won')),
    'oldest_hot_agent', (select u.full_name from hot h
                          left join users u on u.id = h.assigned_to
                          order by h.created_at limit 1)
  ),
  'funnel', (select to_jsonb(f) from funnel f),
  'loss',   (select by_reason from loss),
  'campaigns', coalesce((
    select jsonb_agg(c order by c->>'audience' desc) from (
      select jsonb_build_object(
        'id', pc.id, 'name', pc.name, 'offer', pc.offer,
        'channel', pc.channel, 'created_at', pc.created_at,
        'audience',  (select count(*) from scope s where s.campaign_id = pc.id),
        'pool',      (select count(*) from scope s where s.campaign_id = pc.id and s.assigned_to is null),
        'called',    (select count(*) from scope s where s.campaign_id = pc.id
                        and (s.status::text like 'attempt_%' or s.status in ('callback_scheduled','qualified','won','lost'))),
        'converted', (select count(*) from scope s where s.campaign_id = pc.id and s.status = 'won'),
        'revenue',   (select coalesce(sum(o.total_price), 0) from scope s
                        join orders o on o.id = s.converted_order_id
                       where s.campaign_id = pc.id and o.status = 'delivered'),
        -- Sent from the business number: template state and the delivery
        -- funnel. NULL for agent-sent and call campaigns.
        'whatsapp', case when pc.wa_sender = 'api' then jsonb_build_object(
          'launch_status', pc.wa_launch_status,
          'language', pc.wa_language,
          'template_status', (select t.status from whatsapp_templates t where t.id = pc.wa_template_id),
          'template_name', (select t.name from whatsapp_templates t where t.id = pc.wa_template_id),
          'template_rejected_reason', (select t.rejected_reason from whatsapp_templates t where t.id = pc.wa_template_id),
          'queued', (select count(*) from whatsapp_outbox o where o.campaign_id = pc.id and o.status in ('queued', 'sending')),
          'sent', (select count(*) from whatsapp_messages m where m.campaign_id = pc.id and m.direction = 'out' and m.status in ('sent', 'delivered', 'read')),
          'delivered', (select count(*) from whatsapp_messages m where m.campaign_id = pc.id and m.direction = 'out' and m.status in ('delivered', 'read')),
          'read', (select count(*) from whatsapp_messages m where m.campaign_id = pc.id and m.direction = 'out' and m.status = 'read'),
          'replied', (select count(distinct m.lead_id) from whatsapp_messages m
                       where m.direction = 'in' and m.lead_id in (select s.id from scope s where s.campaign_id = pc.id)),
          'failed', (select count(*) from whatsapp_outbox o where o.campaign_id = pc.id and o.status = 'failed')
                  + (select count(*) from whatsapp_messages m where m.campaign_id = pc.id and m.direction = 'out' and m.status = 'failed'),
          'skipped', (select count(*) from whatsapp_outbox o where o.campaign_id = pc.id and o.status = 'skipped'),
          -- 20260925170000: what the campaign sheet and card need to tell the
          -- story without a second request.
          'skipped_marketing_cap', (select count(*) from whatsapp_outbox o
                                     where o.campaign_id = pc.id and o.status = 'skipped' and o.skip_reason = 'marketing_cap'),
          'status_at', pc.wa_launch_status_at,
          'launched_at', pc.launched_at,
          'rate', pc.wa_rate,
          'window', pc.wa_window,
          'follow_up_hours', pc.wa_follow_up_hours,
          'message', pc.wa_message,
          'image_url', pc.wa_image_url,
          'filter', pc.filter_json
        ) else null end
      ) as c
      from prospect_campaigns pc
      where pc.market_id = p_market_id
    ) t
  ), '[]'::jsonb),
  'agents', coalesce((
    select jsonb_agg(a order by a->>'hot_waiting' desc) from (
      select jsonb_build_object(
        'id', ag.id, 'name', ag.full_name,
        'open_leads',  (select count(*) from working w where w.assigned_to = ag.id and w.status <> 'won'),
        'hot_waiting', (select count(*) from hot h where h.assigned_to = ag.id),
        'late_callbacks', (select count(*) from scope s
                            where s.assigned_to = ag.id and s.status = 'callback_scheduled'
                              and s.callback_scheduled_at < now()),
        'calls_today',     (select count(*) from today t where t.actor_id = ag.id and t.status_to::text like 'attempt_%'),
        'reached_today',   (select count(*) from today t where t.actor_id = ag.id
                             and t.status_to in ('callback_scheduled','qualified','won')),
        'converted_today', (select count(*) from today t where t.actor_id = ag.id and t.status_to = 'won'),
        'last_touch_minutes', (select round(extract(epoch from (now() - max(t.created_at))) / 60)::int
                                 from lead_history t where t.actor_id = ag.id)
      ) as a
      from agents ag
    ) t
  ), '[]'::jsonb)
);
$function$;

revoke all on function public.get_prospect_console(uuid, text) from public, anon;
grant execute on function public.get_prospect_console(uuid, text) to authenticated;
