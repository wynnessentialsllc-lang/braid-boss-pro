-- Shippo / live carrier rates, phase 3a foundation (config only).
--
-- Stylists choose their shipping_mode (already on shop_settings): 'flat' keeps
-- the existing self-set rate; 'carrier' uses live Shippo rates. This adds the
-- configuration a carrier quote needs: the stylist's Shippo API token, a
-- default parcel size, and a per-product shipping weight. The rate-shopping
-- call + checkout flow build on this next.
--
-- Security: shippo_api_token is a per-stylist secret. shop_settings is
-- owner-only (RLS) and the public fulfillment RPC never selects it, so it's
-- only ever read server-side via the service role. (A future hardening pass
-- could move it to a dedicated secrets store / encrypt at rest.)

alter table public.shop_settings
  add column if not exists shippo_api_token     text,
  add column if not exists ship_parcel_length_in numeric(6, 2),
  add column if not exists ship_parcel_width_in  numeric(6, 2),
  add column if not exists ship_parcel_height_in numeric(6, 2);

alter table public.products
  add column if not exists weight_oz numeric(8, 2);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_weight_oz_nonneg_chk'
  ) then
    alter table public.products
      add constraint products_weight_oz_nonneg_chk
        check (weight_oz is null or weight_oz >= 0);
  end if;
end $$;

notify pgrst, 'reload schema';
