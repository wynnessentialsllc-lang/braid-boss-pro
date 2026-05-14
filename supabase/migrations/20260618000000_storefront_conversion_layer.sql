-- Phases 2-5: cover images, public reviews, lightweight products,
-- and service→product recommendations. Everything is additive and
-- nullable so existing booking + Stripe + contract flows are
-- untouched. Tables are RLS-locked to the owner. Public-page reads
-- go through SECURITY DEFINER RPCs that join on
-- _resolve_slug_to_canonical() so branded slugs work everywhere.

-- ===== Phase 2: service cover images ==================================
alter table public.services
  add column if not exists cover_image_url text,
  add column if not exists before_after_image_url text;

-- ===== Phase 3: public_reviews =========================================
create table if not exists public.public_reviews (
  id uuid primary key default gen_random_uuid(),
  stylist_user_id uuid not null references auth.users(id) on delete cascade,
  reviewer_name text not null,
  review_text text not null,
  service_name text,
  image_url text,
  is_featured boolean not null default false,
  is_verified_booking boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_reviews_text_not_blank check (length(trim(review_text)) > 0),
  constraint public_reviews_name_not_blank check (length(trim(reviewer_name)) > 0)
);
create index if not exists public_reviews_user_idx on public.public_reviews (stylist_user_id, created_at desc);
alter table public.public_reviews enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='public_reviews' and policyname='public_reviews_owner_select') then
    create policy public_reviews_owner_select on public.public_reviews for select to authenticated using (stylist_user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='public_reviews' and policyname='public_reviews_owner_insert') then
    create policy public_reviews_owner_insert on public.public_reviews for insert to authenticated with check (stylist_user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='public_reviews' and policyname='public_reviews_owner_update') then
    create policy public_reviews_owner_update on public.public_reviews for update to authenticated using (stylist_user_id = auth.uid()) with check (stylist_user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='public_reviews' and policyname='public_reviews_owner_delete') then
    create policy public_reviews_owner_delete on public.public_reviews for delete to authenticated using (stylist_user_id = auth.uid());
  end if;
end $$;

-- ===== Phase 4: lightweight products ==================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  image_url text,
  price numeric(10, 2),
  is_featured boolean not null default false,
  local_pickup_available boolean not null default false,
  external_checkout_url text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_title_not_blank check (length(trim(title)) > 0),
  constraint products_price_nonneg check (price is null or price >= 0)
);
create index if not exists products_user_idx on public.products (user_id, sort_order, created_at desc);
create index if not exists products_user_featured_idx on public.products (user_id, is_featured) where is_featured = true;
alter table public.products enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='products' and policyname='products_owner_select') then
    create policy products_owner_select on public.products for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='products' and policyname='products_owner_insert') then
    create policy products_owner_insert on public.products for insert to authenticated with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='products' and policyname='products_owner_update') then
    create policy products_owner_update on public.products for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='products' and policyname='products_owner_delete') then
    create policy products_owner_delete on public.products for delete to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- ===== Phase 5: service_product_recommendations ========================
create table if not exists public.service_product_recommendations (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint service_product_recommendations_unique unique (service_id, product_id)
);
create index if not exists spr_service_idx on public.service_product_recommendations (service_id, display_order);
create index if not exists spr_product_idx on public.service_product_recommendations (product_id);
alter table public.service_product_recommendations enable row level security;

-- Owner-scoped indirectly through the services join. Every CRUD
-- policy gates on auth.uid() owning the underlying service (and
-- product on insert) so no extra user_id column is needed.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='service_product_recommendations' and policyname='spr_owner_select') then
    create policy spr_owner_select on public.service_product_recommendations for select to authenticated
      using (exists (select 1 from public.services s where s.id = service_id and s.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='service_product_recommendations' and policyname='spr_owner_insert') then
    create policy spr_owner_insert on public.service_product_recommendations for insert to authenticated
      with check (
        exists (select 1 from public.services s where s.id = service_id and s.user_id = auth.uid())
        and exists (select 1 from public.products p where p.id = product_id and p.user_id = auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='service_product_recommendations' and policyname='spr_owner_update') then
    create policy spr_owner_update on public.service_product_recommendations for update to authenticated
      using (exists (select 1 from public.services s where s.id = service_id and s.user_id = auth.uid()))
      with check (exists (select 1 from public.services s where s.id = service_id and s.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='service_product_recommendations' and policyname='spr_owner_delete') then
    create policy spr_owner_delete on public.service_product_recommendations for delete to authenticated
      using (exists (select 1 from public.services s where s.id = service_id and s.user_id = auth.uid()));
  end if;
end $$;

-- ===== Public RPCs (SECURITY DEFINER) =================================

create or replace function public.public_list_reviews(slug_in text)
returns table (
  id uuid,
  reviewer_name text,
  review_text text,
  service_name text,
  image_url text,
  is_featured boolean,
  is_verified_booking boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select r.id, r.reviewer_name, r.review_text, r.service_name, r.image_url,
         r.is_featured, r.is_verified_booking, r.created_at
  from public.public_reviews r
  inner join public.booking_links bl on bl.user_id = r.stylist_user_id
  where bl.slug = public._resolve_slug_to_canonical(slug_in)
    and bl.active = true
  order by r.is_featured desc, r.created_at desc
  limit 24;
$$;
revoke all on function public.public_list_reviews(text) from public;
grant execute on function public.public_list_reviews(text) to anon, authenticated;

create or replace function public.public_list_products(slug_in text)
returns table (
  id uuid,
  title text,
  description text,
  image_url text,
  price numeric(10, 2),
  is_featured boolean,
  local_pickup_available boolean,
  external_checkout_url text,
  sort_order integer
)
language sql
security definer
set search_path = public
as $$
  select p.id, p.title, p.description, p.image_url, p.price,
         p.is_featured, p.local_pickup_available, p.external_checkout_url, p.sort_order
  from public.products p
  inner join public.booking_links bl on bl.user_id = p.user_id
  where bl.slug = public._resolve_slug_to_canonical(slug_in)
    and bl.active = true
    and p.active = true
  order by p.is_featured desc, p.sort_order asc, p.created_at desc
  limit 24;
$$;
revoke all on function public.public_list_products(text) from public;
grant execute on function public.public_list_products(text) to anon, authenticated;

create or replace function public.public_list_service_recommendations(slug_in text, service_id_in uuid)
returns table (
  product_id uuid,
  title text,
  description text,
  image_url text,
  price numeric(10, 2),
  local_pickup_available boolean,
  external_checkout_url text,
  display_order integer
)
language sql
security definer
set search_path = public
as $$
  select p.id as product_id, p.title, p.description, p.image_url, p.price,
         p.local_pickup_available, p.external_checkout_url, r.display_order
  from public.service_product_recommendations r
  inner join public.products p on p.id = r.product_id and p.active = true
  inner join public.services s on s.id = r.service_id
  inner join public.booking_links bl on bl.user_id = s.user_id
  where r.service_id = service_id_in
    and bl.slug = public._resolve_slug_to_canonical(slug_in)
    and bl.active = true
    and s.is_active = true
  order by r.display_order asc, p.created_at desc
  limit 12;
$$;
revoke all on function public.public_list_service_recommendations(text, uuid) from public;
grant execute on function public.public_list_service_recommendations(text, uuid) to anon, authenticated;

-- Extend public_list_services to surface cover_image_url +
-- before_after_image_url so the booking page renders covers in one
-- roundtrip.
drop function if exists public.public_list_services(text);
create or replace function public.public_list_services(slug_in text)
returns table (
  id uuid,
  name text,
  description text,
  duration_hours numeric(5,2),
  base_price numeric(10,2),
  deposit_required boolean,
  deposit_amount numeric(10,2),
  add_ons jsonb,
  extras jsonb,
  prep_instructions text,
  buffer_before_minutes integer,
  buffer_after_minutes integer,
  max_concurrent integer,
  contract_template_id uuid,
  category_id uuid,
  featured boolean,
  cover_image_url text,
  before_after_image_url text
)
language sql
security definer
set search_path = public
as $$
  select
    s.id, s.name, s.description, s.duration_hours, s.base_price,
    s.deposit_required, s.deposit_amount, s.add_ons, s.extras,
    s.prep_instructions,
    s.buffer_before_minutes, s.buffer_after_minutes, s.max_concurrent,
    s.contract_template_id, s.category_id, coalesce(s.featured, false) as featured,
    s.cover_image_url, s.before_after_image_url
  from public.services s
  inner join public.booking_links bl on bl.user_id = s.user_id
  where bl.slug = public._resolve_slug_to_canonical(slug_in)
    and bl.active = true
    and s.is_active = true
  order by coalesce(s.featured, false) desc, s.name asc;
$$;
revoke all on function public.public_list_services(text) from public;
grant execute on function public.public_list_services(text) to anon, authenticated;

notify pgrst, 'reload schema';
