-- Customer message grammar fixes.
--
-- Three defects surfaced in real client texts, plus one latent one:
--
--   1. 2-hour reminders truncated the style/studio name at a hard 24-char
--      window with left(), cutting a word in half and leaking a dangling
--      bracket -- e.g. "Boho Knotless Braids (Medium)" texted as
--      "...Braids (Me". Fixed with sms_truncate_label(), which backs off
--      to the last word boundary and strips trailing punctuation so the
--      cap never produces a partial word or an unbalanced "(".
--
--   2. hair_bring_text() appended " packs" to the packs field even when the
--      stylist had already typed "packs" (packs = "6 packs" -> "6 packs
--      packs"). Now it only appends the unit when the value doesn't already
--      mention a pack.
--
--   3. hair_bring_text() left a trailing period on the assembled spec, so a
--      color entered as "Any color of your choice." collided with the
--      caller's own period -> "...choice.." Now trailing punctuation is
--      stripped before the caller adds its sentence period.
--
--   4. Promotional SMS substituted only 3 of the 4 merge tags the email
--      composer offers; a campaign using {{first_name}} texted the literal
--      "{{first_name}}" to the client. Now substituted like the email path.
--
-- Every reproduced function is byte-for-byte its latest definition with
-- only the lines above changed.

-- ---- Word-boundary-safe SMS label truncation ----------------------
-- Caps a free-text name to keep an SMS within one segment WITHOUT cutting
-- a word in half. Returns the trimmed value untouched when it already
-- fits; otherwise trims to the last whole word inside the window and
-- strips any trailing whitespace/punctuation (including a dangling "(").
create or replace function public.sms_truncate_label(
  label_in text,
  max_len_in int default 24
)
returns text
language plpgsql
immutable
as $$
declare
  v   text;
  cut text;
begin
  v := nullif(btrim(coalesce(label_in, '')), '');
  if v is null then
    return null;
  end if;
  if char_length(v) <= max_len_in then
    return v;
  end if;
  cut := left(v, max_len_in);
  -- Back off to the last word boundary so we never end mid-word.
  if position(' ' in cut) > 0 then
    cut := regexp_replace(cut, '\s+\S*$', '');
  end if;
  -- Drop any trailing whitespace/punctuation left behind (e.g. "Braids (").
  cut := regexp_replace(cut, '[[:space:][:punct:]]+$', '');
  -- Single over-long word (no usable boundary): fall back to a hard cut.
  if nullif(btrim(cut), '') is null then
    cut := btrim(left(v, max_len_in));
  end if;
  return cut;
end;
$$;

revoke all on function public.sms_truncate_label(text, int) from public;
grant execute on function public.sms_truncate_label(text, int) to authenticated, service_role;

-- ---- hair_bring_text: de-dupe the pack unit + strip trailing period --
-- Reproduced from 20261020 with two fixes: don't double the "packs" unit
-- when the stylist already typed it, and strip trailing punctuation so the
-- caller's sentence period doesn't double up.
create or replace function public.hair_bring_text(
  service_id_in uuid,
  short_in      boolean default false
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s     public.services%rowtype;
  brand text; color text; packs text; prep text;
  packs_label text;
  core  text;
begin
  if service_id_in is null then return null; end if;
  select * into s from public.services where id = service_id_in;
  if not found or coalesce(s.hair_sourcing, 'included') not in ('client', 'choice') then
    return null;
  end if;
  brand := nullif(trim(coalesce(s.hair_spec->>'brand', '')), '');
  color := nullif(trim(coalesce(s.hair_spec->>'color', '')), '');
  packs := nullif(trim(coalesce(s.hair_spec->>'packs', '')), '');
  prep  := nullif(trim(coalesce(s.hair_spec->>'prep',  '')), '');
  -- Only append the "packs" unit when the value is a bare count; if the
  -- stylist already wrote "6 packs" leave it as-is (no "6 packs packs").
  packs_label := case
    when packs is null       then null
    when packs ~* 'pack'     then packs
    else packs || ' packs'
  end;
  if short_in then
    -- packs + color only, to keep the SMS within one segment.
    core := nullif(trim(concat_ws(' ', packs_label, color)), '');
    -- Strip trailing punctuation so the caller's period doesn't double.
    core := nullif(regexp_replace(coalesce(core, ''), '[[:space:][:punct:]]+$', ''), '');
    return core;
  end if;
  core := nullif(trim(concat_ws(' ', packs_label, brand, color)), '');
  if core is null then return null; end if;
  core := nullif(regexp_replace(core, '[[:space:][:punct:]]+$', ''), '');
  if core is null then return null; end if;
  if prep is not null then
    return core || '. ' || regexp_replace(prep, '[[:space:][:punct:]]+$', '');
  end if;
  return core;
end;
$$;

revoke all on function public.hair_bring_text(uuid, boolean) from public;
grant execute on function public.hair_bring_text(uuid, boolean) to authenticated, service_role;

-- ---- Appointment confirmation SMS: word-boundary studio truncation ---
create or replace function public.enqueue_appointment_confirmation(
  appt_id_in        text,
  user_id_in        uuid,
  client_name_in    text,
  client_email_in   text,
  client_phone_in   text,
  service_name_in   text,
  appt_date_in      text,
  appt_time_in      text,
  total_price_in    numeric,
  sms_opt_in_in     boolean,
  custom_message_in text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_caller uuid := auth.uid();
  v_studio text;
  v_base   text;
  v_sms    text;
  v_when   text;
  v_msg    text;
  v_datekey text;
  v_sid    uuid;
  v_hair   text;
  v_hair_sms text;
begin
  if v_caller is not null and v_caller <> user_id_in then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_base   := coalesce(nullif(current_setting('app.public_url', true), ''), 'https://braidbosspro.app');
  v_studio := coalesce(nullif(trim(public.public_get_studio_name(user_id_in)), ''), 'your studio');
  v_msg    := nullif(trim(coalesce(custom_message_in, '')), '');
  v_datekey := coalesce(nullif(trim(coalesce(appt_date_in, '')), ''), 'na');

  select br.service_id into v_sid
  from public.booking_requests br
  where br.appointment_id::text = appt_id_in and br.service_id is not null
  order by br.updated_at desc limit 1;
  v_hair := public.hair_bring_text(v_sid, false);
  v_hair_sms := public.hair_bring_text(v_sid, true);

  if client_email_in is not null and position('@' in client_email_in) > 0 then
    perform public.queue_notification(
      user_id_in           => user_id_in,
      channel_in           => 'email',
      notification_type_in => 'appointment_confirmed',
      body_in              => 'Your appointment is confirmed.',
      subject_in           => 'Your appointment is confirmed — ' || v_studio,
      recipient_email_in   => client_email_in,
      recipient_name_in    => client_name_in,
      payload_in           => jsonb_build_object(
        'clientName',       coalesce(client_name_in, 'there'),
        'studioName',       v_studio,
        'serviceName',      service_name_in,
        'preferredDate',    appt_date_in,
        'preferredTime',    appt_time_in,
        'remainingBalance', case when total_price_in is not null and total_price_in > 0
                                 then total_price_in else null end,
        'customMessage',    v_msg,
        'hairBring',        v_hair,
        'appBase',          v_base
      ),
      dedupe_key_in        => 'appointment_confirmed:' || appt_id_in || ':' || v_datekey,
      appointment_id_in    => appt_id_in
    );
  end if;

  if coalesce(sms_opt_in_in, false)
     and client_phone_in is not null
     and length(public.sms_normalize_phone(client_phone_in)) >= 7
     and not exists (select 1 from public.sms_opt_outs o
                     where o.phone = public.sms_normalize_phone(client_phone_in))
     and coalesce((select balance from public.sms_credits where user_id = user_id_in), 0) > 0
  then
    begin
      v_when := case when appt_date_in is not null and appt_date_in <> ''
                     then ' on ' || to_char(appt_date_in::date, 'FMMon FMDD')
                     else '' end
             || case when appt_time_in is not null and appt_time_in <> ''
                     then ' at ' || appt_time_in else '' end;
    exception when others then
      v_when := '';
    end;
    v_sms := 'You''re booked with ' || public.sms_truncate_label(v_studio, 24) || v_when || '.';
    if v_hair_sms is not null then
      v_sms := v_sms || ' Bring: ' || v_hair_sms || '.';
    end if;
    begin
      perform public.queue_notification(
        user_id_in           => user_id_in,
        channel_in           => 'sms',
        notification_type_in => 'appointment_confirmed',
        body_in              => v_sms,
        recipient_phone_in   => client_phone_in,
        recipient_name_in    => client_name_in,
        payload_in           => jsonb_build_object('smsText', v_sms),
        dedupe_key_in        => 'appointment_confirmed_sms:' || appt_id_in || ':' || v_datekey,
        appointment_id_in    => appt_id_in
      );
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.enqueue_appointment_confirmation(
  text, uuid, text, text, text, text, text, text, numeric, boolean, text
) from public;
grant execute on function public.enqueue_appointment_confirmation(
  text, uuid, text, text, text, text, text, text, numeric, boolean, text
) to authenticated, service_role;


-- ---- 2-hour reminder SMS: word-boundary label truncation ---------
create or replace function public.enqueue_due_2h_sms_reminders()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  enqueued int := 0;
  br public.booking_requests%rowtype;
  ap public.appointments%rowtype;
  studio_name text;
  service_label text;
  appt_status text;
  start_ts timestamptz;
  v_tz text;
  sms_body text;
  v_hair_sms text;
begin
  for br in
    select * from public.booking_requests
    where approval_status in ('approved', 'confirmed')
      and cancelled_at is null
      and preferred_date is not null
      and preferred_time is not null
      and preferred_date >= (current_date - 1)
  loop
    if not (coalesce(br.sms_opt_in, false)
            and br.client_phone is not null
            and length(public.sms_normalize_phone(br.client_phone)) >= 7
            and not exists (select 1 from public.sms_opt_outs o
                            where o.phone = public.sms_normalize_phone(br.client_phone))
            and coalesce((select balance from public.sms_credits where user_id = br.user_id), 0) > 0) then
      continue;
    end if;

    v_tz := coalesce(
      nullif(br.timezone, ''),
      (select br2.timezone from public.booking_requests br2
        where br2.user_id = br.user_id and br2.timezone is not null and br2.timezone <> ''
        order by br2.created_at desc limit 1),
      'America/Los_Angeles'
    );
    begin
      start_ts := (br.preferred_date::text || ' ' || br.preferred_time::text)::timestamp
                  at time zone v_tz;
    exception when others then
      continue;
    end;
    if start_ts <= now() + interval '90 minutes'
       or start_ts >= now() + interval '150 minutes' then
      continue;
    end if;
    if br.appointment_id is not null then
      select status into appt_status from public.appointments where id = br.appointment_id;
      -- Missing row (hard-deleted from the schedule) or terminal status:
      -- the appointment is gone/cancelled, so don't remind. NOT FOUND must
      -- be checked explicitly because appt_status is left NULL/stale.
      if not found
         or coalesce(appt_status, '') in
              ('cancelled', 'canceled', 'no-show', 'no_show', 'noshow', 'declined', 'completed')
      then
        continue;
      end if;
    end if;

    studio_name := coalesce(nullif(trim(public.public_get_studio_name(br.user_id)), ''), 'your stylist');
    service_label := coalesce(br.selected_variation_name, br.service_name, 'appointment');
    v_hair_sms := public.hair_bring_text(br.service_id, true);
    sms_body := 'Reminder: ' || public.sms_truncate_label(service_label, 24) || ' with ' || public.sms_truncate_label(studio_name, 24)
                || ' today at ' || br.preferred_time || '.';
    if v_hair_sms is not null then
      sms_body := sms_body || ' Bring: ' || v_hair_sms || '.';
    end if;
    begin
      perform public.queue_notification(
        user_id_in => br.user_id,
        channel_in => 'sms',
        notification_type_in => 'appointment_reminder_2h',
        body_in => sms_body,
        recipient_phone_in => br.client_phone,
        recipient_name_in => br.client_name,
        payload_in => jsonb_build_object('smsText', sms_body),
        dedupe_key_in => 'appt_reminder_2h_sms:' || br.id::text || ':' || br.preferred_date::text,
        booking_request_id_in => br.id,
        appointment_id_in => br.appointment_id
      );
      enqueued := enqueued + 1;
    exception when others then null;
    end;
  end loop;

  for ap in
    select * from public.appointments a
    where coalesce(a.kind, 'appointment') = 'appointment'
      and coalesce(a.is_all_day, false) = false
      and coalesce(a.status, '') not in
            ('cancelled', 'canceled', 'no-show', 'no_show', 'noshow', 'declined', 'completed')
      and a.appt_date is not null
      and a.appt_time is not null
      and a.appt_date >= (current_date - 1)
      and not exists (select 1 from public.booking_requests br2 where br2.appointment_id = a.id)
  loop
    if not (coalesce(ap.sms_opt_in, false)
            and ap.client_phone is not null
            and length(public.sms_normalize_phone(ap.client_phone)) >= 7
            and not exists (select 1 from public.sms_opt_outs o
                            where o.phone = public.sms_normalize_phone(ap.client_phone))
            and coalesce((select balance from public.sms_credits where user_id = ap.user_id), 0) > 0) then
      continue;
    end if;

    v_tz := coalesce(
      nullif(ap.timezone, ''),
      (select br2.timezone from public.booking_requests br2
        where br2.user_id = ap.user_id and br2.timezone is not null and br2.timezone <> ''
        order by br2.created_at desc limit 1),
      'America/Los_Angeles'
    );
    begin
      start_ts := (ap.appt_date::text || ' ' || ap.appt_time::text)::timestamp
                  at time zone v_tz;
    exception when others then
      continue;
    end;
    if start_ts <= now() + interval '90 minutes'
       or start_ts >= now() + interval '150 minutes' then
      continue;
    end if;

    studio_name := coalesce(nullif(trim(public.public_get_studio_name(ap.user_id)), ''), 'your stylist');
    service_label := coalesce(ap.style, 'appointment');
    sms_body := 'Reminder: ' || public.sms_truncate_label(service_label, 24) || ' with ' || public.sms_truncate_label(studio_name, 24)
                || ' today at ' || ap.appt_time || '.';
    begin
      perform public.queue_notification(
        user_id_in => ap.user_id,
        channel_in => 'sms',
        notification_type_in => 'appointment_reminder_2h',
        body_in => sms_body,
        recipient_phone_in => ap.client_phone,
        recipient_name_in => ap.client_name,
        payload_in => jsonb_build_object('smsText', sms_body),
        dedupe_key_in => 'appt_reminder_2h_sms:appt:' || ap.id::text || ':' || ap.appt_date::text,
        appointment_id_in => ap.id::text
      );
      enqueued := enqueued + 1;
    exception when others then null;
    end;
  end loop;

  return enqueued;
end;
$function$;

revoke all on function public.enqueue_due_2h_sms_reminders() from public;
grant execute on function public.enqueue_due_2h_sms_reminders() to service_role;


-- ---- Promotional SMS: honour the {{first_name}} merge tag --------
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
      v_sms := replace(v_sms, '{{first_name}}',
        coalesce(nullif(split_part(trim(r.name), ' ', 1), ''), 'there'));

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
