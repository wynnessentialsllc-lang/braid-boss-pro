-- Review-request emails now fire at appointment_end + 1 hour
-- (was +2h). end_ts = appt_date+appt_time + duration_hours, so it
-- already respects edited durations, add-on-extended durations, and
-- per-instance recurring rows. Never keyed off start time.
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
  end_ts   timestamp;
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
    begin
      end_ts := (a.appt_date::text || ' ' || a.appt_time)::timestamp
                + (coalesce(a.duration_hours, 0)::text || ' hours')::interval;
    exception when others then
      continue;
    end;

    -- Send only once the service has realistically finished:
    -- end of appointment + 1 hour. Never before end_ts.
    if now() < end_ts + interval '1 hour' then
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
