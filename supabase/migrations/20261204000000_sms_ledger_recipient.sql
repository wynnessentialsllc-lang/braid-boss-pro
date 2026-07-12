-- SMS ledger — record WHO each text was sent to.
--
-- The credit history now shows the message text (20261129) but not the
-- recipient, so a stylist can't tell which client a reminder went to. Add a
-- `recipient` column and teach consume_sms_credit to store the client name
-- the send path already knows (notification_queue.recipient_name).
--
-- Backward compatible: recipient_in defaults to null, and the column is
-- nullable, so historical rows and any older caller keep working (recipient
-- stays null; the UI degrades to just the message text).

alter table public.sms_credit_ledger
  add column if not exists recipient text;

-- Replace the two-arg signature with a three-arg one so there's no
-- ambiguous overload (mirrors how 20261129 replaced the one-arg version).
drop function if exists public.consume_sms_credit(uuid, text);

create or replace function public.consume_sms_credit(
  user_id_in   uuid,
  body_in      text default null,
  recipient_in text default null
)
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

  insert into public.sms_credit_ledger (user_id, delta, reason, note, recipient)
  values (
    user_id_in,
    -1,
    'send',
    nullif(trim(coalesce(body_in, '')), ''),
    nullif(trim(coalesce(recipient_in, '')), '')
  );

  return jsonb_build_object('ok', true, 'balance', v_balance);
end;
$function$;

revoke all on function public.consume_sms_credit(uuid, text, text) from public;
grant execute on function public.consume_sms_credit(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
