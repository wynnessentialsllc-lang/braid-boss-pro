-- Don't ask a client for a review if they've already left one.
--
-- Review requests are gated per-appointment (review_request_sent_at), which
-- stops a single appointment from being asked twice. But a returning client
-- with a NEW appointment would still get a fresh request (email and/or SMS)
-- even after they'd already reviewed the stylist from an earlier visit —
-- nagging a client who has already given their feedback.
--
-- Reviews (appointment_reviews) carry no client column of their own; they
-- link to the client through the appointment that was reviewed
-- (appointment_reviews.appointment_id = appointments.id). So "has this
-- client already reviewed this stylist" is expressed as: an existing review,
-- for the same stylist (user_id), whose reviewed appointment shares this
-- candidate's contact info. Match on client_email (case-insensitive) OR
-- normalized client_phone so the guard holds whether the client was reached
-- by email, SMS, or both. Scoping to user_id keeps it per-stylist — a review
-- left for one stylist never suppresses another stylist's request.
--
-- This re-creates the 20261017 version (email + parallel one-segment SMS)
-- verbatim and only adds the new "already reviewed" exclusion to the loop's
-- candidate query. Everything else (status/cancellation filters, timezone
-- resolution, end+2h gate, 14-day staleness sweep, payloads, dedupe, SMS
-- opt-in/opt-out/credit gates) is unchanged.
create or replace function public.enqueue_due_review_requests()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  enqueued int := 0;
  app_base text;
  a        public.appointments%rowtype;
  studio_name text;
  v_tz     text;
  end_ts   timestamptz;
  v_review_url text;
  v_sms    text;
begin
  app_base := coalesce(
    nullif(current_setting('app.public_url', true), ''),
    'https://braidbosspro.app'
  );

  for a in
    select * from public.appointments
    where coalesce(status, '') not in
            ('cancelled', 'canceled', 'no-show', 'no_show', 'noshow',
             'declined', 'rescheduled')
      and cancelled_at is null
      and (
        (client_email is not null and client_email <> '')
        or (client_phone is not null and client_phone <> '')
      )
      and appt_date is not null and appt_time is not null
      and review_request_sent_at is null
      and review_request_token is not null
      and coalesce(kind, 'appointment') = 'appointment'
      and coalesce(is_all_day, false) = false
      and not exists (
        select 1 from public.booking_requests br
        where br.appointment_id = appointments.id
          and br.user_id = appointments.user_id
          and (
            br.cancelled_at is not null
            or coalesce(br.approval_status, '') in ('cancelled', 'denied', 'declined')
            or (coalesce(br.reschedule_count, 0) >= 1
                and coalesce(br.approval_status, '') = 'deposit_paid_pending_approval')
          )
      )
      -- Skip clients who have already left this stylist a review. Match by
      -- email (case-insensitive) or normalized phone via the reviewed
      -- appointment, scoped to the same stylist so a review for one stylist
      -- never suppresses a request from another.
      and not exists (
        select 1
        from public.appointment_reviews ar
        join public.appointments ra
          on ra.id = ar.appointment_id
         and ra.user_id = ar.user_id
        where ar.user_id = appointments.user_id
          and (
            (ra.client_email is not null and appointments.client_email is not null
              and lower(trim(ra.client_email)) = lower(trim(appointments.client_email)))
            or
            (ra.client_phone is not null and appointments.client_phone is not null
              and length(public.sms_normalize_phone(appointments.client_phone)) >= 7
              and public.sms_normalize_phone(ra.client_phone)
                  = public.sms_normalize_phone(appointments.client_phone))
          )
      )
  loop
    v_tz := coalesce(
      nullif(a.timezone, ''),
      (select br.timezone
         from public.booking_requests br
        where br.user_id = a.user_id
          and br.timezone is not null
          and br.timezone <> ''
        order by br.created_at desc
        limit 1),
      'America/Los_Angeles'
    );

    begin
      end_ts := ((a.appt_date::text || ' ' || a.appt_time)::timestamp
                 at time zone v_tz)
                + (coalesce(a.duration_hours, 0)::text || ' hours')::interval;
    exception when others then
      continue;
    end;

    if now() < end_ts + interval '2 hours' then
      continue;
    end if;

    if end_ts < now() - interval '14 days' then
      update public.appointments
        set review_request_sent_at = now()
        where id = a.id and user_id = a.user_id;
      continue;
    end if;

    studio_name := coalesce(
      nullif(trim(public.public_get_studio_name(a.user_id)), ''),
      'your stylist'
    );
    v_review_url := app_base || '/review/' || a.review_request_token;

    begin
      if a.client_email is not null and a.client_email <> '' then
        perform public.queue_notification(
          user_id_in           => a.user_id,
          channel_in           => 'email',
          notification_type_in => 'review_request',
          body_in              => 'How was your appointment? Leave a quick review.',
          subject_in           => 'How was your appointment?',
          recipient_email_in   => a.client_email,
          recipient_name_in    => a.client_name,
          payload_in           => jsonb_build_object(
            'clientName',  coalesce(a.client_name, 'there'),
            'studioName',  studio_name,
            'serviceName', a.style,
            'reviewUrl',   v_review_url
          ),
          dedupe_key_in        => 'review_request:' || a.id,
          appointment_id_in    => a.id
        );
      end if;

      if coalesce(a.sms_opt_in, false)
         and a.client_phone is not null
         and length(public.sms_normalize_phone(a.client_phone)) >= 7
         and not exists (select 1 from public.sms_opt_outs o
                         where o.phone = public.sms_normalize_phone(a.client_phone))
         and coalesce((select balance from public.sms_credits where user_id = a.user_id), 0) > 0
      then
        -- No studio name in the body: the link already carries the
        -- variable length, so this keeps the text one segment.
        v_sms := 'How was your visit? Leave a quick review: ' || v_review_url;
        perform public.queue_notification(
          user_id_in           => a.user_id,
          channel_in           => 'sms',
          notification_type_in => 'review_request',
          body_in              => v_sms,
          recipient_phone_in   => a.client_phone,
          recipient_name_in    => a.client_name,
          payload_in           => jsonb_build_object('smsText', v_sms),
          dedupe_key_in        => 'review_request_sms:' || a.id,
          appointment_id_in    => a.id
        );
      end if;

      update public.appointments
        set review_request_sent_at = now()
        where id = a.id and user_id = a.user_id;
      enqueued := enqueued + 1;
    exception when others then null;
    end;
  end loop;

  return enqueued;
end;
$function$;

revoke all on function public.enqueue_due_review_requests() from public;
grant execute on function public.enqueue_due_review_requests() to service_role;

notify pgrst, 'reload schema';
