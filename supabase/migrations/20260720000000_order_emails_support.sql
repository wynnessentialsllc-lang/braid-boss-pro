-- Order emails support — pickup address fields + ready-for-pickup RPC.
--
-- The three emails (order_confirmation, order_ready_for_pickup,
-- order_shipped) live in the existing notification queue, so the
-- only DB work here is:
--   1. Structured pickup-address columns on shop_settings (line1,
--      line2, city, state, postal_code). The pre-existing
--      pickup_instructions text column stays as a separate
--      free-text field for things like "Use the side door" / "Ring
--      the buzzer for 2B" — that's intentionally orthogonal to the
--      address.
--   2. mark_order_ready_for_pickup RPC mirroring the existing
--      mark_order_shipped / mark_order_fulfilled shape (security
--      definer + auth.uid() ownership check).

alter table public.shop_settings
  add column if not exists pickup_address_line1 text,
  add column if not exists pickup_address_line2 text,
  add column if not exists pickup_city          text,
  add column if not exists pickup_state         text,
  add column if not exists pickup_postal_code   text;

-- mark_order_ready_for_pickup: transitions the fulfillment status
-- to 'ready_for_pickup' and stamps ready_for_pickup_at. Idempotent
-- — stamps timestamp only on first transition (uses coalesce).
create or replace function public.mark_order_ready_for_pickup(order_id_in uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare row_user uuid;
begin
  select user_id into row_user from public.product_orders where id = order_id_in;
  if row_user is null then return false; end if;
  if row_user <> auth.uid() then raise exception 'forbidden'; end if;
  update public.product_orders
  set fulfillment_status     = 'ready_for_pickup',
      ready_for_pickup_at    = coalesce(ready_for_pickup_at, now()),
      updated_at             = now()
  where id = order_id_in;
  return true;
end $$;

revoke all on function public.mark_order_ready_for_pickup(uuid) from public;
grant execute on function public.mark_order_ready_for_pickup(uuid) to authenticated;
