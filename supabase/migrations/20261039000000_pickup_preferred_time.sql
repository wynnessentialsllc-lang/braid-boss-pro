-- Pickup Level 2: buyer's preferred pickup time (Phase A4).
--
-- Optional free-text the buyer enters at checkout when fulfillment_method =
-- 'pickup'. The stylist sees it on the order detail sheet so they know e.g.
-- "I'd like to pick up Friday after 5pm" instead of having to ask.
--
-- Stored as text on product_orders. No validation beyond a sane length cap
-- (200 chars) — this is a hint, not a structured slot. Calendar / capacity
-- slot picking is Level 3, intentionally a future PR.

alter table public.product_orders
  add column if not exists pickup_preferred_time text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'product_orders_pickup_pref_time_len_chk'
  ) then
    alter table public.product_orders
      add constraint product_orders_pickup_pref_time_len_chk
        check (
          pickup_preferred_time is null
          or char_length(pickup_preferred_time) <= 200
        );
  end if;
end $$;

notify pgrst, 'reload schema';
