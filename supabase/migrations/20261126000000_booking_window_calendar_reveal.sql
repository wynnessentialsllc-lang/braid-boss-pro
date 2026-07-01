-- Calendar Reveal — the Braid Boss Pro take on Square's "booking window".
--
-- Stylists control how far into the future clients may book, in three
-- shapes that cover how braiders actually run their books:
--
--   1. rolling          — "the next N days are always open" (30 / 60 / 90 …).
--                         The horizon slides forward automatically every
--                         day, so there's nothing to re-open by hand.
--   2. fixed            — "book up to this exact date, then my books are
--                         closed." A hard cutoff for a stylist who's about
--                         to take leave / relocate / pause.
--   3. monthly_release  — "my books drop on the {day} of each month for the
--                         next month(s)." The reveal happens automatically
--                         on the release day — no manual toggling — which is
--                         the behaviour the request asked for.
--
-- Everything hangs off booking_policies (one row per stylist). A single
-- security-definer helper, compute_booking_window(), turns the config into
-- a concrete [min_date, max_date] the public surfaces enforce. Slot listing,
-- the month heatmap, and the booking submit RPC all route through it so a
-- client can never bypass the window by hand-calling an RPC. A public read
-- RPC exposes the window (and the next drop date) so the booking page can
-- greet visitors with "Books open again on …" instead of a dead calendar.
--
-- Idempotent: column adds are `if not exists`, the CHECK is guarded by a
-- pg_constraint lookup, and every function uses `create or replace`.

-- =====================================================================
-- 1. booking_policies — window configuration columns
-- =====================================================================
alter table public.booking_policies
  add column if not exists booking_window_mode text,
  add column if not exists booking_window_days integer,
  add column if not exists booking_window_until date,
  add column if not exists booking_min_notice_hours integer,
  add column if not exists release_day_of_month integer,
  add column if not exists release_months_ahead integer;

-- Backfill existing rows to the default rolling 60-day window so the
-- public surfaces behave identically to today for anyone who never
-- touches the setting.
update public.booking_policies
set booking_window_mode = coalesce(booking_window_mode, 'rolling'),
    booking_window_days = coalesce(booking_window_days, 60),
    booking_min_notice_hours = coalesce(booking_min_notice_hours, 0),
    release_months_ahead = coalesce(release_months_ahead, 1)
where booking_window_mode is null
   or booking_window_days is null
   or booking_min_notice_hours is null
   or release_months_ahead is null;

alter table public.booking_policies
  alter column booking_window_mode set default 'rolling',
  alter column booking_window_days set default 60,
  alter column booking_min_notice_hours set default 0,
  alter column release_months_ahead set default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_policies_booking_window_mode_check'
  ) then
    alter table public.booking_policies
      add constraint booking_policies_booking_window_mode_check
      check (booking_window_mode in ('rolling', 'fixed', 'monthly_release'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_policies_booking_window_days_check'
  ) then
    alter table public.booking_policies
      add constraint booking_policies_booking_window_days_check
      check (booking_window_days is null or (booking_window_days >= 1 and booking_window_days <= 730));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_policies_release_day_check'
  ) then
    alter table public.booking_policies
      add constraint booking_policies_release_day_check
      check (release_day_of_month is null or (release_day_of_month >= 1 and release_day_of_month <= 28));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_policies_release_months_check'
  ) then
    alter table public.booking_policies
      add constraint booking_policies_release_months_check
      check (release_months_ahead is null or (release_months_ahead >= 1 and release_months_ahead <= 12));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_policies_min_notice_check'
  ) then
    alter table public.booking_policies
      add constraint booking_policies_min_notice_check
      check (booking_min_notice_hours is null or (booking_min_notice_hours >= 0 and booking_min_notice_hours <= 8760));
  end if;
end $$;

-- =====================================================================
-- 2. compute_booking_window(owner) — config → concrete date window
-- =====================================================================
-- Returns a single row describing the currently bookable date range for
-- a stylist, plus (for monthly_release) when the next drop lands and how
-- far it will reach. max_date NULL means "no upper bound" (only possible
-- for a fixed window with no cutoff date set).
--
-- The JS twin lives in app/lib/bookingWindow.ts; keep the two in lockstep.
create or replace function public.compute_booking_window(
  owner_id_in uuid
)
returns table (
  mode text,
  min_date date,
  max_date date,
  window_days integer,
  release_day integer,
  release_months integer,
  next_release_date date,
  next_release_max_date date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_days integer;
  v_until date;
  v_notice integer;
  v_rday integer;
  v_months integer;
  today date := current_date;
  now_ts timestamptz := now();
  last_release_first date;
  next_release_first date;
begin
  select
    coalesce(bp.booking_window_mode, 'rolling'),
    coalesce(bp.booking_window_days, 60),
    bp.booking_window_until,
    coalesce(bp.booking_min_notice_hours, 0),
    bp.release_day_of_month,
    coalesce(bp.release_months_ahead, 1)
  into v_mode, v_days, v_until, v_notice, v_rday, v_months
  from public.booking_policies bp
  where bp.user_id = owner_id_in
  limit 1;

  if not found then
    v_mode := 'rolling'; v_days := 60; v_until := null;
    v_notice := 0; v_rday := null; v_months := 1;
  end if;

  -- Earliest bookable date honours the minimum-notice lead time. A
  -- stylist who needs 48h heads-up won't see today/tomorrow offered.
  min_date := (now_ts + make_interval(hours => greatest(0, coalesce(v_notice, 0))))::date;
  if min_date < today then
    min_date := today;
  end if;

  mode := v_mode;
  window_days := v_days;
  release_day := v_rday;
  release_months := v_months;
  next_release_date := null;
  next_release_max_date := null;

  if v_mode = 'fixed' then
    -- Hard cutoff. NULL until = no upper bound (callers treat as open-ended).
    max_date := v_until;

  elsif v_mode = 'monthly_release' then
    -- Clamp so every month actually has the release day (28 is the
    -- safe ceiling) and the reach stays sane.
    v_rday := least(28, greatest(1, coalesce(v_rday, 1)));
    v_months := least(12, greatest(1, coalesce(v_months, 1)));
    release_day := v_rday;
    release_months := v_months;

    -- Locate the most recent drop on/before today, and the next one.
    if extract(day from today)::int >= v_rday then
      last_release_first := date_trunc('month', today)::date;
      next_release_first := (date_trunc('month', today) + interval '1 month')::date;
    else
      last_release_first := (date_trunc('month', today) - interval '1 month')::date;
      next_release_first := date_trunc('month', today)::date;
    end if;

    -- A drop in month M opens bookings through the end of month M+months.
    max_date := (last_release_first + make_interval(months => v_months + 1) - interval '1 day')::date;
    next_release_date := (next_release_first + make_interval(days => v_rday - 1))::date;
    next_release_max_date := (next_release_first + make_interval(months => v_months + 1) - interval '1 day')::date;

  else
    -- rolling (default): the horizon slides forward every day.
    max_date := today + greatest(1, coalesce(v_days, 60));
  end if;

  return next;
end;
$$;

revoke all on function public.compute_booking_window(uuid) from public;
grant execute on function public.compute_booking_window(uuid) to anon, authenticated, service_role;

-- =====================================================================
-- 3. public_get_booking_window(slug) — anon read for the booking page
-- =====================================================================
create or replace function public.public_get_booking_window(
  slug_in text
)
returns table (
  mode text,
  min_date date,
  max_date date,
  window_days integer,
  release_day integer,
  release_months integer,
  next_release_date date,
  next_release_max_date date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  owner_id uuid;
begin
  select user_id into owner_id
  from public.booking_links
  where slug = slug_in and active = true
  limit 1;
  if owner_id is null then
    return;
  end if;

  return query
  select * from public.compute_booking_window(owner_id);
end;
$$;

revoke all on function public.public_get_booking_window(text) from public;
grant execute on function public.public_get_booking_window(text) to anon, authenticated;

-- =====================================================================
-- 4. Gate public_list_availability by the window
-- =====================================================================
-- Same body as the Phase B2 RPC, with one early guard added right after
-- the slug → owner resolve: a date outside [min_date, max_date] returns
-- no slots, exactly like a closed day.
create or replace function public.public_list_availability(
  slug_in text,
  date_in date,
  duration_minutes_in integer default null,
  service_id_in uuid default null,
  slot_interval_minutes_in integer default 30
)
returns table (
  slot_time text,
  slot_label text,
  start_minute integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  weekday_in smallint;
  rule record;
  exc_off boolean;
  exc_custom_start text;
  exc_custom_end text;
  base_start text;
  base_end text;
  break_start text;
  break_end text;
  duration_minutes integer;
  buffer_before integer := 0;
  buffer_after integer := 0;
  max_concurrent integer := 1;
  interval_minutes integer;
  win record;
  windows record;
begin
  interval_minutes := greatest(5, coalesce(slot_interval_minutes_in, 30));

  -- 1. Resolve slug → owner.
  select user_id into owner_id
  from public.booking_links
  where slug = slug_in and active = true
  limit 1;
  if owner_id is null then
    return;
  end if;

  -- 1.5. Calendar Reveal window. A date the stylist hasn't opened yet
  --      (or has closed) yields no slots — the client can't reach past
  --      the horizon even by calling this RPC directly.
  select * into win from public.compute_booking_window(owner_id);
  if date_in < win.min_date then
    return;
  end if;
  if win.max_date is not null and date_in > win.max_date then
    return;
  end if;

  -- 2. Resolve duration + buffers + concurrency.
  if service_id_in is not null then
    select
      coalesce(duration_minutes_in, (s.duration_hours * 60)::integer),
      coalesce(s.buffer_before_minutes, 0),
      coalesce(s.buffer_after_minutes, 0),
      coalesce(s.max_concurrent, 1)
      into duration_minutes, buffer_before, buffer_after, max_concurrent
    from public.services s
    where s.id = service_id_in and s.user_id = owner_id and s.is_active = true
    limit 1;
  else
    duration_minutes := duration_minutes_in;
  end if;
  if duration_minutes is null or duration_minutes <= 0 then
    return;
  end if;
  duration_minutes := greatest(15, duration_minutes);

  -- 3. Off-day exception → no slots.
  select true into exc_off
  from public.availability_exceptions
  where user_id = owner_id and kind = 'off'
    and date_in between start_date and end_date
  limit 1;
  if exc_off is true then
    return;
  end if;

  -- 4. Weekly rule for the weekday.
  weekday_in := extract(dow from date_in)::smallint;
  select start_time, end_time, break_start, break_end, is_open
    into rule
  from public.availability_rules
  where user_id = owner_id and weekday = weekday_in
  limit 1;
  if rule is null then
    base_start := '09:00';
    base_end   := '18:00';
    break_start := null;
    break_end := null;
  elsif rule.is_open = false then
    return;
  else
    base_start := rule.start_time;
    base_end   := rule.end_time;
    break_start := rule.break_start;
    break_end := rule.break_end;
  end if;

  -- 5. Custom-hours exception overrides the weekly window for that day.
  select start_time, end_time
    into exc_custom_start, exc_custom_end
  from public.availability_exceptions
  where user_id = owner_id and kind = 'custom'
    and date_in between start_date and end_date
  limit 1;
  if exc_custom_start is not null and exc_custom_end is not null then
    base_start := exc_custom_start;
    base_end := exc_custom_end;
    break_start := null;
    break_end := null;
  end if;

  -- 6. Build the open windows and emit fitting slots.
  return query
  with raw_windows as (
    select
      to_min(base_start) as w_start,
      to_min(base_end) as w_end,
      to_min(break_start) as b_start,
      to_min(break_end) as b_end
  ),
  windows as (
    select w_start, b_start as w_end from raw_windows
    where b_start is not null and b_end is not null
      and b_start > w_start and b_start < w_end
    union all
    select b_end as w_start, w_end from raw_windows
    where b_start is not null and b_end is not null
      and b_end > w_start and b_end < w_end
    union all
    select w_start, w_end from raw_windows
    where b_start is null or b_end is null
       or b_start <= w_start or b_end >= w_end
  ),
  reserved as (
    select
      greatest(0, to_min(a.appt_time) - buffer_before) as r_start,
      to_min(a.appt_time) + greatest(15, (coalesce(a.duration_hours, 1) * 60)::integer) + buffer_after as r_end
    from public.appointments a
    where a.user_id = owner_id
      and a.appt_date = date_in
      and a.status <> 'cancelled'
      and a.appt_time is not null
    union all
    select to_min(start_time), to_min(end_time)
    from public.availability_exceptions
    where user_id = owner_id and kind = 'blocked'
      and date_in between start_date and end_date
      and start_time is not null and end_time is not null
  ),
  slot_candidates as (
    select
      gs.s as start_minute,
      gs.s + duration_minutes as end_minute
    from windows w,
      lateral generate_series(
        w.w_start,
        w.w_end - duration_minutes,
        interval_minutes
      ) as gs(s)
  ),
  slots_with_overlap as (
    select
      sc.start_minute,
      sc.end_minute,
      coalesce((
        select count(*)
        from reserved r
        where r.r_start < sc.end_minute and r.r_end > sc.start_minute
      ), 0) as overlap_count
    from slot_candidates sc
  )
  select
    to_hhmm(sw.start_minute) as slot_time,
    to_label(sw.start_minute) as slot_label,
    sw.start_minute
  from slots_with_overlap sw
  where sw.overlap_count < max_concurrent
  order by sw.start_minute asc;
end;
$$;

revoke all on function public.public_list_availability(text, date, integer, uuid, integer) from public;
grant execute on function public.public_list_availability(text, date, integer, uuid, integer) to anon, authenticated;

-- =====================================================================
-- 5. Gate public_get_month_availability by the window
-- =====================================================================
-- Days before the window opens or after it closes are returned as
-- 'off' with zero slots, so the heatmap greys them out and the month
-- navigation can stop at the horizon.
create or replace function public.public_get_month_availability(
  slug_in text,
  year_in integer,
  month_in integer,
  service_id_in uuid default null,
  duration_minutes_in integer default null
)
returns table (
  day_iso date,
  slot_count integer,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  sensitivity text;
  interval_minutes integer;
  first_day date;
  last_day date;
  d date;
  slot_n integer;
  win record;
begin
  if year_in is null or month_in is null then
    return;
  end if;
  if month_in < 1 or month_in > 12 then
    return;
  end if;

  select user_id into owner_id
  from public.booking_links
  where slug = slug_in and active = true
  limit 1;
  if owner_id is null then
    return;
  end if;

  select coalesce(availability_sensitivity, 'balanced')
  into sensitivity
  from public.booking_policies
  where user_id = owner_id
  limit 1;
  if sensitivity is null then
    sensitivity := 'balanced';
  end if;

  interval_minutes := case sensitivity
    when 'conservative' then 60
    when 'aggressive' then 15
    else 30
  end;

  select * into win from public.compute_booking_window(owner_id);

  first_day := make_date(year_in, month_in, 1);
  last_day := (first_day + interval '1 month' - interval '1 day')::date;
  d := first_day;

  while d <= last_day loop
    if d < current_date
       or d < win.min_date
       or (win.max_date is not null and d > win.max_date) then
      -- Outside the revealed window (past, before it opens, or beyond
      -- the horizon) → greyed 'off' with no slots.
      day_iso := d;
      slot_count := 0;
      status := 'off';
      return next;
    else
      select count(*)
      into slot_n
      from public.public_list_availability(
        slug_in, d, duration_minutes_in, service_id_in, interval_minutes
      );

      day_iso := d;
      slot_count := coalesce(slot_n, 0);

      if slot_count = 0 then
        if exists (
          select 1 from public.availability_exceptions
          where user_id = owner_id and kind = 'off'
            and d between start_date and end_date
        ) then
          status := 'off';
        elsif exists (
          select 1 from public.availability_rules
          where user_id = owner_id
            and weekday = extract(dow from d)::smallint
            and is_open = false
        ) then
          status := 'off';
        else
          status := 'booked';
        end if;
      elsif slot_count <= 4 then
        status := 'limited';
      else
        status := 'available';
      end if;

      return next;
    end if;

    d := d + 1;
  end loop;
end;
$$;

revoke all on function public.public_get_month_availability(text, integer, integer, uuid, integer) from public;
grant execute on function public.public_get_month_availability(text, integer, integer, uuid, integer) to anon, authenticated;

-- =====================================================================
-- 6. Gate public_submit_booking_request by the window (server-side)
-- =====================================================================
-- The UI already hides out-of-window days, but a hand-crafted request
-- must not slip a date past the horizon. This wraps the existing RPC's
-- guard: after resolving the owner we reject any preferred_date outside
-- the window by returning no rows (the client sees no request_id, same
-- as any other rejected submission). The remainder of the body is the
-- add-ons version from 20260615000000_service_addons.sql, unchanged.
create or replace function public.public_submit_booking_request(
  slug_in text,
  client_name_in text,
  client_phone_in text default null,
  client_email_in text default null,
  service_id_in uuid default null,
  preferred_date_in date default null,
  preferred_time_in text default null,
  notes_in text default null,
  timezone_in text default null,
  locale_in text default null,
  variation_id_in text default null,
  addon_ids_in text[] default null
)
returns table (
  request_id uuid,
  approval_status text,
  deposit_required boolean,
  deposit_amount numeric,
  stripe_connect_account_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  owner_connect_id text;
  owner_charges_enabled boolean;
  svc_row public.services%rowtype;
  new_id uuid;
  effective_deposit_required boolean := false;
  effective_deposit_amount numeric := null;
  initial_status text := 'pending_review';
  connect_stamp text := null;
  variation_obj jsonb := null;
  variation_id_eff text := null;
  variation_name_eff text := null;
  variation_price_eff numeric := null;
  variation_duration_eff numeric := null;
  variation_deposit_amount_eff numeric := null;
  variation_deposit_required_eff boolean := null;
  resolved_price numeric := null;
  resolved_duration numeric := null;
  resolved_deposit_required boolean := false;
  resolved_deposit_amount numeric := null;
  addons_snapshot jsonb := '[]'::jsonb;
  addons_price_total numeric := 0;
  addons_duration_total numeric := 0;
  addons_deposit_extra numeric := 0;
  extra_obj jsonb;
  addon_id_iter text;
  win record;
begin
  if slug_in is null or trim(slug_in) = '' then return; end if;
  if client_name_in is null or trim(client_name_in) = '' then return; end if;

  select user_id into owner_id
  from public.booking_links
  where slug = slug_in and active = true
  limit 1;
  if owner_id is null then return; end if;

  -- Calendar Reveal window guard. A supplied date outside the open
  -- range is rejected server-side regardless of what the client sends.
  if preferred_date_in is not null then
    select * into win from public.compute_booking_window(owner_id);
    if preferred_date_in < win.min_date then return; end if;
    if win.max_date is not null and preferred_date_in > win.max_date then return; end if;
  end if;

  select p.stripe_connect_account_id, p.stripe_connect_charges_enabled
    into owner_connect_id, owner_charges_enabled
  from public.profiles p
  where p.id = owner_id
  limit 1;

  if service_id_in is not null then
    select * into svc_row
    from public.services
    where id = service_id_in and user_id = owner_id and is_active = true
    limit 1;
  end if;

  if svc_row.id is not null
     and variation_id_in is not null
     and trim(variation_id_in) <> ''
  then
    select v.value into variation_obj
    from jsonb_array_elements(coalesce(svc_row.add_ons, '[]'::jsonb)) as v
    where v.value ->> 'id' = variation_id_in
    limit 1;

    if variation_obj is not null then
      variation_id_eff := variation_obj ->> 'id';
      variation_name_eff := nullif(trim(coalesce(variation_obj ->> 'name', '')), '');

      if variation_obj ? 'variation_price'
         and (variation_obj -> 'variation_price') is not null
         and jsonb_typeof(variation_obj -> 'variation_price') = 'number'
      then
        variation_price_eff := (variation_obj ->> 'variation_price')::numeric;
      else
        variation_price_eff := coalesce(svc_row.base_price, 0)
          + coalesce(nullif(variation_obj ->> 'amount', '')::numeric, 0);
      end if;

      if variation_obj ? 'variation_duration_hours'
         and (variation_obj -> 'variation_duration_hours') is not null
         and jsonb_typeof(variation_obj -> 'variation_duration_hours') = 'number'
      then
        variation_duration_eff := (variation_obj ->> 'variation_duration_hours')::numeric;
      end if;

      if variation_obj ? 'variation_deposit_required'
         and (variation_obj -> 'variation_deposit_required') is not null
         and jsonb_typeof(variation_obj -> 'variation_deposit_required') = 'boolean'
      then
        variation_deposit_required_eff := (variation_obj ->> 'variation_deposit_required')::boolean;
      end if;

      if variation_obj ? 'variation_deposit_amount'
         and (variation_obj -> 'variation_deposit_amount') is not null
         and jsonb_typeof(variation_obj -> 'variation_deposit_amount') = 'number'
      then
        variation_deposit_amount_eff := (variation_obj ->> 'variation_deposit_amount')::numeric;
      end if;
    end if;
  end if;

  resolved_price := coalesce(variation_price_eff, svc_row.base_price);
  resolved_duration := coalesce(variation_duration_eff, svc_row.duration_hours);

  if variation_obj is not null and variation_deposit_required_eff is not null then
    resolved_deposit_required := variation_deposit_required_eff;
  else
    resolved_deposit_required := coalesce(svc_row.deposit_required, false);
  end if;

  if resolved_deposit_required then
    if variation_deposit_amount_eff is not null and variation_deposit_amount_eff > 0 then
      resolved_deposit_amount := variation_deposit_amount_eff;
    else
      resolved_deposit_amount := svc_row.deposit_amount;
    end if;
    if resolved_price is not null and resolved_deposit_amount is not null
       and resolved_deposit_amount > resolved_price
    then
      resolved_deposit_amount := resolved_price;
    end if;
  end if;

  if svc_row.id is not null and addon_ids_in is not null then
    foreach addon_id_iter in array addon_ids_in loop
      if addon_id_iter is null or trim(addon_id_iter) = '' then continue; end if;
      select e.value into extra_obj
      from jsonb_array_elements(coalesce(svc_row.extras, '[]'::jsonb)) as e
      where e.value ->> 'id' = addon_id_iter
        and coalesce((e.value ->> 'active')::boolean, true) is true
      limit 1;
      if extra_obj is null then continue; end if;

      addons_snapshot := addons_snapshot || jsonb_build_array(jsonb_build_object(
        'id', extra_obj ->> 'id',
        'name', coalesce(extra_obj ->> 'name', ''),
        'price', coalesce(nullif(extra_obj ->> 'price', '')::numeric, 0),
        'duration_hours_delta', coalesce(nullif(extra_obj ->> 'duration_hours_delta', '')::numeric, 0),
        'include_in_deposit', coalesce((extra_obj ->> 'include_in_deposit')::boolean, false)
      ));
      addons_price_total := addons_price_total + coalesce(nullif(extra_obj ->> 'price', '')::numeric, 0);
      addons_duration_total := addons_duration_total + coalesce(nullif(extra_obj ->> 'duration_hours_delta', '')::numeric, 0);
      if coalesce((extra_obj ->> 'include_in_deposit')::boolean, false) is true then
        addons_deposit_extra := addons_deposit_extra + coalesce(nullif(extra_obj ->> 'price', '')::numeric, 0);
      end if;
    end loop;
  end if;

  resolved_price := coalesce(resolved_price, 0) + addons_price_total;
  resolved_duration := coalesce(resolved_duration, 0) + addons_duration_total;
  if resolved_deposit_required then
    resolved_deposit_amount := coalesce(resolved_deposit_amount, 0) + addons_deposit_extra;
    if resolved_price is not null and resolved_deposit_amount > resolved_price then
      resolved_deposit_amount := resolved_price;
    end if;
  elsif addons_deposit_extra > 0 then
    resolved_deposit_required := true;
    resolved_deposit_amount := addons_deposit_extra;
  end if;

  if svc_row.id is not null
     and resolved_deposit_required is true
     and coalesce(resolved_deposit_amount, 0) > 0
     and owner_charges_enabled is true
     and owner_connect_id is not null
     and owner_connect_id <> ''
  then
    effective_deposit_required := true;
    effective_deposit_amount := resolved_deposit_amount;
    initial_status := 'awaiting_deposit';
    connect_stamp := owner_connect_id;
  end if;

  insert into public.booking_requests (
    user_id, link_slug,
    client_name, client_phone, client_email,
    service_id, service_name, service_name_snapshot,
    service_duration, service_duration_hours,
    service_price,
    service_deposit_required, service_deposit_amount,
    service_prep_instructions,
    preferred_date, preferred_time, notes,
    timezone, locale, created_from_public,
    status, approval_status,
    deposit_required, deposit_amount,
    payment_status, deposit_paid,
    stripe_connect_account_id,
    selected_variation_id, selected_variation_name,
    selected_variation_price, selected_variation_duration_hours,
    selected_variation_deposit_amount,
    selected_addons
  ) values (
    owner_id,
    nullif(trim(slug_in), ''),
    nullif(trim(client_name_in), ''),
    nullif(trim(coalesce(client_phone_in, '')), ''),
    nullif(trim(coalesce(client_email_in, '')), ''),
    svc_row.id,
    case
      when variation_name_eff is not null and svc_row.name is not null
        then svc_row.name || ' — ' || variation_name_eff
      else coalesce(svc_row.name, null)
    end,
    coalesce(svc_row.name, null),
    resolved_duration,
    resolved_duration,
    resolved_price,
    resolved_deposit_required,
    resolved_deposit_amount,
    svc_row.prep_instructions,
    preferred_date_in,
    nullif(trim(coalesce(preferred_time_in, '')), ''),
    nullif(trim(coalesce(notes_in, '')), ''),
    nullif(trim(coalesce(timezone_in, '')), ''),
    nullif(trim(coalesce(locale_in, '')), ''),
    true,
    'pending',
    initial_status,
    effective_deposit_required,
    effective_deposit_amount,
    'unpaid',
    false,
    connect_stamp,
    variation_id_eff,
    variation_name_eff,
    variation_price_eff,
    variation_duration_eff,
    variation_deposit_amount_eff,
    addons_snapshot
  )
  returning id into new_id;

  request_id := new_id;
  approval_status := initial_status;
  deposit_required := effective_deposit_required;
  deposit_amount := effective_deposit_amount;
  stripe_connect_account_id := connect_stamp;
  return next;
end;
$$;

revoke all on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text, text, text[]
) from public;
grant execute on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text, text, text[]
) to anon, authenticated;
