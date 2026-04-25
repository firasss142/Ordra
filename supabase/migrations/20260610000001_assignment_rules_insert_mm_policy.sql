-- Allow market managers to upsert their own market's assignment rule.
-- Previously only UPDATE was allowed, so PUT /api/assignment-rules failed with
-- "new row violates row-level security policy for table assignment_rules"
-- because Postgres validates the INSERT WITH CHECK on every upsert path,
-- even when the conflict resolves to UPDATE.
CREATE POLICY assignment_rules_insert_mm
  ON assignment_rules
  FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() = 'market_manager'
    AND market_id = get_user_market_id()
  );
