-- ============================================================
-- 20260925160000_whatsapp_config_last_test.sql
-- WhatsApp Business Cloud API — keep the last staged test on the config row.
--
-- WHY: Connexions › Services › WhatsApp runs a five-stage test (credentials →
-- number → WABA → app subscription → webhook). The result lived only in the
-- browser, so a reload threw away exactly the run someone wanted to read
-- again — usually the failed one, with the fix written in its detail line.
-- The prototype (prototypes/whatsapp-manager-v1.html?screen=connexions) shows
-- the checklist as a standing part of the card, not a toast.
--
-- WHAT: three nullable columns on whatsapp_configs, written by
-- POST /api/whatsapp/config/[marketId]/test and read by GET /api/whatsapp/config.
--   last_test_at      when the run happened
--   last_test_ok      false when any stage failed
--   last_test_stages  [{ key, status, code, params, detail }] — no secret: the
--                     route builds it from Graph answers, never from the
--                     decrypted token, app secret or verify token.
--
-- SECURITY: additive only. whatsapp_configs keeps RLS on with zero policies
-- and no grant to anon/authenticated (20260925100000); new columns inherit
-- that, so only the service role reads them. No function is created here.
-- ============================================================

ALTER TABLE public.whatsapp_configs
  ADD COLUMN IF NOT EXISTS last_test_at     timestamptz,
  ADD COLUMN IF NOT EXISTS last_test_ok     boolean,
  ADD COLUMN IF NOT EXISTS last_test_stages jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_configs_last_test_stages_array'
  ) THEN
    ALTER TABLE public.whatsapp_configs
      ADD CONSTRAINT whatsapp_configs_last_test_stages_array
      CHECK (last_test_stages IS NULL OR jsonb_typeof(last_test_stages) = 'array');
  END IF;
END $$;

COMMENT ON COLUMN public.whatsapp_configs.last_test_at IS
  'When the last staged connection test ran (Connexions › Services › WhatsApp).';
COMMENT ON COLUMN public.whatsapp_configs.last_test_ok IS
  'False when any stage of the last staged test failed.';
COMMENT ON COLUMN public.whatsapp_configs.last_test_stages IS
  'The five stages of the last test: [{key,status,code,params,detail}]. Built from Graph answers; never holds a secret.';
