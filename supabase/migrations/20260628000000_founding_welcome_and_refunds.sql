-- Founding Stylist Access: welcome email + refund tracking.
--
-- Two additions on top of the auto-claim infrastructure:
--   1. Queue a one-time "Welcome, Founding Stylist" email whenever
--      profiles.founding_access flips to true. Dedupe via the new
--      profiles.founding_welcome_email_sent_at column so a webhook
--      replay or a follow-on claim never sends a second copy.
--   2. mark_founding_order_refunded RPC for the webhook to call on
--      charge.refunded. Flips the order row to status='refunded' and
--      stamps refunded_at. Deliberately does NOT revoke
--      profiles.founding_access — refunds are reviewed manually by
--      an admin before the grandfathered seat is taken back.

-- 1. profiles flag + worker email type ---------------------------------

alter table public.profiles
  add column if not exists founding_welcome_email_sent_at timestamptz;

-- 2. Internal helper: queue the founding welcome email, once. ----------
--
-- Called from inside mark_founding_order_paid and
-- claim_founding_access_for_user — both run with security definer,
-- which is required because queue_notification enforces auth.uid()
-- ownership and these RPCs run on behalf of either the webhook
-- (service role) or a freshly signed-up user.
create or replace function public.send_founding_welcome_email(uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  user_email text;
  user_name  text;
  app_url    text;
begin
  if uid is null then return; end if;

  -- Bail if we've already queued the welcome — keeps the email
  -- single-shot across webhook replays + signup-time claims.
  if exists (
    select 1 from public.profiles
    where id = uid and founding_welcome_email_sent_at is not null
  ) then
    return;
  end if;

  select au.email, coalesce(p.full_name, au.raw_user_meta_data->>'full_name')
    into user_email, user_name
    from auth.users au
    left join public.profiles p on p.id = au.id
    where au.id = uid
    limit 1;

  if user_email is null or position('@' in user_email) = 0 then
    return;
  end if;

  app_url := coalesce(
    nullif(current_setting('app.public_url', true), ''),
    'https://braidbosspro.app'
  );

  -- Stamp first so a transient queue_notification failure doesn't
  -- leave us looping into duplicate sends on the next call.
  update public.profiles
  set founding_welcome_email_sent_at = now(),
      updated_at = now()
  where id = uid;

  begin
    perform public.queue_notification(
      user_id_in           => uid,
      channel_in           => 'email',
      notification_type_in => 'founding_welcome',
      body_in              => 'Welcome to Braid Boss Pro, Founding Stylist.',
      subject_in           => 'Welcome to Braid Boss Pro, Founding Stylist',
      recipient_email_in   => user_email,
      recipient_name_in    => user_name,
      payload_in           => jsonb_build_object(
        'stylistName', coalesce(user_name, 'Stylist'),
        'appUrl',      app_url
      ),
      dedupe_key_in        => 'founding_welcome:' || uid::text
    );
  exception when others then
    -- Roll the stamp back so a future trigger can retry.
    update public.profiles
    set founding_welcome_email_sent_at = null
    where id = uid;
  end;
end $$;

revoke all on function public.send_founding_welcome_email(uuid) from public;

-- 3. Re-define mark_founding_order_paid to queue the welcome -----------
create or replace function public.mark_founding_order_paid(
  session_id_in text,
  payment_intent_in text,
  customer_email_in text,
  amount_total_cents_in integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.founding_access_orders%rowtype;
  matched_uid uuid;
begin
  select * into existing
    from public.founding_access_orders
    where stripe_session_id = session_id_in
    limit 1;

  if existing.id is null then
    insert into public.founding_access_orders (
      stripe_session_id, stripe_payment_intent, customer_email,
      amount_cents, currency, status, paid_at
    ) values (
      session_id_in, payment_intent_in, customer_email_in,
      coalesce(amount_total_cents_in, 999), 'usd', 'paid', now()
    )
    returning * into existing;
  else
    if existing.status = 'paid' then
      -- Still attempt the welcome — covers the case where the user
      -- signed up AFTER the first paid event was processed but the
      -- claim path hadn't yet fired.
      if existing.claimed_by_user_id is not null then
        perform public.send_founding_welcome_email(existing.claimed_by_user_id);
      end if;
      return true;
    end if;
    update public.founding_access_orders
    set status = 'paid',
        stripe_payment_intent = coalesce(stripe_payment_intent, payment_intent_in),
        customer_email = coalesce(customer_email, customer_email_in),
        paid_at = now(),
        updated_at = now()
    where id = existing.id
    returning * into existing;
  end if;

  if existing.customer_email is not null then
    select u.id into matched_uid
    from auth.users u
    where lower(u.email) = lower(existing.customer_email)
    limit 1;

    if matched_uid is not null then
      update public.founding_access_orders
      set claimed_by_user_id = matched_uid,
          claimed_at = coalesce(claimed_at, now()),
          updated_at = now()
      where id = existing.id;

      update public.profiles
      set founding_access = true,
          founding_paid_at = coalesce(founding_paid_at, now()),
          updated_at = now()
      where id = matched_uid;

      perform public.send_founding_welcome_email(matched_uid);
    end if;
  end if;

  return true;
end $$;

revoke all on function public.mark_founding_order_paid(text, text, text, integer) from public;
grant execute on function public.mark_founding_order_paid(text, text, text, integer) to service_role;

-- 4. Re-define claim_founding_access_for_user to queue the welcome ----
create or replace function public.claim_founding_access_for_user(
  email_in text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  e text := lower(coalesce(trim(email_in), ''));
  matched_count int;
begin
  if uid is null then return false; end if;
  if e = '' then return false; end if;

  if (select founding_access from public.profiles where id = uid) is true then
    -- Already a member — make sure the welcome went out for the
    -- legacy lifetime_access cohort that predates this column.
    perform public.send_founding_welcome_email(uid);
    return true;
  end if;

  with claimed as (
    update public.founding_access_orders
    set claimed_by_user_id = uid,
        claimed_at = coalesce(claimed_at, now()),
        updated_at = now()
    where lower(customer_email) = e
      and status = 'paid'
      and (claimed_by_user_id is null or claimed_by_user_id = uid)
    returning id
  )
  select count(*) into matched_count from claimed;

  if matched_count > 0 then
    update public.profiles
    set founding_access = true,
        founding_paid_at = coalesce(founding_paid_at, now()),
        updated_at = now()
    where id = uid;
    perform public.send_founding_welcome_email(uid);
    return true;
  end if;

  return false;
end $$;

revoke all on function public.claim_founding_access_for_user(text) from public;
grant execute on function public.claim_founding_access_for_user(text) to authenticated;

-- 5. Refund handling ---------------------------------------------------
--
-- Why we don't auto-revoke:
--   * Most Stripe refunds during founding launch will be courtesy
--     refunds (duplicate charge, charged the wrong card, switching
--     to a different email). Auto-revoking would punish those users.
--   * Chargebacks and fraud get reviewed by an admin who can flip
--     profiles.founding_access = false manually after confirming.
--   * Refund event order is not strictly guaranteed; we want a
--     human in the loop before pulling lifetime access back.
-- This RPC just stamps the order so the admin Stripe-vs-DB
-- reconciliation surfaces it.
create or replace function public.mark_founding_order_refunded(
  session_id_in text,
  payment_intent_in text,
  refund_metadata_in jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  if session_id_in is null and payment_intent_in is null then
    return false;
  end if;

  update public.founding_access_orders
  set status = 'refunded',
      refunded_at = coalesce(refunded_at, now()),
      metadata = coalesce(metadata, '{}'::jsonb)
                 || jsonb_build_object('refund', coalesce(refund_metadata_in, '{}'::jsonb)),
      updated_at = now()
  where (session_id_in is not null and stripe_session_id = session_id_in)
     or (payment_intent_in is not null and stripe_payment_intent = payment_intent_in);

  get diagnostics affected = row_count;
  return affected > 0;
end $$;

revoke all on function public.mark_founding_order_refunded(text, text, jsonb) from public;
grant execute on function public.mark_founding_order_refunded(text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
