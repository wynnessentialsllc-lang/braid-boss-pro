-- Stop client-facing notifications from web-pushing to the stylist.
--
-- push_stylist_addressed_email() fires a web push to the stylist for any
-- notification_queue row whose recipient_email equals the stylist's own
-- login email. That email match was meant as a proxy for "addressed to
-- the stylist" — but it leaks: when a client books using the same email
-- as the stylist's login (e.g. the stylist testing their own booking
-- link, or a coincidental match), CLIENT-facing messages like
-- "your booking request was not approved" get pushed to the stylist's
-- phone.
--
-- Fix: gate the push on the notification TYPE, not just the email. A
-- fixed denylist of client-facing types returns early (no push) even when
-- the email matches. Genuinely stylist-addressed types (review_received,
-- stylist_deposit_paid, *_owner_alert, stylist_booking_*, etc.) are not in
-- the list, so their pushes keep working. Using a denylist (rather than an
-- allowlist) is fail-safe: an unforeseen stylist-facing type still pushes.

create or replace function public.push_stylist_addressed_email()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_stylist_email text;
  v_title         text;
  v_body          text;
  v_tag           text;
  -- Client-facing notification types: these are addressed to the CLIENT
  -- and must never web-push to the stylist, even if the client's email
  -- happens to equal the stylist's login email.
  client_facing_types constant text[] := array[
    'appointment_approved', 'appointment_confirmed', 'appointment_reminder',
    'appointment_rescheduled', 'appointment_updated',
    'balance_paid', 'birthday_greeting',
    'booking_confirmation',
    'booking_denied_no_charge', 'booking_denied_refund_manual', 'booking_denied_refunded',
    'client_booking_cancelled', 'client_booking_rescheduled',
    'contract_invite', 'contract_signing', 'contract_signing_email',
    'deposit_received', 'founding_welcome', 'gift_card_issued',
    'marketing_campaign', 'new_client_welcome',
    'order_confirmation', 'order_ready_for_pickup', 'order_shipped',
    'rebook_nudge', 'reorder_nudge', 'review_request',
    'waitlist_opening', 'winback'
  ];
begin
  if NEW.channel <> 'email' then return NEW; end if;
  if NEW.recipient_email is null or trim(NEW.recipient_email) = '' then
    return NEW;
  end if;

  -- Client-facing type → never push to the stylist.
  if NEW.notification_type = any(client_facing_types) then
    return NEW;
  end if;

  begin
    select email into v_stylist_email from auth.users where id = NEW.user_id;
  exception when others then
    v_stylist_email := null;
  end;
  if v_stylist_email is null
     or lower(NEW.recipient_email) <> lower(v_stylist_email) then
    return NEW;  -- not addressed to the stylist; nothing to push
  end if;

  v_title := nullif(left(trim(coalesce(NEW.subject, '')), 60), '');
  if v_title is null then v_title := 'Braid Boss Pro'; end if;

  v_body := nullif(left(trim(coalesce(NEW.body, '')), 160), '');
  if v_body is null then v_body := ''; end if;

  v_tag := coalesce(NEW.notification_type, 'bbp_notification');
  if NEW.appointment_id is not null then
    v_tag := v_tag || ':' || NEW.appointment_id::text;
  end if;

  begin
    perform public.internal_send_push(
      target_user => NEW.user_id,
      title_in    => v_title,
      body_in     => v_body,
      url_in      => '/',
      tag_in      => v_tag
    );
  exception when others then
    null;
  end;

  return NEW;
end;
$function$;
