-- Phase 1 product variants — single dimension per product
-- (Color, Size, Style, etc.). Each product can declare a
-- variant_label (the picker title shown on the storefront)
-- and a list of variant rows in variants jsonb:
--   [{ "id": "<short>", "name": "Black" }, ...]
--
-- Backwards-compatible: existing products with no variant_label
-- + an empty variants array continue to render exactly as
-- before (no picker shown, single Buy-now path).

alter table public.products
  add column if not exists variant_label text,
  add column if not exists variants jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_schema = 'public' and table_name = 'products'
      and constraint_name = 'products_variant_label_len'
  ) then
    alter table public.products
      add constraint products_variant_label_len check (
        variant_label is null or length(trim(variant_label)) between 1 and 40
      );
  end if;
end $$;

drop function if exists public.public_list_products(text);
create or replace function public.public_list_products(slug_in text)
returns table (
  id uuid, title text, slug text, description text, image_url text,
  gallery_images jsonb, price numeric, compare_at_price numeric,
  inventory_count integer, category text, is_featured boolean,
  local_pickup_available boolean, external_checkout_url text,
  requires_shipping boolean,
  variant_label text, variants jsonb
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
      coalesce(p.variants, '[]'::jsonb)
    from public.products p
    where p.user_id = resolved.user_id and p.active = true
    order by p.is_featured desc, p.sort_order asc, p.created_at desc;
end $$;

revoke all on function public.public_list_products(text) from public;
grant execute on function public.public_list_products(text) to anon, authenticated, service_role;

drop function if exists public.public_get_product(text, text);
create or replace function public.public_get_product(slug_in text, product_slug_in text)
returns table (
  id uuid, user_id uuid, title text, slug text, description text, image_url text,
  gallery_images jsonb, price numeric, compare_at_price numeric,
  inventory_count integer, category text, is_featured boolean,
  local_pickup_available boolean, external_checkout_url text,
  requires_shipping boolean,
  variant_label text, variants jsonb,
  stylist_account_id text, stylist_charges_enabled boolean
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
      coalesce(prof.stripe_connect_charges_enabled, false)
    from public.products p
    left join public.profiles prof on prof.id = p.user_id
    where p.user_id = resolved.user_id and p.active = true and p.slug = product_slug_in
    limit 1;
end $$;

revoke all on function public.public_get_product(text, text) from public;
grant execute on function public.public_get_product(text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
