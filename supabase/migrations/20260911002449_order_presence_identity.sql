-- ============================================================
-- 20260925000005_order_presence_identity.sql
-- Let a presence row carry the holder's name and photo.
--
-- WHY: the head icon is useless without a name, and there is no path to one.
--   * /api/agents is `role='agent'` only — it can never name a manager.
--   * /api/users hands a market_manager nothing but agents, same gap.
--   * Embedding `users(full_name, avatar_url)` in the presence SELECT looked
--     like the answer, but `users` RLS does not let an agent read a MANAGER's
--     row: the join resolves to NULL and the head renders as the dashed "+"
--     that means "unassigned, act on this" everywhere else in the product —
--     the exact opposite of "someone is in here". Verified against production.
--
-- WHAT: a SECURITY DEFINER reader that returns presence rows already joined to
-- the holder's identity, applying the same visibility rule the order_presence
-- SELECT policy applies. DEFINER is what lets it cross the `users` boundary,
-- and it exposes only full_name + avatar_url — the two fields already shown on
-- every roster, chip and audit line in the console.
--
-- NON-GOALS: no change to what anyone may SEE. The WHERE clause below is the
-- order_presence policy, restated. It cannot widen it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_order_presence()
RETURNS TABLE (
  order_id   uuid,
  user_id    uuid,
  role       text,
  mode       text,
  opened_at  timestamptz,
  expires_at timestamptz,
  full_name  text,
  avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- `public`, NOT ''. get_user_role() and get_user_market_id() are older helpers
-- that reference a bare `users` and carry no search_path of their own, so they
-- inherit the caller's. Under '' they fail with `relation "users" does not
-- exist` — caught in production, and silently, because the failure only
-- surfaces to a non-superuser caller.
SET search_path = public, pg_temp
AS $$
  SELECT p.order_id, p.user_id, p.role, p.mode, p.opened_at, p.expires_at,
         u.full_name, u.avatar_url
    FROM public.order_presence p
    JOIN public.users u ON u.id = p.user_id
   WHERE p.expires_at > now()
     AND (
       -- Mirrors order_presence_select (20260925000001). Restated, not widened.
       (select public.get_user_role()) = 'super_admin'
       OR (
         (select public.get_user_role()) = 'market_manager'
         AND p.market_id = (select public.get_user_market_id())
       )
       OR p.user_id = (select auth.uid())
       OR EXISTS (
         SELECT 1 FROM public.orders o
          WHERE o.id = p.order_id
            AND o.assigned_to = (select auth.uid())
       )
     );
$$;

REVOKE ALL ON FUNCTION public.list_order_presence() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_order_presence() TO authenticated;
