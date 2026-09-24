
-- ── à partir d'ici, tout touche au schéma `storage` ────────────────────────
-- NOTE (2026-09-20, corrigé le 2026-09-24) : ce BLOC SEUL est conditionnel.
-- En local, `supabase start` applique les migrations AVANT que le conteneur
-- storage-api n'ait créé le schéma `storage`. Une première version enveloppait
-- le FICHIER ENTIER, ce qui sautait aussi les ALTER TABLE ordinaires ci-dessus
-- — `users.avatar_url` n'existait alors jamais et une migration bien plus tard
-- échouait dessus. Seules les instructions `storage.*` doivent être sautées.
DO $reconstructible$
BEGIN
IF to_regclass('storage.buckets') IS NULL THEN
  RAISE NOTICE 'schema storage absent — bloc buckets saute (base en reconstruction)';
  RETURN;
END IF;

-- ============================================================
-- 20260627000001_product_images_bucket.sql
-- Public storage bucket for product images.
-- Mirrors the avatars bucket pattern: public read (no signed URLs),
-- writes restricted to the service role (our /api/products/[id]/image route).
-- The existing products.image_url column now stores the bucket public URL.
-- Path convention: `${market_id}/${product_id}/image.<ext>`
-- ============================================================

-- 1. Bucket — public read.
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Storage RLS — public read; uploads/updates/deletes via service role only.

DROP POLICY IF EXISTS "product_images_public_read" ON storage.objects;
CREATE POLICY "product_images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "product_images_service_write" ON storage.objects;
CREATE POLICY "product_images_service_write"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'product-images' AND auth.role() = 'service_role');

DROP POLICY IF EXISTS "product_images_service_update" ON storage.objects;
CREATE POLICY "product_images_service_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'product-images' AND auth.role() = 'service_role');

DROP POLICY IF EXISTS "product_images_service_delete" ON storage.objects;
CREATE POLICY "product_images_service_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'product-images' AND auth.role() = 'service_role');

END
$reconstructible$;
