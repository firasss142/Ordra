-- A setting reads the same whether it is stored bare (`30`) or wrapped
-- (`{"value": 30}`).
--
-- WHY. Both shapes live in `settings`: PATCH /api/settings/:id wraps every
-- scalar as `{ value }`, the seeds and older writes are bare, and
-- PUT /api/assignment-rules writes `{ type }`. The TypeScript readers unwrap all
-- of them (storedScalar, getMarketSetting). Seven SQL readers did not:
--
--   archive_finished_orders   NULLIF(value #>> '{}', '')::int
--   get_team_live             (value #>> '{}')::numeric      ×2
--   get_team_performance      (value #>> '{}')::numeric      ×4
--   get_agent_day_detail      (value #>> '{}')::numeric      ×3
--   get_prospect_console      value::int
--   delivery_setting_int      (s.value->>'value')::integer   bare → silently the default
--   leads_create_winback      (s.value ->> 'value')::boolean bare → silently "not disabled"
--
-- On 2026-08-21 Tunisia saved auto_archive_after_days and its team goals from
-- the screen, wrapped. Since the night of 2026-08-22 the pg_cron job
-- `auto-archive-finished-orders` has failed every night with 22P02 — and the
-- exception aborts the loop, so neither market has archived anything since.
-- Libya's goals are still bare; the first goal a manager saves from Réglages
-- would have broken its Salle de contrôle, Performance and agent day view.
--
-- HOW. One helper, the SQL twin of storedScalar, and each reader patched in
-- place: the live definition is read with pg_get_functiondef, the exact read
-- expression is replaced, and the result is executed. Nothing else in these
-- functions changes — the live bodies differ from the repo's migration files
-- in comments, and re-creating them from the files would ship those
-- differences too. CREATE OR REPLACE keeps the owner and the grants.
-- Safe to run twice: a function already patched is skipped.
--
-- `claim_darb_sync` is left alone on purpose: it reads `darb_last_sync_at`,
-- which only it writes, always bare (to_jsonb(now())). The settings route
-- never touches that key.

CREATE OR REPLACE FUNCTION public.setting_scalar(p_value jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    -- { value } from the settings route, { type } from the assignment-rules
    -- route, { amount } from the old fee editor — one key, one scalar.
    WHEN jsonb_typeof(p_value) = 'object'
         AND (SELECT count(*) FROM jsonb_object_keys(p_value)) = 1
         AND (p_value ? 'value' OR p_value ? 'type' OR p_value ? 'amount')
      THEN COALESCE(p_value ->> 'value', p_value ->> 'type', p_value ->> 'amount')
    ELSE p_value #>> '{}'
  END
$$;

COMMENT ON FUNCTION public.setting_scalar(jsonb) IS
  'A settings value as text, whether stored bare (30) or wrapped ({"value": 30}, {"type": …}, {"amount": …}). Every SQL reader of a scalar setting goes through it; casting value #>> ''{}'' directly broke nightly archiving from 2026-08-22.';

REVOKE ALL ON FUNCTION public.setting_scalar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.setting_scalar(jsonb) TO authenticated, service_role;

DO $patch$
DECLARE
  r      RECORD;
  v_oid  OID;
  v_n    INT;
  v_def  TEXT;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      (1, 'archive_finished_orders',
          $p$NULLIF(value #>> '{}', '')::int$p$,
          $p$NULLIF(public.setting_scalar(value), '')::int$p$),
      (2, 'get_team_live',
          $p$(value #>> '{}')::numeric$p$,
          $p$public.setting_scalar(value)::numeric$p$),
      (3, 'get_team_performance',
          $p$(value #>> '{}')::numeric$p$,
          $p$public.setting_scalar(value)::numeric$p$),
      -- The COALESCE first: it already read both shapes, and once the generic
      -- replacement below has run it would no longer match.
      (4, 'get_agent_day_detail',
          $p$COALESCE((value ->> 'value')::numeric, (value #>> '{}')::numeric)$p$,
          $p$public.setting_scalar(value)::numeric$p$),
      (5, 'get_agent_day_detail',
          $p$(value #>> '{}')::numeric$p$,
          $p$public.setting_scalar(value)::numeric$p$),
      (6, 'get_prospect_console',
          $p$select value::int from settings$p$,
          $p$select public.setting_scalar(value)::int from settings$p$),
      (7, 'delivery_setting_int',
          $p$(s.value->>'value')::integer$p$,
          $p$public.setting_scalar(s.value)::integer$p$),
      (8, 'leads_create_winback',
          $p$(s.value ->> 'value')::boolean$p$,
          $p$public.setting_scalar(s.value)::boolean$p$)
    ) AS t(ord, fn, old_expr, new_expr)
    ORDER BY ord
  LOOP
    SELECT count(*), min(p.oid) INTO v_n, v_oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = r.fn;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'setting_scalar patch: expected one public.%, found %', r.fn, v_n;
    END IF;

    v_def := pg_get_functiondef(v_oid);
    IF position(r.old_expr IN v_def) = 0 THEN
      IF position(r.new_expr IN v_def) > 0 THEN
        CONTINUE;  -- already patched
      END IF;
      RAISE EXCEPTION 'setting_scalar patch: public.% contains neither % nor %',
        r.fn, r.old_expr, r.new_expr;
    END IF;

    EXECUTE replace(v_def, r.old_expr, r.new_expr);
  END LOOP;
END
$patch$;

-- Every settings reader now either goes through setting_scalar or branches on
-- jsonb_typeof itself. Anything else is the bug this migration fixes.
DO $verify$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~* 'from\s+(public\.)?settings'
     AND p.prosrc !~ 'setting_scalar'
     AND p.prosrc !~ 'jsonb_typeof'
     AND p.proname <> 'claim_darb_sync';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'settings readers that cast a raw value: %', v_bad;
  END IF;
END
$verify$;
