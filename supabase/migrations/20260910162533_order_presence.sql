-- ============================================================
-- 20260925000001_order_presence.sql
-- Who currently has an order open on screen.
--
-- WHY: an agent "opening" an order is purely local React state
-- (QueuePage.selectedOrderId). Nothing server-side records it, so a manager
-- reassigning that order has no way to know an agent is on the phone about it —
-- and `assign_order` never checked ownership, so the reassign silently wins.
-- The agent then discovers it when their confirm returns 404 Order not found,
-- indistinguishable from "this order was deleted", after the call is over.
--
-- WHAT: one ephemeral row per open detail panel per TAB. Rows live ~75 s past
-- the last heartbeat and are deleted on release. The table holds "panels
-- currently open" — tens of rows, never a log. Audit lives in order_history.
--
-- The asymmetry is deliberate and is expressed by `role`:
--   role = 'agent'   → BLOCKING. 20260925000003 refuses manager writes on the
--                      order while such a row is live.
--   role = manager   → ADVISORY. Shown to the agent, blocks nobody. An agent
--                      mid-call must never be frozen because a manager clicked
--                      a row to read it.
--
-- NON-GOALS: this migration only stores and broadcasts presence. It enforces
-- nothing — the write guard lands in 20260925000003, so 1 and 2 can ship dark
-- and be verified against zero rows before any UI creates a single row.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.order_presence (
  order_id   UUID        NOT NULL REFERENCES public.orders(id)  ON DELETE CASCADE,
  -- Per TAB (crypto.randomUUID()), not per user. Without it, an agent with two
  -- tabs on one order drops the surviving tab's row when the first one closes.
  session_id UUID        NOT NULL,
  user_id    UUID        NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  -- Taken from the ORDER, never from the user: users.market_id is NULL for
  -- super_admin, and this column is what the manager RLS arm and the broadcast
  -- topic are keyed on.
  market_id  UUID        NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('agent', 'market_manager', 'super_admin')),
  mode       TEXT        NOT NULL DEFAULT 'viewing' CHECK (mode IN ('viewing', 'editing')),
  opened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Stored, not derived from a last_heartbeat_at + a TTL constant duplicated
  -- across SQL, the route and the client. Force-release, natural expiry and the
  -- client countdown all read this one column.
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (order_id, session_id)
);

-- A partial index `WHERE expires_at > now()` is illegal (now() is not
-- IMMUTABLE). This composite serves the manager's market sweep; the enforcement
-- probe uses the PK prefix instead.
CREATE INDEX IF NOT EXISTS idx_order_presence_market_live
  ON public.order_presence (market_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_presence_user
  ON public.order_presence (user_id);

COMMENT ON TABLE public.order_presence IS
  'Ephemeral: who has an order detail view open. role=agent rows block manager writes (see assert_order_unlocked). Deleted on release, expire ~75s after the last heartbeat.';

ALTER TABLE public.order_presence ENABLE ROW LEVEL SECURITY;

-- Scalar-subquery style per 20260829000003 (initplan: the helper runs once for
-- the statement, not once per row).
DROP POLICY IF EXISTS order_presence_select ON public.order_presence;
CREATE POLICY order_presence_select ON public.order_presence
  FOR SELECT TO authenticated
  USING (
    (select public.get_user_role()) = 'super_admin'
    OR (
      (select public.get_user_role()) = 'market_manager'
      AND market_id = (select public.get_user_market_id())
    )
    OR user_id = (select auth.uid())
    -- The arm that lets an agent see a manager standing on THEIR order. A
    -- correlated EXISTS — normally what 20260822000002 moved away from — but it
    -- runs against a tens-of-rows table filtered to the agent's own queue ids,
    -- so it is a handful of PK lookups, not a scan.
    OR EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = order_id
         AND o.assigned_to = (select auth.uid())
    )
  );

-- No INSERT/UPDATE/DELETE policies: `authenticated` may never write this table
-- directly. Every mutation goes through a SECURITY DEFINER RPC that authorises
-- itself against auth.uid() — the shape manual_delete_orders already uses.

-- ============================================================
-- Broadcast. Mirrors orders_broadcast_change (20260924000002) exactly:
-- SECURITY DEFINER (realtime.send inserts as the invoking role, and
-- realtime.messages has no INSERT policy for `authenticated` — without DEFINER
-- every broadcast from a user session is silently dropped while service-role
-- writes work), SET search_path = '', and the body wrapped so a Realtime hiccup
-- can never fail the presence write itself.
-- ============================================================

CREATE OR REPLACE FUNCTION public.order_presence_broadcast()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row      public.order_presence;
  v_payload  jsonb;
  v_assignee uuid;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  v_payload := jsonb_build_object(
    'op',         TG_OP,
    'order_id',   v_row.order_id,
    'user_id',    v_row.user_id,
    'market_id',  v_row.market_id,
    'role',       v_row.role,
    'mode',       v_row.mode,
    'opened_at',  v_row.opened_at,
    'expires_at', v_row.expires_at
  );

  BEGIN
    -- Managers and super_admins watch their market.
    PERFORM realtime.send(
      v_payload,
      'presence_changed',
      'order_presence:market:' || v_row.market_id::text,
      true
    );

    -- The assignee watches their own topic, so an agent learns a manager is
    -- standing on their order without seeing any other agent's traffic. Their
    -- own row is not echoed back to them.
    SELECT o.assigned_to INTO v_assignee
      FROM public.orders o WHERE o.id = v_row.order_id;

    IF v_assignee IS NOT NULL AND v_assignee <> v_row.user_id THEN
      PERFORM realtime.send(
        v_payload,
        'presence_changed',
        'order_presence:agent:' || v_assignee::text,
        true
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'order_presence_broadcast: % (order %)', SQLERRM, v_row.order_id;
  END;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.order_presence_broadcast() FROM PUBLIC;

-- Two triggers, not one: a single trigger cannot reference OLD on INSERT nor
-- NEW on DELETE.
DROP TRIGGER IF EXISTS trg_order_presence_ins_del ON public.order_presence;
CREATE TRIGGER trg_order_presence_ins_del
  AFTER INSERT OR DELETE ON public.order_presence
  FOR EACH ROW EXECUTE FUNCTION public.order_presence_broadcast();

-- Fires on heartbeat too (expires_at moves). That is deliberate: without it a
-- manager's cached expires_at goes stale and a live lock reads as expired after
-- 75 s. Cost is ~1 message per open panel per 25 s. The client holds entries in
-- a ref and re-renders only when the orderId:userId:mode signature changes, so
-- a heartbeat never repaints the orders table.
DROP TRIGGER IF EXISTS trg_order_presence_upd ON public.order_presence;
CREATE TRIGGER trg_order_presence_upd
  AFTER UPDATE ON public.order_presence
  FOR EACH ROW EXECUTE FUNCTION public.order_presence_broadcast();

-- ============================================================
-- Who may join the presence topics.
--
-- The topic prefix must NOT begin with 'orders:market:' — orders_broadcast_read
-- matches that with LIKE and, since 20260924000004, admits role 'agent'. A
-- topic named 'orders:market:<uuid>:presence' would hand every agent the
-- market's entire presence state. Hence 'order_presence:'.
--
-- Two NEW policies rather than editing orders_broadcast_read: SELECT policies
-- are OR'd, so these cannot weaken it, and there is no drop-and-recreate window.
-- ============================================================

DROP POLICY IF EXISTS order_presence_broadcast_market_read ON realtime.messages;
CREATE POLICY order_presence_broadcast_market_read ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.topic() LIKE 'order_presence:market:%'
    AND (
      (select public.get_user_role()) = 'super_admin'
      OR (
        (select public.get_user_role()) = 'market_manager'
        AND realtime.topic() = 'order_presence:market:' || (select public.get_user_market_id())::text
      )
    )
  );

-- Exact match, no LIKE: an agent can only ever join their own topic.
DROP POLICY IF EXISTS order_presence_broadcast_agent_read ON realtime.messages;
CREATE POLICY order_presence_broadcast_agent_read ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.topic() = 'order_presence:agent:' || (select auth.uid())::text
  );
