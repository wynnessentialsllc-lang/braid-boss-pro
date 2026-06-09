-- Tap to Pay on iPhone (Stripe Terminal): per-braider Terminal Location.
--
-- Stripe requires a Terminal Location to register a reader (including
-- the iPhone-as-reader). We create one Location per connected account
-- the first time a braider enables in-person payments, and cache its id
-- here so we don't recreate it on every session. Additive column; no
-- existing flow depends on it.

alter table public.profiles
  add column if not exists stripe_terminal_location_id text;
