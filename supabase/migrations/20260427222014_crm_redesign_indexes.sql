-- NOTE (2026-09-20) : CONCURRENTLY retiré pour que la base soit RECONSTRUCTIBLE.
-- `supabase db reset` applique les migrations dans un pipeline transactionnel, et
-- CREATE INDEX CONCURRENTLY y est interdit (SQLSTATE 25001) : la reconstruction
-- s'arrêtait ici. L'index produit est STRICTEMENT le même ; CONCURRENTLY ne
-- change que le verrouillage pendant la création, ce qui n'a de sens que sur une
-- table déjà en service — pas sur une base vide qu'on rebâtit. Ces index sont
-- déjà en place en production, où ils ont bien été créés sans verrou bloquant.
CREATE INDEX IF NOT EXISTS idx_leads_phone_market
  ON leads (customer_phone, market_id);

CREATE INDEX IF NOT EXISTS idx_leads_status_updated
  ON leads (status, updated_at DESC)
  WHERE status IN ('callback_scheduled', 'qualified');
