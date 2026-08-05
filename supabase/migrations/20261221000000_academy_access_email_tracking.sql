-- Track delivery of the Academy access email so it can be retried.
--
-- The class/video webhooks email the buyer their access (watch link /
-- class details) right after payment. That send is fail-soft — a Resend
-- hiccup, an unverified sender, or (until just now) a webhook that
-- crashed before reaching the email step means the buyer silently gets
-- nothing. Because the tokenised /watch link is the ONLY way back to a
-- purchased video, a single missed email locks the buyer out.
--
-- Add a nullable timestamp that is stamped once the access email is
-- accepted by Resend. The reconcile sweep resends any paid purchase whose
-- stamp is still null, so delivery becomes eventually-guaranteed instead
-- of best-effort-once.

alter table public.video_purchases
  add column if not exists access_email_sent_at timestamptz;

alter table public.class_registrations
  add column if not exists access_email_sent_at timestamptz;

-- Partial indexes so the sweep's "paid but not yet emailed" scan stays
-- cheap as the tables grow.
create index if not exists video_purchases_email_pending_idx
  on public.video_purchases (created_at)
  where access_email_sent_at is null;

create index if not exists class_registrations_email_pending_idx
  on public.class_registrations (created_at)
  where access_email_sent_at is null;
