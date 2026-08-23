-- Sticker rolls: the write policies the first migration forgot.
--
-- 20260823000001 enabled RLS on sticker_rolls and wrote only a SELECT policy,
-- so every registration failed with a bare "db_error" — caught by driving the
-- real form against production, not by the route tests, which mock Supabase
-- and therefore never meet RLS at all.
--
-- Modelled on label_prints, the closest existing analogue: the same three roles
-- may write, scoped to their own market, and the row records who did it.
--
-- The SELECT policy is tightened at the same time. `USING (true)` let any
-- authenticated user read every market's rolls, which is not how any other
-- market-scoped table behaves.

DROP POLICY IF EXISTS sticker_rolls_read ON public.sticker_rolls;

CREATE POLICY sticker_rolls_select ON public.sticker_rolls
  FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM public.carriers c
      WHERE c.id = sticker_rolls.carrier_id
        AND c.market_id = public.get_user_market_id()
    )
  );

CREATE POLICY sticker_rolls_insert ON public.sticker_rolls
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = ANY (ARRAY['super_admin', 'market_manager', 'warehouse_agent'])
    AND (
      public.get_user_role() = 'super_admin'
      OR EXISTS (
        SELECT 1 FROM public.carriers c
        WHERE c.id = sticker_rolls.carrier_id
          AND c.market_id = public.get_user_market_id()
      )
    )
    -- Who opened the roll is part of the record, not a field to spoof.
    AND opened_by = auth.uid()
  );

CREATE POLICY sticker_rolls_update ON public.sticker_rolls
  FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = ANY (ARRAY['super_admin', 'market_manager', 'warehouse_agent'])
    AND (
      public.get_user_role() = 'super_admin'
      OR EXISTS (
        SELECT 1 FROM public.carriers c
        WHERE c.id = sticker_rolls.carrier_id
          AND c.market_id = public.get_user_market_id()
      )
    )
  )
  WITH CHECK (
    public.get_user_role() = ANY (ARRAY['super_admin', 'market_manager', 'warehouse_agent'])
    AND (
      public.get_user_role() = 'super_admin'
      OR EXISTS (
        SELECT 1 FROM public.carriers c
        WHERE c.id = sticker_rolls.carrier_id
          AND c.market_id = public.get_user_market_id()
      )
    )
  );

-- No DELETE policy on purpose. A roll is closed (`exhausted` / `void`), never
-- removed: the numbers it covers are the audit trail behind every sticker bound
-- from it, and get_sticker_rolls counts consumption against that range.

-- darb_zones and darb_branches keep `USING (true)`: Darb's directory is one
-- national list, identical for both accounts, and carries nothing market-private.
