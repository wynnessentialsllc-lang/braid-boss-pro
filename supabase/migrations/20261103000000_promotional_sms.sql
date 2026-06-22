-- Promotional / marketing SMS — stylist-composed campaign blasts.
--
-- Marketing has been email-only. This lets a stylist send a one-off
-- campaign over SMS instead, to clients who gave the separate marketing
-- SMS consent on the booking form (booking_requests.sms_marketing_opt_in,
-- added in 20261102). Scope is intentionally narrow:
--   * Only the stylist-composed "marketing_campaign" type can go out via
--     SMS. The automated nudges (rebook/winback/birthday/reorder) stay
--     email-only.
--   * Per-stylist opt-in: profiles.sms_marketing_enabled (default FALSE),
--     in addition to the existing master profiles.sms_notifications_enabled
--     gate enforced inside queue_notification().
--   * Recipient eligibility is resolved at send time: client has a phone,
--     that phone gave marketing SMS consent on a booking, and it isn't on
--     the STOP list. Credits are consumed by the worker at send time.

-- ---------------------------------------------------------------
-- Per-stylist promotional-SMS opt-in
-- ---------------------------------------------------------------
alter table public.profiles
  add column if not exists sms_marketing_enabled boolean not null default false;

-- Owner-controlled setter (mirrors set_sms_notifications_enabled). Flips
-- the flag for the calling stylist only; touches no other column or row.
create or replace function public.set_sms_marketing_enabled(enabled_in boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  update public.profiles
     set sms_marketing_enabled = coalesce(enabled_in, false),
         updated_at = now()
   where id = caller;
  return coalesce(enabled_in, false);
end;
$$;

revoke all on function public.set_sms_marketing_enabled(boolean) from public;
grant execute on function public.set_sms_marketing_enabled(boolean) to authenticated;

-- ---------------------------------------------------------------
-- Campaign channel
-- ---------------------------------------------------------------
-- Defaults to 'email' so every existing campaign keeps its behaviour.
alter table public.marketing_campaigns
  add column if not exists channel text not null default 'email'
    check (channel in ('email', 'sms'));

-- Defensive: marketing SMS needs a phone on the client row. The column is
-- written by the app sync layer already; ensure it exists for the joins.
alter table public.clients
  add column if not exists phone text;

-- ---------------------------------------------------------------
-- Channel-aware recipient counter (composer "Send to N" preview)
-- ---------------------------------------------------------------
-- New 2-arg overload; the existing 1-arg count_marketing_segment(jsonb)
-- (email) is left in place for any caller that doesn't pass a channel.
create or replace function public.count_marketing_segment(
  segment_in jsonb,
  channel_in text
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

  if coalesce(channel_in, 'email') <> 'sms' then
    return public.count_marketing_segment(segment_in);
  end if;

  -- SMS eligibility: phone present + gave marketing SMS consent on a
  -- booking + not on the STOP list. Segment filter mirrors the email path.
  select count(*) into v_count
    from public.clients c
   where c.user_id = caller
     and c.phone is not null
     and length(public.sms_normalize_phone(c.phone)) >= 7
     and not exists (
       select 1 from public.sms_opt_outs o
        where o.phone = public.sms_normalize_phone(c.phone))
     and exists (
       select 1 from public.booking_requests br
        where br.user_id = caller
          and coalesce(br.sms_marketing_opt_in, false) = true
          and public.sms_normalize_phone(br.client_phone) = public.sms_normalize_phone(c.phone))
     and (
       v_kind is null or v_kind = 'all'
       or (v_kind = 'active_last' and exists (
         select 1 from public.appointments a
         where a.user_id = caller and a.client_id = c.id
           and a.appt_date >= current_date - make_interval(days => coalesce(v_days, 90))
           and a.status not in ('cancelled', 'canceled')
           and (a.status = 'completed' or a.payment_status = 'paid')
       ))
       or (v_kind = 'lapsed' and exists (
         select 1 from public.appointments a
         where a.user_id = caller and a.client_id = c.id
           and a.status not in ('cancelled', 'canceled')
           and (a.status = 'completed' or a.payment_status = 'paid')
       ) and not exists (
         select 1 from public.appointments a2
         where a2.user_id = caller and a2.client_id = c.id
           and a2.appt_date >= current_date - make_interval(days => coalesce(v_min_days, 90))
           and a2.status not in ('cancelled', 'canceled')
           and (a2.status = 'completed' or a2.payment_status = 'paid')
       ))
       or (v_kind = 'manual' and c.id in (
         select jsonb_array_elements_text(coalesce(segment_in->'client_ids', '[]'::jsonb))
       ))
     );

  return v_count;
end $$;

revoke all on function public.count_marketing_segment(jsonb, text) from public;
grant execute on function public.count_marketing_segment(jsonb, text) to authenticated;

-- ---------------------------------------------------------------
-- Campaign processor — now channel-aware
-- ---------------------------------------------------------------
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
  v_book_url text;
  v_channel text;
  v_sms text;
  v_res jsonb;
  v_enqueued int := 0;
  v_failed int := 0;
  r record;
  v_token text;
  v_dedupe text;
  v_payload jsonb;
begin
  select * into v_campaign from public.marketing_campaigns
    where id = campaign_id_in for update;
  if v_campaign.id is null then
    raise exception 'campaign_not_found';
  end if;
  if v_caller is not null and v_caller <> v_campaign.user_id then
    raise exception 'forbidden';
  end if;
  if v_campaign.status in ('sending', 'sent') then
    return 0;
  end if;

  v_channel := coalesce(v_campaign.channel, 'email');

  -- Promotional SMS requires the stylist's marketing-SMS opt-in. (The
  -- master SMS switch is enforced separately inside queue_notification.)
  if v_channel = 'sms' and not coalesce(
       (select sms_marketing_enabled from public.profiles where id = v_campaign.user_id),
       false) then
    raise exception 'sms_marketing_disabled';
  end if;

  update public.marketing_campaigns
    set status = 'sending', updated_at = now()
    where id = campaign_id_in;

  v_kind     := v_campaign.segment->>'kind';
  v_days     := nullif(v_campaign.segment->>'days', '')::int;
  v_min_days := nullif(v_campaign.segment->>'min_days', '')::int;

  select coalesce(p.business_name, p.full_name),
         coalesce(bl.slug, p.public_slug)
    into v_studio, v_slug
    from public.profiles p
    left join public.booking_links bl on bl.user_id = p.id and bl.active = true
    where p.id = v_campaign.user_id;

  v_book_url := case
    when v_slug is not null and length(trim(v_slug)) > 0
      then 'https://braidbosspro.app/book/' || v_slug
    else 'https://braidbosspro.app'
  end;

  if v_channel = 'sms' then
    -- SMS recipients: phone + marketing SMS consent + not opted out.
    for r in
      with recipients as (
        select c.id, c.name, c.phone
          from public.clients c
         where c.user_id = v_campaign.user_id
           and c.phone is not null
           and length(public.sms_normalize_phone(c.phone)) >= 7
           and not exists (
             select 1 from public.sms_opt_outs o
              where o.phone = public.sms_normalize_phone(c.phone))
           and exists (
             select 1 from public.booking_requests br
              where br.user_id = v_campaign.user_id
                and coalesce(br.sms_marketing_opt_in, false) = true
                and public.sms_normalize_phone(br.client_phone) = public.sms_normalize_phone(c.phone))
           and (
             v_kind is null or v_kind = 'all'
             or (v_kind = 'active_last' and exists (
               select 1 from public.appointments a
               where a.user_id = v_campaign.user_id and a.client_id = c.id
                 and a.appt_date >= current_date - make_interval(days => coalesce(v_days, 90))
                 and a.status not in ('cancelled', 'canceled')
                 and (a.status = 'completed' or a.payment_status = 'paid')
             ))
             or (v_kind = 'lapsed' and exists (
               select 1 from public.appointments a
               where a.user_id = v_campaign.user_id and a.client_id = c.id
                 and a.status not in ('cancelled', 'canceled')
                 and (a.status = 'completed' or a.payment_status = 'paid')
             ) and not exists (
               select 1 from public.appointments a2
               where a2.user_id = v_campaign.user_id and a2.client_id = c.id
                 and a2.appt_date >= current_date - make_interval(days => coalesce(v_min_days, 90))
                 and a2.status not in ('cancelled', 'canceled')
                 and (a2.status = 'completed' or a2.payment_status = 'paid')
             ))
             or (v_kind = 'manual' and c.id in (
               select jsonb_array_elements_text(coalesce(v_campaign.segment->'client_ids', '[]'::jsonb))
             ))
           )
      )
      select id, name, phone from recipients
    loop
      v_dedupe := 'campaign:' || v_campaign.id || ':' || r.id;
      -- Substitute merge tags in SQL (the email path renders these in the
      -- edge function; SMS bodies are plain text so we do it here). The
      -- worker appends "Reply STOP to opt out" automatically.
      v_sms := coalesce(v_campaign.body_text, '');
      v_sms := replace(v_sms, '{{client_name}}', coalesce(nullif(trim(r.name), ''), 'there'));
      v_sms := replace(v_sms, '{{studio_name}}', coalesce(v_studio, 'your stylist'));
      v_sms := replace(v_sms, '{{book_url}}', v_book_url);

      v_payload := jsonb_build_object(
        'smsText', v_sms,
        'campaignId', v_campaign.id::text
      );

      begin
        select public.queue_notification(
          v_campaign.user_id, 'sms', 'marketing_campaign',
          v_sms, null,
          null, r.phone, r.name,
          v_payload, null, v_dedupe, null, null, r.id, null
        ) into v_res;
        if coalesce((v_res->>'ok')::boolean, false) then
          v_enqueued := v_enqueued + 1;
        else
          v_failed := v_failed + 1;
        end if;
      exception when others then
        v_failed := v_failed + 1;
      end;
    end loop;
  else
    -- Email recipients (unchanged from 20260726).
    for r in
      with recipients as (
        select c.id, c.name, c.email
          from public.clients c
         where c.user_id = v_campaign.user_id
           and c.marketing_emails_enabled = true
           and c.email is not null and length(trim(c.email)) > 3
           and (
             v_kind is null or v_kind = 'all'
             or (v_kind = 'active_last' and exists (
               select 1 from public.appointments a
               where a.user_id = v_campaign.user_id and a.client_id = c.id
                 and a.appt_date >= current_date - make_interval(days => coalesce(v_days, 90))
                 and a.status not in ('cancelled', 'canceled')
                 and (a.status = 'completed' or a.payment_status = 'paid')
             ))
             or (v_kind = 'lapsed' and exists (
               select 1 from public.appointments a
               where a.user_id = v_campaign.user_id and a.client_id = c.id
                 and a.status not in ('cancelled', 'canceled')
                 and (a.status = 'completed' or a.payment_status = 'paid')
             ) and not exists (
               select 1 from public.appointments a2
               where a2.user_id = v_campaign.user_id and a2.client_id = c.id
                 and a2.appt_date >= current_date - make_interval(days => coalesce(v_min_days, 90))
                 and a2.status not in ('cancelled', 'canceled')
                 and (a2.status = 'completed' or a2.payment_status = 'paid')
             ))
             or (v_kind = 'manual' and c.id in (
               select jsonb_array_elements_text(coalesce(v_campaign.segment->'client_ids', '[]'::jsonb))
             ))
           )
      )
      select id, name, email from recipients
    loop
      v_dedupe := 'campaign:' || v_campaign.id || ':' || r.id;
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
          v_campaign.user_id, 'email', 'marketing_campaign',
          v_campaign.body_text, v_campaign.subject,
          r.email, null, r.name,
          v_payload, null, v_dedupe, null, null, r.id, null
        );
        v_enqueued := v_enqueued + 1;
      exception when others then
        v_failed := v_failed + 1;
      end;
    end loop;
  end if;

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

notify pgrst, 'reload schema';
