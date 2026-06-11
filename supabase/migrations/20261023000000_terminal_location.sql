-- Tap to Pay on iPhone (Stripe Terminal): per-stylist Terminal Location.
--
-- Stripe requires a Terminal Location to register a reader (including the
-- iPhone-as-reader). We provision one Location per connected account the
-- first time a stylist enables in-person payments, and cache its id here
-- so we don't list/recreate it on every charge. Additive column; no
-- existing flow depends on it.

alter table public.profiles
  add column if not exists stripe_terminal_location_id text;
