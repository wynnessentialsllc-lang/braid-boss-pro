-- Phase 2 commerce — extends product_orders, adds shop_settings,
-- appointment-attached upsell add-ons, status-transition RPCs,
-- a public order tracking RPC, and retail analytics views.

alter table public.product_orders
  add column if not exists fulfillment_status text not null default 'unfulfilled',
  add column if not exists fulfillment_type text,
  add column if not exists tracking_carrier text,
  add column if not exists tracking_number text,
  add column if not exists tracking_url text,
  add column if not exists shipping_notes text,
  add column if not exists fulfilled_at timestamptz,
  add column if not exists shipped_at timestamptz,
  add column if not exists canceled_at timestamptz,
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_amount numeric(10, 2),
  add column if not exists stripe_refund_id text,
  add column if not exists customer_token text,
  add column if not exists customer_phone text;

do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_schema='public' and table_name='product_orders'
      and constraint_name='product_orders_fulfillment_status_check'
  ) then
    alter table public.product_orders add constraint product_orders_fulfillment_status_check check (
      fulfillment_status in ('unfulfilled','fulfilled','shipped','refunded','canceled','partial')
    );
  end if;
end $$;

update public.product_orders
set customer_token = lower(replace(gen_random_uuid()::text, '-', ''))
where customer_token is null;

alter table public.product_orders alter column customer_token set not null;

create unique index if not exists product_orders_customer_token_uidx
  on public.product_orders (customer_token);

create table if not exists public.shop_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pickup_instructions text,
  shipping_notes text,
  turnaround_days_min integer,
  turnaround_days_max integer,
  default_carrier text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shop_settings enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='shop_settings' and policyname='shop_settings_owner_select') then
    create policy shop_settings_owner_select on public.shop_settings for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='shop_settings' and policyname='shop_settings_owner_insert') then
    create policy shop_settings_owner_insert on public.shop_settings for insert to authenticated with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='shop_settings' and policyname='shop_settings_owner_update') then
    create policy shop_settings_owner_update on public.shop_settings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

alter table public.booking_requests
  add column if not exists upsell_items jsonb not null default '[]'::jsonb;

create or replace function public.mark_order_fulfilled(order_id_in uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare row_user uuid;
begin
  select user_id into row_user from public.product_orders where id = order_id_in;
  if row_user is null then return false; end if;
  if row_user <> auth.uid() then raise exception 'forbidden'; end if;
  update public.product_orders
  set fulfillment_status = case when fulfillment_status = 'shipped' then 'shipped' else 'fulfilled' end,
      fulfilled_at = coalesce(fulfilled_at, now()),
      updated_at = now()
  where id = order_id_in;
  return true;
end $$;

create or replace function public.mark_order_shipped(
  order_id_in uuid, carrier_in text, tracking_in text, url_in text
) returns boolean language plpgsql security definer set search_path = public as $$
declare row_user uuid;
begin
  select user_id into row_user from public.product_orders where id = order_id_in;
  if row_user is null then return false; end if;
  if row_user <> auth.uid() then raise exception 'forbidden'; end if;
  update public.product_orders
  set fulfillment_status = 'shipped',
      tracking_carrier = nullif(trim(coalesce(carrier_in, '')), ''),
      tracking_number  = nullif(trim(coalesce(tracking_in, '')), ''),
      tracking_url     = nullif(trim(coalesce(url_in, '')), ''),
      shipped_at       = coalesce(shipped_at, now()),
      fulfilled_at     = coalesce(fulfilled_at, now()),
      updated_at       = now()
  where id = order_id_in;
  return true;
end $$;

create or replace function public.mark_order_canceled(order_id_in uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare row_user uuid;
begin
  select user_id into row_user from public.product_orders where id = order_id_in;
  if row_user is null then return false; end if;
  if row_user <> auth.uid() then raise exception 'forbidden'; end if;
  update public.product_orders
  set fulfillment_status = 'canceled',
      canceled_at = coalesce(canceled_at, now()),
      updated_at = now()
  where id = order_id_in;
  return true;
end $$;

create or replace function public.mark_order_refunded(
  order_id_in uuid, refund_id_in text, refund_amount_in numeric
) returns boolean language plpgsql security definer set search_path = public as $$
declare row_user uuid;
begin
  select user_id into row_user from public.product_orders where id = order_id_in;
  if row_user is null then return false; end if;
  if row_user <> auth.uid() and current_setting('role', true) <> 'service_role' then raise exception 'forbidden'; end if;
  update public.product_orders
  set fulfillment_status = 'refunded',
      stripe_refund_id   = coalesce(stripe_refund_id, refund_id_in),
      refund_amount      = coalesce(refund_amount, refund_amount_in),
      refunded_at        = coalesce(refunded_at, now()),
      updated_at         = now()
  where id = order_id_in;
  return true;
end $$;

revoke all on function public.mark_order_fulfilled(uuid) from public;
revoke all on function public.mark_order_shipped(uuid, text, text, text) from public;
revoke all on function public.mark_order_canceled(uuid) from public;
revoke all on function public.mark_order_refunded(uuid, text, numeric) from public;
grant execute on function public.mark_order_fulfilled(uuid) to authenticated;
grant execute on function public.mark_order_shipped(uuid, text, text, text) to authenticated;
grant execute on function public.mark_order_canceled(uuid) to authenticated;
grant execute on function public.mark_order_refunded(uuid, text, numeric) to authenticated, service_role;

create or replace function public.public_get_order(token_in text)
returns table (
  id uuid,
  customer_token text,
  status text,
  fulfillment_status text,
  amount_total numeric,
  currency text,
  customer_email text,
  customer_name text,
  shipping_required boolean,
  shipping_address jsonb,
  line_items jsonb,
  tracking_carrier text,
  tracking_number text,
  tracking_url text,
  shipping_notes text,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  shipped_at timestamptz,
  created_at timestamptz,
  stylist_business_name text,
  stylist_logo_url text,
  stylist_handle text
) language plpgsql security definer set search_path = public as $$
begin
  return query
  select o.id, o.customer_token, o.status, o.fulfillment_status,
    o.amount_total, o.currency, o.customer_email, o.customer_name,
    o.shipping_required, o.shipping_address, o.line_items,
    o.tracking_carrier, o.tracking_number, o.tracking_url,
    coalesce(s.shipping_notes, o.shipping_notes) as shipping_notes,
    o.paid_at, o.fulfilled_at, o.shipped_at, o.created_at,
    coalesce(bl.business_name, p.business_name)              as stylist_business_name,
    bl.logo_url                                              as stylist_logo_url,
    coalesce(p.public_slug, bl.slug)                         as stylist_handle
  from public.product_orders o
  left join public.shop_settings s on s.user_id = o.user_id
  left join public.profiles p on p.id = o.user_id
  left join lateral (
    select bl.* from public.booking_links bl
    where bl.user_id = o.user_id and bl.active = true
    order by bl.created_at asc limit 1
  ) bl on true
  where o.customer_token = token_in
  limit 1;
end $$;

revoke all on function public.public_get_order(text) from public;
grant execute on function public.public_get_order(text) to anon, authenticated, service_role;

create or replace view public.v_retail_analytics as
select
  o.user_id,
  count(*) filter (where o.status = 'paid')                            as orders_paid,
  count(*) filter (where o.fulfillment_status = 'refunded')            as orders_refunded,
  sum(case when o.status = 'paid' then o.amount_total else 0 end)      as gross_revenue,
  avg(case when o.status = 'paid' then o.amount_total else null end)   as avg_order_value,
  min(o.created_at) as first_order_at,
  max(o.created_at) as last_order_at
from public.product_orders o
group by o.user_id;

grant select on public.v_retail_analytics to authenticated;

create or replace view public.v_retail_top_products as
select
  o.user_id,
  (li->>'product_id')::uuid                                 as product_id,
  li->>'title'                                              as title,
  sum(coalesce((li->>'quantity')::int, 1))                  as units_sold,
  sum(coalesce((li->>'quantity')::int, 1) * coalesce((li->>'unit_amount')::numeric, 0)) as revenue
from public.product_orders o
cross join lateral jsonb_array_elements(coalesce(o.line_items, '[]'::jsonb)) li
where o.status = 'paid'
group by o.user_id, (li->>'product_id')::uuid, li->>'title';

grant select on public.v_retail_top_products to authenticated;

notify pgrst, 'reload schema';
