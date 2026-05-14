-- Service categories — organize a stylist's catalog into browsable
-- groups (Boho Braids, Knotless, Maintenance, …).  Variations stay
-- attached to services; categories sit one level above.
--
-- Hierarchy: category → service → variation.
-- Categories are optional. Services without a category fall into the
-- "Other Services" bucket on both the editor and the public booking
-- page, so existing services keep working without any data migration.

create table if not exists public.service_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  -- URL-safe label derived from the name. Kept per-user so two
  -- stylists can both have "knotless" without colliding.
  slug text,
  description text,
  image_url text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_categories_name_not_blank check (length(trim(name)) > 0)
);

create index if not exists service_categories_user_id_idx
  on public.service_categories (user_id);
create index if not exists service_categories_user_sort_idx
  on public.service_categories (user_id, sort_order, name);
create unique index if not exists service_categories_user_slug_uidx
  on public.service_categories (user_id, slug)
  where slug is not null;

-- updated_at trigger using the existing helper if present.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_current_timestamp_updated_at') then
    drop trigger if exists service_categories_set_updated_at on public.service_categories;
    create trigger service_categories_set_updated_at
      before update on public.service_categories
      for each row execute function public.set_current_timestamp_updated_at();
  end if;
end $$;

alter table public.service_categories enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'service_categories'
      and policyname = 'service_categories_owner_select'
  ) then
    create policy service_categories_owner_select
      on public.service_categories for select to authenticated
      using (user_id = auth.uid());
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'service_categories'
      and policyname = 'service_categories_owner_insert'
  ) then
    create policy service_categories_owner_insert
      on public.service_categories for insert to authenticated
      with check (user_id = auth.uid());
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'service_categories'
      and policyname = 'service_categories_owner_update'
  ) then
    create policy service_categories_owner_update
      on public.service_categories for update to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'service_categories'
      and policyname = 'service_categories_owner_delete'
  ) then
    create policy service_categories_owner_delete
      on public.service_categories for delete to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

-- Attach categories to services. Nullable so existing rows stay
-- valid; ON DELETE SET NULL so dropping a category demotes its
-- services to "Other Services" rather than nuking them.
alter table public.services
  add column if not exists category_id uuid
    references public.service_categories(id) on delete set null;

create index if not exists services_category_id_idx on public.services (category_id);

-- ----------------------------------------------------------------
-- Public read RPCs — security-definer wrappers so anonymous
-- /book/<slug> visitors can browse categories without granting
-- direct SELECT on the RLS-protected tables.
-- ----------------------------------------------------------------

create or replace function public.public_list_service_categories(slug_in text)
returns table (
  id uuid,
  name text,
  slug text,
  description text,
  image_url text,
  sort_order integer
)
language sql
security definer
set search_path = public
as $$
  select c.id, c.name, c.slug, c.description, c.image_url, c.sort_order
  from public.service_categories c
  inner join public.booking_links bl on bl.user_id = c.user_id
  where bl.slug = slug_in
    and bl.active = true
    and c.active = true
    -- Hide empty categories so the picker doesn't show ghost tabs.
    and exists (
      select 1 from public.services s
      where s.user_id = c.user_id
        and s.category_id = c.id
        and s.is_active = true
    )
  order by c.sort_order asc, c.name asc;
$$;

revoke all on function public.public_list_service_categories(text) from public;
grant execute on function public.public_list_service_categories(text) to anon, authenticated;

-- Extend public_list_services to surface the category_id so the
-- booking page can filter client-side without a second RPC roundtrip.
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
  prep_instructions text,
  buffer_before_minutes integer,
  buffer_after_minutes integer,
  max_concurrent integer,
  contract_template_id uuid,
  category_id uuid
)
language sql
security definer
set search_path = public
as $$
  select
    s.id, s.name, s.description, s.duration_hours, s.base_price,
    s.deposit_required, s.deposit_amount, s.add_ons, s.prep_instructions,
    s.buffer_before_minutes, s.buffer_after_minutes, s.max_concurrent,
    s.contract_template_id, s.category_id
  from public.services s
  inner join public.booking_links bl on bl.user_id = s.user_id
  where bl.slug = slug_in
    and bl.active = true
    and s.is_active = true
  order by s.name asc;
$$;

revoke all on function public.public_list_services(text) from public;
grant execute on function public.public_list_services(text) to anon, authenticated;
