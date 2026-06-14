-- Pickup ETA on the storefront.
--
-- Stylists already configure turnaround_days_min / _max on shop_settings; up
-- to now those numbers were only used in the "ready for pickup" email
-- template. The buyer at checkout saw "Pickup — Free" with no sense of how
-- long they'd wait. This widens public_get_shop_fulfillment to include them
-- so the cart + product page can render "Pickup • Usually ready in 1–3
-- days" right under the radio button.
--
-- Same drop-then-recreate dance every other RPC widening uses (returns-table
-- signature changes require a drop first).

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
  delivery_radius_miles   numeric,
  turnaround_days_min     integer,
  turnaround_days_max     integer
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
      s.delivery_radius_miles,
      s.turnaround_days_min,
      s.turnaround_days_max
    from public.shop_settings s
    where s.user_id = resolved.user_id
    limit 1;
end $$;

revoke all on function public.public_get_shop_fulfillment(text) from public;
grant execute on function public.public_get_shop_fulfillment(text) to anon, authenticated;

notify pgrst, 'reload schema';
