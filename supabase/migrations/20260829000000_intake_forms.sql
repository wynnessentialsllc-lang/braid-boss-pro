-- Digital intake / consultation forms.
--
-- Workflow: on the public booking page the client picks a style + date,
-- optionally fills the stylist's consultation form, then pays the
-- deposit. Answers are captured on the booking_request BEFORE checkout,
-- surface in the stylist's client view, and ride into the approval
-- ("appointment_approved") confirmation email via enrichCustomization
-- in the notification worker.
--
--   * booking_links.intake_form    jsonb  — the stylist's form config
--       { "enabled": bool, "questions": [ { id, label, type, options?, enabled } ] }
--   * booking_requests.intake_answers jsonb — captured answers, an array
--       of { "q": "<question label>", "a": "<answer>" }. Labels are
--       denormalized so display + email never need the form config.

-- 1. Stylist-side form config (owner-written under existing booking_links RLS)
alter table public.booking_links
  add column if not exists intake_form jsonb;

-- 2. Per-booking captured answers
alter table public.booking_requests
  add column if not exists intake_answers jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'booking_requests_intake_answers_chk'
  ) then
    alter table public.booking_requests
      add constraint booking_requests_intake_answers_chk
      check (
        intake_answers is null
        or (jsonb_typeof(intake_answers) = 'array' and jsonb_array_length(intake_answers) <= 40)
      ) not valid;
    alter table public.booking_requests validate constraint booking_requests_intake_answers_chk;
  end if;
end $$;

-- 3. Anon: fetch a stylist's intake form for the booking page. Keyed by
--    user_id (the booking page already resolves slug -> user_id).
create or replace function public.public_get_intake_form(user_id_in uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form jsonb;
begin
  if user_id_in is null then
    return jsonb_build_object('ok', false);
  end if;

  select intake_form
    into v_form
  from public.booking_links
  where user_id = user_id_in
  order by created_at desc nulls last
  limit 1;

  return jsonb_build_object('ok', true, 'intake_form', v_form);
end;
$$;

revoke all on function public.public_get_intake_form(uuid) from public;
grant execute on function public.public_get_intake_form(uuid) to anon, authenticated;

-- 4. Anon: attach captured answers to a booking request (before deposit).
--    Best-effort, idempotent (overwrites). Validates shape + caps size.
create or replace function public.public_attach_intake_answers(
  request_id_in uuid,
  answers_in    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  if request_id_in is null then
    return jsonb_build_object('ok', false, 'reason', 'no_request');
  end if;
  if answers_in is null
     or jsonb_typeof(answers_in) <> 'array'
     or jsonb_array_length(answers_in) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_answers');
  end if;
  if jsonb_array_length(answers_in) > 40 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  select exists(select 1 from public.booking_requests where id = request_id_in)
    into v_exists;
  if not v_exists then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update public.booking_requests
     set intake_answers = answers_in
   where id = request_id_in;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.public_attach_intake_answers(uuid, jsonb) from public;
grant execute on function public.public_attach_intake_answers(uuid, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
