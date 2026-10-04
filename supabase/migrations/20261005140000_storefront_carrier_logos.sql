-- Logos téléversés pour les boutiques et les transporteurs.
--
-- Jusqu'ici le logo d'une boutique venait de sa plateforme (SourceLogo) et celui
-- d'un transporteur d'une carte statique par `code` (carrier-logos.ts) — si bien
-- que Darb Tripoli et Darb Benghazi, deux comptes du même code, ne pouvaient
-- pas se distinguer, et une boutique ne portait jamais sa propre marque.
-- NULL = pas de logo téléversé : l'écran retombe sur la marque d'avant.
--
-- Écriture : PUT /api/{storefronts,carriers}/[id]/logo, super_admin seulement,
-- comme tous les autres champs de ces deux tables.

ALTER TABLE public.storefronts ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.carriers    ADD COLUMN IF NOT EXISTS logo_url text;

-- ── à partir d'ici, tout touche au schéma `storage` ────────────────────────
-- Conditionnel pour la même raison que 20260420174606_user_avatars.sql : en
-- local, le schéma `storage` peut ne pas exister quand les migrations passent.
DO $reconstructible$
BEGIN
IF to_regclass('storage.buckets') IS NULL THEN
  RAISE NOTICE 'schema storage absent — bloc buckets saute (base en reconstruction)';
  RETURN;
END IF;

-- Lecture publique (pas d'URL signée) ; écritures par le service role seulement,
-- c'est-à-dire par nos routes, après leur propre contrôle de rôle.
INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "logos_public_read" ON storage.objects;
CREATE POLICY "logos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'logos');

DROP POLICY IF EXISTS "logos_service_write" ON storage.objects;
CREATE POLICY "logos_service_write"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'logos' AND auth.role() = 'service_role');

DROP POLICY IF EXISTS "logos_service_update" ON storage.objects;
CREATE POLICY "logos_service_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'logos' AND auth.role() = 'service_role');

DROP POLICY IF EXISTS "logos_service_delete" ON storage.objects;
CREATE POLICY "logos_service_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'logos' AND auth.role() = 'service_role');

END
$reconstructible$;
