-- No-show protection.
--
-- Card-on-file no-show fees. The deposit checkout now saves the card
-- (setup_future_usage=off_session, customer_creation=always) on the
-- connected account; the deposit webhook stores the resulting customer
-- + payment method here. When a stylist marks an appointment no-show
-- they can charge a configurable fee off-session to that saved card via
-- /api/no-show-charge.
--
--   booking_requests:
--     stripe_customer_id            — connected-account Customer id
--     stripe_payment_method_id      — saved card (off-session reusable)
--     nshow_card_brand / nshow_card_last4 — display only
--     no_show_fee_amount            — $ charged (once)
--     no_show_fee_charged_at        — when (null = not charged)
--     no_show_fee_payment_intent_id — the off-session PI
--   booking_policies:
--     no_show_fee_enabled / no_show_fee_type ('flat'|'percent') / no_show_fee_value

alter table public.booking_requests
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_payment_method_id text,
  add column if not exists nshow_card_brand text,
  add column if not exists nshow_card_last4 text,
  add column if not exists no_show_fee_amount numeric,
  add column if not exists no_show_fee_charged_at timestamptz,
  add column if not exists no_show_fee_payment_intent_id text;

alter table public.booking_policies
  add column if not exists no_show_fee_enabled boolean not null default false,
  add column if not exists no_show_fee_type text,
  add column if not exists no_show_fee_value numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'booking_policies_no_show_fee_type_chk'
  ) then
    alter table public.booking_policies
      add constraint booking_policies_no_show_fee_type_chk
      check (no_show_fee_type is null or no_show_fee_type in ('flat', 'percent')) not valid;
    alter table public.booking_policies validate constraint booking_policies_no_show_fee_type_chk;
  end if;
end $$;
