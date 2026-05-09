-- 20260509000000_pro_user_columns.sql
--
-- Add columns required for the Stripe one-time lifetime unlock and
-- lock them down at the column level so an authenticated user can
-- never UPDATE themselves into pro status from the client.
--
-- Threat model:
--   The frontend gate checks `profiles.is_pro_user`. Without
--   column-level revoke-and-regrant, an authenticated user could
--   issue a PostgREST PATCH on their own row and flip the boolean
--   to true (existing RLS allows UPDATE where auth.uid() = id).
--   The webhook, running as service_role, must remain the only path
--   that ever writes those columns.
--
-- Already-applied via Supabase MCP on 2026-05-09. This file commits
-- the same statements so any fresh environment lands at the same
-- state.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_pro_user                boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_customer_id         text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS upgraded_at                timestamptz;

-- Service role keeps full access (already granted in PR #39).
-- Authenticated users: revoke broad UPDATE, regrant only on the
-- columns they're allowed to change. The four pro-status columns
-- are now writable only by service_role (i.e. the Stripe webhook).
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, business_name, avatar_url, updated_at)
  ON public.profiles TO authenticated;

-- Index to look up by Stripe customer id quickly when we ever need
-- to reconcile a webhook against a known customer (e.g. the
-- customer.subscription.* events we don't use today).
CREATE INDEX IF NOT EXISTS profiles_stripe_customer_id_idx
  ON public.profiles (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
