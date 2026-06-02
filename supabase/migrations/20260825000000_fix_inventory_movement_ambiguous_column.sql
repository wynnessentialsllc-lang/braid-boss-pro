-- Fix: "column reference quantity_on_hand is ambiguous" when applying a
-- stock movement (restock / waste / adjustment / return).
--
-- Both inventory_apply_movement and its service-role twin declare
--   returns table (item_id text, quantity_on_hand numeric, low_stock boolean)
-- which puts an OUT variable named quantity_on_hand in scope inside the
-- function body. The UPDATE ... SET / RETURNING quantity_on_hand then can't
-- tell whether quantity_on_hand means the inventory_items column or that
-- OUT variable, so Postgres raises the ambiguity error and no stock update
-- ever lands.
--
-- We recreate both functions with the table column references qualified
-- (inventory_items.quantity_on_hand / .low_stock_threshold). The left-hand
-- side of a SET target is always the column and stays unqualified.
-- create or replace keeps existing grants intact.

create or replace function public.inventory_apply_movement(
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
  caller uuid := auth.uid();
  v_quantity numeric;
  v_threshold numeric;
begin
  if caller is null then
    raise exception 'inventory_apply_movement: not authenticated';
  end if;
  if delta_in is null or delta_in = 0 then
    raise exception 'inventory_apply_movement: delta must be non-zero';
  end if;

  -- Lock the row so two concurrent movements can't both observe the
  -- same starting quantity. Implicit ownership check via the WHERE.
  update public.inventory_items
     set quantity_on_hand = inventory_items.quantity_on_hand + delta_in,
         updated_at = now()
   where inventory_items.user_id = caller
     and inventory_items.id = item_id_in
   returning inventory_items.quantity_on_hand, inventory_items.low_stock_threshold
        into v_quantity, v_threshold;

  if not found then
    raise exception 'inventory_apply_movement: item % not found for user %', item_id_in, caller;
  end if;

  insert into public.inventory_movements (
    user_id, id, item_id, delta, reason,
    appointment_id, storefront_order_id, business_expense_id,
    unit_cost_snapshot, note
  ) values (
    caller, movement_id_in, item_id_in, delta_in, reason_in,
    appointment_id_in, storefront_order_id_in, business_expense_id_in,
    unit_cost_snapshot_in, note_in
  );

  return query select item_id_in, v_quantity, v_quantity <= v_threshold;
end;
$$;

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
     set quantity_on_hand = inventory_items.quantity_on_hand + delta_in,
         updated_at = now()
   where inventory_items.user_id = user_id_in
     and inventory_items.id = item_id_in
   returning inventory_items.quantity_on_hand, inventory_items.low_stock_threshold
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
