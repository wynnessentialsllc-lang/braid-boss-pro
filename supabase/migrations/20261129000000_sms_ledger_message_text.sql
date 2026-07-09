-- SMS ledger — record the message text on every send.
--
-- The SMS credits "Transaction history" only showed "Text sent" with no
-- way to see WHICH message went out. The ledger already has a `note`
-- column (used for purchases/refunds) but the send path never populated
-- it. This teaches consume_sms_credit to store the exact outbound text
-- so the app can show it when a stylist taps a history row.
--
-- Backward compatible: body_in defaults to null, so any older caller that
-- passes only user_id_in still resolves to this function and behaves as
-- before (note stays null). Historical send rows keep their null note —
-- the text was never captured for them; the UI degrades gracefully.

-- Old single-arg signature is replaced by the two-arg one below. Drop it
-- first so we don't leave an ambiguous overload behind.
drop function if exists public.consume_sms_credit(uuid);

create or replace function public.consume_sms_credit(
  user_id_in uuid,
  body_in    text default null
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

  insert into public.sms_credit_ledger (user_id, delta, reason, note)
  values (user_id_in, -1, 'send', nullif(trim(coalesce(body_in, '')), ''));

  return jsonb_build_object('ok', true, 'balance', v_balance);
end;
$function$;

revoke all on function public.consume_sms_credit(uuid, text) from public;
grant execute on function public.consume_sms_credit(uuid, text) to service_role;
