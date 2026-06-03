-- Friendly stylist-bell label for the consolidated "appointment
-- updated" client email.
--
-- The stylist edit flow now sends a single `appointment_updated` email
-- whenever a date/time, price, or add-on change lands on an existing
-- appointment (superseding the date/time-only `appointment_rescheduled`
-- path for stylist edits). The mirror trigger that surfaces outbound
-- client emails in the stylist's in-app bell otherwise falls back to a
-- generic "Email sent" for this new type — add a specific label so the
-- activity feed reads clearly.
--
-- This only extends the CASE in mirror_client_email_to_notifications;
-- behavior is otherwise unchanged from 20260808000000.

create or replace function public.mirror_client_email_to_notifications()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_stylist_email text;
  v_title         text;
  v_body          text;
begin
  -- Only mirror outbound email rows that actually have a recipient.
  if NEW.channel <> 'email' then return NEW; end if;
  if NEW.recipient_email is null or trim(NEW.recipient_email) = '' then
    return NEW;
  end if;

  -- Skip stylist-addressed emails (the stylist IS the recipient).
  begin
    select email into v_stylist_email from auth.users where id = NEW.user_id;
  exception when others then
    v_stylist_email := null;
  end;
  if v_stylist_email is not null
     and lower(NEW.recipient_email) = lower(v_stylist_email) then
    return NEW;
  end if;

  -- Friendly title per notification_type. Unknown types fall back to
  -- a generic "Email sent" so future types still surface.
  v_title := case NEW.notification_type
    when 'booking_confirmation'           then 'Booking confirmation emailed'
    when 'appointment_approved'           then 'Approval notice emailed'
    when 'appointment_confirmed'          then 'Confirmation emailed'
    when 'appointment_reminder'           then 'Reminder emailed'
    when 'appointment_rescheduled'        then 'Reschedule notice emailed'
    when 'appointment_updated'            then 'Appointment update emailed'
    when 'client_booking_rescheduled'     then 'Reschedule notice emailed'
    when 'client_booking_cancelled'       then 'Cancellation emailed'
    when 'deposit_received'               then 'Deposit receipt emailed'
    when 'balance_paid'                   then 'Balance receipt emailed'
    when 'review_request'                 then 'Review request emailed'
    when 'contract_signing'               then 'Contract sign-link emailed'
    when 'contract_signing_email'         then 'Contract sign-link emailed'
    when 'contract_invite'                then 'Contract invite emailed'
    when 'order_confirmation'             then 'Order confirmation emailed'
    when 'order_ready_for_pickup'         then 'Pickup-ready notice emailed'
    when 'order_shipped'                  then 'Shipment notice emailed'
    when 'gift_card_issued'               then 'Gift card emailed'
    when 'booking_denied_no_charge'       then 'Decline notice emailed'
    when 'booking_denied_refunded'        then 'Decline + refund emailed'
    when 'booking_denied_refund_manual'   then 'Decline emailed (refund manually)'
    when 'rebook_nudge'                   then 'Rebook nudge emailed'
    when 'birthday_greeting'              then 'Birthday greeting emailed'
    when 'winback'                        then 'Win-back emailed'
    when 'new_client_welcome'             then 'Welcome email sent'
    when 'reorder_nudge'                  then 'Re-order nudge emailed'
    when 'marketing_campaign'             then 'Campaign sent'
    else                                       'Email sent'
  end;

  v_body := 'To ' || coalesce(nullif(trim(coalesce(NEW.recipient_name, '')), ''),
                              NEW.recipient_email);

  -- Mirror — id is deterministic on the queue row so a re-fire can't
  -- duplicate, and the outer exception clamps any other failure.
  begin
    insert into public.notifications (
      id, user_id, category, title, body, data
    ) values (
      'qmail:' || NEW.id::text,
      NEW.user_id,
      'communication',
      v_title,
      v_body,
      jsonb_build_object(
        'queueId',          NEW.id,
        'notificationType', NEW.notification_type,
        'recipientEmail',   NEW.recipient_email,
        'recipientName',    NEW.recipient_name,
        'subject',          NEW.subject,
        'channel',          NEW.channel,
        'clientId',         NEW.client_id,
        'appointmentId',    NEW.appointment_id
      )
    );
  exception when others then
    null;  -- never block the queue insert
  end;

  return NEW;
end;
$function$;

drop trigger if exists trg_mirror_client_email on public.notification_queue;
create trigger trg_mirror_client_email
  after insert on public.notification_queue
  for each row execute function public.mirror_client_email_to_notifications();
