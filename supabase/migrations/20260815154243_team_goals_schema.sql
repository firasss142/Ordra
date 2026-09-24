-- ============================================================
-- 20260907000001_team_goals_schema.sql
-- Team control room — goals ("Objectifs") storage.
--
-- WHY: the redesigned /team pages judge agents against goals, not dinars:
--   • three daily objectives (volume / quality / hygiene) per agent,
--   • a weekly ranking target in confirmations per active hour,
--   • one cooperative team goal per week.
-- Market-wide defaults live in `settings` (one row per key per market, seeded
-- here so the pages never fall back to a hardcoded number the way the old
-- `confirmation_rate_target` did — that key existed in ZERO rows for six
-- months and every surface silently used 70).
--
-- Per-agent overrides live in `agent_targets`. The manager's coaching CTA
-- ("→ Objectif taux 40 %") appends a row; the LATEST row per (agent, metric)
-- wins. Append-only by policy — no UPDATE/DELETE — so a target change is a
-- recorded act with an author and a date, not a silent edit.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_targets (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_id   UUID        NOT NULL REFERENCES markets(id),
  metric      TEXT        NOT NULL
                CHECK (metric IN ('daily_treated', 'min_rate', 'conf_per_hour', 'throughput')),
  value       NUMERIC     NOT NULL CHECK (value >= 0),
  set_by      UUID        REFERENCES users(id),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_targets_latest_idx
  ON agent_targets (agent_id, metric, created_at DESC);

ALTER TABLE agent_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_targets_select ON agent_targets;
CREATE POLICY agent_targets_select ON agent_targets FOR SELECT
  USING (
    get_user_role() = 'super_admin'
    OR market_id = get_user_market_id()
  );

DROP POLICY IF EXISTS agent_targets_insert ON agent_targets;
CREATE POLICY agent_targets_insert ON agent_targets FOR INSERT
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );

COMMENT ON TABLE agent_targets IS
  'Per-agent goal overrides set by managers. Append-only; latest row per (agent_id, metric) is the active target. Market defaults are in settings (goal_*).';

-- Market defaults. ON CONFLICT DO NOTHING so a market that already tuned a
-- value keeps it.
INSERT INTO settings (market_id, key, value)
SELECT m.id, k.key, k.value
FROM markets m
CROSS JOIN (VALUES
  ('goal_daily_treated',    '12'::jsonb),  -- treated orders per agent per local day
  ('goal_min_rate',         '40'::jsonb),  -- confirmation rate on treated, %
  ('goal_conf_per_hour',    '3'::jsonb),   -- weekly ranking target, confirmations / active hour
  ('goal_team_weekly_conf', '150'::jsonb)  -- cooperative team goal, confirmations / week
) AS k(key, value)
ON CONFLICT (market_id, key) DO NOTHING;
