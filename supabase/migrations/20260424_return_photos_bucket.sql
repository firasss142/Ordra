-- ============================================================
-- 20260424_return_photos_bucket.sql
-- Private storage bucket for damaged-return photo evidence.
-- Writes go through service role (API route). Reads require an authenticated
-- warehouse actor whose market_id matches the first path segment.
-- ============================================================

-- 1. Bucket — private (photos contain order/customer context; serve via signed URL)
INSERT INTO storage.buckets (id, name, public)
VALUES ('return-photos', 'return-photos', false)
ON CONFLICT (id) DO NOTHING;

-- 2. RLS policies

-- Service role writes everything (uploads via API route handler).
DROP POLICY IF EXISTS "return_photos_service_write" ON storage.objects;
CREATE POLICY "return_photos_service_write"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'return-photos'
    AND auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "return_photos_service_update" ON storage.objects;
CREATE POLICY "return_photos_service_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'return-photos' AND auth.role() = 'service_role');

DROP POLICY IF EXISTS "return_photos_service_delete" ON storage.objects;
CREATE POLICY "return_photos_service_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'return-photos' AND auth.role() = 'service_role');

-- Read: authenticated warehouse roles can read photos for their market.
-- Path convention: `${market_id}/${order_id}/${uuid}.${ext}`
-- super_admin: all markets.
DROP POLICY IF EXISTS "return_photos_warehouse_read" ON storage.objects;
CREATE POLICY "return_photos_warehouse_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'return-photos'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('warehouse_agent', 'market_manager', 'super_admin')
        AND (
          u.role = 'super_admin'
          OR (split_part(name, '/', 1) = u.market_id::text)
        )
    )
  );
