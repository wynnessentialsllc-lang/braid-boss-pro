-- Supports the booking-request edge function's anti-abuse rate check,
-- which counts recent rows for a booking link:
--   select count(*) from booking_requests
--   where link_slug = $1 and created_at >= now() - interval '60 seconds'
--
-- booking_requests had no index on link_slug (only user_id-leading
-- indexes), so that count would scan. A (link_slug, created_at) btree
-- makes it an index range scan. Pure additive, no behavior change.

create index if not exists idx_booking_requests_link_slug_created_at
  on public.booking_requests (link_slug, created_at);
