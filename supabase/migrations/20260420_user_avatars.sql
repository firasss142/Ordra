-- Add avatar support to users + create public avatars storage bucket.

-- 1. Column on users table. Nullable — falls back to initials when empty.
alter table public.users
  add column if not exists avatar_url text;

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
