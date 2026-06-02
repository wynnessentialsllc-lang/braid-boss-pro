-- Per-variation inventory tracking.
--
-- An inventory item can carry color/size variations (stored in the
-- data jsonb blob as data->'variations': an array of
-- { id, name, quantityOnHand, lowStockThreshold? } objects). When a
-- movement targets a specific variation, we decrement/increment that
-- variation's count inside the jsonb and keep the item's
-- quantity_on_hand column as the SUM of its variations so every
-- existing item-level reader (totals, low-stock, value) stays correct.
--
-- inventory_apply_movement gains a trailing variation_id_in argument.
-- When null it behaves exactly as before (item-level pool). The arg
-- list changes, so we drop the old 9-arg function and recreate it
-- (create or replace can't add a parameter), then re-grant.
--
-- The ledger gains a nullable variation_id so per-color history is
-- attributable. The service-role admin twin is left untouched —
-- storefront sales decrement at the item level only.

alter table public.inventory_movements
  add column if not exists variation_id text;

drop function if exists public.inventory_apply_movement(
  text, text, numeric, text, text, uuid, text, numeric, text
);

create function public.inventory_apply_movement(
  movement_id_in text,
  item_id_in text,
  delta_in numeric,
  reason_in text,
  appointment_id_in text default null,
  storefront_order_id_in uuid default null,
  business_expense_id_in text default null,
  unit_cost_snapshot_in numeric default null,
  note_in text default null,
  variation_id_in text default null
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
  v_data jsonb;
  v_item_threshold numeric;
  v_found boolean := false;
  v_sum numeric := 0;
  v_new_variations jsonb := '[]'::jsonb;
  elem jsonb;
begin
  if caller is null then
    raise exception 'inventory_apply_movement: not authenticated';
  end if;
  if delta_in is null or delta_in = 0 then
    raise exception 'inventory_apply_movement: delta must be non-zero';
  end if;

  if variation_id_in is null then
    -- Item-level pool (no variations). Lock the row so two concurrent
    -- movements can't both observe the same starting quantity.
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
  else
    -- Variation-level. Lock the item, walk its variations, bump the
    -- matching one, and rebuild quantity_on_hand as the new sum.
    select data, low_stock_threshold
      into v_data, v_item_threshold
      from public.inventory_items
     where user_id = caller
       and id = item_id_in
       for update;

    if not found then
      raise exception 'inventory_apply_movement: item % not found for user %', item_id_in, caller;
    end if;

    for elem in
      select * from jsonb_array_elements(coalesce(v_data->'variations', '[]'::jsonb))
    loop
      if (elem->>'id') = variation_id_in then
        v_found := true;
        v_quantity := coalesce((elem->>'quantityOnHand')::numeric, 0) + delta_in;
        elem := jsonb_set(elem, '{quantityOnHand}', to_jsonb(v_quantity));
        v_threshold := coalesce(
          nullif(elem->>'lowStockThreshold', '')::numeric,
          v_item_threshold
        );
      end if;
      v_sum := v_sum + coalesce((elem->>'quantityOnHand')::numeric, 0);
      v_new_variations := v_new_variations || elem;
    end loop;

    if not v_found then
      raise exception 'inventory_apply_movement: variation % not found on item %', variation_id_in, item_id_in;
    end if;

    update public.inventory_items
       set data = jsonb_set(coalesce(data, '{}'::jsonb), '{variations}', v_new_variations),
           quantity_on_hand = v_sum,
           updated_at = now()
     where user_id = caller
       and id = item_id_in;
  end if;

  insert into public.inventory_movements (
    user_id, id, item_id, delta, reason,
    appointment_id, storefront_order_id, business_expense_id,
    unit_cost_snapshot, note, variation_id
  ) values (
    caller, movement_id_in, item_id_in, delta_in, reason_in,
    appointment_id_in, storefront_order_id_in, business_expense_id_in,
    unit_cost_snapshot_in, note_in, variation_id_in
  );

  return query select item_id_in, v_quantity, v_quantity <= v_threshold;
end;
$$;

revoke all on function public.inventory_apply_movement(
  text, text, numeric, text, text, uuid, text, numeric, text, text
) from public;
grant execute on function public.inventory_apply_movement(
  text, text, numeric, text, text, uuid, text, numeric, text, text
) to authenticated;
