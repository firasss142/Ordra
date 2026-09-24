-- Schedule the Darb shipping-rate harvest.
--
-- WHY: /api/cron/darb-rates-harvest has existed since the rate table landed,
-- but it was never registered in cron.job — so the catalogue was harvested
-- exactly once, by hand, on 2026-08-08. By 2026-09-09 every quote for both
-- Libya accounts was 32 days old, past the 14-day freshness cutoff in
-- darb-rate-recommendation.ts. The picker then fell through to
-- get_carrier_true_cost, a MARKET-WIDE average with no notion of destination,
-- which ranks the Benghazi account cheapest everywhere (24.64 vs 30.40 LYD)
-- purely because it ships mostly to the cheap east. Agents saw "meilleur
-- choix: Benghazi" even for طرابلس, where Benghazi quotes 40 LYD against
-- Tripoli's 35.
--
-- Nightly at 02:17 UTC: off the hour so it never contends with the 10-minute
-- carrier sync jobs, and well clear of investor-rollup-nightly (02:41).
-- One run covers all 556 cells (278 destinations x 2 accounts).

CREATE OR REPLACE FUNCTION invoke_darb_rates_harvest()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
  v_req_id BIGINT;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'app_url';

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'cron_secret';

  IF v_url IS NULL OR v_secret IS NULL OR v_url = '' OR v_secret = '' THEN
    RAISE EXCEPTION 'vault secrets app_url and cron_secret must be set';
  END IF;

  SELECT net.http_post(
    url     := v_url || '/api/cron/darb-rates-harvest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb,
    -- The route itself is capped at maxDuration 300 in vercel.json.
    timeout_milliseconds := 295000
  ) INTO v_req_id;

  RETURN v_req_id;
END;
$$;

REVOKE ALL ON FUNCTION invoke_darb_rates_harvest() FROM PUBLIC, anon, authenticated;

-- Idempotent: unschedule first so re-running this migration cannot double-book.
SELECT cron.unschedule('darb-rates-harvest-nightly')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'darb-rates-harvest-nightly'
);

SELECT cron.schedule(
  'darb-rates-harvest-nightly',
  '17 2 * * *',
  $cron$ SELECT invoke_darb_rates_harvest(); $cron$
);
