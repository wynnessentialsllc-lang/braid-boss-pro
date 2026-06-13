-- Storefront fulfillment, phase 1: shipping / delivery / pickup.
--
-- The shop checkout currently charges no shipping and offers no fulfillment
-- choice — products' requires_shipping / local_pickup_available are purely
-- informational. This adds an opt-in, per-shop fulfillment model:
--
--   • Pickup  — free.
--   • Delivery — no shipping, an optional flat delivery fee.
--   • Shipping — a flat rate, optionally free over a subtotal threshold.
--
-- Everything is gated and defaults OFF, so a shop that configures nothing
-- checks out exactly as before. shipping_mode is 'flat' today; a future
-- 'carrier' mode (live Shippo rates) can slot in without a schema change.

-- ---- Shop-level fulfillment config -------------------------------
alter table public.shop_settings
  add column if not exists pickup_enabled          boolean not null default false,
  add column if not exists delivery_enabled        boolean not null default false,
  add column if not exists shipping_enabled        boolean not null default false,
  add column if not exists shipping_mode           text    not null default 'flat',
  add column if not exists shipping_flat_rate      numeric(10, 2),
  add column if not exists shipping_free_threshold numeric(10, 2),
  add column if not exists delivery_fee            numeric(10, 2);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shop_settings_shipping_mode_chk'
  ) then
    alter table public.shop_settings
      add constraint shop_settings_shipping_mode_chk
        check (shipping_mode in ('flat', 'carrier'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'shop_settings_fee_nonneg_chk'
  ) then
    alter table public.shop_settings
      add constraint shop_settings_fee_nonneg_chk check (
        (shipping_flat_rate      is null or shipping_flat_rate      >= 0) and
        (shipping_free_threshold is null or shipping_free_threshold >= 0) and
        (delivery_fee            is null or delivery_fee            >= 0)
      );
  end if;
end $$;

-- ---- Per-order fulfillment breakdown -----------------------------
alter table public.product_orders
  add column if not exists fulfillment_method text,
  add column if not exists subtotal           numeric(10, 2),
  add column if not exists shipping_cost       numeric(10, 2);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'product_orders_fulfillment_method_chk'
  ) then
    alter table public.product_orders
      add constraint product_orders_fulfillment_method_chk
        check (fulfillment_method is null
               or fulfillment_method in ('shipping', 'delivery', 'pickup'));
  end if;
end $$;

-- ---- Public RPC: a shop's enabled fulfillment options ------------
-- The storefront buyer UI reads this to render the Shipping / Delivery /
-- Pickup choice and its fees. shop_settings itself stays owner-only (no
-- public read); this RPC exposes ONLY the non-sensitive fulfillment config.
create or replace function public.public_get_shop_fulfillment(slug_in text)
returns table (
  pickup_enabled          boolean,
  delivery_enabled        boolean,
  shipping_enabled        boolean,
  shipping_mode           text,
  shipping_flat_rate      numeric,
  shipping_free_threshold numeric,
  delivery_fee            numeric,
  pickup_instructions     text
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
      s.pickup_instructions
    from public.shop_settings s
    where s.user_id = resolved.user_id
    limit 1;
end $$;

revoke all on function public.public_get_shop_fulfillment(text) from public;
grant execute on function public.public_get_shop_fulfillment(text) to anon, authenticated;

notify pgrst, 'reload schema';
