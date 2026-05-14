-- Public Supabase Storage bucket for storefront product photos.
-- Same shape as booking-logos: public reads (anonymous storefront
-- visitors must be able to render the image), owner-only writes
-- pinned to {auth.uid()}/<filename>.

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='product_images_owner_insert'
  ) then
    create policy product_images_owner_insert
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'product-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='product_images_owner_update'
  ) then
    create policy product_images_owner_update
      on storage.objects for update to authenticated
      using (
        bucket_id = 'product-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'product-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='product_images_owner_delete'
  ) then
    create policy product_images_owner_delete
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'product-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='product_images_public_read'
  ) then
    create policy product_images_public_read
      on storage.objects for select
      using (bucket_id = 'product-images');
  end if;
end $$;
