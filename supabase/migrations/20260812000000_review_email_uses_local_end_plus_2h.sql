-- Review-request emails now fire 2 hours after the appointment's
-- LOCAL scheduled end time (was 1 hour, and was computed as a naive
-- timestamp compared against UTC now()).
--
-- The previous version cast (appt_date || ' ' || appt_time) to a
-- naive `timestamp` and compared it against `now()` (timestamptz).
-- Postgres silently coerced the naive value as if it were UTC, so a
-- PDT stylist's 9 AM – 5 PM appointment had end_ts treated as
-- 17:00 UTC, then +1h, firing at 18:00 UTC = 11:00 AM PDT — only
-- two hours into the actual service. The fix: interpret the
-- (date, time) pair in the stylist's local zone via `AT TIME ZONE`
-- so end_ts is a real timestamptz, then add +2 hours.
--
-- Timezone resolution (none of the appointments rows currently have
-- timezone set, so a fallback chain is required):
--   1. appointments.timezone if non-empty
--   2. most recent non-null booking_requests.timezone for this user
--   3. 'America/Los_Angeles' — last resort. Better than UTC, which
--      would fire 7+ hours early for a West-Coast stylist.
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
            ('cancelled', 'no-show', 'no_show', 'noshow', 'declined')
      and client_email is not null and client_email <> ''
      and appt_date is not null and appt_time is not null
      and review_request_sent_at is null
      and review_request_token is not null
      and coalesce(kind, 'appointment') = 'appointment'
      and coalesce(is_all_day, false) = false
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
