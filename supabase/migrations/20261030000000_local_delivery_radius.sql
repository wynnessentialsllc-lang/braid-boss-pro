-- Local delivery, radius enforcement. Stylists set a max delivery radius
-- (miles) from their business/pickup address; buyers entering a delivery ZIP
-- outside that radius can't choose local delivery. We cache the geocoded
-- origin (lat/lng) so the distance check doesn't re-geocode the shop address
-- on every request. A null radius means "no limit" (legacy behavior).

alter table public.shop_settings
  add column if not exists delivery_radius_miles numeric(6, 1),
  add column if not exists delivery_origin_lat   double precision,
  add column if not exists delivery_origin_lng   double precision;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shop_settings_delivery_radius_chk'
  ) then
    alter table public.shop_settings
      add constraint shop_settings_delivery_radius_chk
        check (delivery_radius_miles is null or delivery_radius_miles >= 0);
  end if;
end $$;

-- Widen the public fulfillment RPC with the delivery radius so the storefront
-- knows when local delivery needs a ZIP check. Origin coords stay private
-- (the distance check happens server-side).
drop function if exists public.public_get_shop_fulfillment(text);

create or replace function public.public_get_shop_fulfillment(slug_in text)
returns table (
  pickup_enabled          boolean,
  delivery_enabled        boolean,
  shipping_enabled        boolean,
  shipping_mode           text,
  shipping_flat_rate      numeric,
  shipping_free_threshold numeric,
  delivery_fee            numeric,
  pickup_instructions     text,
  delivery_radius_miles   numeric
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
      coalesce(s.pickup_enabled, false),
      coalesce(s.delivery_enabled, false),
      coalesce(s.shipping_enabled, false),
      coalesce(s.shipping_mode, 'flat'),
      s.shipping_flat_rate,
      s.shipping_free_threshold,
      s.delivery_fee,
      s.pickup_instructions,
      s.delivery_radius_miles
    from public.shop_settings s
    where s.user_id = resolved.user_id
    limit 1;
end $$;

revoke all on function public.public_get_shop_fulfillment(text) from public;
grant execute on function public.public_get_shop_fulfillment(text) to anon, authenticated;

notify pgrst, 'reload schema';
