-- Notify the stylist when a client joins their waitlist from the public
-- booking page.
--
-- Until now a public waitlist join landed in waitlist_requests silently
-- (only a client-side analytics event) — the stylist had to happen to
-- open the Waitlist tab to notice. This wires the join into the SAME
-- machinery the build-your-style + review flows already use:
--   * public.notifications   -> the in-app bell
--   * queue_notification()   -> notification_queue -> email worker (Resend)
--
-- The OS-level web push is delivered automatically: trg_push_stylist_-
-- addressed (migration 20260822) fires internal_send_push() for every
-- notification_queue row whose channel is 'email' and whose recipient is
-- the stylist's own auth.users.email — which is exactly the email we
-- queue below. So we do NOT call internal_send_push() here; doing so
-- would push twice (the review flow deliberately dropped its explicit
-- push call for the same reason).
--
-- Fires ONLY for public joins (created_from_public = true) so the
-- stylist's own manual waitlist entries from the app never self-notify.
-- Every send is best-effort: any failure is swallowed so it can never
-- block the underlying insert (a client must always make it onto the
-- list, even if a notification hiccups).
--
-- Reuses existing helpers, so no email-worker or edge-function redeploy:
--   * public.style_request_studio_name(uid)  — settings-first studio name
--   * public.queue_notification(...)         — named-arg email enqueue
-- The 'waitlist_join_owner' notification_type falls through to the
-- worker's branded generic renderer (same approach as style requests).

create or replace function public.waitlist_requests_notify_joined()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_owner_email text;
  v_studio      text;
  v_who         text;
  v_when        text;
  v_flex        text;
  v_contact     text;
  v_summary     text;
  v_body        text;
begin
  -- Public joins only — skip the owner's manual adds.
  if not coalesce(NEW.created_from_public, false) then
    return NEW;
  end if;

  v_studio := public.style_request_studio_name(NEW.user_id);

  begin
    select email into v_owner_email from auth.users where id = NEW.user_id;
  exception when others then
    v_owner_email := null;
  end;

  v_who  := coalesce(nullif(trim(NEW.client_name), ''), 'Someone');
  v_when := nullif(trim(concat_ws(' at ',
              NEW.preferred_date::text,
              nullif(trim(coalesce(NEW.preferred_time, '')), ''))), '');
  v_flex := case NEW.flexibility
              when 'anytime'   then 'Anytime that day'
              when 'morning'   then 'Mornings'
              when 'afternoon' then 'Afternoons'
              when 'evening'   then 'Evenings'
              when 'specific'  then 'A specific time'
              else null
            end;
  v_contact := nullif(concat_ws(' · ',
                 nullif(trim(coalesce(NEW.client_phone, '')), ''),
                 nullif(trim(coalesce(NEW.client_email, '')), '')), '');
  -- One-line "what + when + how flexible" used for the bell + push body.
  v_summary := coalesce(
                 nullif(concat_ws(' · ',
                   nullif(trim(coalesce(NEW.service_name, '')), ''),
                   v_when, v_flex), ''),
                 'Tap to review the request.');

  -- 1) In-app bell entry for the stylist.
  begin
    insert into public.notifications (id, user_id, category, title, body, data)
    values (
      'waitlist:' || NEW.id::text,
      NEW.user_id,
      'waitlist',
      v_who || ' joined your waitlist',
      v_summary,
      jsonb_build_object(
        'waitlistRequestId', NEW.id,
        'clientName',        NEW.client_name,
        'serviceName',       NEW.service_name,
        'preferredDate',     NEW.preferred_date,
        'preferredTime',     NEW.preferred_time,
        'flexibility',       NEW.flexibility
      )
    )
    on conflict (id) do nothing;
  exception when others then
    null;  -- never block the insert
  end;

  -- 2) Stylist email — "someone joined your waitlist". Queuing this row
  --    (channel 'email', recipient = the stylist's own email) ALSO fires
  --    the OS web push automatically via trg_push_stylist_addressed, so
  --    no separate internal_send_push() call is needed (or wanted).
  if v_owner_email is not null and position('@' in v_owner_email) > 0 then
    v_body :=
      v_who || ' just joined your waitlist.' || chr(10) || chr(10) ||
      case when nullif(trim(coalesce(NEW.service_name, '')), '') is not null
           then 'Service: ' || NEW.service_name || chr(10) else '' end ||
      case when v_when is not null then 'Preferred: ' || v_when || chr(10) else '' end ||
      case when v_flex is not null then 'Flexibility: ' || v_flex || chr(10) else '' end ||
      case when v_contact is not null then 'Contact: ' || v_contact || chr(10) else '' end ||
      case when nullif(trim(coalesce(NEW.notes, '')), '') is not null
           then chr(10) || 'Notes: ' || NEW.notes || chr(10) else '' end ||
      chr(10) || 'Open Braid Boss Pro -> Waitlist to reach out or book them in.';
    begin
      perform public.queue_notification(
        user_id_in           => NEW.user_id,
        channel_in           => 'email',
        notification_type_in => 'waitlist_join_owner',
        body_in              => v_body,
        subject_in           => v_who || ' joined your waitlist',
        recipient_email_in   => v_owner_email,
        recipient_name_in    => v_studio,
        payload_in           => jsonb_build_object('waitlistRequestId', NEW.id),
        dedupe_key_in        => 'waitlist_join_owner:' || NEW.id::text
      );
    exception when others then
      null;
    end;
  end if;

  -- (Web push is handled automatically by trg_push_stylist_addressed on
  --  the email row queued above — see the header note.)

  return NEW;
end;
$$;

drop trigger if exists trg_waitlist_requests_notify_joined on public.waitlist_requests;
create trigger trg_waitlist_requests_notify_joined
  after insert on public.waitlist_requests
  for each row execute function public.waitlist_requests_notify_joined();
