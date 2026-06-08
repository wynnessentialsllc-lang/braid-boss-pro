-- Inventory item type — separate store stock from service supplies.
--
-- The braider keeps two distinct kinds of stock that used to share one
-- undifferentiated table:
--   - retail   → items SOLD to clients (not used on them)
--   - service  → items USED to service clients (not for sale)
--   - both     → sold AND used (e.g. an oil sold at the chair that's
--                also applied during a style)
--
-- This drives where an item can surface: only retail/both items are
-- eligible for the storefront; only service/both items appear as
-- service materials. Existing behavior treated everything as sellable,
-- so the column defaults to 'retail' and the backfill below reclassifies
-- pure supplies as 'service'.

alter table public.inventory_items
  add column if not exists item_type text not null default 'retail'
    check (item_type in ('retail', 'service', 'both'));

-- Backfill existing rows: anything already tied to a storefront product
-- or carrying a retail price is store stock ('retail'); everything else
-- is treated as a service supply ('service'). The stylist can re-tag
-- individual items afterward. Guarded so re-running the migration (or
-- running it after rows are already classified) never clobbers a value
-- the user set — only the default 'retail' rows are touched.
update public.inventory_items
   set item_type = case
     when storefront_product_id is not null or retail_price is not null then 'retail'
     else 'service'
   end
 where item_type = 'retail';

-- Filtering the inventory list by type ("For sale" / "Used on clients")
-- is a primary view, so index active rows by type.
create index if not exists inventory_items_user_type_idx
  on public.inventory_items (user_id, item_type)
  where archived_at is null;
