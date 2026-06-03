-- Client messaging — in-app, portal-backed two-way threads.
--
-- A "thread" is anchored to a booking_request: the same row that backs
-- the client appointment portal at /client/appointment/<portal_token>.
-- The anonymous client side reads + writes through SECURITY DEFINER
-- RPCs keyed by portal_token; the stylist side reads / writes the table
-- directly under RLS (user_id = auth.uid()).
--
-- Deliberately NO Twilio / SMS dependency. Delivery is in-app:
--   • client -> stylist : the portal thread + an in-app bell row
--     (public.notifications, category 'client_message') + a web-push
--     banner via internal_send_push (no email, so no inbox clutter).
--   • stylist -> client : the portal thread (client sees it next time
--     they open their appointment link).

-- =====================================================================
-- 1. Table
-- =====================================================================
create table if not exists public.client_messages (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  booking_request_id uuid not null references public.booking_requests(id) on delete cascade,
  sender             text not null check (sender in ('client', 'stylist')),
  body               text not null,
  read_by_owner      boolean not null default false,
  read_by_client     boolean not null default false,
  created_at         timestamptz not null default now()
);

create index if not exists client_messages_user_idx
  on public.client_messages (user_id, created_at desc);
create index if not exists client_messages_thread_idx
  on public.client_messages (booking_request_id, created_at);
create index if not exists client_messages_unread_owner_idx
  on public.client_messages (user_id)
  where read_by_owner = false and sender = 'client';

alter table public.client_messages enable row level security;

-- Owner (stylist) reads / writes / updates only their own rows. Inserts
-- from the authenticated side are always 'stylist'; client-authored
-- rows arrive exclusively through the SECURITY DEFINER RPC below.
drop policy if exists client_messages_owner_select on public.client_messages;
create policy client_messages_owner_select on public.client_messages
  for select using (user_id = auth.uid());

drop policy if exists client_messages_owner_insert on public.client_messages;
create policy client_messages_owner_insert on public.client_messages
  for insert with check (user_id = auth.uid() and sender = 'stylist');

drop policy if exists client_messages_owner_update on public.client_messages;
create policy client_messages_owner_update on public.client_messages
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.client_messages to authenticated;

-- =====================================================================
-- 2. Anonymous portal RPCs (keyed by portal_token)
-- =====================================================================

-- List a thread for the client portal. Marks the stylist's messages as
-- read_by_client so unread badges clear once the client opens the link.
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

-- Post a message from the client portal. Inserts a 'client' row, raises
-- an in-app bell for the stylist, and fires a best-effort web push.
create or replace function public.public_post_client_message(
  token_in text,
  body_in  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  br       public.booking_requests%rowtype;
  v_body   text;
  v_client text;
  v_msg_id uuid;
begin
  if token_in is null or length(trim(token_in)) < 16 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;

  v_body := nullif(left(trim(coalesce(body_in, '')), 4000), '');
  if v_body is null then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  select * into br from public.booking_requests
  where portal_token = token_in
  limit 1;
  if br.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  insert into public.client_messages (
    user_id, booking_request_id, sender, body, read_by_owner, read_by_client
  ) values (
    br.user_id, br.id, 'client', v_body, false, true
  )
  returning id into v_msg_id;

  v_client := coalesce(nullif(trim(br.client_name), ''), 'A client');

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
      left(v_body, 140),
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
      left(v_body, 160),
      '/',
      'client_message:' || br.id::text
    );
  exception when others then
    null;
  end;

  return jsonb_build_object('ok', true, 'id', v_msg_id);
end;
$$;

revoke all on function public.public_post_client_message(text, text) from public;
grant execute on function public.public_post_client_message(text, text) to anon, authenticated;
