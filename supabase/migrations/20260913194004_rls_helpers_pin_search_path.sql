-- ============================================================
-- 20260926000009_rls_helpers_pin_search_path.sql
-- get_user_role() and get_user_market_id() are SECURITY DEFINER with NO
-- search_path of their own, so they resolve `users` through whatever
-- search_path the CALLER has. Every RLS policy calls them.
--
-- Found on 2026-09-13 building the delivery page: get_delivery_worklist is
-- SECURITY INVOKER with `SET search_path = ''` (the hardening pattern used
-- throughout the recent migrations). Under that path the policies on orders /
-- customers call these helpers, which then fail with
-- `relation "users" does not exist` — so the worklist errored for every real
-- agent and manager. The earlier SQL checks ran as the owner, which bypasses
-- RLS, and never saw it.
--
-- Pinning the path fixes the helpers for every caller, and closes the classic
-- SECURITY DEFINER search_path hijack (a caller-controlled path could
-- otherwise point `users` at a look-alike table). The bodies are unchanged.
-- ============================================================

ALTER FUNCTION public.get_user_role() SET search_path = public;
ALTER FUNCTION public.get_user_market_id() SET search_path = public;
