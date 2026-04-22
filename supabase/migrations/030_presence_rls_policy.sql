-- Allow any authenticated user to update their own last_seen_at (presence heartbeat).
-- The existing users_update_super_admin policy only permits super_admin, so agents
-- are silently blocked from writing their heartbeat timestamp.

CREATE POLICY users_update_own_presence
  ON users
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
