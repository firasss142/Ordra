-- Webhook delivery log: audit trail for all incoming storefront webhooks
CREATE TABLE webhook_delivery_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text        NOT NULL,
  event         text        NOT NULL,
  payload       jsonb       NOT NULL,
  order_id      uuid        REFERENCES orders(id),
  status        text        NOT NULL CHECK (status IN ('processed', 'ignored', 'error')),
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE webhook_delivery_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_insert" ON webhook_delivery_log
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "super_admin_select" ON webhook_delivery_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'super_admin')
  );
