-- Marketplace Phase 4 — Open Style Requests, sub-step 3:
-- client quote-view + notifications (closes the loop).
--
--   * public_get_request_quotes(token)        — anon: a client's request +
--                                               its quotes (with braider
--                                               public profile to book).
--   * enqueue_request_match_notifications(id) — emails matching braiders
--                                               when a new request is posted.
--   * marketplace_submit_quote()              — now also emails the client
--                                               when a NEW quote arrives.
--
-- Client-facing emails ride queue_notification with user_id = the braider
-- (owner context) + recipient_email = the client. Called from a service-role
-- route (auth.uid() null), the queue_notification owner-match check is
-- skipped, so we can enqueue on any braider's behalf.

-- ---------------------------------------------------------------
-- Client view: request + quotes by token
-- ---------------------------------------------------------------
create or replace function public.public_get_request_quotes(token_in text)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'status',     r.status,
    'styleTags',  r.style_tags,
    'size',       r.size,
    'length',     r.length,
    'budgetMin',  r.budget_min,
    'budgetMax',  r.budget_max,
    'city',       r.city,
    'notes',      r.notes,
    'createdAt',  r.created_at,
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'price',        q.price,
        'message',      q.message,
        'availableDate',q.available_date,
        'createdAt',    q.created_at,
        'businessName', bl.business_name,
        'slug',         bl.slug,
        'logoUrl',      bl.logo_url
      ) order by q.created_at desc)
      from public.marketplace_quotes q
      join public.booking_links bl on bl.user_id = q.user_id
      where q.request_id = r.id and q.status <> 'withdrawn'
    ), '[]'::jsonb)
  )
  from public.marketplace_style_requests r
  where r.client_token = token_in
  limit 1;
$$;

revoke all on function public.public_get_request_quotes(text) from public;
grant execute on function public.public_get_request_quotes(text) to anon, authenticated;

-- ---------------------------------------------------------------
-- Notify matching braiders when a request is posted
-- ---------------------------------------------------------------
create or replace function public.enqueue_request_match_notifications(p_request_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.marketplace_style_requests%rowtype;
  rec record;
  n integer := 0;
begin
  select * into r from public.marketplace_style_requests where id = p_request_id;
  if r.id is null or r.status <> 'open' then
    return 0;
  end if;

  for rec in
    select bl.user_id, u.email
    from public.booking_links bl
    join auth.users u on u.id = bl.user_id
    where bl.active = true
      and bl.marketplace_hidden = false
      and u.email is not null
      and exists (
        select 1 from public.services s
        where s.user_id = bl.user_id and s.is_active = true
          and s.style_tags && r.style_tags
      )
      and (
        coalesce(trim(r.city), '') = ''
        or coalesce(trim(bl.business_city), '') = ''
        or r.city ilike '%' || bl.business_city || '%'
        or bl.business_city ilike '%' || r.city || '%'
      )
  loop
    perform public.queue_notification(
      rec.user_id,
      'email',
      'marketplace_request_match',
      'A client near you is looking for a style you do — open the app to send a quote.',
      'New style request near you',
      rec.email,
      null,
      null,
      jsonb_build_object('request_id', r.id),
      null,
      'mkt_req_match:' || r.id::text || ':' || rec.user_id::text
    );
    n := n + 1;
  end loop;

  return n;
end;
$$;

revoke all on function public.enqueue_request_match_notifications(uuid) from public;
grant execute on function public.enqueue_request_match_notifications(uuid) to service_role;

-- ---------------------------------------------------------------
-- Quote submit — now emails the client on a NEW quote
-- ---------------------------------------------------------------
create or replace function public.marketplace_submit_quote(
  p_request_id    uuid,
  p_price         numeric,
  p_message       text default null,
  p_available_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_id uuid;
  v_was_new boolean := false;
  r public.marketplace_style_requests%rowtype;
  v_biz text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'A valid price is required';
  end if;

  select * into r from public.marketplace_style_requests where id = p_request_id;
  if r.id is null then
    raise exception 'Request not found';
  end if;
  if r.status <> 'open' then
    raise exception 'This request is no longer open';
  end if;

  select id into v_id from public.marketplace_quotes
  where request_id = p_request_id and user_id = v_uid;
  v_was_new := (v_id is null);

  insert into public.marketplace_quotes (request_id, user_id, price, message, available_date)
  values (p_request_id, v_uid, round(p_price, 2), nullif(btrim(p_message), ''), p_available_date)
  on conflict (request_id, user_id) do update
    set price          = excluded.price,
        message        = excluded.message,
        available_date = excluded.available_date,
        status         = 'sent',
        updated_at     = now()
  returning id into v_id;

  -- Email the client only on a brand-new quote (not edits), and only if
  -- they left an email. Best-effort: never block the quote.
  if v_was_new and coalesce(trim(r.client_email), '') <> '' then
    begin
      select business_name into v_biz from public.booking_links where user_id = v_uid;
      perform public.queue_notification(
        v_uid,
        'email',
        'marketplace_quote_received',
        coalesce(v_biz, 'A braider') || ' sent you a quote of $' ||
          to_char(round(p_price, 2), 'FM999990') ||
          '. Open your request to see it and book.',
        'You got a quote',
        r.client_email,
        null,
        r.client_name,
        jsonb_build_object('request_id', r.id),
        null,
        'mkt_quote:' || v_id::text
      );
    exception when others then
      null; -- notification failure never blocks the quote
    end;
  end if;

  return v_id;
end;
$$;

revoke all on function public.marketplace_submit_quote(uuid, numeric, text, date) from public;
grant execute on function public.marketplace_submit_quote(uuid, numeric, text, date) to authenticated;
