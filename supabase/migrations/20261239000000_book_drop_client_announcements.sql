-- Tell the whole client list when the books drop — optionally.
--
-- The release-day sweep (20261238) tells the WAITLIST: people who
-- explicitly asked to be told. That's transactional. Announcing to a
-- braider's whole client list is marketing — it needs consent
-- filtering, an unsubscribe link, and a record of who it went to.
--
-- All of that already exists in the campaign composer (20260723 +
-- 20260726 manual segment + 20261103 SMS channel), which can already
-- target all clients, recent bookers, lapsed clients, or a hand-picked
-- few. So this doesn't build a second sender. It stores the braider's
-- announcement AS a campaign — audience, channel and copy included —
-- and on drop day copies it into a real campaign with that month's
-- dates filled in.
--
-- Three modes, per braider, off by default:
--   off    nothing goes to the client list (waitlist alerts unaffected)
--   draft  the campaign is prepared and waiting; she reads it and taps
--          Send
--   auto   it goes out on its own, like the waitlist alerts do
--
-- Draft is the safer default for anyone who wants to see their words
-- before their client list does; auto is for braiders who set it once
-- and want it handled while they're doing hair. Neither is imposed.

begin;

-- ---------------------------------------------------------------------
-- Per-braider mode.
-- ---------------------------------------------------------------------
alter table public.booking_policies
  add column if not exists drop_announce_mode text not null default 'off';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'booking_policies_drop_announce_mode_chk'
  ) then
    alter table public.booking_policies
      add constraint booking_policies_drop_announce_mode_chk
      check (drop_announce_mode in ('off', 'draft', 'auto'));
  end if;
end $$;

comment on column public.booking_policies.drop_announce_mode is
  'Book-drop announcement to the client list: off | draft (prepare it, braider sends) | auto (send on the drop).';

-- ---------------------------------------------------------------------
-- The stored announcement, kept as a campaign so the existing composer
-- edits it — audience picker, channel, merge tags, recipient preview,
-- all of it — with no parallel editor to keep in step.
--
-- It is never sent itself; each drop copies it. One per braider.
-- ---------------------------------------------------------------------
alter table public.marketing_campaigns
  add column if not exists is_drop_template boolean not null default false;

create unique index if not exists marketing_campaigns_drop_template_uidx
  on public.marketing_campaigns (user_id)
  where is_drop_template;

comment on column public.marketing_campaigns.is_drop_template is
  'The reusable book-drop announcement. Never sent directly — each drop copies it. Hidden from the campaign list.';

-- ---------------------------------------------------------------------
-- Fetch (or first-time create) a braider's announcement, so the UI can
-- open the composer on it without a separate "create" step.
--
-- The default copy leans on the merge tags the campaign pipeline
-- already substitutes per recipient ({{client_name}}, {{studio_name}}),
-- plus {{dates}}, which this migration fills in per drop. The renderer
-- adds the Book now button and the unsubscribe footer, so the body
-- doesn't repeat either.
-- ---------------------------------------------------------------------
create or replace function public.ensure_drop_announcement_template(user_id_in uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id uuid;
begin
  if user_id_in is null then return null; end if;
  if auth.uid() is not null and auth.uid() <> user_id_in then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id into v_id
    from public.marketing_campaigns
   where user_id = user_id_in and is_drop_template
   limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.marketing_campaigns
    (user_id, name, subject, body_text, segment, status, is_drop_template)
  values (
    user_id_in,
    'Book drop announcement',
    'New dates just opened at {{studio_name}}',
    'Hey {{client_name}},' || chr(10) || chr(10) ||
    'My books just opened for {{dates}}.' || chr(10) || chr(10) ||
    'These dates go fast — first come, first served. Grab your spot below.' || chr(10) || chr(10) ||
    'See you soon,' || chr(10) ||
    '{{studio_name}}',
    '{"kind":"all"}'::jsonb,
    'draft',
    true
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.ensure_drop_announcement_template(uuid) from public;
grant execute on function public.ensure_drop_announcement_template(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Re-created from 20261238 with the client announcement added after the
-- waitlist send. Everything above that point is unchanged.
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

      -- A whole calendar month reads better in an announcement than a
      -- date range, so name the month when the drop is exactly one.
      v_label := case
        when v_from = date_trunc('month', v_from)::date
         and w.max_date = (date_trunc('month', v_from) + interval '1 month - 1 day')::date
          then to_char(v_from, 'FMMonth YYYY')
        else to_char(v_from, 'FMMon FMDD') || ' – ' || to_char(w.max_date, 'FMMon FMDD')
      end;

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
                then 'Your ' || v_label || ' announcement went out to your client list.' ||
                     chr(10) || chr(10) ||
                     'Open Braid Boss Pro -> Marketing to see who received it.'
                else 'Your ' || v_label || ' announcement is written and waiting.' ||
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
