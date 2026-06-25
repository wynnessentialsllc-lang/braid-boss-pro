-- Marketplace Phase 4 — Open Style Requests, sub-step 2: braider inbox + quoting.
--
--   * marketplace_open_requests() — the signed-in braider's inbox: open,
--     non-expired requests whose styles overlap what the braider offers,
--     loosely narrowed by city. Includes the braider's own quote (if any)
--     so the UI can show "quoted / edit".
--   * marketplace_submit_quote() — upserts the braider's quote on a request,
--     after checking the request is still open. SECURITY DEFINER so it can
--     write past RLS as the authenticated caller (auth.uid()).
--
-- Both are authenticated-only and key off auth.uid(), which is the CALLER's
-- id even inside a SECURITY DEFINER function (it reads the JWT claim).

create or replace function public.marketplace_open_requests()
returns table (
  id              uuid,
  photo_path      text,
  style_tags      text[],
  size            text,
  length          text,
  budget_min      numeric,
  budget_max      numeric,
  city            text,
  state           text,
  preferred_date  date,
  notes           text,
  client_name     text,
  created_at      timestamptz,
  my_quote_id     uuid,
  my_quote_price  numeric,
  my_quote_status text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with me as (
    select
      bl.business_city as city,
      coalesce((
        select array_agg(distinct tag)
        from (
          select unnest(s.style_tags) as tag
          from public.services s
          where s.user_id = auth.uid() and s.is_active = true
        ) t
      ), '{}'::text[]) as tags
    from public.booking_links bl
    where bl.user_id = auth.uid()
  )
  select
    r.id,
    r.photo_path,
    r.style_tags,
    r.size,
    r.length,
    r.budget_min,
    r.budget_max,
    r.city,
    r.state,
    r.preferred_date,
    r.notes,
    r.client_name,
    r.created_at,
    q.id     as my_quote_id,
    q.price  as my_quote_price,
    q.status as my_quote_status
  from public.marketplace_style_requests r
  cross join me
  left join public.marketplace_quotes q
    on q.request_id = r.id and q.user_id = auth.uid()
  where auth.uid() is not null
    and r.status = 'open'
    and r.expires_at > now()
    -- Style overlap is the core relevance signal.
    and r.style_tags && me.tags
    -- City is a soft filter: show when either side is blank or they overlap.
    and (
      coalesce(trim(r.city), '') = ''
      or coalesce(trim(me.city), '') = ''
      or r.city ilike '%' || me.city || '%'
      or me.city ilike '%' || r.city || '%'
    )
  order by r.created_at desc;
$$;

revoke all on function public.marketplace_open_requests() from public;
grant execute on function public.marketplace_open_requests() to authenticated;

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
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'A valid price is required';
  end if;

  select status into v_status
  from public.marketplace_style_requests
  where id = p_request_id;

  if v_status is null then
    raise exception 'Request not found';
  end if;
  if v_status <> 'open' then
    raise exception 'This request is no longer open';
  end if;

  insert into public.marketplace_quotes (request_id, user_id, price, message, available_date)
  values (p_request_id, v_uid, round(p_price, 2), nullif(btrim(p_message), ''), p_available_date)
  on conflict (request_id, user_id) do update
    set price          = excluded.price,
        message        = excluded.message,
        available_date = excluded.available_date,
        status         = 'sent',
        updated_at     = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.marketplace_submit_quote(uuid, numeric, text, date) from public;
grant execute on function public.marketplace_submit_quote(uuid, numeric, text, date) to authenticated;
