-- SECURITY: stop anon reading stylists' home addresses.
--
-- booking_links_anon_select grants `using (active = true)` to anon, and
-- anon held SELECT on all 42 columns. So this, with nothing but the
-- public anon key that ships in every browser bundle, returned every
-- active stylist on the platform:
--
--   select mobile_base_address, mobile_base_lat, mobile_base_lng, phone
--     from booking_links where active = true;
--
-- mobile_base_address is the travel base. For a mobile braider that is
-- usually her home. Coordinates and phone came with it, and user_id
-- allowed correlating rows across other anon-readable tables. No
-- booking link needed, no rate limit to defeat -- one request, every
-- stylist.
--
-- The irony is that the careful path already existed:
-- public_get_mobile_config was written as SECURITY DEFINER precisely so
-- the travel base could be served "without granting select on
-- booking_links to anon" (its own migration comment). That reasoning
-- was right. This policy quietly granted what the function was built to
-- avoid, and the two were never reconciled.
--
-- Fix: RLS decides which ROWS are visible; column grants decide which
-- FIELDS. The row rule was never the problem, so it stays. What changes
-- is that anon now holds SELECT on an explicit allow-list of public
-- branding columns instead of the whole table.
--
-- An allow-list rather than revoking the sensitive few on purpose: a
-- deny-list silently exposes whatever column gets added next, which is
-- exactly how this happened. Anything not named below is invisible to
-- anon and must be served through a SECURITY DEFINER RPC that takes a
-- slug -- per-stylist lookup, never enumeration.
--
-- Nothing here touches authenticated or service_role. Stylists keep
-- full access to their own row through the existing owner policies, and
-- every server route runs as service_role.

-- Clear the blanket table-level grant. Column grants below replace it.
revoke select on public.booking_links from anon;

-- Public branding only. Verified against every direct anon read:
--   app/book/[slug]/page.tsx        -> shop_hidden
--   app/u/[handle]/...              -> shop_*, business_city/state,
--                                      socials, years_in_business
--   app/lib/storefront-meta.ts      -> shop_name/description/logo, banner
-- The booking page's remaining fields (business_name, phone, hours,
-- services, policies, intro) come from public_resolve_booking_slug,
-- which is SECURITY DEFINER and so is unaffected by column grants --
-- it keeps serving them, but only one slug at a time.
grant select (
  slug,
  active,
  business_name,
  tagline,
  about,
  intro,
  logo_url,
  banner_image_url,
  stylist_photo_url,
  gallery_photos,
  accent,
  accent_color,
  header_theme,
  location_text,
  business_city,
  business_state,
  years_in_business,
  instagram_url,
  tiktok_url,
  website_url,
  google_review_url,
  shop_name,
  shop_description,
  shop_logo_url,
  shop_banner_url,
  shop_hidden,
  marketplace_enabled,
  marketplace_hidden
) on public.booking_links to anon;

-- Deliberately NOT granted, and why:
--
--   mobile_base_address   the stylist's home. The whole point.
--   mobile_base_lat/lng   same location, precise enough to drive to.
--   mobile_base_zip
--   mobile_blocked_zips   reveals where she refuses to travel.
--   mobile_radius_miles   travel config; public_get_mobile_config
--                         serves all of the above per slug.
--   phone                 still shown on the booking page via the
--                         resolver. Withheld here so it cannot be
--                         harvested across every stylist at once.
--   user_id               internal id; joins a stylist to rows in
--                         other anon-readable tables.
--   hours, services,
--   policies, intake_form served by their own public_* RPCs.
--   created_at/updated_at no public use.

-- Verification -- as anon, this must now fail with "permission denied
-- for column mobile_base_address":
--   set local role anon;
--   select mobile_base_address from public.booking_links;
--
-- And this must still return the storefront:
--   set local role anon;
--   select slug, shop_name, business_city from public.booking_links
--    where active = true;
