-- Storefront Commerce Phase 1
--
-- Extends the existing `products` table (introduced in Phase 4) with
-- the columns a Shopify-style storefront needs:
--   • slug                 — URL-friendly identifier (unique per stylist)
--   • compare_at_price     — original price for sale strikethrough
--   • inventory_count      — optional stock tracking (null = untracked)
--   • category             — bucket from the curated category set
--   • gallery_images       — jsonb array of additional images
--   • requires_shipping    — whether checkout should collect a shipping address
--   • stripe_price_id      — reserved for future Stripe Product/Price linkage
--
-- Adds:
--   • product_orders table — one row per Checkout Session, written by the
--     webhook with service_role; owner read-only.
--   • public_list_products v2 — returns the new fields, used by the
--     /[handle]/shop public page.
--   • public_get_product — returns one product by (stylist_slug, product_slug);
--     used by the product detail page.
--   • mark_product_order_paid — webhook flips status to 'paid', decrements
--     inventory for line items, and timestamps paid_at. Idempotent.

begin;

-- ---- Column additions ---------------------------------------------------

alter table public.products
  add column if not exists slug text,
  add column if not exists compare_at_price numeric(10, 2),
  add column if not exists inventory_count integer,
  add column if not exists category text,
  add column if not exists gallery_images jsonb not null default '[]'::jsonb,
  add column if not exists requires_shipping boolean not null default false,
  add column if not exists stripe_price_id text;

-- Backfill slug from title for any pre-existing rows so the not-null
-- promotion below is safe. We append the first 6 chars of the id to
-- guarantee uniqueness even when two products share the same title.
update public.products
set slug = regexp_replace(lower(coalesce(nullif(trim(title), ''), 'product')), '[^a-z0-9]+', '-', 'g')
         || '-' || substr(id::text, 1, 6)
where slug is null or length(trim(slug)) = 0;

-- Strip leading/trailing dashes that the regex above could leave behind.
update public.products
set slug = regexp_replace(slug, '^-+|-+$', '', 'g')
where slug ~ '(^-|-$)';

alter table public.products alter column slug set not null;

-- Unique per stylist. Two different stylists may both have a product
-- with the slug 'coconut-oil' — that's fine because the public URL
-- is /@stylist-handle/products/coconut-oil and is scoped by handle.
create unique index if not exists products_user_slug_uidx
  on public.products (user_id, slug);

-- Category check — null is allowed for legacy rows; new rows should
-- pick one. The set matches the Phase 1 spec.
do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_schema = 'public' and table_name = 'products'
      and constraint_name = 'products_category_check'
  ) then
    alter table public.products
      add constraint products_category_check check (
        category is null or category in (
          'hair_bundles', 'braiding_hair', 'oils', 'edge_control',
          'bonnets', 'accessories', 'tools', 'digital', 'other'
        )
      );
  end if;
end $$;

-- Inventory check (null = untracked, else >= 0).
do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_schema = 'public' and table_name = 'products'
      and constraint_name = 'products_inventory_nonneg'
  ) then
    alter table public.products
      add constraint products_inventory_nonneg check (
        inventory_count is null or inventory_count >= 0
      );
  end if;
end $$;

-- compare_at_price check.
do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_schema = 'public' and table_name = 'products'
      and constraint_name = 'products_compare_at_price_nonneg'
  ) then
    alter table public.products
      add constraint products_compare_at_price_nonneg check (
        compare_at_price is null or compare_at_price >= 0
      );
  end if;
end $$;

-- ---- product_orders table ----------------------------------------------

create table if not exists public.product_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_session_id text unique,
  stripe_payment_intent text,
  stripe_account_id text,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'cancelled', 'failed')),
  amount_total numeric(10, 2) not null,
  application_fee numeric(10, 2),
  currency text not null default 'usd',
  customer_email text,
  customer_name text,
  shipping_required boolean not null default false,
  shipping_address jsonb,
  line_items jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_orders_user_idx
  on public.product_orders (user_id, created_at desc);
create index if not exists product_orders_session_idx
  on public.product_orders (stripe_session_id);
create index if not exists product_orders_status_idx
  on public.product_orders (status, created_at desc);

alter table public.product_orders enable row level security;

-- Stylist can read their own orders. Writes happen exclusively through
-- the service-role webhook, so no insert/update/delete policies for
-- the authenticated role.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'product_orders'
      and policyname = 'product_orders_owner_select'
  ) then
    create policy product_orders_owner_select on public.product_orders
      for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- ---- Public RPC: list products (v2 — extended payload) -----------------

-- Drop the v1 first because the return-type shape changed (added
-- gallery_images / compare_at_price / inventory_count / category /
-- requires_shipping). Postgres refuses to CREATE OR REPLACE when the
-- OUT signature differs.
drop function if exists public.public_list_products(text);

create or replace function public.public_list_products(slug_in text)
returns table (
  id uuid,
  title text,
  slug text,
  description text,
  image_url text,
  gallery_images jsonb,
  price numeric,
  compare_at_price numeric,
  inventory_count integer,
  category text,
  is_featured boolean,
  local_pickup_available boolean,
  external_checkout_url text,
  requires_shipping boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved record;
begin
  select * into resolved
    from public.public_resolve_booking_slug(slug_in)
    limit 1;
  if resolved.user_id is null then
    return;
  end if;
  return query
    select
      p.id, p.title, p.slug, p.description, p.image_url,
      coalesce(p.gallery_images, '[]'::jsonb) as gallery_images,
      p.price, p.compare_at_price, p.inventory_count, p.category,
      p.is_featured, p.local_pickup_available,
      p.external_checkout_url, p.requires_shipping
    from public.products p
    where p.user_id = resolved.user_id
      and p.active = true
    order by p.is_featured desc, p.sort_order asc, p.created_at desc;
end $$;

revoke all on function public.public_list_products(text) from public;
grant execute on function public.public_list_products(text) to anon, authenticated;

-- ---- Public RPC: get one product by (handle, product_slug) -------------

create or replace function public.public_get_product(
  slug_in text,
  product_slug_in text
)
returns table (
  id uuid,
  user_id uuid,
  title text,
  slug text,
  description text,
  image_url text,
  gallery_images jsonb,
  price numeric,
  compare_at_price numeric,
  inventory_count integer,
  category text,
  is_featured boolean,
  local_pickup_available boolean,
  external_checkout_url text,
  requires_shipping boolean,
  stylist_account_id text,
  stylist_charges_enabled boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved record;
begin
  select * into resolved
    from public.public_resolve_booking_slug(slug_in)
    limit 1;
  if resolved.user_id is null then
    return;
  end if;
  return query
    select
      p.id, p.user_id, p.title, p.slug, p.description, p.image_url,
      coalesce(p.gallery_images, '[]'::jsonb) as gallery_images,
      p.price, p.compare_at_price, p.inventory_count, p.category,
      p.is_featured, p.local_pickup_available,
      p.external_checkout_url, p.requires_shipping,
      prof.stripe_connect_account_id as stylist_account_id,
      coalesce(prof.stripe_connect_charges_enabled, false) as stylist_charges_enabled
    from public.products p
    left join public.profiles prof on prof.id = p.user_id
    where p.user_id = resolved.user_id
      and p.active = true
      and p.slug = product_slug_in
    limit 1;
end $$;

revoke all on function public.public_get_product(text, text) from public;
grant execute on function public.public_get_product(text, text) to anon, authenticated;

-- ---- Webhook RPC: mark a product order paid + decrement inventory ------

create or replace function public.mark_product_order_paid(
  session_id_in text,
  payment_intent_in text,
  amount_total_in numeric,
  customer_email_in text,
  customer_name_in text,
  shipping_address_in jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.product_orders%rowtype;
begin
  -- Find the order. We intentionally do NOT create an order from the
  -- webhook — the checkout route owns row creation so a webhook with
  -- no matching row means the checkout was never recorded (very rare;
  -- a Stripe pre-checkout error) and we should ignore it rather than
  -- conjure a half-row with no line_items.
  select * into existing
    from public.product_orders
    where stripe_session_id = session_id_in
    limit 1;
  if existing.id is null then
    return false;
  end if;
  if existing.status = 'paid' then
    -- Idempotent — a Stripe retry lands here and the webhook can ack.
    return true;
  end if;

  update public.product_orders
  set status = 'paid',
      stripe_payment_intent = coalesce(stripe_payment_intent, payment_intent_in),
      customer_email = coalesce(customer_email, customer_email_in),
      customer_name = coalesce(customer_name, customer_name_in),
      shipping_address = coalesce(shipping_address, shipping_address_in),
      amount_total = coalesce(nullif(amount_total, 0), amount_total_in),
      paid_at = now(),
      updated_at = now()
  where id = existing.id;

  -- Decrement inventory for each tracked line item. We use greatest()
  -- so over-sells don't drive the count negative; the checkout route
  -- is responsible for refusing to start a session against insufficient
  -- stock so this is purely a defensive floor.
  update public.products p
  set inventory_count = greatest(0, coalesce(p.inventory_count, 0) - coalesce((li->>'quantity')::int, 1)),
      updated_at = now()
  from jsonb_array_elements(existing.line_items) li
  where p.id = (li->>'product_id')::uuid
    and p.user_id = existing.user_id
    and p.inventory_count is not null;

  return true;
end $$;

revoke all on function public.mark_product_order_paid(text, text, numeric, text, text, jsonb) from public;
grant execute on function public.mark_product_order_paid(text, text, numeric, text, text, jsonb) to service_role;

-- ---- Reload PostgREST schema cache --------------------------------------
notify pgrst, 'reload schema';

commit;
