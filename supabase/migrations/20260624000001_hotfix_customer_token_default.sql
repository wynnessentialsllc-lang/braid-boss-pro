-- Hotfix: the Phase 2 migration set product_orders.customer_token
-- to NOT NULL but didn't add a column DEFAULT. The legacy
-- /api/product-checkout route inserts orders without supplying the
-- token, so checkout 500'd with:
--   null value in column "customer_token" of relation
--   "product_orders" violates not-null constraint
--
-- Default to a base36 uuid (dashes stripped) so every insert
-- auto-fills the column. customer_token is a non-secret share
-- handle for the public order-tracking page; the unique index
-- already on the column guarantees no two orders collide.

alter table public.product_orders
  alter column customer_token
  set default lower(replace(gen_random_uuid()::text, '-', ''));

notify pgrst, 'reload schema';
