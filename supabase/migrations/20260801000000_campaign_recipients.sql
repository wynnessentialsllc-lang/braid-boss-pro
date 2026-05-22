-- Per-recipient tracking for marketing campaigns.
--
-- process_marketing_campaign enqueues one notification_queue row per
-- client (notification_type 'marketing_campaign', payload.campaignId
-- set, client_id populated). That row already carries the delivery
-- outcome — status / sent_at / failure_reason. This RPC surfaces it
-- so the campaign detail screen can show exactly WHO a campaign went
-- to and whether each email landed, instead of just a count.
--
-- SECURITY DEFINER + an explicit owner check: a stylist can only
-- read recipients for their own campaigns.

create or replace function public.list_campaign_recipients(campaign_id_in uuid)
returns table (
  client_id       text,
  recipient_name  text,
  recipient_email text,
  status          text,
  sent_at         timestamptz,
  failure_reason  text,
  created_at      timestamptz
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_owner  uuid;
  v_caller uuid := auth.uid();
begin
  select user_id into v_owner
  from public.marketing_campaigns
  where id = campaign_id_in;

  if v_owner is null then
    return;                       -- unknown campaign → empty result
  end if;
  if v_caller is null or v_caller <> v_owner then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select nq.client_id,
           nq.recipient_name,
           nq.recipient_email,
           nq.status,
           nq.sent_at,
           nq.failure_reason,
           nq.created_at
    from public.notification_queue nq
    where nq.user_id = v_owner
      and nq.notification_type = 'marketing_campaign'
      and nq.payload->>'campaignId' = campaign_id_in::text
    order by nq.recipient_name asc nulls last, nq.created_at asc;
end;
$function$;

revoke all on function public.list_campaign_recipients(uuid) from public;
grant execute on function public.list_campaign_recipients(uuid) to authenticated;
