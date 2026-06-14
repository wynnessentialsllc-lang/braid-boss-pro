-- Inventory reservation during checkout (Phase B6).
--
-- Today: two buyers checking out simultaneously for the last-in-stock item
-- can both succeed. /api/product-checkout reads inventory_count, both reads
-- show 1, both Stripe Sessions get created, both pay, both webhooks decrement
-- → inventory goes 1 → 0 → −1 (or the second decrement errors and the
-- order ships incorrectly). The decrement only happens at webhook time,
-- not at checkout-start, so the "read" leg of the check-then-write is
-- non-atomic across requests.
--
-- Fix: a real reservations table + an atomic SQL function that takes a
-- pg_advisory_xact_lock keyed on (user_id, product_id, variant_id) so only
-- one reserve call at a time per SKU. Inside the lock it computes
-- available = inventory_count − sum(active reservations) and inserts the
-- new reservation row when there's room. Reservations expire after a TTL
-- (default 30 min — long enough for a real buyer to finish Stripe Checkout,
-- short enough that abandoned sessions free up stock quickly).
--
-- The webhook flow (mark_product_order_paid) keeps doing the real decrement.
-- When an order gets paid, its reservation can be deleted (or just left to
-- expire — the active-reservation filter ignores expired rows).

create table if not exists public.inventory_reservations (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null,
  product_id  uuid        not null references public.products(id) on delete cascade,
  variant_id  text,
  quantity    integer     not null check (quantity > 0),
  order_id    uuid        references public.product_orders(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

-- Lookup index — only the "active" rows matter for the availability sum.
-- Partial index on the unfiltered expires_at would require IMMUTABLE
-- expressions; plain index is enough at our row count.
create index if not exists inventory_reservations_active_idx
  on public.inventory_reservations (user_id, product_id, variant_id, expires_at);

-- Service-role only. The reservation table is internal plumbing — nothing
-- the buyer or even the stylist directly reads. /api/product-checkout
-- writes through the SECURITY DEFINER RPC below.
alter table public.inventory_reservations enable row level security;
-- No policies = no access from anon / authenticated. Service role bypasses RLS.

-- Reserve qty for an (user, product, variant). Returns true when reserved
-- and stamps a row; returns false when stock is insufficient.
--
-- Locking: pg_advisory_xact_lock over a stable hash of (user_id::text,
-- product_id::text, coalesce(variant_id, '')). Two callers racing for the
-- same SKU serialize cleanly; concurrent reserves on different SKUs run in
-- parallel.
--
-- Availability math:
--   inventory_ceiling = variant.inventory_count when a variant_id is given
--                       (read from products.variants jsonb), else
--                       products.inventory_count.
--   reserved          = sum(active reservations.quantity for the same SKU,
--                            excluding the same order_id so a retry of the
--                            same checkout doesn't double-count its own
--                            previous reservation).
--   available         = inventory_ceiling - reserved
--
-- NULL ceiling = untracked inventory; we always allow the reservation.
create or replace function public.reserve_inventory_for_order(
  p_user_id    uuid,
  p_product_id uuid,
  p_variant_id text,
  p_quantity   integer,
  p_order_id   uuid,
  p_ttl_seconds integer default 1800
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key bigint;
  v_inventory_count integer;
  v_reserved integer;
  v_now timestamptz := now();
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;
  -- Lock a hash of the SKU tuple. abs() so we don't overflow to a negative
  -- bigint (advisory locks accept signed bigints either way; positive is
  -- conventional).
  v_lock_key := abs(
    ('x' || substr(md5(p_user_id::text || ':' || p_product_id::text || ':' || coalesce(p_variant_id, '')), 1, 16))::bit(64)::bigint
  );
  perform pg_advisory_xact_lock(v_lock_key);

  -- Resolve the inventory ceiling. Variant id present → look in the
  -- variants jsonb for a matching id; missing → product-level. NULL count
  -- = untracked = always available.
  if p_variant_id is not null and p_variant_id <> '' then
    select (v->>'inventory_count')::integer into v_inventory_count
    from public.products p,
         jsonb_array_elements(coalesce(p.variants, '[]'::jsonb)) v
    where p.id = p_product_id
      and v->>'id' = p_variant_id
    limit 1;
  else
    select inventory_count into v_inventory_count
    from public.products
    where id = p_product_id;
  end if;

  -- Untracked inventory → always allow. The row is still recorded so
  -- future reservations can see the volume, but no ceiling check applies.
  if v_inventory_count is null then
    insert into public.inventory_reservations (user_id, product_id, variant_id, quantity, order_id, expires_at)
    values (p_user_id, p_product_id, p_variant_id, p_quantity, p_order_id, v_now + (p_ttl_seconds || ' seconds')::interval);
    return true;
  end if;

  -- Sum live reservations for the same SKU, excluding the current order
  -- (so a stylist re-running a checkout for the same order doesn't
  -- double-count their own row).
  select coalesce(sum(quantity), 0) into v_reserved
  from public.inventory_reservations
  where user_id = p_user_id
    and product_id = p_product_id
    and coalesce(variant_id, '') = coalesce(p_variant_id, '')
    and expires_at > v_now
    and (order_id is null or order_id <> p_order_id);

  if v_inventory_count - v_reserved < p_quantity then
    return false;
  end if;

  insert into public.inventory_reservations (user_id, product_id, variant_id, quantity, order_id, expires_at)
  values (p_user_id, p_product_id, p_variant_id, p_quantity, p_order_id, v_now + (p_ttl_seconds || ' seconds')::interval);

  return true;
end $$;

revoke all on function public.reserve_inventory_for_order(uuid, uuid, text, integer, uuid, integer) from public;
grant execute on function public.reserve_inventory_for_order(uuid, uuid, text, integer, uuid, integer) to service_role;

-- Release reservations for an order — called when the order is canceled
-- before payment so the held units free up immediately instead of waiting
-- for the TTL. Service-role only.
create or replace function public.release_inventory_for_order(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from public.inventory_reservations where order_id = p_order_id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.release_inventory_for_order(uuid) from public;
grant execute on function public.release_inventory_for_order(uuid) to service_role;

notify pgrst, 'reload schema';
