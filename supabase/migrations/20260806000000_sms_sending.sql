-- SMS PR 2 — transactional SMS, end to end.
--
-- Additive: extends the existing notification pipeline. Platform
-- Twilio + prepaid credits (PR 1). 1 credit = 1 outbound SMS.
--
-- Adds: a client SMS opt-in on booking requests, a credit-ledger
-- (transaction history), atomic consume/refund RPCs, and SMS
-- enqueue alongside the existing email enqueue in both the booking-
-- confirmation and reminder schedulers.

-- ---------------------------------------------------------------
-- 1. booking_requests.sms_opt_in — set by the booking-flow toggle.
-- ---------------------------------------------------------------
alter table public.booking_requests
  add column if not exists sms_opt_in boolean not null default false;

-- ---------------------------------------------------------------
-- 2. sms_credit_ledger — every credit movement (purchase / send /
--    refund). The cached sms_credits.balance stays authoritative
--    for speed; this is the audit trail + history view.
-- ---------------------------------------------------------------
create table if not exists public.sms_credit_ledger (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  delta      integer not null,
  reason     text not null check (reason in ('purchase', 'send', 'refund', 'adjustment')),
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists sms_credit_ledger_user_idx
  on public.sms_credit_ledger (user_id, created_at desc);

alter table public.sms_credit_ledger enable row level security;
drop policy if exists sms_credit_ledger_owner_select on public.sms_credit_ledger;
create policy sms_credit_ledger_owner_select on public.sms_credit_ledger
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------
-- 3. consume_sms_credit — atomic. Decrements one credit only when
--    the balance is positive; the WHERE + RETURNING make it safe
--    against concurrent workers. Logs a 'send' ledger row.
-- ---------------------------------------------------------------
create or replace function public.consume_sms_credit(user_id_in uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_balance integer;
begin
  update public.sms_credits
     set balance = balance - 1, updated_at = now()
   where user_id = user_id_in and balance > 0
   returning balance into v_balance;

  if v_balance is null then
    return jsonb_build_object('ok', false, 'reason', 'no_credits');
  end if;

  insert into public.sms_credit_ledger (user_id, delta, reason)
  values (user_id_in, -1, 'send');

  return jsonb_build_object('ok', true, 'balance', v_balance);
end;
$function$;

-- ---------------------------------------------------------------
-- 4. refund_sms_credit — returns one credit after a failed send.
-- ---------------------------------------------------------------
create or replace function public.refund_sms_credit(
  user_id_in uuid,
  note_in    text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_balance integer;
begin
  insert into public.sms_credits (user_id, balance)
  values (user_id_in, 1)
  on conflict (user_id) do update
    set balance = public.sms_credits.balance + 1, updated_at = now()
  returning balance into v_balance;

  insert into public.sms_credit_ledger (user_id, delta, reason, note)
  values (user_id_in, 1, 'refund', note_in);

  return jsonb_build_object('ok', true, 'balance', v_balance);
end;
$function$;

revoke all on function public.consume_sms_credit(uuid) from public;
revoke all on function public.refund_sms_credit(uuid, text) from public;
grant execute on function public.consume_sms_credit(uuid) to service_role;
grant execute on function public.refund_sms_credit(uuid, text) to service_role;

-- ---------------------------------------------------------------
-- 5. record_sms_credit_purchase — replace to also log a ledger row.
-- ---------------------------------------------------------------
create or replace function public.record_sms_credit_purchase(session_id_in text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user    uuid;
  v_credits integer;
begin
  update public.sms_credit_purchases
     set status = 'paid', updated_at = now()
   where stripe_session_id = session_id_in
     and status <> 'paid'
   returning user_id, credits into v_user, v_credits;

  if v_user is null then
    return jsonb_build_object('ok', true, 'applied', false);
  end if;

  insert into public.sms_credits (user_id, balance)
  values (v_user, v_credits)
  on conflict (user_id) do update
    set balance    = public.sms_credits.balance + excluded.balance,
        updated_at = now();

  insert into public.sms_credit_ledger (user_id, delta, reason, note)
  values (v_user, v_credits, 'purchase', 'Credit pack purchase');

  return jsonb_build_object('ok', true, 'applied', true, 'credits', v_credits);
end;
$function$;

revoke all on function public.record_sms_credit_purchase(text) from public;
grant execute on function public.record_sms_credit_purchase(text) to service_role;

-- ---------------------------------------------------------------
-- 6. enqueue_due_appointment_reminders — replace to enqueue an SMS
--    reminder alongside the email one. SMS only when the client
--    opted in, has a phone, and the stylist has a credit.
-- ---------------------------------------------------------------
create or replace function public.enqueue_due_appointment_reminders()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  enqueued int := 0;
  app_base text;
  br public.booking_requests%rowtype;
  studio_name text;
  service_label text;
  appt_status text;
  start_ts timestamptz;
  sms_body text;
begin
  app_base := coalesce(
    nullif(current_setting('app.public_url', true), ''),
    'https://braidbosspro.app'
  );
  for br in
    select * from public.booking_requests
    where approval_status in ('approved', 'confirmed')
      and cancelled_at is null
      and client_email is not null
      and preferred_date is not null
      and preferred_time is not null
      and cancel_token is not null
      and (last_reminder_sent_at is null
           or last_reminder_sent_at < (now() - interval '12 hours'))
  loop
    start_ts := (br.preferred_date::text || ' ' || br.preferred_time::text)::timestamp;
    if start_ts <= now() + interval '18 hours'
       or start_ts >= now() + interval '30 hours' then
      continue;
    end if;
    if br.appointment_id is not null then
      select status into appt_status from public.appointments where id = br.appointment_id;
      if appt_status = 'cancelled' then continue; end if;
    end if;
    studio_name := coalesce(nullif(trim(public.public_get_studio_name(br.user_id)), ''), 'your stylist');
    service_label := coalesce(br.selected_variation_name, br.service_name);
    begin
      perform public.queue_notification(
        user_id_in => br.user_id,
        channel_in => 'email',
        notification_type_in => 'appointment_reminder',
        body_in => 'Reminder: your appointment is coming up soon.',
        subject_in => 'Reminder: your appointment with ' || studio_name,
        recipient_email_in => br.client_email,
        recipient_name_in => br.client_name,
        payload_in => jsonb_build_object(
          'clientName', coalesce(br.client_name, 'there'),
          'studioName', studio_name,
          'serviceName', service_label,
          'preferredDate', br.preferred_date,
          'preferredTime', br.preferred_time,
          'cancelUrl', app_base || '/booking-action/' || br.cancel_token || '/cancel',
          'rescheduleUrl',
            case when br.reschedule_count = 0 and br.reschedule_token is not null
              then app_base || '/booking-action/' || br.reschedule_token || '/reschedule'
              else null end,
          'rescheduleUsed', br.reschedule_count >= 1
        ),
        dedupe_key_in => 'appointment_reminder:' || br.id::text || ':' || br.preferred_date::text,
        booking_request_id_in => br.id,
        appointment_id_in => br.appointment_id
      );

      -- SMS reminder — additive, alongside the email. Gated: the
      -- client opted in, has a usable phone, and the stylist still
      -- has at least one credit. queue_notification dedupes on the
      -- distinct sms key, so a re-run won't double-enqueue.
      if coalesce(br.sms_opt_in, false)
         and br.client_phone is not null
         and length(regexp_replace(br.client_phone, '\D', '', 'g')) >= 7
         and coalesce((select balance from public.sms_credits where user_id = br.user_id), 0) > 0
      then
        sms_body := 'Reminder: your ' || coalesce(service_label, 'appointment')
                    || ' with ' || studio_name || ' is '
                    || to_char(br.preferred_date::date, 'FMMon FMDD')
                    || ' at ' || br.preferred_time || '.';
        begin
          perform public.queue_notification(
            user_id_in => br.user_id,
            channel_in => 'sms',
            notification_type_in => 'appointment_reminder',
            body_in => sms_body,
            recipient_phone_in => br.client_phone,
            recipient_name_in => br.client_name,
            payload_in => jsonb_build_object('smsText', sms_body),
            dedupe_key_in => 'appointment_reminder_sms:' || br.id::text || ':' || br.preferred_date::text,
            booking_request_id_in => br.id,
            appointment_id_in => br.appointment_id
          );
        exception when others then null;
        end;
      end if;

      update public.booking_requests
        set last_reminder_sent_at = now()
        where id = br.id;
      enqueued := enqueued + 1;
    exception when others then null;
    end;
  end loop;
  return enqueued;
end;
$function$;

-- ---------------------------------------------------------------
-- 7. enqueue_public_booking_emails — replace to also enqueue an SMS
--    booking confirmation when the client opted in.
-- ---------------------------------------------------------------
create or replace function public.enqueue_public_booking_emails(
  request_id_in    uuid,
  app_base_url_in  text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  br_row         public.booking_requests;
  svc_row        public.services%rowtype;
  studio_name    text;
  enqueued       integer := 0;
  payload_obj    jsonb;
  rpc_result     jsonb;
  app_base       text;
  sms_body       text;
begin
  if request_id_in is null then
    return jsonb_build_object('ok', false, 'reason', 'request_id_required');
  end if;

  select * into br_row from public.booking_requests where id = request_id_in limit 1;
  if br_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'request_not_found');
  end if;

  select coalesce(p.business_name, p.full_name, 'Braid Boss Pro')
    into studio_name
  from public.profiles p where p.id = br_row.user_id limit 1;
  studio_name := coalesce(studio_name, 'Braid Boss Pro');

  if br_row.service_id is not null then
    select * into svc_row from public.services where id = br_row.service_id limit 1;
  end if;

  app_base := coalesce(
    nullif(trim(coalesce(app_base_url_in, '')), ''),
    nullif(current_setting('app.public_url', true), ''),
    'https://braidbosspro.app'
  );

  if br_row.client_email is not null and position('@' in br_row.client_email) > 0 then
    payload_obj := jsonb_build_object(
      'clientName',      coalesce(br_row.client_name, 'there'),
      'studioName',      studio_name,
      'serviceName',     br_row.service_name,
      'preferredDate',   br_row.preferred_date::text,
      'preferredTime',   br_row.preferred_time,
      'approvalStatus',  br_row.approval_status,
      'depositRequired', br_row.deposit_required,
      'hairIncluded',        coalesce(svc_row.hair_included, false),
      'selectedHairColor',   coalesce(br_row.selected_hair_color, br_row.customization_summary->>'custom_hair_color'),
      'selectedCurlPattern', coalesce(br_row.selected_curl_pattern, br_row.customization_summary->>'custom_curl_pattern'),
      'prepReminder',        nullif(trim(coalesce(svc_row.prep_instructions, '')), ''),
      'portalUrl',           case when br_row.portal_token is not null
                             then app_base || '/client/appointment/' || br_row.portal_token
                             else null end
    );
    rpc_result := public.queue_notification(
      user_id_in            => br_row.user_id,
      channel_in            => 'email',
      notification_type_in  => 'booking_confirmation',
      body_in               => 'Booking request received',
      subject_in            => 'Booking request received — ' || studio_name,
      recipient_email_in    => br_row.client_email,
      recipient_name_in     => br_row.client_name,
      payload_in            => payload_obj,
      dedupe_key_in         => 'booking_confirmation:' || br_row.id::text,
      booking_request_id_in => br_row.id
    );
    if coalesce((rpc_result->>'ok')::boolean, false)
       and not coalesce((rpc_result->>'skipped')::boolean, false) then
      enqueued := enqueued + 1;
    end if;
  end if;

  -- SMS booking confirmation — additive. Same gate as the reminder:
  -- opted in, usable phone, stylist has a credit.
  if coalesce(br_row.sms_opt_in, false)
     and br_row.client_phone is not null
     and length(regexp_replace(br_row.client_phone, '\D', '', 'g')) >= 7
     and coalesce((select balance from public.sms_credits where user_id = br_row.user_id), 0) > 0
  then
    sms_body := 'Booking request received by ' || studio_name
                || '. You''ll hear back once it''s confirmed.';
    begin
      rpc_result := public.queue_notification(
        user_id_in            => br_row.user_id,
        channel_in            => 'sms',
        notification_type_in  => 'booking_confirmation',
        body_in               => sms_body,
        recipient_phone_in    => br_row.client_phone,
        recipient_name_in     => br_row.client_name,
        payload_in            => jsonb_build_object('smsText', sms_body),
        dedupe_key_in         => 'booking_confirmation_sms:' || br_row.id::text,
        booking_request_id_in => br_row.id
      );
      if coalesce((rpc_result->>'ok')::boolean, false)
         and not coalesce((rpc_result->>'skipped')::boolean, false) then
        enqueued := enqueued + 1;
      end if;
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'enqueued', enqueued);
end;
$function$;
