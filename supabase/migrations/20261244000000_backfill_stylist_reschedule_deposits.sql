-- One-time backfill: repair bookings a stylist moved BEFORE
-- 20261243000000_stylist_reschedule_carries_deposit.
--
-- Until that migration, the stylist-side Move updated only the
-- appointments row. The linked booking_request kept the OLD
-- preferred_date / preferred_time, and deposit_rollover was never set —
-- so the client portal showed the wrong slot and gave no sign that the
-- deposit they had already paid still applied.
--
-- This walks the bookings that are still out of step and brings the
-- request back in line with its appointment.
--
-- Scope, deliberately narrow:
--   * Only rows whose linked appointment exists, belongs to the same
--     owner, and whose date/time actually differ from the request.
--   * Only appointments still AHEAD of today. A past booking's portal
--     is moot, and rewriting settled history is not this migration's
--     business.
--   * Never a cancelled, declined or forfeited booking — a cancellation
--     forfeits the deposit; it does not roll it over.
--
-- Deliberately NOT touched:
--   * reschedule_count / reschedule_token — the client's one-shot
--     self-service reschedule allowance. A stylist's move (or this
--     repair) must not spend it.
--   * deposit_amount / deposit_paid — the money itself is already
--     correct on both rows. This only records that it carries over.
--   * last_reminder_sent_at is cleared ONLY for appointments more than
--     30 hours out. The reminder cron fires in an 18-30h window, so
--     clearing it inside that window could re-send a reminder the
--     moment this migration runs; outside it, the next run simply picks
--     up the corrected date.
--
-- Idempotent: it selects on the date/time mismatch it fixes, so a second
-- run matches nothing.

do $$
declare
  n_total    int := 0;
  n_rollover int := 0;
begin
  with moved as (
    select
      br.id,
      a.appt_date as new_date,
      nullif(trim(coalesce(a.appt_time, '')), '') as new_time,
      case
        when br.preferred_date is not null and br.preferred_time is not null
          then (br.preferred_date::text || ' ' || br.preferred_time::text)::timestamp
        else null
      end as old_start_ts,
      -- The deposit rolls over only where one was actually collected.
      (coalesce(br.deposit_paid, false) and coalesce(br.deposit_amount, 0) > 0) as carries_deposit,
      -- Safe to re-arm reminders only outside the cron's 18-30h window.
      ((a.appt_date::text || ' ' || coalesce(nullif(trim(coalesce(a.appt_time, '')), ''), '00:00'))::timestamp
        > now() + interval '30 hours') as reminder_safe
    from public.booking_requests br
    join public.appointments a
      on a.id = br.appointment_id
     and a.user_id = br.user_id
    where br.appointment_id is not null
      and a.appt_date is not null
      and a.appt_date >= current_date
      and br.cancelled_at is null
      and coalesce(br.deposit_forfeited, false) = false
      and coalesce(br.approval_status, '') in ('approved', 'confirmed')
      and lower(coalesce(a.status, '')) not in ('cancelled', 'canceled', 'no_show')
      and (
            a.appt_date is distinct from br.preferred_date
         or nullif(trim(coalesce(a.appt_time, '')), '') is distinct from br.preferred_time
          )
  ),
  repaired as (
  update public.booking_requests br
     set preferred_date = m.new_date,
         preferred_time = coalesce(m.new_time, br.preferred_time),
         deposit_rollover = case when m.carries_deposit then true else br.deposit_rollover end,
         rescheduled_from = coalesce(br.rescheduled_from, m.old_start_ts),
         rescheduled_at   = coalesce(br.rescheduled_at, now()),
         last_reminder_sent_at = case when m.reminder_safe then null else br.last_reminder_sent_at end,
         client_action_audit = coalesce(br.client_action_audit, '[]'::jsonb) || jsonb_build_array(
           jsonb_build_object(
             'action',           'reschedule_backfill',
             'from_date',        br.preferred_date,
             'from_time',        br.preferred_time,
             'to_date',          m.new_date,
             'to_time',          m.new_time,
             'deposit_rollover', m.carries_deposit,
             'at',               now()
           )
         ),
         updated_at = now()
    from moved m
   where br.id = m.id
   returning m.carries_deposit
  )
  select count(*), count(*) filter (where carries_deposit)
    into n_total, n_rollover
  from repaired;

  raise notice 'reschedule backfill: % booking(s) re-synced to their appointment, % now marked deposit_rollover',
    n_total, n_rollover;
end $$;
