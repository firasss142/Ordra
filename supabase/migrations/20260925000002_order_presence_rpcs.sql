-- ============================================================
-- 20260925000002_order_presence_rpcs.sql
-- acquire / heartbeat / release / force-release for order_presence.
--
-- All four are SECURITY DEFINER and authorise themselves against auth.uid().
-- order_presence has no INSERT/UPDATE/DELETE policy at all, so these functions
-- are the only way to write it — the shape manual_delete_orders already uses.
--
-- auth.uid() resolves inside SECURITY DEFINER: it reads the request.jwt.claims
-- GUC, and DEFINER changes the role, not the GUCs. manual_delete_orders has
-- relied on exactly this in production since 20260520181559.
--
-- ACQUIRE NEVER FAILS ON CONTENTION. Presence is a set, not a mutex: several
-- people may legitimately have one order open. The block lives on the WRITE
-- path (20260925000003), not here. Acquire only reports who is blocking so a
-- manager's UI can grey out its affordances immediately.
--
-- NON-GOALS: no enforcement here either. Still dark.
-- ============================================================

-- Statuses in which an AGENT's open panel is worth protecting: their own
-- confirmation work, plus `rejected` (agents may edit rejected orders for 7
-- days — 20260829000005). Deliberately excludes everything from `scanned` on,
-- so an agent can never park a lock on an order the warehouse floor is holding.
CREATE OR REPLACE FUNCTION public.order_presence_agent_lockable_statuses()
RETURNS public.order_status[]
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'pending', 'new', 'assigned',
    'attempt_1', 'attempt_2', 'attempt_3',
    'callback_scheduled', 'confirmed', 'dispatch_scheduled',
    'uploaded', 'rejected'
  ]::public.order_status[];
$$;

-- ------------------------------------------------------------
-- acquire
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acquire_order_presence(
  p_order_id    uuid,
  p_session_id  uuid,
  p_mode        text DEFAULT 'viewing',
  p_ttl_seconds int  DEFAULT 75
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid         uuid := (select auth.uid());
  v_role        text;
  v_user_market uuid;
  v_market      uuid;
  v_assignee    uuid;
  v_status      public.order_status;
  v_tracked     boolean := false;
  v_expires     timestamptz;
  v_blocking    json;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_mode NOT IN ('viewing', 'editing') THEN
    RAISE EXCEPTION 'invalid mode: %', p_mode USING ERRCODE = '22023';
  END IF;
  -- Bound the TTL so a crafted call cannot park a lock for a day.
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 10 OR p_ttl_seconds > 300 THEN
    RAISE EXCEPTION 'ttl out of range: %', p_ttl_seconds USING ERRCODE = '22023';
  END IF;

  SELECT u.role, u.market_id INTO v_role, v_user_market
    FROM public.users u WHERE u.id = v_uid;

  IF v_role IS NULL OR v_role NOT IN ('agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT o.market_id, o.assigned_to, o.status
    INTO v_market, v_assignee, v_status
    FROM public.orders o WHERE o.id = p_order_id;

  IF v_market IS NULL THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_role <> 'super_admin' AND v_market IS DISTINCT FROM v_user_market THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- An agent may only be present on an order they own, in a status where their
  -- work is worth protecting. Outside that they simply are not tracked — the
  -- panel still opens; it just creates no row.
  IF v_role = 'agent' THEN
    v_tracked := v_assignee IS NOT DISTINCT FROM v_uid
                 AND v_status = ANY (public.order_presence_agent_lockable_statuses());
  ELSE
    v_tracked := true;
  END IF;

  IF v_tracked THEN
    v_expires := now() + make_interval(secs => p_ttl_seconds);

    INSERT INTO public.order_presence AS op
      (order_id, session_id, user_id, market_id, role, mode, opened_at, expires_at)
    VALUES
      (p_order_id, p_session_id, v_uid, v_market, v_role, p_mode, now(), v_expires)
    ON CONFLICT (order_id, session_id) DO UPDATE
      SET mode       = EXCLUDED.mode,
          expires_at = EXCLUDED.expires_at,
          -- Re-acquiring the same tab keeps "since when", so the manager's
          -- "ouverte depuis 4 min" does not reset on every visibility change.
          opened_at  = CASE WHEN op.user_id = EXCLUDED.user_id
                            THEN op.opened_at ELSE now() END
      WHERE op.user_id = EXCLUDED.user_id;
  END IF;

  -- Who (if anyone) is blocking writes on this order right now: agents only,
  -- and never the caller themselves.
  SELECT json_build_object(
           'user_id',   p.user_id,
           'full_name', u.full_name,
           'opened_at', p.opened_at,
           'expires_at', p.expires_at)
    INTO v_blocking
    FROM public.order_presence p
    JOIN public.users u ON u.id = p.user_id
   WHERE p.order_id = p_order_id
     AND p.role = 'agent'
     AND p.expires_at > now()
     AND p.user_id <> v_uid
   LIMIT 1;

  RETURN json_build_object(
    'tracked',        v_tracked,
    'expires_at',     v_expires,
    'server_now',     now(),
    'blocking_agent', v_blocking
  );
END;
$$;

-- ------------------------------------------------------------
-- heartbeat
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.heartbeat_order_presence(
  p_order_id    uuid,
  p_session_id  uuid,
  p_mode        text DEFAULT NULL,
  p_ttl_seconds int  DEFAULT 75
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid     uuid := (select auth.uid());
  v_expires timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_mode IS NOT NULL AND p_mode NOT IN ('viewing', 'editing') THEN
    RAISE EXCEPTION 'invalid mode: %', p_mode USING ERRCODE = '22023';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 10 OR p_ttl_seconds > 300 THEN
    RAISE EXCEPTION 'ttl out of range: %', p_ttl_seconds USING ERRCODE = '22023';
  END IF;

  -- `expires_at > now()` is what makes a force-release or a natural expiry
  -- irreversible: a late heartbeat cannot resurrect a row that has gone.
  UPDATE public.order_presence
     SET expires_at = now() + make_interval(secs => p_ttl_seconds),
         mode       = COALESCE(p_mode, mode)
   WHERE order_id   = p_order_id
     AND session_id = p_session_id
     AND user_id    = v_uid
     AND expires_at > now()
  RETURNING expires_at INTO v_expires;

  RETURN json_build_object(
    'alive',      v_expires IS NOT NULL,
    'expires_at', v_expires,
    'server_now', now()
  );
END;
$$;

-- ------------------------------------------------------------
-- release
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_order_presence(
  p_order_id   uuid,
  p_session_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (select auth.uid());
  v_n   int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- Scoped by session_id: closing one tab must not release another tab's row.
  DELETE FROM public.order_presence
   WHERE order_id   = p_order_id
     AND session_id = p_session_id
     AND user_id    = v_uid;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN json_build_object('released', v_n > 0);
END;
$$;

-- ------------------------------------------------------------
-- force-release (super_admin only)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.force_release_order_presence(p_order_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid        uuid := (select auth.uid());
  v_role       text;
  v_actor_name text;
  v_holder     uuid;
  v_holder_nm  text;
  v_market     uuid;
  v_status     public.order_status;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT u.role, u.full_name INTO v_role, v_actor_name
    FROM public.users u WHERE u.id = v_uid;

  -- Raised HERE and not only in the route: market_manager must not be able to
  -- break a live lock by any path. Their recourse is to wait out the TTL.
  IF v_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- Only agent rows block anything, so only agent rows are worth forcing.
  DELETE FROM public.order_presence p
   WHERE p.order_id = p_order_id
     AND p.role = 'agent'
     AND p.expires_at > now()
  RETURNING p.user_id INTO v_holder;

  IF v_holder IS NULL THEN
    RAISE EXCEPTION 'no live agent lock on order %', p_order_id USING ERRCODE = 'P0002';
  END IF;

  SELECT u.full_name INTO v_holder_nm FROM public.users u WHERE u.id = v_holder;
  SELECT o.market_id, o.status INTO v_market, v_status
    FROM public.orders o WHERE o.id = p_order_id;

  -- status_from = status_to: this records an intervention, not a transition —
  -- same convention as logManagerTakeOver. actor_type CHECK allows only
  -- ('system','agent','manager'), so super_admin maps to 'manager'.
  INSERT INTO public.order_history
    (order_id, status_from, status_to, actor_id, actor_type, note, market_id)
  VALUES
    (p_order_id, v_status, v_status, v_uid, 'manager',
     format('Admin %s a libéré de force la commande ouverte par l''agent %s',
            COALESCE(v_actor_name, '—'), COALESCE(v_holder_nm, '—')),
     v_market);

  -- Emitted from the RPC, not the DELETE trigger: a normal release is also a
  -- DELETE, and only this function knows the difference between "the agent
  -- closed the panel" and "the agent was thrown out of it".
  BEGIN
    PERFORM realtime.send(
      jsonb_build_object(
        'order_id',         p_order_id,
        'released_by',      v_uid,
        'released_by_name', v_actor_name,
        'at',               now()
      ),
      'lock_forced',
      'order_presence:agent:' || v_holder::text,
      true
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'force_release_order_presence: broadcast failed: %', SQLERRM;
  END;

  RETURN json_build_object(
    'released', true,
    'holder',   json_build_object('user_id', v_holder, 'full_name', v_holder_nm)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_order_presence(uuid, uuid, text, int)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.heartbeat_order_presence(uuid, uuid, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_order_presence(uuid, uuid)              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.force_release_order_presence(uuid)              FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.acquire_order_presence(uuid, uuid, text, int)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_order_presence(uuid, uuid, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_order_presence(uuid, uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.force_release_order_presence(uuid)              TO authenticated;
