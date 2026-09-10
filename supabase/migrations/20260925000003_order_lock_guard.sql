-- ============================================================
-- 20260925000003_order_lock_guard.sql
-- The hard block: while an AGENT has an order open, nobody else may write it.
--
-- THE TRAP THIS DESIGN EXISTS TO AVOID
-- src/app/api/darb-assabil/sync-market/route.ts builds a USER-SESSION client
-- (not the admin client) and calls promote_darb_status. That route fires on
-- every app launch, for every role, and drives a large share of the Darb sync's
-- ~117k order updates a day. So auth.uid() is a real manager's UUID during
-- those writes. ANY guard keyed on "is there a session?" would break the Darb
-- sweep the moment one order in the market is locked.
--
-- The sound signal is the NAMED ACTOR. Every system path already declares
-- itself by passing p_actor_id => NULL (sync-market:164, sync-batch:202,
-- auto-assignment-orchestrator.ts:80). So: p_actor_id IS NULL => never blocked.
--
-- auth.uid() DOES resolve inside SECURITY DEFINER — it reads the
-- request.jwt.claims GUC, and DEFINER changes the role, not the GUCs.
-- manual_delete_orders has relied on exactly that since 20260520181559.
--
-- TWO PARTS, because neither covers everything:
--   (a) assert_order_unlocked(), called at the top of every mutating RPC. Keyed
--       on p_actor_id, so system paths are exempt by construction.
--   (b) a BEFORE UPDATE trigger on orders, for the raw .update() paths no RPC
--       covers (PATCH /api/orders/[id], the two items routes). Keyed on
--       current_user, because a raw PostgREST write runs as `authenticated`
--       while every SECURITY DEFINER RPC runs as the owner and the admin
--       client runs as service_role.
--
-- DELIBERATE NON-COVERAGE: the warehouse RPCs (scan_order_out, scan_return_in,
-- unscan_order, scan_received_in, record_stock_count) are NOT guarded. An agent
-- can legitimately hold a lock on an `uploaded` order; freezing the warehouse
-- floor because a tab is open would be a worse bug than the one being fixed.
-- ============================================================

-- SQLSTATE 55006 = object_in_use. A real, standard code: it cannot be confused
-- with the bare P0001 that the dozens of un-coded RAISE EXCEPTIONs elsewhere in
-- these migrations produce. DETAIL carries JSON the API layer parses into the
-- 409 { code: "locked", lock: {...} } body.
CREATE OR REPLACE FUNCTION public.assert_order_unlocked(p_order_id uuid, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_holder  uuid;
  v_name    text;
  v_since   timestamptz;
  v_expires timestamptz;
BEGIN
  -- System write (cron, webhook intake, carrier sync). Never blocked.
  IF p_actor_id IS NULL THEN
    RETURN;
  END IF;

  SELECT p.user_id, u.full_name, p.opened_at, p.expires_at
    INTO v_holder, v_name, v_since, v_expires
    FROM public.order_presence p
    JOIN public.users u ON u.id = p.user_id
   WHERE p.order_id = p_order_id
     AND p.role = 'agent'          -- manager presence is advisory; it blocks nobody
     AND p.expires_at > now()
     AND p.user_id <> p_actor_id   -- the holder's own writes always pass
   LIMIT 1;

  IF v_holder IS NULL THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'order_locked'
    USING ERRCODE = '55006',
          DETAIL  = json_build_object(
                      'order_id',    p_order_id,
                      'holder_id',   v_holder,
                      'holder_name', v_name,
                      'since',       v_since,
                      'expires_at',  v_expires
                    )::text;
END;
$$;

-- Array variant for manual_delete_orders. Fails loudly on the first locked
-- order rather than skipping: a cancel is a single deliberate act even when the
-- caller passes several ids, and a silent partial cancel is worse than a clear
-- refusal naming the order that is busy.
CREATE OR REPLACE FUNCTION public.assert_orders_unlocked(p_order_ids uuid[], p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_actor_id IS NULL THEN
    RETURN;
  END IF;
  FOREACH v_id IN ARRAY p_order_ids LOOP
    PERFORM public.assert_order_unlocked(v_id, p_actor_id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_order_unlocked(uuid, uuid)    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_orders_unlocked(uuid[], uuid) FROM PUBLIC;

-- ------------------------------------------------------------
-- (a) Install the guard at the top of every mutating RPC.
--
-- Patched IN PLACE from pg_get_functiondef rather than re-emitted by hand:
-- transition_order_status alone is 6 KB of transition table, and retyping it to
-- add one line is how a transition rule gets silently dropped. Every target was
-- checked to contain exactly ONE `\nbegin\n` anchor (the outer block, no
-- nesting), so the insertion point is unambiguous. Idempotent: a function that
-- already calls the guard is skipped.
-- ------------------------------------------------------------
DO $patch$
DECLARE
  r      record;
  v_def  text;
  v_new  text;
  v_call text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('assign_order', 'unassign_order', 'return_order_to_pool',
                         'transition_order_status', 'no_response_with_auto_reject',
                         'recover_deleted_order', 'manual_delete_orders')
  LOOP
    v_def := pg_get_functiondef(r.oid);

    IF v_def ~* 'assert_orders?_unlocked' THEN
      CONTINUE;
    END IF;

    v_call := CASE WHEN r.proname = 'manual_delete_orders'
                   THEN '  perform public.assert_orders_unlocked(p_order_ids, p_actor_id);'
                   ELSE '  perform public.assert_order_unlocked(p_order_id, p_actor_id);'
              END;

    -- chr(10)/chr(9) rather than an E-string: this literal has to survive a
    -- file, a JSON tool call and psql without anyone counting backslashes.
    v_new := regexp_replace(
               v_def,
               '(' || chr(10) || 'begin[ ' || chr(9) || ']*' || chr(10) || ')',
               '\1' || v_call || chr(10),
               'i'
             );

    IF v_new = v_def THEN
      RAISE EXCEPTION 'lock guard: no begin anchor found in %', r.proname;
    END IF;

    EXECUTE v_new;
  END LOOP;
END
$patch$;

-- A later CREATE OR REPLACE of any guarded function would silently drop its
-- guard and nothing would fail. This turns that into a one-command check —
-- run `SELECT public.assert_lock_guards_installed();` after touching any of
-- them. It is also called once at the end of this migration.
CREATE OR REPLACE FUNCTION public.assert_lock_guards_installed()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_missing
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('assign_order', 'unassign_order', 'return_order_to_pool',
                       'transition_order_status', 'no_response_with_auto_reject',
                       'recover_deleted_order', 'manual_delete_orders')
     AND pg_get_functiondef(p.oid) !~* 'assert_orders?_unlocked';

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'order lock guard missing from: %', array_to_string(v_missing, ', ');
  END IF;
  RETURN 'ok';
END;
$$;

-- ------------------------------------------------------------
-- (b) The raw-write trigger.
-- ------------------------------------------------------------
-- SECURITY INVOKER, and that is the entire point — do NOT "harden" this to
-- SECURITY DEFINER. Inside a DEFINER function current_user is the OWNER, so the
-- test below would read 'postgres' on every call and the guard would silently
-- never run. That exact mistake was made and caught here: the RPC path blocked
-- correctly while a raw PATCH /api/orders/[id] sailed straight through.
--
-- As INVOKER, current_user is the seam, and it is load-bearing:
--   'authenticated'  -> a RAW PostgREST table write. Nothing declared an actor,
--                       so auth.uid() is the only signal available.
--   owner (postgres) -> the UPDATE is inside a SECURITY DEFINER RPC, already
--                       guarded by assert_order_unlocked() on its own
--                       p_actor_id — which is what correctly exempts the Darb
--                       sweep. Also pg_cron.
--   'service_role'   -> the admin client. Always a system write.
--
-- The helper it delegates to stays SECURITY DEFINER so it can read
-- order_presence and users regardless of the caller's RLS.
CREATE OR REPLACE FUNCTION public.orders_assert_unlocked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  PERFORM public.assert_order_unlocked(NEW.id, (select auth.uid()));
  RETURN NEW;
END;
$$;

-- Required because the trigger now runs AS the invoking role. Read-only: the
-- helper can only return void or raise, so the worst it exposes is the holder's
-- name for an order id the caller would have to already know.
GRANT EXECUTE ON FUNCTION public.assert_order_unlocked(uuid, uuid) TO authenticated;

-- The WHEN list mirrors trg_orders_broadcast_upd and DELIBERATELY omits
-- carrier_status_*, tracking_number and updated_at. That omission is what keeps
-- sync-batch/route.ts:190's raw `carrier_status_synced_at` write — which really
-- does run as `authenticated` — out of the function body entirely.
DROP TRIGGER IF EXISTS trg_orders_lock_guard ON public.orders;
CREATE TRIGGER trg_orders_lock_guard
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  WHEN (
       OLD.assigned_to      IS DISTINCT FROM NEW.assigned_to
    OR OLD.status           IS DISTINCT FROM NEW.status
    OR OLD.customer_name    IS DISTINCT FROM NEW.customer_name
    OR OLD.customer_phone   IS DISTINCT FROM NEW.customer_phone
    OR OLD.customer_phone_2 IS DISTINCT FROM NEW.customer_phone_2
    OR OLD.customer_address IS DISTINCT FROM NEW.customer_address
    OR OLD.customer_city    IS DISTINCT FROM NEW.customer_city
    OR OLD.customer_note    IS DISTINCT FROM NEW.customer_note
    OR OLD.quantity         IS DISTINCT FROM NEW.quantity
    OR OLD.total_price      IS DISTINCT FROM NEW.total_price
  )
  EXECUTE FUNCTION public.orders_assert_unlocked();

-- ------------------------------------------------------------
-- Bulk assign: skip locked, report them.
--
-- Single-order action -> fail loudly (409). Bulk action -> skip and report.
-- The plpgsql EXCEPTION block opens a subtransaction, so a locked order rolls
-- back ALONE and the loop continues: per-order atomicity survives while the
-- batch becomes partial. Same contract /api/orders/auto-assign-bulk already
-- ships (assigned[] + skipped[{order_id, reason}]).
--
-- The signature is unchanged but the JSON SHAPE changes, with no compile-time
-- check anywhere (there is no generated Supabase types file, and
-- bulk-assign/route.ts casts). Route and migration ship together, and the route
-- tolerates both shapes for one release.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_assign_orders(
  p_order_ids uuid[],
  p_agent_id  uuid,
  p_actor_id  uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id UUID;
  v_assigned UUID[]  := '{}';
  v_skipped  JSONB   := '[]'::jsonb;
  v_holder   UUID;
BEGIN
  IF coalesce(cardinality(p_order_ids), 0) > 500 THEN
    RAISE EXCEPTION 'bulk_assign_orders: at most 500 orders per call'
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_order_id IN ARRAY p_order_ids LOOP
    BEGIN
      PERFORM assign_order(v_order_id, p_agent_id, p_actor_id, 'manager');
      v_assigned := v_assigned || v_order_id;
    EXCEPTION WHEN SQLSTATE '55006' THEN
      SELECT p.user_id INTO v_holder
        FROM public.order_presence p
       WHERE p.order_id = v_order_id
         AND p.role = 'agent'
         AND p.expires_at > now()
       LIMIT 1;
      v_skipped := v_skipped || jsonb_build_object(
        'order_id',  v_order_id,
        'reason',    'locked',
        'holder_id', v_holder
      );
    END;
  END LOOP;

  RETURN json_build_object('assigned', v_assigned, 'skipped', v_skipped);
END;
$$;

SELECT public.assert_lock_guards_installed();
