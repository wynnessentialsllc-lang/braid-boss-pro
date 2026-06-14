-- Gift cards — in-person redemption (Boss Checkout).
--
-- The original redemption path (20260803) only covers ONLINE orders: its
-- RPC keys on product_order_id and is granted to service_role for the
-- Stripe webhook. Boss Checkout redeems a card AT THE CHAIR, where there
-- is no product_order and the caller is the signed-in stylist. This adds
-- an authenticated, idempotent in-person redemption path that reuses the
-- same gift_card_redemptions ledger.

-- ---------------------------------------------------------------
-- Generalise the ledger so a redemption can be tied to an in-person
-- sale (the Boss Checkout transaction id) instead of a product order.
-- product_order_id becomes optional; sale_id is the idempotency key for
-- chair-side redemptions. A partial unique index keeps one redemption
-- per sale without affecting the existing per-order uniqueness.
-- ---------------------------------------------------------------
alter table public.gift_card_redemptions
  alter column product_order_id drop not null;
alter table public.gift_card_redemptions
  add column if not exists sale_id text;
create unique index if not exists gift_card_redemptions_sale_id_key
  on public.gift_card_redemptions (sale_id)
  where sale_id is not null;

-- Owner can insert their own redemption rows (the RPC is security
-- definer, but keeping an explicit policy is consistent with the rest
-- of the schema and harmless).
drop policy if exists gift_card_redemptions_owner_insert on public.gift_card_redemptions;
create policy gift_card_redemptions_owner_insert on public.gift_card_redemptions
  for insert with check (user_id = auth.uid());

-- ---------------------------------------------------------------
-- redeem_gift_card_in_person — idempotent on sale_id. Validates that
-- the card belongs to the caller, that the balance covers the amount,
-- records the redemption, and decrements the balance exactly once per
-- sale. Returns the new balance, or a reason on failure.
-- ---------------------------------------------------------------
create or replace function public.redeem_gift_card_in_person(
  card_id_in  uuid,
  sale_id_in  text,
  amount_in   numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_bal numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if sale_id_in is null or length(trim(sale_id_in)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_sale');
  end if;
  if amount_in is null or amount_in <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_amount');
  end if;

  -- Idempotency: a replay of the same sale is a no-op success.
  if exists (select 1 from public.gift_card_redemptions where sale_id = sale_id_in) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  -- Lock the card and validate ownership + funds.
  select balance into v_bal
    from public.gift_cards
   where id = card_id_in and user_id = v_uid
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_bal < amount_in then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'balance', v_bal);
  end if;

  insert into public.gift_card_redemptions (gift_card_id, user_id, amount, sale_id)
  values (card_id_in, v_uid, amount_in, sale_id_in);

  update public.gift_cards
     set balance    = balance - amount_in,
         status     = case when balance - amount_in <= 0 then 'depleted' else status end,
         updated_at = now()
   where id = card_id_in and user_id = v_uid;

  return jsonb_build_object('ok', true, 'balance', v_bal - amount_in);
end;
$function$;

revoke all on function public.redeem_gift_card_in_person(uuid, text, numeric) from public;
grant execute on function public.redeem_gift_card_in_person(uuid, text, numeric) to authenticated;
