-- Inventory V1 — single source of truth for hair, products, supplies.
--
-- The braider's reality: the same bundle of hair can be sold on the
-- storefront OR used on a client. So we keep ONE inventory_items
-- table and let two consumption paths decrement from it via a
-- movement ledger:
--   - storefront_sale  (online order ships)
--   - service_use      (used on an appointment)
--   - purchase         (restocks, also creates a business_expense)
--   - adjustment       (manual correction)
--   - waste            (broken / damaged / discarded)
--   - return           (client return, or vendor return)
--
-- Movements are append-only so quantity_on_hand at any past date is
-- reconstructible (taxes, insurance, audit). Current quantity is
-- denormalised onto inventory_items for fast reads; the RPC
-- inventory_apply_movement keeps the two in sync atomically.
--
-- Composite PK (user_id, id) + text id matches the rest of the sync
-- layer (appointments, business_expenses) so the existing
-- toCloudRow/fromCloudRow pipeline can carry it.

create table if not exists public.inventory_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null,
  sku text,
  category text,             -- "Hair / bundles" | "Products" | "Tools" | "Supplies" | …
  unit text,                 -- "bundle" | "bottle" | "each" | …
  unit_cost numeric(12, 2) not null default 0 check (unit_cost >= 0),
  retail_price numeric(12, 2) check (retail_price is null or retail_price >= 0),
  quantity_on_hand numeric(14, 3) not null default 0,
  low_stock_threshold numeric(14, 3) not null default 0 check (low_stock_threshold >= 0),
  supplier text,
  photo_path text,
  -- Optional link to a storefront product. When set, online sales
  -- decrement this inventory item via the storefront webhook.
  storefront_product_id uuid,
  archived_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists inventory_items_user_active_idx
  on public.inventory_items (user_id, archived_at) where archived_at is null;

create index if not exists inventory_items_user_low_stock_idx
  on public.inventory_items (user_id, quantity_on_hand)
  where archived_at is null;

create index if not exists inventory_items_user_storefront_idx
  on public.inventory_items (user_id, storefront_product_id)
  where storefront_product_id is not null;

alter table public.inventory_items enable row level security;

drop policy if exists "inventory_items_self_select" on public.inventory_items;
create policy "inventory_items_self_select" on public.inventory_items
  for select using (auth.uid() = user_id);

drop policy if exists "inventory_items_self_insert" on public.inventory_items;
create policy "inventory_items_self_insert" on public.inventory_items
  for insert with check (auth.uid() = user_id);

drop policy if exists "inventory_items_self_update" on public.inventory_items;
create policy "inventory_items_self_update" on public.inventory_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "inventory_items_self_delete" on public.inventory_items;
create policy "inventory_items_self_delete" on public.inventory_items
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.inventory_items to authenticated;

create or replace function public.inventory_items_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inventory_items_touch on public.inventory_items;
create trigger inventory_items_touch
  before update on public.inventory_items
  for each row
  execute function public.inventory_items_touch_updated_at();

-- ---------------------------------------------------------------
-- Movement ledger — append-only audit of every stock change.
-- ---------------------------------------------------------------

create table if not exists public.inventory_movements (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  item_id text not null,
  -- Positive for stock in (purchase, return), negative for stock out
  -- (service_use, storefront_sale, waste, adjustment-down).
  delta numeric(14, 3) not null check (delta <> 0),
  reason text not null check (reason in (
    'purchase', 'service_use', 'storefront_sale',
    'adjustment', 'waste', 'return'
  )),
  -- Optional references to attribute the movement back to the source.
  appointment_id text,
  storefront_order_id uuid,
  business_expense_id text,
  -- Snapshot of unit_cost at the time of the movement so historical
  -- cost-of-goods doesn't shift when the master unit_cost is later
  -- updated. Always set for purchases; optional for sales/uses.
  unit_cost_snapshot numeric(12, 2),
  note text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  -- Compose with the item's composite PK so a single user's
  -- movements can only ever reference their own items.
  foreign key (user_id, item_id) references public.inventory_items (user_id, id) on delete cascade
);

create index if not exists inventory_movements_user_item_idx
  on public.inventory_movements (user_id, item_id, created_at desc);

create index if not exists inventory_movements_user_appt_idx
  on public.inventory_movements (user_id, appointment_id)
  where appointment_id is not null;

create index if not exists inventory_movements_user_order_idx
  on public.inventory_movements (user_id, storefront_order_id)
  where storefront_order_id is not null;

alter table public.inventory_movements enable row level security;

drop policy if exists "inventory_movements_self_select" on public.inventory_movements;
create policy "inventory_movements_self_select" on public.inventory_movements
  for select using (auth.uid() = user_id);

drop policy if exists "inventory_movements_self_insert" on public.inventory_movements;
create policy "inventory_movements_self_insert" on public.inventory_movements
  for insert with check (auth.uid() = user_id);

-- No update / delete on movements: ledger is append-only. Mistakes
-- get corrected with a compensating 'adjustment' row.

grant select, insert on public.inventory_movements to authenticated;

-- ---------------------------------------------------------------
-- Atomic apply-movement RPC.
--
-- Why an RPC: a movement row + a quantity_on_hand update must be
-- transactional. RLS forces the caller's user_id; the function
-- runs as security definer so the SELECT FOR UPDATE on the item
-- can fire and so the FK on the movement enforces ownership.
-- ---------------------------------------------------------------

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
     set quantity_on_hand = quantity_on_hand + delta_in,
         updated_at = now()
   where user_id = caller
     and id = item_id_in
   returning quantity_on_hand, low_stock_threshold
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

revoke all on function public.inventory_apply_movement(
  text, text, numeric, text, text, uuid, text, numeric, text
) from public;
grant execute on function public.inventory_apply_movement(
  text, text, numeric, text, text, uuid, text, numeric, text
) to authenticated;

-- ---------------------------------------------------------------
-- Storefront products → inventory link.
--
-- A storefront product MAY reference an inventory_items row. When it
-- does, the storefront purchase webhook decrements the linked item.
-- Items without a link are non-stocked (digital services, dropship,
-- etc.) — the existing inventory_count column on products keeps its
-- legacy meaning for those.
-- ---------------------------------------------------------------

alter table public.products
  add column if not exists inventory_item_id text;

create index if not exists products_user_inventory_item_idx
  on public.products (user_id, inventory_item_id)
  where inventory_item_id is not null;

-- ---------------------------------------------------------------
-- Services → default materials.
--
-- Each service can declare a typical materials list: an array of
-- { inventory_item_id, quantity } entries. On appointment completion
-- the app pre-fills this list and lets the stylist confirm/edit in
-- one tap before the movements are written.
-- ---------------------------------------------------------------

alter table public.services
  add column if not exists default_materials jsonb not null default '[]'::jsonb;
