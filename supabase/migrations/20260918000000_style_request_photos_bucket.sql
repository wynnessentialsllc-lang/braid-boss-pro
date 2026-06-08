-- Public Storage bucket for "Build your style" inspiration photos.
--
-- The booking page is anonymous, and the existing booking-gallery /
-- booking-logos buckets only allow authenticated (owner) writes. So the
-- client's inspiration photo is uploaded SERVER-SIDE by the
-- /api/style-consult route using the service role (which bypasses RLS) —
-- no anon write policy is needed here. The bucket is public-read so the
-- stylist's review queue can display the photo by URL.

insert into storage.buckets (id, name, public)
values ('style-request-photos', 'style-request-photos', true)
on conflict (id) do update set public = true;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'style_request_photos_public_read'
  ) then
    create policy style_request_photos_public_read
      on storage.objects for select
      using (bucket_id = 'style-request-photos');
  end if;
end $$;
