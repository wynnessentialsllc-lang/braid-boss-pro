-- Digital products (downloadable ebooks / PDFs).
--
-- Braiders can now sell a downloadable file (an ebook, a lookbook PDF,
-- a care guide) alongside — or instead of — a physical item. A product
-- is "digital" when is_digital = true and it carries a digital_file_path
-- pointing at an object in the PRIVATE `product-files` bucket. After a
-- paid order, the buyer gets a short-lived signed download URL minted
-- server-side by /api/product-download; the object path itself is never
-- exposed to the browser and the bucket has no public-read policy.
--
-- is_digital and requires_shipping are independent, so a single product
-- can be:
--   • physical only   (requires_shipping=true,  is_digital=false)
--   • digital only     (requires_shipping=false, is_digital=true)  — an ebook
--   • both / bundle    (requires_shipping=true,  is_digital=true)  — paperback + PDF
--
--   products.is_digital        — deliver a download on paid orders.
--   products.digital_file_path — object path in product-files ({uid}/<file>).
--   products.digital_file_name — original filename, used for the download's
--                                Content-Disposition so the buyer gets a
--                                sensibly-named file.

begin;

-- ── Columns ──────────────────────────────────────────────────────────
alter table public.products
  add column if not exists is_digital boolean not null default false,
  add column if not exists digital_file_path text,
  add column if not exists digital_file_name text;

-- ── Private bucket ───────────────────────────────────────────────────
-- 100 MB per-object cap (image-heavy PDFs / ebooks can be large). Common
-- ebook + document container types only. Private: no public-read policy,
-- reads go through a server-minted signed URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-files', 'product-files', false, 104857600,
  array[
    'application/pdf',
    'application/epub+zip',
    'application/x-mobipocket-ebook',
    'application/zip',
    'application/octet-stream'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = 104857600,
      allowed_mime_types = array[
        'application/pdf',
        'application/epub+zip',
        'application/x-mobipocket-ebook',
        'application/zip',
        'application/octet-stream'
      ];

-- Owner-only CRUD, pinned to the {auth.uid()}/<file> folder — mirrors the
-- academy-videos bucket. NO public read policy: buyers never read the
-- object directly, they get a service-role signed URL from the download
-- route.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='product_files_owner_insert') then
    create policy product_files_owner_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'product-files' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='product_files_owner_update') then
    create policy product_files_owner_update on storage.objects for update to authenticated
      using (bucket_id = 'product-files' and (storage.foldername(name))[1] = auth.uid()::text)
      with check (bucket_id = 'product-files' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='product_files_owner_delete') then
    create policy product_files_owner_delete on storage.objects for delete to authenticated
      using (bucket_id = 'product-files' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  -- Owner can read their OWN objects (e.g. to preview / re-download in the
  -- dashboard). Buyers never read directly — they get a signed URL.
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='product_files_owner_select') then
    create policy product_files_owner_select on storage.objects for select to authenticated
      using (bucket_id = 'product-files' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;

-- ── public_list_products — expose is_digital for the storefront grid ──
-- so a digital listing can badge itself and skip shipping messaging.
-- Return shape changes, so drop + recreate. Mirrors the variants-phase1
-- definition with is_digital appended.
drop function if exists public.public_list_products(text);
create or replace function public.public_list_products(slug_in text)
returns table (
  id uuid, title text, slug text, description text, image_url text,
  gallery_images jsonb, price numeric, compare_at_price numeric,
  inventory_count integer, category text, is_featured boolean,
  local_pickup_available boolean, external_checkout_url text,
  requires_shipping boolean,
  variant_label text, variants jsonb,
  is_digital boolean
)
language plpgsql security definer set search_path = public as $$
declare resolved record;
begin
  select * into resolved from public.public_resolve_booking_slug(slug_in) limit 1;
  if resolved.user_id is null then return; end if;
  return query
    select p.id, p.title, p.slug, p.description, p.image_url,
      coalesce(p.gallery_images, '[]'::jsonb),
      p.price, p.compare_at_price, p.inventory_count, p.category,
      p.is_featured, p.local_pickup_available,
      p.external_checkout_url, p.requires_shipping,
      p.variant_label,
      coalesce(p.variants, '[]'::jsonb),
      coalesce(p.is_digital, false)
    from public.products p
    where p.user_id = resolved.user_id and p.active = true
    order by p.is_featured desc, p.sort_order asc, p.created_at desc;
end $$;

revoke all on function public.public_list_products(text) from public;
grant execute on function public.public_list_products(text) to anon, authenticated, service_role;

-- ── public_get_product — expose is_digital so the checkout route can
-- snapshot it onto the order's line items, and the product page can badge
-- the download. Return shape changes, so drop + recreate. Mirrors the
-- gift-cards-redemption definition (is_gift_card + gift_card_allow_custom)
-- with is_digital appended.
drop function if exists public.public_get_product(text, text);
create or replace function public.public_get_product(slug_in text, product_slug_in text)
returns table(
  id uuid, user_id uuid, title text, slug text, description text,
  image_url text, gallery_images jsonb, price numeric,
  compare_at_price numeric, inventory_count integer, category text,
  is_featured boolean, local_pickup_available boolean,
  external_checkout_url text, requires_shipping boolean,
  variant_label text, variants jsonb, stylist_account_id text,
  stylist_charges_enabled boolean,
  is_gift_card boolean, gift_card_allow_custom boolean,
  is_digital boolean
)
language plpgsql security definer set search_path = public as $$
declare resolved record;
begin
  select * into resolved from public.public_resolve_booking_slug(slug_in) limit 1;
  if resolved.user_id is null then return; end if;
  return query
    select p.id, p.user_id, p.title, p.slug, p.description, p.image_url,
      coalesce(p.gallery_images, '[]'::jsonb),
      p.price, p.compare_at_price, p.inventory_count, p.category,
      p.is_featured, p.local_pickup_available,
      p.external_checkout_url, p.requires_shipping,
      p.variant_label,
      coalesce(p.variants, '[]'::jsonb),
      prof.stripe_connect_account_id,
      coalesce(prof.stripe_connect_charges_enabled, false),
      coalesce(p.is_gift_card, false),
      coalesce(p.gift_card_allow_custom, false),
      coalesce(p.is_digital, false)
    from public.products p
    left join public.profiles prof on prof.id = p.user_id
    where p.user_id = resolved.user_id and p.active = true and p.slug = product_slug_in
    limit 1;
end $$;

revoke all on function public.public_get_product(text, text) from public;
grant execute on function public.public_get_product(text, text) to anon, authenticated, service_role;

-- ── Reload PostgREST schema cache ────────────────────────────────────
notify pgrst, 'reload schema';

commit;
