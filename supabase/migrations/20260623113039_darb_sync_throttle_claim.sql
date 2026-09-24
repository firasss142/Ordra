-- ============================================================
-- 20260817000002_darb_sync_throttle_claim.sql
-- claim_darb_sync: atomic per-market throttle for the app-launch Darb sync.
--
-- The launch sync (POST /api/darb-assabil/sync-market) fires on app open. To
-- avoid hammering the carrier API (N browser refreshes = N sweeps), the market
-- may sync at most once per throttle window. This RPC atomically checks the last
-- sync time AND claims the slot in one statement, so two simultaneous launches
-- can't both win — only the first gets `claimed = true`.
--
-- Marker lives in settings(market_id, key='darb_last_sync_at', value=jsonb ts).
-- Returns: { claimed: bool, last_synced_at: timestamptz|null }.
--   claimed=true  → caller should run the sweep (slot now stamped to now()).
--   claimed=false → another caller synced within the window; skip.
--
-- SECURITY DEFINER so it can upsert settings regardless of the caller's RLS
-- (the marker is operational, not market data). market_id is validated by FK.
-- ============================================================

CREATE OR REPLACE FUNCTION claim_darb_sync(
  p_market_id        UUID,
  p_throttle_seconds INT DEFAULT 600   -- 10 minutes
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_key        CONSTANT TEXT := 'darb_last_sync_at';
  v_now        TIMESTAMPTZ := now();
  v_last       TIMESTAMPTZ;
  v_claimed    BOOLEAN := FALSE;
BEGIN
  -- Lock the marker row (if any) so concurrent claims serialize.
  SELECT (value #>> '{}')::timestamptz
    INTO v_last
  FROM settings
  WHERE market_id = p_market_id AND key = v_key
  FOR UPDATE;

  IF v_last IS NULL OR v_now - v_last >= make_interval(secs => p_throttle_seconds) THEN
    v_claimed := TRUE;
    INSERT INTO settings (market_id, key, value, updated_at)
    VALUES (p_market_id, v_key, to_jsonb(v_now), v_now)
    ON CONFLICT (market_id, key)
    DO UPDATE SET value = to_jsonb(v_now), updated_at = v_now;
  END IF;

  RETURN json_build_object(
    'claimed', v_claimed,
    'last_synced_at', v_last
  );
END;
$$;

COMMENT ON FUNCTION claim_darb_sync IS
  'Atomic per-market throttle claim for the app-launch Darb sync. Returns claimed=true (and stamps now()) only if the last sync was older than the throttle window. See plans/darb-assabil-status-sync-fix.md.';
