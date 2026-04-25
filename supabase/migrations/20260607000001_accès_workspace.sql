-- user_audit_log: append-only event log for user management actions
CREATE TABLE user_audit_log (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id   uuid NOT NULL REFERENCES users(id),
  target_id  uuid NOT NULL REFERENCES users(id),
  event_type text NOT NULL,
  meta       jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX user_audit_log_target_idx  ON user_audit_log(target_id);
CREATE INDEX user_audit_log_actor_idx   ON user_audit_log(actor_id);
CREATE INDEX user_audit_log_created_idx ON user_audit_log(created_at DESC);

ALTER TABLE user_audit_log ENABLE ROW LEVEL SECURITY;

-- Route handler is the primary gate; RLS is defense-in-depth
CREATE POLICY "audit_super_admin_read" ON user_audit_log FOR SELECT
  USING (auth.jwt() ->> 'role' = 'super_admin');

-- invitation tracking and deactivation reason on users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS invitation_sent_at     timestamptz,
  ADD COLUMN IF NOT EXISTS invitation_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivation_reason    text
    CHECK (deactivation_reason IN ('off-boarded', 'on-leave', 'terminated'));
