-- Service-role variant of inventory_apply_movement.
--
-- The auth-scoped function in 20260715 reads auth.uid() so it can
-- only be called by signed-in stylists. Server-side surfaces with no
-- auth context — currently the storefront-order webhook — need the
-- same atomic update + ledger insert, but scoped to an explicit
-- user_id passed in.
--
-- Only the service role may execute this; we don't grant it to
-- authenticated, anon, or public.

create or replace function public.inventory_apply_movement_admin(
  user_id_in uuid,
  movement_id_in text,
  item_id_in text,
  delta_in numeric,
  reason_in text,
  appointment_id_in text default null,
  storefront_order_id_in uuid default null,
  business_expense_id_in text default null,
  unit_cost_snapshot_in numeric default null,
  note_in text default null
)
returns table (item_id text, quantity_on_hand numeric, low_stock boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quantity numeric;
  v_threshold numeric;
begin
  if user_id_in is null then
    raise exception 'inventory_apply_movement_admin: user_id is required';
  end if;
  if delta_in is null or delta_in = 0 then
    raise exception 'inventory_apply_movement_admin: delta must be non-zero';
  end if;

  update public.inventory_items
     set quantity_on_hand = quantity_on_hand + delta_in,
         updated_at = now()
   where user_id = user_id_in
     and id = item_id_in
   returning quantity_on_hand, low_stock_threshold
        into v_quantity, v_threshold;

  if not found then
    raise exception 'inventory_apply_movement_admin: item % not found for user %', item_id_in, user_id_in;
  end if;

  insert into public.inventory_movements (
    user_id, id, item_id, delta, reason,
    appointment_id, storefront_order_id, business_expense_id,
    unit_cost_snapshot, note
  ) values (
    user_id_in, movement_id_in, item_id_in, delta_in, reason_in,
    appointment_id_in, storefront_order_id_in, business_expense_id_in,
    unit_cost_snapshot_in, note_in
  );

  return query select item_id_in, v_quantity, v_quantity <= v_threshold;
end;
$$;

revoke all on function public.inventory_apply_movement_admin(
  uuid, text, text, numeric, text, text, uuid, text, numeric, text
) from public;
revoke all on function public.inventory_apply_movement_admin(
  uuid, text, text, numeric, text, text, uuid, text, numeric, text
) from authenticated, anon;
grant execute on function public.inventory_apply_movement_admin(
  uuid, text, text, numeric, text, text, uuid, text, numeric, text
) to service_role;
