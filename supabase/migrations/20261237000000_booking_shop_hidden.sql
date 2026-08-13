-- Let a braider hide the Shop from their public pages.
--
-- The storefront nav has always rendered a Shop tab for everyone, and
-- a braider who sells nothing gets a tab that leads to "Shop coming
-- soon" — an empty room with a sign on the door. Plenty of braiders
-- only take bookings and never intend to sell product, so this is a
-- dead end they can't remove.
--
-- One flag on the booking link, set from Customize booking page. When
-- it's on, the Shop tab disappears from the booking page and every
-- storefront page, and /@handle/shop bounces to the booking page so an
-- old shared link doesn't land on a dead end either.
--
-- Default false, so every existing storefront keeps its Shop tab and
-- nothing changes until a braider opts out. The column is read by the
-- public storefront through the same anon SELECT on booking_links that
-- already serves shop_name / shop_description (20260911, 20260913), so
-- no RPC signature changes and no new grants.

alter table public.booking_links
  add column if not exists shop_hidden boolean not null default false;

comment on column public.booking_links.shop_hidden is
  'When true the public Shop tab is hidden and /@handle/shop redirects to the booking page. Set from Customize booking page.';

notify pgrst, 'reload schema';
