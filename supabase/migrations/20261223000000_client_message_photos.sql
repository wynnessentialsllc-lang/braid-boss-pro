-- Client message photos — let clients attach a screenshot / image to an
-- in-app message from the appointment portal.
--
-- Storage: a public-read bucket 'client-message-photos'. The portal is
-- anonymous and can't write to buckets under RLS, so the image is
-- uploaded SERVER-SIDE by /api/client-message-photo using the service
-- role (which bypasses RLS), keyed by the portal_token. Public-read so
-- the stylist's Inbox can render the photo by URL, same as the existing
-- style-request-photos inspiration bucket.
--
-- Data: client_messages gains an optional image_url. A message may now
-- be image-only (empty body) or text + image.

-- =====================================================================
-- 1. Storage bucket
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('client-message-photos', 'client-message-photos', true)
on conflict (id) do update set public = true;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'client_message_photos_public_read'
  ) then
    create policy client_message_photos_public_read
      on storage.objects for select
      using (bucket_id = 'client-message-photos');
  end if;
end $$;

-- =====================================================================
-- 2. Column
-- =====================================================================
alter table public.client_messages
  add column if not exists image_url text;

-- A message must carry text, an image, or both. NOT VALID so the check
-- applies to new writes without rescanning legacy rows (which all have a
-- non-empty body by construction).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'client_messages_content_chk'
  ) then
    alter table public.client_messages
      add constraint client_messages_content_chk
      check (btrim(body) <> '' or image_url is not null) not valid;
  end if;
end $$;

-- =====================================================================
-- 3. Portal RPCs — carry the image URL through
-- =====================================================================

-- List now includes image_url on each message.
create or replace function public.public_list_client_messages(token_in text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  br          public.booking_requests%rowtype;
  studio_name text;
  msgs        jsonb;
begin
  if token_in is null or length(trim(token_in)) < 16 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;

  select * into br from public.booking_requests
  where portal_token = token_in
  limit 1;
  if br.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update public.client_messages
     set read_by_client = true
   where booking_request_id = br.id
     and sender = 'stylist'
     and read_by_client = false;

  studio_name := coalesce(
    nullif(trim(public.public_get_studio_name(br.user_id)), ''),
    'your stylist'
  );

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',         m.id,
               'sender',     m.sender,
               'body',       m.body,
               'image_url',  m.image_url,
               'created_at', m.created_at
             )
             order by m.created_at asc
           ),
           '[]'::jsonb
         )
    into msgs
  from public.client_messages m
  where m.booking_request_id = br.id;

  return jsonb_build_object(
    'ok',          true,
    'studio_name', studio_name,
    'messages',    msgs
  );
end;
$$;

revoke all on function public.public_list_client_messages(text) from public;
grant execute on function public.public_list_client_messages(text) to anon, authenticated;

-- Post now accepts an optional image_url. Drop the old 2-arg signature
-- first so we replace rather than overload it.
drop function if exists public.public_post_client_message(text, text);

create or replace function public.public_post_client_message(
  token_in     text,
  body_in      text,
  image_url_in text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  br       public.booking_requests%rowtype;
  v_body   text;
  v_image  text;
  v_client text;
  v_preview text;
  v_msg_id uuid;
begin
  if token_in is null or length(trim(token_in)) < 16 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;

  v_body := left(trim(coalesce(body_in, '')), 4000);

  -- Only accept an image URL that lives in our own public bucket — the
  -- client hands this back after uploading via /api/client-message-photo,
  -- so anything else is not a real upload from this flow.
  v_image := nullif(trim(coalesce(image_url_in, '')), '');
  if v_image is not null
     and v_image not like '%/storage/v1/object/public/client-message-photos/%' then
    v_image := null;
  end if;

  if (v_body is null or v_body = '') and v_image is null then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  select * into br from public.booking_requests
  where portal_token = token_in
  limit 1;
  if br.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  insert into public.client_messages (
    user_id, booking_request_id, sender, body, image_url, read_by_owner, read_by_client
  ) values (
    br.user_id, br.id, 'client', coalesce(v_body, ''), v_image, false, true
  )
  returning id into v_msg_id;

  v_client := coalesce(nullif(trim(br.client_name), ''), 'A client');
  v_preview := coalesce(nullif(v_body, ''), '📷 Photo');

  -- In-app bell for the stylist. Per-message id so each message is its
  -- own entry; the dashboard maps category 'client_message' to an
  -- actionable bell that deep-links to the Inbox.
  begin
    insert into public.notifications (id, user_id, category, title, body, data)
    values (
      'client_message:' || v_msg_id::text,
      br.user_id,
      'client_message',
      'New message from ' || v_client,
      left(v_preview, 140),
      jsonb_build_object(
        'bookingRequestId', br.id,
        'clientName',       v_client,
        'messageId',        v_msg_id
      )
    )
    on conflict (id) do nothing;
  exception when others then
    null;
  end;

  -- Web-push banner (no email — messaging stays in-app). Best-effort.
  begin
    perform public.internal_send_push(
      br.user_id,
      'New message from ' || v_client,
      left(v_preview, 160),
      '/',
      'client_message:' || br.id::text
    );
  exception when others then
    null;
  end;

  return jsonb_build_object('ok', true, 'id', v_msg_id);
end;
$$;

revoke all on function public.public_post_client_message(text, text, text) from public;
grant execute on function public.public_post_client_message(text, text, text) to anon, authenticated;
