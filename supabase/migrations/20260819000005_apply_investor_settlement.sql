-- ============================================================
-- 20260819000005_apply_investor_settlement.sql
-- Atomically commit a computed settlement.
--
-- The arithmetic deliberately lives in TypeScript
-- (src/lib/investors/settlement.ts) so it can be unit-tested with hand-checked
-- numbers and share the exact allocation helpers the portal displays. This
-- function only WRITES, and its job is to make the write all-or-nothing.
--
-- Without it a settlement could half-apply: statements inserted, ledger rows
-- lost to a timeout. The ledger is append-only, so there is no way to repair
-- that afterwards — an investor's balance would silently disagree with their
-- statements forever.
--
-- IDEMPOTENT: the (investor_id, product_id, period_start, period_end) unique
-- constraint absorbs a re-run, and the ledger rows are joined to the statements
-- that were actually inserted. Running the same period twice therefore inserts
-- nothing the second time rather than paying twice.
--
-- AUTHORIZATION: called only from POST /api/admin/investments/settlements,
-- which gates on super_admin via getActor() and uses the service-role client.
-- SECURITY DEFINER is required because investor_ledger intentionally has no
-- UPDATE/DELETE policy and only a super_admin INSERT policy.
-- ============================================================

CREATE OR REPLACE FUNCTION apply_investor_settlement(
  p_statements JSONB,
  p_ledger     JSONB,
  p_actor_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_statements_inserted INT := 0;
  v_ledger_inserted     INT := 0;
BEGIN
  IF p_statements IS NULL OR jsonb_array_length(p_statements) = 0 THEN
    RETURN jsonb_build_object('statements_inserted', 0, 'ledger_inserted', 0);
  END IF;

  WITH inserted AS (
    INSERT INTO investor_statements (
      investor_id, product_id, market_id, period_start, period_end,
      revenue, cogs, delivery_cost, return_cost, packing_cost,
      ad_spend_direct, ad_spend_allocated, processing_cost, net_profit,
      delivered_count, returned_count, confirmed_count,
      investor_capital, total_capital, share_pct, investor_share,
      reserve_held, carried_loss_applied, cost_inputs,
      status, settled_at, settled_by
    )
    SELECT
      s.investor_id, s.product_id, s.market_id, s.period_start, s.period_end,
      s.revenue, s.cogs, s.delivery_cost, s.return_cost, s.packing_cost,
      s.ad_spend_direct, s.ad_spend_allocated, s.processing_cost, s.net_profit,
      s.delivered_count, s.returned_count, s.confirmed_count,
      s.investor_capital, s.total_capital, s.share_pct, s.investor_share,
      s.reserve_held, s.carried_loss_applied, s.cost_inputs,
      'settled', now(), p_actor_id
    FROM jsonb_to_recordset(p_statements) AS s(
      investor_id UUID, product_id UUID, market_id UUID,
      period_start DATE, period_end DATE,
      revenue NUMERIC, cogs NUMERIC, delivery_cost NUMERIC, return_cost NUMERIC,
      packing_cost NUMERIC, ad_spend_direct NUMERIC, ad_spend_allocated NUMERIC,
      processing_cost NUMERIC, net_profit NUMERIC,
      delivered_count INT, returned_count INT, confirmed_count INT,
      investor_capital NUMERIC, total_capital NUMERIC, share_pct NUMERIC,
      investor_share NUMERIC, reserve_held NUMERIC, carried_loss_applied NUMERIC,
      cost_inputs JSONB
    )
    -- Re-running a period must not pay twice.
    ON CONFLICT (investor_id, product_id, period_start, period_end) DO NOTHING
    RETURNING id, investor_id, product_id
  ),
  ledger_ins AS (
    INSERT INTO investor_ledger (
      investor_id, statement_id, product_id, market_id,
      entry_type, amount, note, created_by
    )
    SELECT
      l.investor_id, i.id, l.product_id, l.market_id,
      l.entry_type, l.amount, l.note, p_actor_id
    FROM jsonb_to_recordset(p_ledger) AS l(
      investor_id UUID, product_id UUID, market_id UUID,
      entry_type TEXT, amount NUMERIC, note TEXT
    )
    -- Only for statements this call actually inserted. A conflicting (already
    -- settled) statement contributes no ledger rows, which is what makes the
    -- whole operation safely repeatable.
    JOIN inserted i
      ON i.investor_id = l.investor_id
     AND i.product_id  = l.product_id
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM inserted),
    (SELECT count(*) FROM ledger_ins)
  INTO v_statements_inserted, v_ledger_inserted;

  RETURN jsonb_build_object(
    'statements_inserted', v_statements_inserted,
    'ledger_inserted',     v_ledger_inserted
  );
END;
$$;

COMMENT ON FUNCTION apply_investor_settlement IS
  'Commits a settlement computed in src/lib/investors/settlement.ts. All-or-nothing and idempotent per (investor, product, period).';
