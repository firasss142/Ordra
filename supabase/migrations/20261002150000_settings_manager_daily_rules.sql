-- Réglages — a market_manager edits the day-to-day rules of their own market.
--
-- WHY. The owner decided (plans/reglages-redesign.md, 2026-10-02) that a
-- manager runs the daily rules of their market: call attempts, SLA, duplicate
-- and merge windows, archiving, the distribution method, team goals, and the
-- risky-parcel and follow-up thresholds. The only write policy on `settings`
-- was `settings_write_super_admin`, so every manager save through
-- PATCH /api/settings/:id ended in a 500 — in production too.
--
-- WHAT. INSERT and UPDATE (the route's upsert needs both) for a manager, on
-- rows of their own market whose key is in the list below. Nothing else:
-- money, stock planning and WhatsApp automation stay the administrator's, and
-- a manager deletes nothing. The list is the same as
-- MANAGER_EDITABLE_SETTING_KEYS in src/lib/reglages/topics.ts — a test there
-- reads this file and fails if the two drift apart. The route checks it first
-- for a readable 403; this is what holds against a direct PostgREST call.
--
-- `(SELECT get_user_role())` and not a bare call: a bare helper in a policy is
-- re-run per row (see the RLS InitPlan note).

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
      'delivery_done_window_hours'
    ])
  );

-- USING picks the rows a manager may touch, WITH CHECK what they may turn them
-- into: the same test on both sides, so a row can neither be moved to the other
-- market nor renamed into a key the manager does not own.
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
      'delivery_done_window_hours'
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
      'delivery_done_window_hours'
    ])
  );
