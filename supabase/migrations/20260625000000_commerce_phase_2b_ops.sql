-- Phase 2b commerce ops — adds the columns + RPCs the Orders admin
-- needs to mark ready-for-pickup, archive orders, leave internal
-- notes, and ship refunds end-to-end.

alter table public.product_orders
  add column if not exists internal_notes text,
  add column if not exists archived_at timestamptz,
  add column if not exists ready_for_pickup_at timestamptz;

alter table public.product_orders
  drop constraint if exists product_orders_fulfillment_status_check;

alter table public.product_orders
  add constraint product_orders_fulfillment_status_check check (
    fulfillment_status in ('unfulfilled','ready_for_pickup','fulfilled','shipped','refunded','canceled','partial')
  );

create or replace function public.mark_order_ready_for_pickup(order_id_in uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare row_user uuid;
begin
  select user_id into row_user from public.product_orders where id = order_id_in;
  if row_user is null then return false; end if;
  if row_user <> auth.uid() then raise exception 'forbidden'; end if;
  update public.product_orders
  set fulfillment_status = 'ready_for_pickup',
      ready_for_pickup_at = coalesce(ready_for_pickup_at, now()),
      updated_at = now()
  where id = order_id_in;
  return true;
end $$;

create or replace function public.set_order_archived(order_id_in uuid, archived_in boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare row_user uuid;
begin
  select user_id into row_user from public.product_orders where id = order_id_in;
  if row_user is null then return false; end if;
  if row_user <> auth.uid() then raise exception 'forbidden'; end if;
  update public.product_orders
  set archived_at = case when archived_in then coalesce(archived_at, now()) else null end,
      updated_at = now()
  where id = order_id_in;
  return true;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='product_orders'
      and policyname='product_orders_owner_update_notes'
  ) then
    create policy product_orders_owner_update_notes on public.product_orders
      for update to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

revoke all on function public.mark_order_ready_for_pickup(uuid) from public;
revoke all on function public.set_order_archived(uuid, boolean) from public;
grant execute on function public.mark_order_ready_for_pickup(uuid) to authenticated;
grant execute on function public.set_order_archived(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
