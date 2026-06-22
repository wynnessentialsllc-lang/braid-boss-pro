-- Product Profit Calculator (Settings → Product Profit Calculator).
--
-- Stores one row per saved product calculation: cost inputs (bulk,
-- dilution, packaging, labor, fees) plus the chosen margin and expected
-- sales volume. The full input lives in `data jsonb` so the calculator
-- can keep adding fields (raw-ingredient %, formula costing, inventory
-- deduction, COGS reporting) without another migration — the same
-- free-form-`data` shape the rest of the app's synced tables use
-- (see business_expenses_v1, inventory_reservations).
--
-- A handful of fields are promoted to real columns purely so the saved-
-- products list and the reporting dashboard can sort/filter without
-- cracking open the jsonb. The pure math lives in lib/product-profit.ts;
-- nothing here recomputes — derived numbers are display-only and never
-- persisted.

create table if not exists public.product_profit_products (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  id          text        not null,
  name        text,
  category    text,
  archived    boolean     not null default false,
  data        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- Active products first, newest edits on top — the saved-products list order.
create index if not exists product_profit_products_user_updated_idx
  on public.product_profit_products (user_id, archived, updated_at desc);

alter table public.product_profit_products enable row level security;

drop policy if exists "product_profit_self_select" on public.product_profit_products;
create policy "product_profit_self_select" on public.product_profit_products
  for select using (auth.uid() = user_id);

drop policy if exists "product_profit_self_insert" on public.product_profit_products;
create policy "product_profit_self_insert" on public.product_profit_products
  for insert with check (auth.uid() = user_id);

drop policy if exists "product_profit_self_update" on public.product_profit_products;
create policy "product_profit_self_update" on public.product_profit_products
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "product_profit_self_delete" on public.product_profit_products;
create policy "product_profit_self_delete" on public.product_profit_products
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.product_profit_products to authenticated;

-- Keep updated_at honest on every edit so the list order reflects the
-- most recently touched product (mirrors business_expenses_touch).
create or replace function public.product_profit_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists product_profit_touch on public.product_profit_products;
create trigger product_profit_touch
  before update on public.product_profit_products
  for each row
  execute function public.product_profit_touch_updated_at();

notify pgrst, 'reload schema';
