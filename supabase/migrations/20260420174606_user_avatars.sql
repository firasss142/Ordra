-- Add avatar support to users + create public avatars storage bucket.

-- 1. Column on users table. Nullable — falls back to initials when empty.
alter table public.users
  add column if not exists avatar_url text;
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


-- 2. Storage bucket for uploaded avatars. Public read (no signed URLs needed),
--    writes restricted via RLS below.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 3. Storage RLS — uploads/updates/deletes go through the service role
--    (our /api/agents route handlers). Anonymous/auth users can read but
--    cannot write directly. This mirrors the "admin client for writes"
--    pattern used elsewhere in the app.

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars_service_write" on storage.objects;
create policy "avatars_service_write"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.role() = 'service_role');

drop policy if exists "avatars_service_update" on storage.objects;
create policy "avatars_service_update"
  on storage.objects for update
  using (bucket_id = 'avatars' and auth.role() = 'service_role');

drop policy if exists "avatars_service_delete" on storage.objects;
create policy "avatars_service_delete"
  on storage.objects for delete
  using (bucket_id = 'avatars' and auth.role() = 'service_role');

END
$reconstructible$;
