-- Stylist message photos — let the stylist attach a photo to a message
-- they send a client from the dashboard Inbox.
--
-- The client half of this already exists (20261223000000): a public-read
-- bucket 'client-message-photos' written server-side by
-- /api/client-message-photo on behalf of the anonymous portal, and an
-- image_url column on client_messages.
--
-- The stylist is authenticated, so she doesn't need the service-role
-- route — she uploads straight to the same bucket from the app. All
-- that's missing are owner write policies. Same shape as booking-logos:
-- writes pinned to {auth.uid()}/<...>, reads already open so the
-- anonymous portal can render the photo by URL.

-- The bucket already exists from 20261223000000; this keeps the
-- migration self-contained if it's ever replayed against a fresh DB.
insert into storage.buckets (id, name, public)
values ('client-message-photos', 'client-message-photos', true)
on conflict (id) do update set public = true;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'client_message_photos_owner_insert'
  ) then
    create policy client_message_photos_owner_insert
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'client-message-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'client_message_photos_owner_update'
  ) then
    create policy client_message_photos_owner_update
      on storage.objects for update to authenticated
      using (
        bucket_id = 'client-message-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'client-message-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'client_message_photos_owner_delete'
  ) then
    create policy client_message_photos_owner_delete
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'client-message-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;

-- The content check from 20261223000000 was added NOT VALID so legacy
-- rows weren't rescanned. Every row written since carries text or an
-- image, so validate it now — an image-only stylist message (empty body
-- + image_url) is exactly the case this constraint has to allow through.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'client_messages_content_chk' and not convalidated
  ) then
    begin
      alter table public.client_messages
        validate constraint client_messages_content_chk;
    exception when others then
      -- A legacy row that predates the constraint shouldn't block the
      -- migration; the check still applies to every new write.
      null;
    end;
  end if;
end $$;
