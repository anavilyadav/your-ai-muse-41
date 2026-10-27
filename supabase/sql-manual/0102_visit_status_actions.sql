-- 0102 — Aa gaya / Reschedule / Cancel for every visit in the queue (27 Oct 2026)
--
-- Dr. Yadav: every patient entry in the reception queue should carry the
-- same status options — Arrived, Reschedule, Cancel.
--
-- visits.arrived_at: when reception marked the patient as arrived.
-- cancel_visit: takes the patient out of the queue. A visit that already has
--   a payment is NOT removed (money would vanish from the books) — the caller
--   is told to ask the Owner for an adjustment. Soft delete only, with the
--   reason kept; the patient's visit count is recomputed.
-- reschedule_visit: moves the patient to another day. With a payment on the
--   visit (e.g. an advance) the visit itself moves to the new date with a new
--   token; with no payment it is simply removed from today's queue and the
--   appointment booked for the new day carries on.

alter table public.visits add column if not exists arrived_at timestamptz;
alter table public.visits add column if not exists cancel_reason text;
alter table public.visits add column if not exists cancelled_at timestamptz;

create or replace function public.cancel_visit(p_visit_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v record;
begin
  if not public.is_active_staff() then
    raise exception 'permission denied';
  end if;

  select id, patient_id, visit_date, visit_status, is_deleted into v from visits where id = p_visit_id for update;
  if v.id is null or v.is_deleted then
    raise exception 'Visit nahi mili';
  end if;
  if v.visit_status = 'DONE' then
    raise exception 'Ye visit ho chuki hai — cancel nahi ho sakti';
  end if;
  if exists (select 1 from payments where visit_id = p_visit_id and not is_deleted and amount_received > 0) then
    raise exception 'Is visit pe payment le liya gaya hai — pehle Owner se payment adjustment / refund karwao, phir cancel karo';
  end if;

  update visits
  set is_deleted = true, cancelled_at = now(), cancel_reason = coalesce(nullif(trim(p_reason), ''), 'Cancel')
  where id = p_visit_id;

  update patients
  set lifetime_visits = (select count(*) from visits where patient_id = v.patient_id and not is_deleted)
  where id = v.patient_id;

  -- The appointment this patient came for is cancelled with the visit.
  update appointments set status = 'Cancelled'
  where patient_id = v.patient_id and appointment_date = v.visit_date and status in ('Arrived', 'Started');

  return jsonb_build_object('visit_id', p_visit_id, 'cancelled', true);
end;
$function$;

create or replace function public.reschedule_visit(p_visit_id uuid, p_new_date date)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v record;
  v_token text;
  v_n int;
  v_has_payment boolean;
begin
  if not public.is_active_staff() then
    raise exception 'permission denied';
  end if;
  if p_new_date is null or p_new_date <= (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Nayi tareekh aaj se aage ki chuno';
  end if;

  select id, patient_id, branch, visit_date, visit_status, is_deleted into v from visits where id = p_visit_id for update;
  if v.id is null or v.is_deleted then
    raise exception 'Visit nahi mili';
  end if;
  if v.visit_status = 'DONE' then
    raise exception 'Ye visit ho chuki hai — reschedule nahi ho sakti';
  end if;

  select exists (select 1 from payments where visit_id = p_visit_id and not is_deleted and amount_received > 0) into v_has_payment;

  if v_has_payment then
    perform pg_advisory_xact_lock(hashtext(coalesce(v.branch, '') || p_new_date::text));
    select count(*) into v_n from visits where visit_date = p_new_date and branch = v.branch;
    v_token := 'T-' || lpad((v_n + 1)::text, 2, '0');
    update visits set visit_date = p_new_date, token_number = v_token, arrived_at = null where id = p_visit_id;
    return jsonb_build_object('visit_id', p_visit_id, 'moved', true, 'new_date', p_new_date, 'token', v_token);
  end if;

  update visits
  set is_deleted = true, cancelled_at = now(), cancel_reason = 'Reschedule -> ' || p_new_date::text
  where id = p_visit_id;
  update patients
  set lifetime_visits = (select count(*) from visits where patient_id = v.patient_id and not is_deleted)
  where id = v.patient_id;
  return jsonb_build_object('visit_id', p_visit_id, 'moved', false, 'new_date', p_new_date);
end;
$function$;

revoke all on function public.cancel_visit(uuid, text) from public, anon;
revoke all on function public.reschedule_visit(uuid, date) from public, anon;
grant execute on function public.cancel_visit(uuid, text) to authenticated, service_role;
grant execute on function public.reschedule_visit(uuid, date) to authenticated, service_role;

insert into schema_migrations (filename, notes) values
  ('0102_visit_status_actions', 'visits.arrived_at/cancel_reason/cancelled_at, cancel_visit and reschedule_visit (payment-safe)')
on conflict (filename) do nothing;
