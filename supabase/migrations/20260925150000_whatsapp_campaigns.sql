-- ============================================================
-- 20260925150000_whatsapp_campaigns.sql
-- WhatsApp — prospect campaigns sent from the business number (plan Phase 6).
--
-- WHY: `prospect_campaigns.wa_sender = 'api'` has existed since the console
-- shipped, documented as "not connected". Now it is: a manager composes a
-- MARKETING template in Ordra, Ordra submits it to Meta, and once Meta
-- approves it the campaign spawns its prospects (as today) AND queues one
-- paced send per prospect. Until approval nothing is spawned — a campaign
-- whose message cannot leave has no business putting names in agents' queues.
--
-- WHAT:
--   prospect_campaigns.wa_template_id / wa_language / wa_image_url /
--     wa_launch_status / launched_at — every existing row keeps today's
--     semantics ('launched'), as does every agent-sent campaign.
--   whatsapp_campaign_slot()      when the i-th message goes, given a window and a rate
--   whatsapp_enqueue_campaign()   one outbox row per prospect, paced, skipping the brakes
--   get_campaign_whatsapp_stats() queued/sent/delivered/read/replied/failed per campaign
-- ============================================================

ALTER TABLE public.prospect_campaigns
  ADD COLUMN IF NOT EXISTS wa_template_id uuid REFERENCES public.whatsapp_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wa_language text CHECK (wa_language IS NULL OR wa_language IN ('ar', 'fr')),
  ADD COLUMN IF NOT EXISTS wa_image_url text,
  ADD COLUMN IF NOT EXISTS wa_launch_status text NOT NULL DEFAULT 'launched'
    CHECK (wa_launch_status IN ('draft', 'pending_template', 'ready', 'launched', 'rejected')),
  ADD COLUMN IF NOT EXISTS launched_at timestamptz;

-- ─────────────────────────────────────────────────────────────
-- whatsapp_campaign_slot — the i-th send of a paced campaign
-- ─────────────────────────────────────────────────────────────
-- Row i (0-based) leaves at window_start + i / rate hours, rolling into the
-- next day's window when the day is full. "10-20" at 60/h: rows 0..599 today
-- between 10:00 and 20:00, row 600 tomorrow at 10:00. Without a window the
-- pacing starts now.
CREATE OR REPLACE FUNCTION public.whatsapp_campaign_slot(
  p_window text,
  p_rate integer,
  p_index integer,
  p_tz text,
  p_from timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_rate    integer := GREATEST(1, COALESCE(p_rate, 60));
  v_start   integer;
  v_end     integer;
  v_local   timestamp;
  v_day     timestamp;
  v_per_day integer;
  v_days    integer;
  v_in_day  integer;
  v_offset  interval;
  v_first   timestamp;
BEGIN
  IF p_window IS NULL OR p_window !~ '^\d{1,2}-\d{1,2}$' THEN
    RETURN p_from + make_interval(secs => (3600.0 * p_index) / v_rate);
  END IF;
  v_start := split_part(p_window, '-', 1)::integer;
  v_end   := split_part(p_window, '-', 2)::integer;
  IF v_start < 0 OR v_start > 23 OR v_end < 1 OR v_end > 24 OR v_start >= v_end THEN
    RETURN p_from + make_interval(secs => (3600.0 * p_index) / v_rate);
  END IF;

  v_local := p_from AT TIME ZONE p_tz;
  v_day   := date_trunc('day', v_local);
  -- The first slot: now if inside the window, else the next opening.
  IF v_local < v_day + make_interval(hours => v_start) THEN
    v_first := v_day + make_interval(hours => v_start);
  ELSIF v_local >= v_day + make_interval(hours => v_end) THEN
    v_first := v_day + interval '1 day' + make_interval(hours => v_start);
  ELSE
    v_first := v_local;
  END IF;

  -- How many sends fit between the first slot and the end of its window.
  v_per_day := GREATEST(1, floor(extract(epoch FROM (date_trunc('day', v_first) + make_interval(hours => v_end) - v_first)) / 3600.0 * v_rate)::integer);
  IF p_index < v_per_day THEN
    RETURN (v_first + make_interval(secs => (3600.0 * p_index) / v_rate)) AT TIME ZONE p_tz;
  END IF;
  -- Later days start at window open and hold a full window each.
  v_in_day := (v_end - v_start) * v_rate;
  v_days   := 1 + (p_index - v_per_day) / v_in_day;
  v_offset := make_interval(secs => (3600.0 * ((p_index - v_per_day) % v_in_day)) / v_rate);
  RETURN (date_trunc('day', v_first) + make_interval(days => v_days, hours => v_start) + v_offset) AT TIME ZONE p_tz;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_campaign_slot(text, integer, integer, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_campaign_slot(text, integer, integer, text, timestamptz) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- whatsapp_enqueue_campaign — one paced row per prospect
-- ─────────────────────────────────────────────────────────────
-- Called by the launch route (service role) right after rpc_run_prospect_campaign
-- spawned the leads. Idempotent on dedupe_key, so a second launch adds only
-- the prospects that were missing. The brakes are decided here for what is
-- known now (invalid number, opted out, undeliverable) and re-checked by the
-- drain at send time.
CREATE OR REPLACE FUNCTION public.whatsapp_enqueue_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_c        public.prospect_campaigns%ROWTYPE;
  v_code     text;
  v_tz       text;
  v_lang     text;
  v_inserted integer := 0;
  v_queued   integer := 0;
  v_skipped  jsonb := '{}'::jsonb;
  v_i        integer := 0;
  r          RECORD;
  v_phone    text;
  v_reason   text;
  v_slot     timestamptz;
  v_status   text;
BEGIN
  SELECT * INTO v_c FROM public.prospect_campaigns WHERE id = p_campaign_id;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'campaign not found' USING ERRCODE = 'P0002'; END IF;
  IF v_c.wa_sender <> 'api' THEN RAISE EXCEPTION 'campaign is not sent from the business number' USING ERRCODE = '22023'; END IF;
  IF v_c.wa_template_id IS NULL THEN RAISE EXCEPTION 'campaign has no template' USING ERRCODE = '22023'; END IF;

  SELECT m.code, CASE m.code WHEN 'ly' THEN 'Africa/Tripoli' ELSE 'Africa/Tunis' END, m.language
    INTO v_code, v_tz, v_lang
    FROM public.markets m WHERE m.id = v_c.market_id;
  v_lang := COALESCE(v_c.wa_language, v_lang, 'fr');

  FOR r IN
    SELECT l.id, l.customer_phone,
           c.id AS customer_id, c.whatsapp_opted_out_at, c.whatsapp_undeliverable_at,
           wc.opted_out_at AS conv_opted_out_at, wc.undeliverable_at AS conv_undeliverable_at
      FROM public.leads l
      LEFT JOIN public.customers c
        ON c.market_id = l.market_id AND c.phone_normalized = public.normalize_phone(l.customer_phone)
      LEFT JOIN public.whatsapp_conversations wc
        ON wc.market_id = l.market_id AND wc.phone_e164 = public.whatsapp_e164(l.customer_phone, v_code)
     WHERE l.campaign_id = p_campaign_id
       AND l.status NOT IN ('won', 'lost', 'archived')
       AND NOT EXISTS (SELECT 1 FROM public.whatsapp_outbox o WHERE o.dedupe_key = 'campaign:' || p_campaign_id::text || ':' || l.id::text)
     ORDER BY l.created_at
  LOOP
    v_phone  := public.whatsapp_e164(r.customer_phone, v_code);
    v_reason := CASE
      WHEN v_phone IS NULL THEN 'invalid_phone'
      WHEN r.whatsapp_opted_out_at IS NOT NULL OR r.conv_opted_out_at IS NOT NULL THEN 'opted_out'
      WHEN r.whatsapp_undeliverable_at IS NOT NULL OR r.conv_undeliverable_at IS NOT NULL THEN 'undeliverable'
      ELSE NULL END;
    v_status := CASE WHEN v_reason IS NULL THEN 'queued' ELSE 'skipped' END;
    v_slot   := CASE WHEN v_reason IS NULL THEN public.whatsapp_campaign_slot(v_c.wa_window, v_c.wa_rate, v_i, v_tz, now()) ELSE now() END;

    INSERT INTO public.whatsapp_outbox
      (market_id, kind, dedupe_key, phone_e164, customer_id, lead_id, campaign_id, language, payload,
       status, skip_reason, not_before, next_attempt_at)
    VALUES
      (v_c.market_id, 'campaign', 'campaign:' || p_campaign_id::text || ':' || r.id::text,
       COALESCE(v_phone, r.customer_phone), r.customer_id, r.id, p_campaign_id, v_lang,
       jsonb_build_object('template_id', v_c.wa_template_id, 'image_url', v_c.wa_image_url),
       v_status, v_reason, v_slot, v_slot)
    ON CONFLICT (dedupe_key) DO NOTHING;

    v_inserted := v_inserted + 1;
    IF v_reason IS NULL THEN
      v_queued := v_queued + 1;
      v_i := v_i + 1;
    ELSE
      v_skipped := jsonb_set(v_skipped, ARRAY[v_reason], to_jsonb(COALESCE((v_skipped ->> v_reason)::int, 0) + 1));
    END IF;
  END LOOP;

  UPDATE public.prospect_campaigns
     SET wa_launch_status = 'launched', launched_at = COALESCE(launched_at, now())
   WHERE id = p_campaign_id;

  RETURN jsonb_build_object('inserted', v_inserted, 'queued', v_queued, 'skipped_by_reason', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_enqueue_campaign(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_enqueue_campaign(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────
-- get_prospect_console — the funnel on the campaign card
-- ─────────────────────────────────────────────────────────────
-- The console is one round trip by contract (its route test says so). The
-- campaigns array gains a `whatsapp` object for business-number campaigns:
-- template state, the queue, Meta's statuses, and who wrote back. Body is
-- 20260915173415's function plus that one key.
-- SECURITY INVOKER on purpose, as in 20260915173415: RLS on leads (and now on
-- whatsapp_outbox / whatsapp_messages) IS the isolation. The function has no
-- role or market check of its own, so it must never become DEFINER.
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
          'skipped', (select count(*) from whatsapp_outbox o where o.campaign_id = pc.id and o.status = 'skipped')
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
