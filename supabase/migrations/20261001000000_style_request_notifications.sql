-- Build-your-style request notifications (Stage 1).
--
-- A "Build your style" request used to land in style_requests silently:
-- no email to the client, no alert to the stylist. This wires the
-- request lifecycle into the EXISTING machinery:
--   * queue_notification()  -> notification_queue -> Resend worker
--   * public.notifications  -> the in-app bell
--
-- Stage 1 covers the two ends that needed no payment plumbing:
--   1. On submit (INSERT): confirm to the client, alert the stylist
--      (bell + email) that a request needs review.
--   2. On deny (status -> 'denied'): email the client with the
--      stylist's reason (review_notes), which the UI already promises
--      but never delivered.
--
-- The approve -> deposit -> confirmation -> contract chain is Stage 2
-- (it reuses the deposit-first booking flow) and is intentionally not
-- handled here.
--
-- Emails use new notification_types that fall through to the worker's
-- branded generic renderer, so this needs NO redeploy of the email
-- worker. All sends are best-effort: a failure here never blocks the
-- underlying insert/update.

-- ---------------------------------------------------------------------
-- Studio name resolver.
--
-- The braider's business name lives in settings.data.business
-- ("BUSINESS NAME" in the app), NOT profiles.business_name (which the
-- email worker's generic enrichment reads and which is usually empty).
-- Resolve it the way the rest of the app does — settings first — and
-- fall back through the public booking-link name and the profile so a
-- studio name is found wherever it was set.
-- ---------------------------------------------------------------------
create or replace function public.style_request_studio_name(uid uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    nullif(trim((select data->'business'->>'businessName' from public.settings where user_id = uid)), ''),
    nullif(trim((select business_name from public.booking_links where user_id = uid limit 1)), ''),
    nullif(trim((select business_name from public.profiles where id = uid)), ''),
    nullif(trim((select full_name from public.profiles where id = uid)), ''),
    'your stylist'
  );
$$;

-- ---------------------------------------------------------------------
-- Fired AFTER INSERT on style_requests.
-- ---------------------------------------------------------------------
create or replace function public.style_requests_notify_submitted()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_owner_email text;
  v_studio      text;
  v_first       text;
  v_who         text;
  v_when        text;
  v_summary     text;
  v_contact     text;
  v_body        text;
begin
  v_studio := public.style_request_studio_name(NEW.user_id);

  -- Stylist's own email, for the "review needed" alert.
  begin
    select email into v_owner_email from auth.users where id = NEW.user_id;
  exception when others then
    v_owner_email := null;
  end;

  v_who   := coalesce(nullif(trim(NEW.client_name), ''), 'a client');
  v_first := coalesce(nullif(split_part(trim(coalesce(NEW.client_name, '')), ' ', 1), ''), 'there');
  v_when  := nullif(trim(concat_ws(' at ', NEW.preferred_date::text, nullif(trim(coalesce(NEW.preferred_time, '')), ''))), '');
  v_summary := nullif(concat_ws(' · ',
                 nullif(trim(coalesce(NEW.ai_style_family, '')), ''),
                 nullif(trim(coalesce(NEW.size, '')), ''),
                 nullif(trim(coalesce(NEW.length, '')), ''),
                 nullif(trim(coalesce(NEW.color, '')), '')), '');
  v_contact := nullif(concat_ws(' · ',
                 nullif(trim(coalesce(NEW.client_phone, '')), ''),
                 nullif(trim(coalesce(NEW.client_email, '')), '')), '');

  -- 1) In-app bell entry for the stylist — the "review needed" alert.
  begin
    insert into public.notifications (id, user_id, category, title, body, data)
    values (
      'stylereq:' || NEW.id::text,
      NEW.user_id,
      'style_request',
      'New style request — ' || v_who,
      coalesce(v_summary, 'Tap to review the request.'),
      jsonb_build_object(
        'styleRequestId', NEW.id,
        'clientName',     NEW.client_name,
        'preferredDate',  NEW.preferred_date,
        'preferredTime',  NEW.preferred_time
      )
    );
  exception when others then
    null;  -- never block the insert
  end;

  -- 2) Client confirmation email — "we got your request".
  if NEW.client_email is not null and position('@' in NEW.client_email) > 0 then
    v_body :=
      'Hi ' || v_first || ',' || chr(10) || chr(10) ||
      'Thanks for sending your style request to ' || v_studio || '. We''ve received it' ||
      case when v_when is not null then ' for ' || v_when else '' end || '.' || chr(10) || chr(10) ||
      v_studio || ' will review it and follow up to confirm pricing and a deposit to lock in your spot. ' ||
      'This is a request — not a confirmed booking yet.' || chr(10) || chr(10) ||
      'We''ll only email you about this request.';
    begin
      perform public.queue_notification(
        NEW.user_id, 'email', 'style_request_received',
        v_body,
        'We got your style request — ' || v_studio,
        NEW.client_email, null, NEW.client_name,
        jsonb_build_object('studioName', v_studio, 'clientName', NEW.client_name),
        null,
        'stylereq_recv:' || NEW.id::text
      );
    exception when others then
      null;
    end;
  end if;

  -- 3) Stylist email — "a new request needs review".
  if v_owner_email is not null and position('@' in v_owner_email) > 0 then
    v_body :=
      'New "Build your style" request from ' || v_who || '.' || chr(10) || chr(10) ||
      case when v_summary is not null then 'Wants: ' || v_summary || chr(10) else '' end ||
      case when v_when is not null then 'Requested for: ' || v_when || chr(10) else '' end ||
      case when v_contact is not null then 'Contact: ' || v_contact || chr(10) else '' end ||
      case when nullif(trim(coalesce(NEW.notes, '')), '') is not null
           then chr(10) || 'Notes: ' || NEW.notes || chr(10) else '' end ||
      chr(10) || 'Open Braid Boss Pro -> Style requests to approve or deny.';
    begin
      perform public.queue_notification(
        NEW.user_id, 'email', 'style_request_new_owner',
        v_body,
        'New style request from ' || v_who,
        v_owner_email, null, null,
        jsonb_build_object('styleRequestId', NEW.id),
        null,
        'stylereq_owner:' || NEW.id::text
      );
    exception when others then
      null;
    end;
  end if;

  return NEW;
end;
$$;

-- ---------------------------------------------------------------------
-- Fired AFTER UPDATE OF status — emails the client on denial with the
-- stylist's reason. (Approval is Stage 2.)
-- ---------------------------------------------------------------------
create or replace function public.style_requests_notify_denied()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_studio text;
  v_first  text;
  v_body   text;
begin
  if NEW.status is not distinct from OLD.status then return NEW; end if;
  if NEW.status <> 'denied' then return NEW; end if;
  if NEW.client_email is null or position('@' in NEW.client_email) = 0 then return NEW; end if;

  v_studio := public.style_request_studio_name(NEW.user_id);
  v_first := coalesce(nullif(split_part(trim(coalesce(NEW.client_name, '')), ' ', 1), ''), 'there');

  v_body :=
    'Hi ' || v_first || ',' || chr(10) || chr(10) ||
    'Thank you for your interest in booking with ' || v_studio || '. ' ||
    'After reviewing your style request, ' || v_studio || ' isn''t able to take this one on right now.' ||
    chr(10) || chr(10) ||
    case when nullif(trim(coalesce(NEW.review_notes, '')), '') is not null
         then 'A note from your stylist:' || chr(10) || NEW.review_notes || chr(10) || chr(10)
         else '' end ||
    'You''re welcome to browse other styles and send a new request any time.';

  begin
    perform public.queue_notification(
      NEW.user_id, 'email', 'style_request_denied',
      v_body,
      'Update on your style request — ' || v_studio,
      NEW.client_email, null, NEW.client_name,
      jsonb_build_object('studioName', v_studio, 'clientName', NEW.client_name),
      null,
      'stylereq_denied:' || NEW.id::text
    );
  exception when others then
    null;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_style_requests_notify_submitted on public.style_requests;
create trigger trg_style_requests_notify_submitted
  after insert on public.style_requests
  for each row execute function public.style_requests_notify_submitted();

drop trigger if exists trg_style_requests_notify_denied on public.style_requests;
create trigger trg_style_requests_notify_denied
  after update of status on public.style_requests
  for each row execute function public.style_requests_notify_denied();
