-- Storage hardening: stop cross-tenant file ENUMERATION on the public
-- buckets.
--
-- All five buckets below are public = true, so their objects are served
-- by the public CDN URL (/storage/v1/object/public/...) WITHOUT any RLS
-- SELECT policy. The broad "<bucket>_public_read" policies
-- (USING (bucket_id = '<bucket>'), no role restriction) add nothing for
-- that display path — but they DO let any anon caller run
-- storage.objects SELECT / `.list()` and enumerate every object path
-- across all stylists, then download them. For `support-screenshots`
-- that means enumerating support-ticket screenshots that can contain
-- client PII; for the others it's cross-tenant listing of files that are
-- only meant to be reached by their known URL.
--
-- Dropping the listing policies removes the enumeration vector. Verified
-- non-breaking: the app only ever reaches these buckets via getPublicUrl
-- (public CDN) and uploads (INSERT policy) — it never calls .list() or
-- the authenticated .download() on them, and the service role (server
-- routes / edge functions) bypasses RLS entirely.
--
-- NOTE: a stronger follow-up for `support-screenshots` specifically is to
-- make the bucket private and serve via signed URLs, since public-by-URL
-- is still path-readable. That requires an app change (persisting a
-- re-signable reference instead of a public URL) and is intentionally NOT
-- bundled here to avoid breaking the support flow.

drop policy if exists "booking_gallery_public_read" on storage.objects;
drop policy if exists "booking_logos_public_read" on storage.objects;
drop policy if exists "product_images_public_read" on storage.objects;
drop policy if exists "style_request_photos_public_read" on storage.objects;
drop policy if exists "support_screenshots_public_read" on storage.objects;
