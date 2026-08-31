-- Credits: charge what a send actually costs, and open the wallet to
-- metered features beyond SMS.
--
-- Two problems, one root cause -- the wallet only knew how to spend
-- exactly one credit on exactly one thing.
--
-- 1. consume_sms_credit decremented 1 per message regardless of length,
--    while Twilio bills per segment (160 GSM-7 chars for a lone
--    message, 153 each once concatenated; 70 / 67 when any character
--    forces UCS-2). Real traffic already averages ~1.09 segments per
--    credit, and one 506-character message billed four segments against
--    a single credit. Marketing blasts are long by nature, so the leak
--    widens exactly as sending grows.
--
-- 2. The AI routes (business coach, rebooking, social, style consult,
--    booking concierge) call Anthropic on the platform's key and charge
--    nothing. They cost more per call than a text does.
--
-- So: a generic consume_credits/refund_credits pair that moves N
-- credits for a named reason, with the SMS entry points reimplemented
-- on top. One balance, one ledger, one audit trail.
--
-- Ledger reasons gain 'ai'. Existing rows and reasons are untouched.

-- ---------------------------------------------------------------
-- 1. Ledger: allow AI spend as a distinct reason.
-- ---------------------------------------------------------------
alter table public.sms_credit_ledger
  drop constraint if exists sms_credit_ledger_reason_check;
alter table public.sms_credit_ledger
  add constraint sms_credit_ledger_reason_check
  check (reason in ('purchase', 'send', 'refund', 'adjustment', 'ai'));

-- ---------------------------------------------------------------
-- 2. sms_segments — how many segments a body actually bills.
-- ---------------------------------------------------------------
-- GSM-7 is the cheap encoding: 160 characters alone, 153 apiece once a
-- message splits (the UDH header eats 7). A single character outside
-- the GSM-7 set -- most often an emoji or a curly quote pasted from a
-- phone keyboard -- forces the whole message to UCS-2, where the
-- limits collapse to 70 and 67. That cliff is why a short, friendly
-- text with one emoji can cost double a longer plain one, and why
-- counting characters alone would still under-bill.
--
-- The GSM-7 set is approximated by its printable ASCII core plus the
-- handful of Latin-1 letters carriers accept. Anything else is treated
-- as UCS-2, which errs toward charging correctly rather than cheaply.
create or replace function public.sms_segments(body_in text)
returns integer
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  body     text := coalesce(body_in, '');
  len      integer;
  is_gsm   boolean;
  single   integer;
  multi    integer;
begin
  len := length(body);
  if len = 0 then
    -- An empty body never reaches Twilio, but a caller asking what it
    -- would cost should get the same answer as the one-segment floor.
    return 1;
  end if;

  is_gsm := body ~ '^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&''()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\[~\]|€\\]*$';

  if is_gsm then
    single := 160; multi := 153;
  else
    single := 70;  multi := 67;
  end if;

  if len <= single then
    return 1;
  end if;
  return ceil(len::numeric / multi)::integer;
end $$;

revoke all on function public.sms_segments(text) from public;
grant execute on function public.sms_segments(text) to service_role, authenticated;

-- ---------------------------------------------------------------
-- 3. consume_credits — atomic multi-credit spend.
-- ---------------------------------------------------------------
-- The single UPDATE with `balance >= amount` is what makes this safe
-- against concurrent workers: two callers racing for the last credit
-- cannot both win, because only one UPDATE can see a sufficient
-- balance. Returns the amount actually charged so the caller can
-- refund exactly that much if the downstream send fails.
--
-- Partial spends are deliberately refused. Charging 2 of 4 segments
-- would bill for a text the carrier will never assemble.
create or replace function public.consume_credits(
  user_id_in   uuid,
  amount_in    integer,
  reason_in    text default 'send',
  note_in      text default null,
  recipient_in text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_amount  integer := greatest(1, coalesce(amount_in, 1));
  v_balance integer;
begin
  if reason_in not in ('send', 'ai', 'adjustment') then
    return jsonb_build_object('ok', false, 'reason', 'bad_reason');
  end if;

  update public.sms_credits
     set balance = balance - v_amount, updated_at = now()
   where user_id = user_id_in and balance >= v_amount
   returning balance into v_balance;

  if v_balance is null then
    -- Report what was needed so the caller can tell the stylist how
    -- short they are rather than a bare "no credits".
    return jsonb_build_object(
      'ok', false,
      'reason', 'insufficient_credits',
      'needed', v_amount,
      'balance', coalesce(
        (select balance from public.sms_credits where user_id = user_id_in), 0)
    );
  end if;

  insert into public.sms_credit_ledger (user_id, delta, reason, note, recipient)
  values (
    user_id_in,
    -v_amount,
    reason_in,
    nullif(trim(coalesce(note_in, '')), ''),
    nullif(trim(coalesce(recipient_in, '')), '')
  );

  return jsonb_build_object('ok', true, 'balance', v_balance, 'charged', v_amount);
end $$;

revoke all on function public.consume_credits(uuid, integer, text, text, text) from public;
grant execute on function public.consume_credits(uuid, integer, text, text, text) to service_role;

-- ---------------------------------------------------------------
-- 4. refund_credits — give back exactly what was charged.
-- ---------------------------------------------------------------
create or replace function public.refund_credits(
  user_id_in uuid,
  amount_in  integer default 1,
  note_in    text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_amount  integer := greatest(1, coalesce(amount_in, 1));
  v_balance integer;
begin
  insert into public.sms_credits (user_id, balance)
  values (user_id_in, v_amount)
  on conflict (user_id) do update
    set balance = public.sms_credits.balance + v_amount, updated_at = now()
  returning balance into v_balance;

  insert into public.sms_credit_ledger (user_id, delta, reason, note)
  values (user_id_in, v_amount, 'refund', note_in);

  return jsonb_build_object('ok', true, 'balance', v_balance);
end $$;

revoke all on function public.refund_credits(uuid, integer, text) from public;
grant execute on function public.refund_credits(uuid, integer, text) to service_role;

-- ---------------------------------------------------------------
-- 5. SMS entry points, reimplemented on the generic wallet.
-- ---------------------------------------------------------------
-- Same three-argument signature the worker already calls, so this
-- deploys without a coordinated worker release. The difference is the
-- amount: segments, not 1. The response now carries `charged` so the
-- worker can refund the right number on a Twilio failure.
create or replace function public.consume_sms_credit(
  user_id_in   uuid,
  body_in      text default null,
  recipient_in text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_segments integer := public.sms_segments(body_in);
begin
  return public.consume_credits(
    user_id_in   => user_id_in,
    amount_in    => v_segments,
    reason_in    => 'send',
    note_in      => body_in,
    recipient_in => recipient_in
  );
end $$;

revoke all on function public.consume_sms_credit(uuid, text, text) from public;
grant execute on function public.consume_sms_credit(uuid, text, text) to service_role;

-- Kept for callers that refund a single credit; the worker now passes
-- the charged amount through refund_credits instead.
create or replace function public.refund_sms_credit(
  user_id_in uuid,
  note_in    text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  return public.refund_credits(user_id_in, 1, note_in);
end $$;

revoke all on function public.refund_sms_credit(uuid, text) from public;
grant execute on function public.refund_sms_credit(uuid, text) to service_role;

notify pgrst, 'reload schema';
