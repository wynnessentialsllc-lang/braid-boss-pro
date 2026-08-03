-- Restore the per-stylist push opt-out (profiles.push_disabled_types).
--
-- The "Real-time activity pushes" toggles in Account write the muted
-- notification types into profiles.push_disabled_types, but the trigger
-- function push_stylist_addressed_email() stopped honoring that column
-- when 20260909_push_only_stylist_facing.sql redefined it to add the
-- client-facing denylist — the opt-out check that
-- 20260823_push_disabled_types.sql had added was silently dropped in
-- that rewrite. Net effect: toggling a category off (New reviews,
-- Client booking changes, Contract activity) still web-pushed the
-- stylist; the toggle was dead.
--
-- This redefinition keeps the 20260909 client-facing denylist verbatim
-- and re-inserts the opt-out check in its original place (right after
-- the stylist-email match). Email + in-app bell are unaffected — only
-- the OS push is suppressed for a type the stylist muted. The opt-out
-- read is wrapped so a missing profiles row or any error defaults to
-- "all on" and never blocks the notification_queue insert.

create or replace function public.push_stylist_addressed_email()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_stylist_email  text;
  v_title          text;
  v_body           text;
  v_tag            text;
  v_disabled_types text[];
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

  -- Honor the stylist's per-type push opt-outs (Account →
  -- "Real-time activity pushes"). Empty/null array = all on. Wrapped so
  -- a missing profiles row or any error fails safe to "all on" and can
  -- never throw out of the trigger and block the queue insert.
  begin
    select coalesce(push_disabled_types, '{}'::text[])
      into v_disabled_types
      from public.profiles
      where id = NEW.user_id;
  exception when others then
    v_disabled_types := '{}'::text[];
  end;
  if NEW.notification_type is not null
     and NEW.notification_type = any(v_disabled_types) then
    return NEW;  -- stylist opted out of push for this type
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
