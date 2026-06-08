-- Don't send a review request for an appointment that was rescheduled,
-- cancelled, or otherwise never completed — there is nothing to review.
--
-- The prior version (20260812...) gated purely on time (local end +2h)
-- and a small status blocklist. That let two "nothing to review" cases
-- slip through and email the client anyway:
--
--   1. Cancelled-but-not-restamped rows. The appointments.status field
--      isn't always flipped to 'cancelled' (cancellation can live on
--      appointments.cancelled_at or on the linked booking_requests row),
--      so a cancelled visit whose status still read 'scheduled' still
--      got a review request once its old time passed.
--
--   2. Pending reschedules. When a client reschedules, the booking goes
--      back to 'deposit_paid_pending_approval' and the appointments row
--      keeps its OLD (past) date until the stylist re-approves and the
--      row is moved. In that window the time gate fires a review for a
--      slot the client never actually attended.
--
-- Fix: keep the existing time-passed = completed model (a past
-- 'scheduled'/'confirmed' visit is treated as completed, since stylists
-- rarely mark 'completed' by hand), but exclude rows that represent a
-- visit that did not happen:
--   - broader status blocklist (adds 'canceled', 'rescheduled')
--   - appointments.cancelled_at must be null
--   - no linked booking_request that is cancelled/denied or has a
--     reschedule still awaiting the stylist's re-approval
--
-- Everything else (timezone resolution, end+2h gate, 14-day staleness
-- sweep, payload, dedupe) is carried over unchanged from 20260812.
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
      and client_email is not null and client_email <> ''
      and appt_date is not null and appt_time is not null
      and review_request_sent_at is null
      and review_request_token is not null
      and coalesce(kind, 'appointment') = 'appointment'
      and coalesce(is_all_day, false) = false
      -- Skip visits that did not happen as scheduled: the booking was
      -- cancelled/denied, or a reschedule request is still awaiting the
      -- stylist's re-approval (the appointments row still holds the old
      -- date in that window, so the time gate below would misfire).
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

    -- Send only once the service has realistically wrapped:
    -- local end time + 2 hours.
    if now() < end_ts + interval '2 hours' then
      continue;
    end if;

    -- Stale: more than 14 days past end. Mark sent so we stop
    -- considering the row; never email a client about an old visit.
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

    begin
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
          'reviewUrl',   app_base || '/review/' || a.review_request_token
        ),
        dedupe_key_in        => 'review_request:' || a.id,
        appointment_id_in    => a.id
      );
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
