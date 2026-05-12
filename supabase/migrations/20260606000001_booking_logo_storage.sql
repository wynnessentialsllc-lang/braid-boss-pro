-- Public Supabase Storage bucket for booking-page logos. The
-- /book/<slug> page renders the image to anonymous visitors so the
-- bucket must be public; writes are pinned to {auth.uid()}/<file>
-- via storage.objects policies so stylists can only manage their
-- own logo.

insert into storage.buckets (id, name, public)
values ('booking-logos', 'booking-logos', true)
on conflict (id) do update set public = true;

-- Owner-only writes scoped by the leading folder of the object path.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='booking_logos_owner_insert'
  ) then
    create policy booking_logos_owner_insert
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'booking-logos'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='booking_logos_owner_update'
  ) then
    create policy booking_logos_owner_update
      on storage.objects for update to authenticated
      using (
        bucket_id = 'booking-logos'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'booking-logos'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='booking_logos_owner_delete'
  ) then
    create policy booking_logos_owner_delete
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'booking-logos'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  -- Explicit public read policy. The bucket's `public = true` flag
  -- already grants this implicitly via the storage helpers, but a
  -- named policy keeps it visible in pg_policies for audits.
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='booking_logos_public_read'
  ) then
    create policy booking_logos_public_read
      on storage.objects for select
      using (bucket_id = 'booking-logos');
  end if;
end $$;
