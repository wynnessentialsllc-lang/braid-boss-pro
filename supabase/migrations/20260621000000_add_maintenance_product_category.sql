-- Add 'maintenance' to the products.category check constraint so
-- stylists can tag oils / scarves / scalp-care products that
-- support their existing braid services.

alter table public.products
  drop constraint if exists products_category_check;

alter table public.products
  add constraint products_category_check check (
    category is null or category in (
      'hair_bundles', 'braiding_hair', 'oils', 'edge_control',
      'bonnets', 'accessories', 'tools', 'digital', 'maintenance', 'other'
    )
  );

notify pgrst, 'reload schema';
