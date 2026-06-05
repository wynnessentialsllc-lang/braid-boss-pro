-- Optional shop-specific branding: banner + logo overrides.
--
-- Companion to 20260911 (shop_name). The storefront (/@handle/shop and
-- product pages) reused booking_links.banner_image_url and logo_url —
-- the same hero image + logo as the booking page. Some stylists want
-- their shop to carry its own brand (e.g. a product-line banner and
-- store logo) distinct from their personal booking page.
--
-- These two optional overrides are used ONLY by the storefront. Each
-- falls back to its booking-page counterpart when NULL, so every
-- existing shop is unchanged:
--
--   * shop_banner_url → wide hero image on the shop. Falls back to
--                       banner_image_url.
--   * shop_logo_url   → logo on the shop. Falls back to logo_url.
--
-- Both nullable with no default. The images live in the same
-- "booking-logos" storage bucket under the user's folder
-- (shop-banner.jpg / shop-logo.jpg), so no new bucket or storage
-- policy is required.
alter table public.booking_links
  add column if not exists shop_banner_url text,
  add column if not exists shop_logo_url text;
