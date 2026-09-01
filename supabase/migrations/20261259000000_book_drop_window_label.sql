-- The book-drop announcement should name the window clients can
-- actually book, not just the slice that opened this morning.
--
-- On a Sept 1 drop with one month ahead, the horizon moves from
-- Sept 30 to Oct 31. 20261239 labelled that by the newly-opened days
-- only (Oct 1 – Oct 31), which is exactly one calendar month, so the
-- announcement read "My books just opened for October 2026" — telling
-- a client that October is bookable and saying nothing about the eight
-- weeks starting today. September was open the whole time.
--
-- The label now spans the whole open window, from the first date
-- someone can actually book (min_date, so a min-notice lead time is
-- respected) through the horizon: "September through October 31st".
-- The end is always an explicit date because that is the cutoff
-- clients need; the start is just the month name when the window is
-- already underway inside it.
--
-- The WAITLIST send is untouched: those people asked about specific
-- dates, so it still fires on the newly-opened range only.

begin;

-- ---------------------------------------------------------------------
-- Shared label so the campaign name, the {{dates}} merge tag and the
-- braider's own alert can never drift from one another.
-- ---------------------------------------------------------------------
-- Year is noise while the window is still in this one, and necessary
-- the moment it isn't ("December through January 31st, 2027").
create or replace function public.book_drop_label_year(d date)
returns text
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when d is null then ''
    when extract(year from d) = extract(year from current_date) then ''
    else ', ' || to_char(d, 'YYYY')
  end;
$$;

create or replace function public.book_drop_window_label(
  from_date_in date,
  to_date_in   date
)
returns text
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select case
    -- Nothing sensible to say about an empty or backwards range.
    when from_date_in is null or to_date_in is null or to_date_in < from_date_in
      then null

    -- A single day.
    when from_date_in = to_date_in
      then to_char(to_date_in, 'FMMonth FMDDth')
           || public.book_drop_label_year(to_date_in)

    -- Exactly one whole calendar month.
    when from_date_in = date_trunc('month', from_date_in)::date
     and to_date_in = (date_trunc('month', from_date_in) + interval '1 month - 1 day')::date
      then to_char(from_date_in, 'FMMonth')
           || public.book_drop_label_year(to_date_in)

    else
      -- Start: the month name alone when the window opens on the 1st or
      -- is already underway inside the current month ("September"); an
      -- explicit day when it starts mid-month for another reason, such
      -- as a min-notice lead time that pushes it into the next one
      -- ("October 2nd").
      (case
         when from_date_in = date_trunc('month', from_date_in)::date
           or date_trunc('month', from_date_in) = date_trunc('month', current_date)
           then to_char(from_date_in, 'FMMonth')
         else to_char(from_date_in, 'FMMonth FMDDth')
       end)
      || ' through '
      -- End: always an explicit date — it is the cutoff clients need.
      || to_char(to_date_in, 'FMMonth FMDDth')
      || public.book_drop_label_year(to_date_in)
  end;
$$;

revoke all on function public.book_drop_window_label(date, date) from public;
revoke all on function public.book_drop_label_year(date) from public;
grant execute on function public.book_drop_window_label(date, date) to authenticated, service_role;
grant execute on function public.book_drop_label_year(date) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Re-created from 20261239 with two changes, both in the client-list
-- announcement block: the label spans the open window, and the
-- braider's alert reads naturally around a longer label. The waitlist
-- send, the horizon bookkeeping and the clamp are unchanged.
-- ---------------------------------------------------------------------
create or replace function public.process_waitlist_release_drops()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  p            record;
  w            record;
  v_tpl        record;
  v_from       date;
  v_sent       integer;   -- this braider only; n is the sweep-wide total
  v_mode       text;
  v_open_from  date;
  v_label      text;
  v_campaign   uuid;
  n            integer := 0;
begin
  for p in
    select bp.user_id,
           bp.waitlist_release_notified_through as announced_through,
           coalesce(bp.drop_announce_mode, 'off') as announce_mode
      from public.booking_policies bp
     where coalesce(bp.booking_window_mode, 'rolling') = 'monthly_release'
  loop
    begin
      select * into w from public.compute_booking_window(p.user_id) limit 1;
      if w.max_date is null then
        continue;
      end if;

      if p.announced_through is null then
        update public.booking_policies
           set waitlist_release_notified_through = w.max_date
         where user_id = p.user_id;
        continue;  -- bootstrap only
      end if;

      -- Horizon SHRANK — fewer months opened, a later drop day, a spell
      -- on a different booking mode. Those dates aren't bookable any
      -- more, so forget we announced them and drop the mark to match.
      --
      -- Without this the mark strands itself above the calendar and
      -- every drop is silent until the horizon climbs back past it —
      -- months of nothing, with no clue beyond a waitlist that went
      -- quiet. Clamping makes it self-correct on the next sweep.
      --
      -- Re-announcing after a clamp is the right outcome, not a bug:
      -- those dates closed and re-opened, which is news. And a braider
      -- who shrinks then restores lands back on the same horizon, whose
      -- dedupe key was already used, so the flip-flop sends nothing.
      if w.max_date < p.announced_through then
        update public.booking_policies
           set waitlist_release_notified_through = w.max_date
         where user_id = p.user_id;
        continue;
      end if;

      if w.max_date = p.announced_through then
        continue;  -- horizon hasn't moved
      end if;

      -- Only the days that weren't bookable before this drop.
      v_from := p.announced_through + 1;
      v_sent := public.notify_waitlist_of_opening(
        user_id_in      => p.user_id,
        from_date_in    => v_from,
        to_date_in      => w.max_date,
        kind_in         => 'dates_open',
        dedupe_scope_in => 'release:' || w.max_date::text
      );
      n := n + v_sent;

      update public.booking_policies
         set waitlist_release_notified_through = w.max_date
       where user_id = p.user_id;

      -- Tell the braider their waitlist went out. This fires in their
      -- name while they're doing hair, so they should hear about it
      -- from us before a client replies about it.
      if v_sent > 0 then
        perform public.queue_owner_alert_email(
          user_id_in           => p.user_id,
          notification_type_in => 'waitlist_release_owner',
          subject_in           => 'Your waitlist heard your books are open',
          body_in              =>
            'Your books just opened through ' || to_char(w.max_date, 'MM/DD/YYYY') || '.' ||
            chr(10) || chr(10) ||
            'We let your waitlist know — everyone waiting on a date in the new range, ' ||
            'plus anyone who didn''t name a day.' || chr(10) || chr(10) ||
            'Open Braid Boss Pro -> Waitlist to see who''s waiting.',
          payload_in           => jsonb_build_object(
            'openThrough', w.max_date::text,
            'notified',    v_sent
          ),
          dedupe_key_in        => 'waitlist_release_owner:' || p.user_id::text || ':' || w.max_date::text
        );
      end if;

      -- ---- Client-list announcement (opt-in) -------------------------
      -- Its own block so a problem here can never roll back the
      -- waitlist send that already succeeded above.
      v_mode := p.announce_mode;
      if v_mode in ('draft', 'auto') then
        begin
          -- The whole bookable window, not just today's slice: the
          -- client list is being told what it can book, and the rest of
          -- this month is as bookable as the month that just opened.
          v_open_from := greatest(current_date, coalesce(w.min_date, current_date));
          -- Degenerate only if a long min-notice reaches past the
          -- horizon; the new dates are still the honest answer there.
          if v_open_from > w.max_date then
            v_open_from := v_from;
          end if;
          v_label := coalesce(
            public.book_drop_window_label(v_open_from, w.max_date),
            to_char(w.max_date, 'FMMonth YYYY')
          );

          select * into v_tpl
            from public.marketing_campaigns
           where user_id = p.user_id and is_drop_template
           limit 1;

          if v_tpl.id is not null then
            insert into public.marketing_campaigns
              (user_id, name, subject, body_text, channel, segment, status)
            values (
              p.user_id,
              'Books open — ' || v_label,
              replace(coalesce(v_tpl.subject, ''), '{{dates}}', v_label),
              replace(coalesce(v_tpl.body_text, ''), '{{dates}}', v_label),
              coalesce(v_tpl.channel, 'email'),
              coalesce(v_tpl.segment, '{"kind":"all"}'::jsonb),
              'draft'
            )
            returning id into v_campaign;

            if v_mode = 'auto' then
              -- Consent, unsubscribe tokens, per-client dedupe and the
              -- recipient record all come from the campaign sender.
              perform public.process_marketing_campaign(v_campaign);
            end if;

            perform public.queue_owner_alert_email(
              user_id_in           => p.user_id,
              notification_type_in => 'drop_announcement_owner',
              subject_in           => case when v_mode = 'auto'
                then 'Your clients heard your books are open'
                else 'Your book drop announcement is ready to send' end,
              body_in              => case when v_mode = 'auto'
                then 'Your announcement for ' || v_label || ' went out to your client list.' ||
                     chr(10) || chr(10) ||
                     'Open Braid Boss Pro -> Marketing to see who received it.'
                else 'Your announcement for ' || v_label || ' is written and waiting.' ||
                     chr(10) || chr(10) ||
                     'Open Braid Boss Pro -> Marketing, give it a read, and tap Send.' end,
              payload_in           => jsonb_build_object(
                'campaignId', v_campaign::text,
                'dates',      v_label,
                'mode',       v_mode
              ),
              dedupe_key_in        => 'drop_announcement_owner:' || p.user_id::text || ':' || w.max_date::text
            );
          end if;
        exception when others then
          null;  -- the waitlist send stands regardless
        end;
      end if;
    exception when others then
      -- One braider's bad config can't stop everyone else's drop.
      null;
    end;
  end loop;

  return n;
end;
$$;

revoke all on function public.process_waitlist_release_drops() from public;
grant execute on function public.process_waitlist_release_drops() to service_role;

notify pgrst, 'reload schema';

commit;
