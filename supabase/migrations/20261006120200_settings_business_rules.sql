-- Réglages v2 — three business rules that were written in the code
-- (plans/journal-detection-and-settings-v2.md §H).
--
-- 1. The online-card surcharge. It was `* 1.1` in TypeScript and in
--    merge_orders(). It is now the market's `card_surcharge_pct` (default 10,
--    super_admin only: it is money). No row means 10 %, so nothing changes until
--    someone saves a different rate.
-- 2. Prospects: `max_lead_attempts` and `lead_hot_window_minutes` were read by
--    the code and editable nowhere. A market_manager may now set both for their
--    own market, so they join the whitelist of 20261002150000 (the route's
--    MANAGER_EDITABLE_SETTING_KEYS must stay equal — a Vitest test reads THIS file).
-- 3. get_prospect_console() read the hot window with `value::int`, which throws
--    on the wrapped {"value": 60} the settings route writes — the bug that
--    stopped nightly archiving from 2026-08-22. It now goes through
--    setting_scalar(), before anyone can save the value from the screen.

-- ── 1. merge_orders reads the rate ──────────────────────────────────────────
DO $patch$
DECLARE
  v_sig REGPROCEDURE;
  v_def TEXT;
  v_old CONSTANT TEXT := 'THEN v_subtotal * 1.1 ELSE v_subtotal END)';
  v_new CONSTANT TEXT := 'THEN v_subtotal * (1 + COALESCE((SELECT public.setting_scalar(s.value)::NUMERIC FROM public.settings s
                                         WHERE s.market_id = v_survivor.market_id AND s.key = ''card_surcharge_pct''), 10) / 100)
                ELSE v_subtotal END)';
BEGIN
  SELECT p.oid::REGPROCEDURE INTO v_sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'merge_orders';
  v_def := pg_get_functiondef(v_sig);
  IF position('card_surcharge_pct' IN v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'merge_orders a changé depuis 20260917140504 : patch refusé';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $patch$;

-- ── 2. a manager sets the prospect rules of their own market ────────────────
DROP POLICY IF EXISTS "settings_insert_manager_daily_rules" ON public.settings;
CREATE POLICY "settings_insert_manager_daily_rules"
  ON public.settings FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.get_user_role()) = 'market_manager'
    AND market_id = (SELECT public.get_user_market_id())
    AND key = ANY (ARRAY[
      'max_call_attempts',
      'attempt_retry_times',
      'sla_minutes',
      'duplicate_window_hours',
      'duplicate_autoselect_window_hours',
      'merge_window_hours',
      'auto_archive_after_days',
      'assignment_algorithm',
      'goal_daily_treated',
      'goal_min_rate',
      'goal_conf_per_hour',
      'goal_team_weekly_conf',
      'high_value_threshold',
      'risk_min_prior_failures',
      'zone_low_delivery_rate_pct',
      'zone_min_sample',
      'carrier_stall_days',
      'delivery_first_action_hours',
      'delivery_done_window_hours',
      'max_lead_attempts',
      'lead_hot_window_minutes'
    ])
  );

DROP POLICY IF EXISTS "settings_update_manager_daily_rules" ON public.settings;
CREATE POLICY "settings_update_manager_daily_rules"
  ON public.settings FOR UPDATE
  TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'market_manager'
    AND market_id = (SELECT public.get_user_market_id())
    AND key = ANY (ARRAY[
      'max_call_attempts',
      'attempt_retry_times',
      'sla_minutes',
      'duplicate_window_hours',
      'duplicate_autoselect_window_hours',
      'merge_window_hours',
      'auto_archive_after_days',
      'assignment_algorithm',
      'goal_daily_treated',
      'goal_min_rate',
      'goal_conf_per_hour',
      'goal_team_weekly_conf',
      'high_value_threshold',
      'risk_min_prior_failures',
      'zone_low_delivery_rate_pct',
      'zone_min_sample',
      'carrier_stall_days',
      'delivery_first_action_hours',
      'delivery_done_window_hours',
      'max_lead_attempts',
      'lead_hot_window_minutes'
    ])
  )
  WITH CHECK (
    (SELECT public.get_user_role()) = 'market_manager'
    AND market_id = (SELECT public.get_user_market_id())
    AND key = ANY (ARRAY[
      'max_call_attempts',
      'attempt_retry_times',
      'sla_minutes',
      'duplicate_window_hours',
      'duplicate_autoselect_window_hours',
      'merge_window_hours',
      'auto_archive_after_days',
      'assignment_algorithm',
      'goal_daily_treated',
      'goal_min_rate',
      'goal_conf_per_hour',
      'goal_team_weekly_conf',
      'high_value_threshold',
      'risk_min_prior_failures',
      'zone_low_delivery_rate_pct',
      'zone_min_sample',
      'carrier_stall_days',
      'delivery_first_action_hours',
      'delivery_done_window_hours',
      'max_lead_attempts',
      'lead_hot_window_minutes'
    ])
  );

-- ── 3. the prospect console reads the hot window whatever its shape ─────────
DO $patch$
DECLARE
  v_sig REGPROCEDURE := 'public.get_prospect_console(uuid, text)'::REGPROCEDURE;
  v_def TEXT := pg_get_functiondef(v_sig);
  v_old CONSTANT TEXT := 'select value::int from settings';
  v_new CONSTANT TEXT := 'select public.setting_scalar(value)::int from public.settings';
BEGIN
  IF position(v_old IN v_def) = 0 THEN RETURN; END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $patch$;
