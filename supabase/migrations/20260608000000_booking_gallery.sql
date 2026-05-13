-- Stylist photo gallery for the public booking page.
--
-- Photos live in a new public Storage bucket `booking-gallery`,
-- pinned to {auth.uid()}/<filename> via storage.objects policies.
-- The booking_links row carries a small jsonb array of
-- { url, path, sort } so order is preserved without an extra table.
-- Capped at 8 entries by the app; this constraint mirrors that so
-- the column never grows unbounded even if a buggy client tries to
-- push more.

alter table public.booking_links
  add column if not exists gallery_photos jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_links_gallery_photos_chk'
  ) then
    alter table public.booking_links
      add constraint booking_links_gallery_photos_chk
      check (
        jsonb_typeof(gallery_photos) = 'array'
        and jsonb_array_length(gallery_photos) <= 8
      )
      not valid;
    alter table public.booking_links
      validate constraint booking_links_gallery_photos_chk;
  end if;
end $$;

-- Storage bucket — public so the anonymous /book/<slug> page can
-- render <img> tags without signed URLs.
insert into storage.buckets (id, name, public)
values ('booking-gallery', 'booking-gallery', true)
on conflict (id) do update set public = true;

-- Owner-scoped writes pinned by leading folder = auth.uid().
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'booking_gallery_owner_insert'
  ) then
    create policy booking_gallery_owner_insert
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'booking-gallery'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'booking_gallery_owner_update'
  ) then
    create policy booking_gallery_owner_update
      on storage.objects for update to authenticated
      using (
        bucket_id = 'booking-gallery'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'booking-gallery'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'booking_gallery_owner_delete'
  ) then
    create policy booking_gallery_owner_delete
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'booking-gallery'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'booking_gallery_public_read'
  ) then
    create policy booking_gallery_public_read
      on storage.objects for select
      using (bucket_id = 'booking-gallery');
  end if;
end $$;
