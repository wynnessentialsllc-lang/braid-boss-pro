-- Shop description — a short line under the shop name on the public
-- storefront describing what the stylist sells (e.g. "Hair bundles,
-- edge control & growth oils").
--
-- Companion to 20260911 (shop_name) and 20260912 (shop branding). This
-- fills the spot under the shop name where the @handle used to sit —
-- on a shop that carries its own brand, a product description reads
-- better than the stylist's personal booking handle.
--
-- Nullable with no default. Storefront-only; the booking page is
-- unaffected. When blank the shop simply renders no description line.
alter table public.booking_links
  add column if not exists shop_description text;
