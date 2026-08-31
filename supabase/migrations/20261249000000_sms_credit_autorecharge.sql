-- Credit auto-recharge — keep the balance topped up without a trip
-- through Checkout.
--
-- Buying credits today is a deliberate one-time Checkout session, so
-- the purchase happens about as often as the pack runs out -- once
-- every year and a half at observed usage. Meanwhile the balance
-- hitting zero silently kills client texts. Auto-recharge turns that
-- decision into a setting: when the balance falls below a threshold,
-- charge the card already on file and credit the pack.
--
-- This spends real money on a card the stylist is not watching, so
-- nearly all of the design below is restraint rather than mechanism:
--
--   * claim_sms_autorecharge() is the ONLY way an attempt starts, and
--     it is atomic. It re-checks eligibility, re-checks the balance,
--     and inserts the pending purchase row in one statement, so two
--     concurrent cron ticks cannot both claim the same account.
--   * The claimed purchase row's uuid becomes the Stripe idempotency
--     key. A retried or duplicated cron call reuses it and Stripe
--     returns the original charge instead of a second one.
--   * A cooldown stops a rapid balance drop from stacking charges.
--   * Consecutive failures disable the setting rather than retrying a
--     declining card forever.
--   * A daily cap bounds the worst case if everything else is wrong.

-- ---------------------------------------------------------------
-- 1. Settings, one row per stylist.
-- ---------------------------------------------------------------
create table if not exists public.sms_autorecharge (
  user_id                  uuid primary key references auth.users(id) on delete cascade,
  enabled                  boolean not null default false,
  -- Recharge when the balance drops BELOW this.
  threshold                integer not null default 20 check (threshold between 1 and 5000),
  pack_id                  text    not null default 'standard',
  stripe_customer_id       text,
  stripe_payment_method_id text,
  card_brand               text,
  card_last4               text,
  -- Guard rails.
  cooldown_minutes         integer not null default 60 check (cooldown_minutes between 5 and 1440),
  max_per_day              integer not null default 2 check (max_per_day between 1 and 10),
  consecutive_failures     integer not null default 0,
  last_attempt_at          timestamptz,
  last_success_at          timestamptz,
  last_error               text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table public.sms_autorecharge enable row level security;

-- The stylist reads their own row. Writes go through the RPCs below so
-- the card fields can never be set from the client.
drop policy if exists sms_autorecharge_owner_select on public.sms_autorecharge;
create policy sms_autorecharge_owner_select on public.sms_autorecharge
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------
-- 2. set_sms_autorecharge — the stylist's own preferences.
-- ---------------------------------------------------------------
-- Deliberately cannot touch the card columns: those are only ever
-- written by the webhook after Stripe confirms a saved payment method.
-- Turning it on without a card on file is refused rather than silently
-- stored, so the toggle never claims to be armed when it isn't.
create or replace function public.set_sms_autorecharge(
  enabled_in   boolean,
  threshold_in integer default null,
  pack_id_in   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_has_card boolean;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  if pack_id_in is not null and pack_id_in not in ('starter', 'standard', 'pro') then
    return jsonb_build_object('ok', false, 'reason', 'bad_pack');
  end if;

  insert into public.sms_autorecharge (user_id) values (v_user)
  on conflict (user_id) do nothing;

  select stripe_payment_method_id is not null
    into v_has_card from public.sms_autorecharge where user_id = v_user;

  if enabled_in and not coalesce(v_has_card, false) then
    return jsonb_build_object('ok', false, 'reason', 'no_card_on_file');
  end if;

  update public.sms_autorecharge
     set enabled    = enabled_in,
         threshold  = coalesce(threshold_in, threshold),
         pack_id    = coalesce(pack_id_in, pack_id),
         -- Re-enabling is the stylist saying the card problem is
         -- fixed; clear the failure count so the guard rail starts
         -- fresh rather than tripping on history.
         consecutive_failures = case when enabled_in then 0 else consecutive_failures end,
         last_error = case when enabled_in then null else last_error end,
         updated_at = now()
   where user_id = v_user;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.set_sms_autorecharge(boolean, integer, text) from public;
grant execute on function public.set_sms_autorecharge(boolean, integer, text) to authenticated;

-- ---------------------------------------------------------------
-- 3. attach_sms_autorecharge_card — webhook only.
-- ---------------------------------------------------------------
create or replace function public.attach_sms_autorecharge_card(
  user_id_in     uuid,
  customer_in    text,
  payment_method_in text,
  brand_in       text default null,
  last4_in       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if user_id_in is null or coalesce(trim(payment_method_in), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  insert into public.sms_autorecharge (
    user_id, stripe_customer_id, stripe_payment_method_id, card_brand, card_last4
  )
  values (user_id_in, customer_in, payment_method_in, brand_in, last4_in)
  on conflict (user_id) do update
    set stripe_customer_id       = excluded.stripe_customer_id,
        stripe_payment_method_id = excluded.stripe_payment_method_id,
        card_brand               = excluded.card_brand,
        card_last4               = excluded.card_last4,
        -- A newly attached card clears the decline history.
        consecutive_failures     = 0,
        last_error               = null,
        updated_at               = now();

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.attach_sms_autorecharge_card(uuid, text, text, text, text) from public;
grant execute on function public.attach_sms_autorecharge_card(uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------
-- 4. claim_sms_autorecharge — atomic "may I charge this card?"
-- ---------------------------------------------------------------
-- Returns at most one claim per eligible account, having already
-- written the pending purchase row. The caller charges Stripe using
-- purchase_id as the idempotency key, then reports back. If the caller
-- dies mid-flight the row stays 'pending' and the cooldown keeps the
-- account quiet until it expires -- no charge, no double charge.
create or replace function public.claim_sms_autorecharge(
  user_id_in     uuid,
  pack_credits_in integer,
  pack_cents_in   integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg        public.sms_autorecharge;
  v_balance  integer;
  v_today    integer;
  v_purchase uuid;
begin
  -- Lock the settings row for the duration; a second tick blocks here
  -- and then fails the cooldown check below.
  select * into cfg from public.sms_autorecharge
   where user_id = user_id_in for update;
  if not found or not cfg.enabled then
    return jsonb_build_object('ok', false, 'reason', 'not_enabled');
  end if;
  if cfg.stripe_customer_id is null or cfg.stripe_payment_method_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_card');
  end if;
  if cfg.consecutive_failures >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_failures');
  end if;
  if cfg.last_attempt_at is not null
     and cfg.last_attempt_at > now() - make_interval(mins => cfg.cooldown_minutes) then
    return jsonb_build_object('ok', false, 'reason', 'cooldown');
  end if;

  -- Re-read the balance INSIDE the lock: a top-up may have landed
  -- between the sweep query and this call.
  select coalesce(balance, 0) into v_balance
    from public.sms_credits where user_id = user_id_in;
  if coalesce(v_balance, 0) >= cfg.threshold then
    return jsonb_build_object('ok', false, 'reason', 'above_threshold');
  end if;

  select count(*) into v_today
    from public.sms_credit_purchases
   where user_id = user_id_in
     and created_at >= date_trunc('day', now())
     and pack_id like 'auto:%';
  if v_today >= cfg.max_per_day then
    return jsonb_build_object('ok', false, 'reason', 'daily_cap');
  end if;

  insert into public.sms_credit_purchases (user_id, pack_id, credits, amount_cents, status)
  values (user_id_in, 'auto:' || cfg.pack_id, pack_credits_in, pack_cents_in, 'pending')
  returning id into v_purchase;

  update public.sms_autorecharge
     set last_attempt_at = now(), updated_at = now()
   where user_id = user_id_in;

  return jsonb_build_object(
    'ok', true,
    'purchase_id', v_purchase,
    'customer', cfg.stripe_customer_id,
    'payment_method', cfg.stripe_payment_method_id,
    'balance', v_balance
  );
end $$;

revoke all on function public.claim_sms_autorecharge(uuid, integer, integer) from public;
grant execute on function public.claim_sms_autorecharge(uuid, integer, integer) to service_role;

-- ---------------------------------------------------------------
-- 5. settle_sms_autorecharge — credit on success, back off on failure.
-- ---------------------------------------------------------------
create or replace function public.settle_sms_autorecharge(
  purchase_id_in uuid,
  succeeded_in   boolean,
  reference_in   text default null,
  error_in       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid;
  v_credits integer;
begin
  -- `status <> 'paid'` makes crediting idempotent: a replayed settle
  -- finds nothing to update and returns applied=false.
  update public.sms_credit_purchases
     set status = case when succeeded_in then 'paid' else 'failed' end,
         stripe_session_id = coalesce(reference_in, stripe_session_id),
         updated_at = now()
   where id = purchase_id_in and status <> 'paid'
   returning user_id, credits into v_user, v_credits;

  if v_user is null then
    return jsonb_build_object('ok', true, 'applied', false);
  end if;

  if succeeded_in then
    insert into public.sms_credits (user_id, balance)
    values (v_user, v_credits)
    on conflict (user_id) do update
      set balance = public.sms_credits.balance + excluded.balance, updated_at = now();

    insert into public.sms_credit_ledger (user_id, delta, reason, note)
    values (v_user, v_credits, 'purchase', 'Auto-recharge');

    update public.sms_autorecharge
       set consecutive_failures = 0, last_error = null,
           last_success_at = now(), updated_at = now()
     where user_id = v_user;
  else
    update public.sms_autorecharge
       set consecutive_failures = consecutive_failures + 1,
           last_error = left(coalesce(error_in, 'charge_failed'), 300),
           -- Three strikes and the setting turns itself off. A card
           -- that keeps declining should stop being retried daily.
           enabled = case when consecutive_failures + 1 >= 3 then false else enabled end,
           updated_at = now()
     where user_id = v_user;
  end if;

  return jsonb_build_object('ok', true, 'applied', true, 'credits', v_credits);
end $$;

revoke all on function public.settle_sms_autorecharge(uuid, boolean, text, text) from public;
grant execute on function public.settle_sms_autorecharge(uuid, boolean, text, text) to service_role;

-- ---------------------------------------------------------------
-- 6. sms_autorecharge_due — the sweep's candidate list.
-- ---------------------------------------------------------------
-- Advisory only. Every row it returns is re-validated under lock by
-- claim_sms_autorecharge before a card is touched.
create or replace function public.sms_autorecharge_due(limit_in integer default 50)
returns table (user_id uuid, pack_id text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.user_id, a.pack_id
  from public.sms_autorecharge a
  left join public.sms_credits c on c.user_id = a.user_id
  where a.enabled
    and a.stripe_payment_method_id is not null
    and a.consecutive_failures < 3
    and coalesce(c.balance, 0) < a.threshold
    and (a.last_attempt_at is null
         or a.last_attempt_at <= now() - make_interval(mins => a.cooldown_minutes))
  order by coalesce(c.balance, 0) asc
  limit greatest(1, least(200, coalesce(limit_in, 50)));
$$;

revoke all on function public.sms_autorecharge_due(integer) from public;
grant execute on function public.sms_autorecharge_due(integer) to service_role;

notify pgrst, 'reload schema';
