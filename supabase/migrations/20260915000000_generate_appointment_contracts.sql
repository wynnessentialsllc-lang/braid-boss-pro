-- generate_appointment_contracts — contracts for MANUALLY-created
-- appointments.
--
-- generate_booking_contracts only works off a booking_request (the
-- online-booking → approval path), so an appointment the stylist creates
-- by hand never got its contract. This mirrors that logic but sources the
-- client + service straight from the appointments row, so a manual create
-- can send the same agreement an online booking would.
--
-- Idempotent: a row already present for (appointment, template) is skipped,
-- so re-saving never duplicates. Security definer + owner check so a
-- stylist can only generate contracts for their own appointments.

create or replace function public.generate_appointment_contracts(
  appointment_id_in text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  caller         uuid;
  appt_row       public.appointments;
  inserted_count integer := 0;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  if appointment_id_in is null or trim(appointment_id_in) = '' then
    return 0;
  end if;

  select a.* into appt_row
  from public.appointments as a
  where a.id = appointment_id_in
    and a.user_id = caller
  limit 1;

  if appt_row.id is null then
    return 0;
  end if;

  with candidate_templates as (
    select distinct on (ct.id)
      ct.id                  as template_id,
      ct.title               as template_title,
      ct.template_type       as template_type,
      ct.body                as template_body,
      ct.require_signature   as template_require_signature,
      ct.require_initials    as template_require_initials
    from public.contract_templates as ct
    left join public.services as svc
      on svc.id = appt_row.service_id
     and svc.user_id = appt_row.user_id
    where ct.user_id = appt_row.user_id
      and ct.is_active = true
      and (
        svc.contract_template_id = ct.id
        or ct.attach_to_all_bookings = true
        or exists (
          select 1
          from public.service_contract_templates as sct
          where sct.contract_template_id = ct.id
            and sct.service_id = appt_row.service_id
        )
      )
    order by ct.id, case when svc.contract_template_id = ct.id then 0 else 1 end
  ),
  to_insert as (
    select cand.*
    from candidate_templates as cand
    where not exists (
      select 1
      from public.booking_contracts as existing_bc
      where existing_bc.appointment_id = appt_row.id
        and existing_bc.contract_template_id = cand.template_id
    )
  ),
  inserted as (
    insert into public.booking_contracts (
      user_id, client_id, booking_request_id, appointment_id,
      contract_template_id, title, template_type, body_snapshot,
      service_name, require_signature, require_initials,
      status, client_name, client_email, client_phone
    )
    select
      appt_row.user_id,
      appt_row.client_id,
      null,
      appt_row.id,
      ti.template_id,
      ti.template_title,
      ti.template_type,
      ti.template_body,
      appt_row.style,
      ti.template_require_signature,
      ti.template_require_initials,
      'sent',
      appt_row.client_name,
      appt_row.client_email,
      appt_row.client_phone
    from to_insert as ti
    returning 1
  )
  select count(*) into inserted_count from inserted;

  return coalesce(inserted_count, 0);
end;
$$;

revoke all on function public.generate_appointment_contracts(text) from public;
grant execute on function public.generate_appointment_contracts(text) to authenticated;
