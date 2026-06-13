-- Storefront tax, phase 2b: compliant Stripe Tax setup for connected
-- (Express) accounts. Express stylists can't self-serve Stripe Tax in their
-- limited dashboard, so the platform configures it for them via the connected
-- account's Tax Settings + Tax Registrations APIs. This stores the business
-- (head-office) address, the states the stylist attests they're registered
-- in, whether Stripe tax settings are active, and the legal acknowledgement.
--
-- tax_enabled (added in phase 2) stays the on/off switch for *collecting* at
-- checkout, but it may only be turned on once tax_settings_active is true and
-- at least one registered state exists — enforced in the setup API + UI.

alter table public.shop_settings
  add column if not exists tax_business_line1       text,
  add column if not exists tax_business_line2       text,
  add column if not exists tax_business_city        text,
  add column if not exists tax_business_state       text,
  add column if not exists tax_business_postal_code text,
  add column if not exists tax_registered_states    jsonb not null default '[]'::jsonb,
  add column if not exists tax_settings_active      boolean not null default false,
  add column if not exists tax_legal_acknowledged_at timestamptz;

notify pgrst, 'reload schema';
