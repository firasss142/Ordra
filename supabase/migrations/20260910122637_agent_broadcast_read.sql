-- ============================================================
-- 20260924000004_agent_broadcast_read.sql
-- Let a confirmation agent join their market's orders broadcast topic.
--
-- WHY: the agent queue (/[locale]/queue) is still on `postgres_changes`, which
-- evaluates the `orders` RLS policy once per changed row PER SUBSCRIBER inside
-- Realtime's poller. With the Darb sync writing ~117k order updates a day, that
-- stream stalls: 8 stops and 12 restarts in the 24 h to 2026-09-10, plus
-- apply_rls cancellations. Every stop is a silent window in which a status
-- change never reaches the agent, so the card stays under its old tab until the
-- 60 s poll happens to correct it — the reported bug.
--
-- The Orders page moved off that transport in 20260924000002 and has been
-- stable since. The trigger, the private topic `orders:market:<uuid>` and this
-- policy already exist; the only thing missing is that `agent` was never in the
-- allowed-roles list, so an agent cannot join the topic at all.
--
-- WHAT: adds 'agent' alongside market_manager and warehouse_agent — same market
-- scoping, same shape. An agent may read broadcasts for their own market only;
-- ownership of the individual order is decided client-side by the queue's cache
-- patcher, exactly as it already is for postgres_changes.
--
-- The payload an agent can see is the slim one the trigger sends
-- (op, id, market_id, status, assigned_to, archived_at, updated_at) — the same
-- market-scoped facts they can already read through the orders table under RLS.
-- No new information is exposed.
--
-- NON-GOALS: no change to the trigger, the payload, or any other policy.
-- CREATE OR REPLACE POLICY does not exist in Postgres, so this drops and
-- recreates — the whole statement is one transaction, so there is no window in
-- which the policy is absent.
-- ============================================================

DROP POLICY IF EXISTS orders_broadcast_read ON realtime.messages;
CREATE POLICY orders_broadcast_read ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.topic() LIKE 'orders:market:%'
    AND (
      (select public.get_user_role()) = 'super_admin'
      OR (
        (select public.get_user_role()) IN ('market_manager', 'warehouse_agent', 'agent')
        AND realtime.topic() = 'orders:market:' || (select public.get_user_market_id())::text
      )
    )
  );
