-- Marketing campaigns — hand-picked recipient segment.
-- Adds a `manual` segment kind: { "kind":"manual", "client_ids":[...] }
--
-- Extends count_marketing_segment + process_marketing_campaign with
-- a `manual` branch so the campaign composer can target individually
-- chosen clients instead of only the bucket segments. CREATE OR
-- REPLACE — idempotent, signatures unchanged.
--
-- clients.id is text; the explicit ::text casts on c.id and the
-- dedupe key are defensive no-ops that keep the comparison correct
-- regardless of the column type.

create or replace function public.count_marketing_segment(
  segment_in jsonb
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  v_kind text := segment_in->>'kind';
  v_days int := nullif(segment_in->>'days', '')::int;
  v_min_days int := nullif(segment_in->>'min_days', '')::int;
  v_count int := 0;
begin
  if caller is null then return 0; end if;

  if v_kind = 'all' or v_kind is null then
    select count(*) into v_count
    from public.clients c
    where c.user_id = caller
      and c.marketing_emails_enabled = true
      and c.email is not null
      and length(trim(c.email)) > 3;

  elsif v_kind = 'active_last' then
    select count(distinct c.id) into v_count
    from public.clients c
    where c.user_id = caller
      and c.marketing_emails_enabled = true
      and c.email is not null
      and length(trim(c.email)) > 3
      and exists (
        select 1
        from public.appointments a
        where a.user_id = caller
          and a.client_id = c.id
          and a.appt_date >= current_date - make_interval(days => coalesce(v_days, 90))
          and a.status not in ('cancelled', 'canceled')
          and (a.status = 'completed' or a.payment_status = 'paid')
      );

  elsif v_kind = 'lapsed' then
    select count(distinct c.id) into v_count
    from public.clients c
    where c.user_id = caller
      and c.marketing_emails_enabled = true
      and c.email is not null
      and length(trim(c.email)) > 3
      and exists (
        select 1
        from public.appointments a
        where a.user_id = caller
          and a.client_id = c.id
          and a.status not in ('cancelled', 'canceled')
          and (a.status = 'completed' or a.payment_status = 'paid')
      )
      and not exists (
        select 1
        from public.appointments a2
        where a2.user_id = caller
          and a2.client_id = c.id
          and a2.appt_date >= current_date - make_interval(days => coalesce(v_min_days, 90))
          and a2.status not in ('cancelled', 'canceled')
          and (a2.status = 'completed' or a2.payment_status = 'paid')
      );

  elsif v_kind = 'manual' then
    select count(*) into v_count
    from public.clients c
    where c.user_id = caller
      and c.marketing_emails_enabled = true
      and c.email is not null
      and length(trim(c.email)) > 3
      and c.id::text in (
        select jsonb_array_elements_text(coalesce(segment_in->'client_ids', '[]'::jsonb))
      );
  end if;

  return v_count;
end $$;

revoke all on function public.count_marketing_segment(jsonb) from public;
grant execute on function public.count_marketing_segment(jsonb) to authenticated;


create or replace function public.process_marketing_campaign(
  campaign_id_in uuid
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.marketing_campaigns%rowtype;
  v_caller uuid := auth.uid();
  v_kind text;
  v_days int;
  v_min_days int;
  v_studio text;
  v_slug text;
  v_enqueued int := 0;
  v_failed int := 0;
  r record;
  v_token text;
  v_dedupe text;
  v_payload jsonb;
begin
  select * into v_campaign
  from public.marketing_campaigns
  where id = campaign_id_in
  for update;

  if v_campaign.id is null then
    raise exception 'campaign_not_found';
  end if;

  if v_caller is not null and v_caller <> v_campaign.user_id then
    raise exception 'forbidden';
  end if;

  if v_campaign.status in ('sending', 'sent') then
    return 0;
  end if;

  update public.marketing_campaigns
  set status = 'sending',
      updated_at = now()
  where id = campaign_id_in;

  v_kind     := v_campaign.segment->>'kind';
  v_days     := nullif(v_campaign.segment->>'days', '')::int;
  v_min_days := nullif(v_campaign.segment->>'min_days', '')::int;

  select coalesce(p.business_name, p.full_name),
         coalesce(bl.slug, p.public_slug)
  into v_studio, v_slug
  from public.profiles p
  left join public.booking_links bl
    on bl.user_id = p.id
   and bl.active = true
  where p.id = v_campaign.user_id;

  for r in
    with recipients as (
      select c.id, c.name, c.email
      from public.clients c
      where c.user_id = v_campaign.user_id
        and c.marketing_emails_enabled = true
        and c.email is not null
        and length(trim(c.email)) > 3
        and (
          v_kind is null
          or v_kind = 'all'

          or (
            v_kind = 'active_last'
            and exists (
              select 1
              from public.appointments a
              where a.user_id = v_campaign.user_id
                and a.client_id = c.id
                and a.appt_date >= current_date - make_interval(days => coalesce(v_days, 90))
                and a.status not in ('cancelled', 'canceled')
                and (a.status = 'completed' or a.payment_status = 'paid')
            )
          )

          or (
            v_kind = 'lapsed'
            and exists (
              select 1
              from public.appointments a
              where a.user_id = v_campaign.user_id
                and a.client_id = c.id
                and a.status not in ('cancelled', 'canceled')
                and (a.status = 'completed' or a.payment_status = 'paid')
            )
            and not exists (
              select 1
              from public.appointments a2
              where a2.user_id = v_campaign.user_id
                and a2.client_id = c.id
                and a2.appt_date >= current_date - make_interval(days => coalesce(v_min_days, 90))
                and a2.status not in ('cancelled', 'canceled')
                and (a2.status = 'completed' or a2.payment_status = 'paid')
            )
          )

          or (
            v_kind = 'manual'
            and c.id::text in (
              select jsonb_array_elements_text(coalesce(v_campaign.segment->'client_ids', '[]'::jsonb))
            )
          )
        )
    )
    select id, name, email
    from recipients
  loop
    v_dedupe := 'campaign:' || v_campaign.id::text || ':' || r.id::text;
    v_token := public.ensure_client_marketing_token(v_campaign.user_id, r.id);

    v_payload := jsonb_build_object(
      'subject', v_campaign.subject,
      'bodyText', v_campaign.body_text,
      'clientName', r.name,
      'studioName', coalesce(v_studio, 'your stylist'),
      'bookingSlug', v_slug,
      'unsubscribeToken', v_token,
      'campaignId', v_campaign.id::text
    );

    begin
      perform public.queue_notification(
        v_campaign.user_id,
        'email',
        'marketing_campaign',
        v_campaign.body_text,
        v_campaign.subject,
        r.email,
        null,
        r.name,
        v_payload,
        null,
        v_dedupe,
        null,
        null,
        r.id,
        null
      );

      v_enqueued := v_enqueued + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  update public.marketing_campaigns
  set status = 'sent',
      sent_at = now(),
      recipient_count = v_enqueued,
      failed_count = v_failed,
      updated_at = now()
  where id = campaign_id_in;

  return v_enqueued;
end $$;

revoke all on function public.process_marketing_campaign(uuid) from public;
grant execute on function public.process_marketing_campaign(uuid) to authenticated, service_role;
