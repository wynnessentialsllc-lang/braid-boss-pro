-- Orders: archive + delete for abandoned carts.
--
-- Abandoned-cart rows are pre-checkout pre-inserts that never converted: the
-- /api/product-checkout route writes them so the webhook has something to
-- match against, but if the buyer closes Stripe Checkout without paying,
-- they sit there forever. The original UI offered a "Cancel order" button
-- on them which silently no-ops (mark_order_canceled flips
-- fulfillment_status but the abandoned filter is keyed on status + paid_at
-- + payment_intent + email — all unchanged by a cancel — so the row never
-- leaves the Abandoned tab). This migration adds the model + RPCs the new
-- UI needs:
--
--   • archived_at — soft-archive a row; the Abandoned tab hides archived
--     rows but the new Archived tab can recover them.
--   • archive / unarchive / delete — single-row RPCs.
--   • bulk_archive / bulk_unarchive — accept a uuid[] for multi-select.
--   • delete_abandoned_orders — accepts a uuid[] (one row, many rows, OR
--     null for "all abandoned for the caller"). The deletion guard is the
--     authoritative abandoned check: pending status, no paid_at, no
--     payment_intent. Anything else is a real order and must not be wiped.
--
-- All RPCs are owner-only (auth.uid()), security definer, return the
-- number of rows affected so the UI can show a clean "Archived 4." toast.

alter table public.product_orders
  add column if not exists archived_at timestamptz;

create index if not exists product_orders_user_archived_idx
  on public.product_orders (user_id, archived_at);

-- Single-row archive / unarchive. Idempotent via coalesce / set-null, so a
-- double-tap can't toggle the wrong direction.
create or replace function public.archive_product_order(order_id_in uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare row_user uuid;
begin
  select user_id into row_user from public.product_orders where id = order_id_in;
  if row_user is null then return false; end if;
  if row_user <> auth.uid() then raise exception 'forbidden'; end if;
  update public.product_orders
  set archived_at = coalesce(archived_at, now()),
      updated_at  = now()
  where id = order_id_in;
  return true;
end $$;

create or replace function public.unarchive_product_order(order_id_in uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare row_user uuid;
begin
  select user_id into row_user from public.product_orders where id = order_id_in;
  if row_user is null then return false; end if;
  if row_user <> auth.uid() then raise exception 'forbidden'; end if;
  update public.product_orders
  set archived_at = null,
      updated_at  = now()
  where id = order_id_in;
  return true;
end $$;

-- Bulk archive / unarchive across a set of ids. Scoped to the caller via
-- the user_id filter so a leaked id list can't touch someone else's rows.
create or replace function public.bulk_archive_product_orders(order_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  update public.product_orders
  set archived_at = coalesce(archived_at, now()),
      updated_at  = now()
  where id = any(order_ids)
    and user_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.bulk_unarchive_product_orders(order_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  update public.product_orders
  set archived_at = null,
      updated_at  = now()
  where id = any(order_ids)
    and user_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;

-- Delete abandoned orders. order_ids = null means "all abandoned rows for
-- the caller" (powers the "Delete all abandoned" action). The abandoned
-- guard is enforced server-side: pending status, no paid_at, no
-- payment_intent. A real order — even if archived — is never touched, so a
-- mis-tap can't wipe revenue.
create or replace function public.delete_abandoned_product_orders(order_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  delete from public.product_orders
  where user_id = auth.uid()
    and status = 'pending'
    and paid_at is null
    and stripe_payment_intent is null
    and (order_ids is null or id = any(order_ids));
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.archive_product_order(uuid)              from public;
revoke all on function public.unarchive_product_order(uuid)            from public;
revoke all on function public.bulk_archive_product_orders(uuid[])      from public;
revoke all on function public.bulk_unarchive_product_orders(uuid[])    from public;
revoke all on function public.delete_abandoned_product_orders(uuid[])  from public;

grant execute on function public.archive_product_order(uuid)              to authenticated;
grant execute on function public.unarchive_product_order(uuid)            to authenticated;
grant execute on function public.bulk_archive_product_orders(uuid[])      to authenticated;
grant execute on function public.bulk_unarchive_product_orders(uuid[])    to authenticated;
grant execute on function public.delete_abandoned_product_orders(uuid[])  to authenticated;

notify pgrst, 'reload schema';
