-- Security: make the support-screenshots bucket PRIVATE.
--
-- Support-ticket screenshots routinely contain client PII visible
-- on-screen (names, phone numbers, the stylist's own dashboard). The
-- bucket was public = true, so any object was readable by its URL
-- (path = <uid>/<ts>-<rand>.<ext>). An earlier migration dropped the
-- broad listing policy (no more enumeration), but public-by-URL still
-- meant a leaked/guessed URL exposed the image. Flip the bucket to
-- private so reads require auth / a signed URL.
--
-- Verified non-breaking: nothing in the app renders screenshot_url — the
-- support team views screenshots via the Supabase dashboard (full
-- access, unaffected by the public flag). The upload path is governed by
-- the support_screenshots_owner_insert INSERT policy, which is unchanged
-- by the public flag, so stylists can still attach screenshots. New
-- reports store the object PATH (see app/lib/support.ts) instead of a
-- now-private URL.

update storage.buckets set public = false where id = 'support-screenshots';
