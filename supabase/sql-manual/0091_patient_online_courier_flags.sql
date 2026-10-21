-- 0091 — Mark online / courier patients (21 Oct 2026)
--
-- Dr. Yadav wants patients who consult online or get medicine by courier
-- marked everywhere (follow-up calling, patient master), and to be able to
-- pick out just the courier patients for a message. Set automatically from
-- what the app records (video visit, courier delivery, online follow-up
-- request); staff can also set/clear them from the patient profile, since
-- the historical import doesn't say who was online.

alter table public.patients add column if not exists is_online boolean not null default false;
alter table public.patients add column if not exists uses_courier boolean not null default false;

update public.patients p set is_online = true
where not p.is_online and (
  exists (select 1 from public.visits v where v.patient_id = p.id and not v.is_deleted
          and (v.visit_type = 'VIDEO' or v.consultation_mode is distinct from 'IN_PERSON'))
  or exists (select 1 from public.online_followup_requests r where r.patient_id = p.id)
);

update public.patients p set uses_courier = true
where not p.uses_courier and (
  exists (select 1 from public.deliveries d where d.patient_id = p.id)
  or exists (select 1 from public.online_followup_requests r where r.patient_id = p.id
             and r.delivery_method in ('COURIER', 'JAIPUR_COURIER'))
);

create or replace function public.mark_patient_online_from_visit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.patient_id is not null and (new.visit_type = 'VIDEO' or new.consultation_mode is distinct from 'IN_PERSON') then
    update public.patients set is_online = true where id = new.patient_id and not is_online;
  end if;
  return new;
end $$;

create or replace function public.mark_patient_courier_from_delivery()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.patient_id is not null then
    update public.patients set uses_courier = true where id = new.patient_id and not uses_courier;
  end if;
  return new;
end $$;

create or replace function public.mark_patient_from_online_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.patients
  set is_online = true,
      uses_courier = uses_courier or new.delivery_method in ('COURIER', 'JAIPUR_COURIER')
  where id = new.patient_id;
  return new;
end $$;

revoke all on function public.mark_patient_online_from_visit() from public, anon;
revoke all on function public.mark_patient_courier_from_delivery() from public, anon;
revoke all on function public.mark_patient_from_online_request() from public, anon;

drop trigger if exists trg_visit_marks_online on public.visits;
create trigger trg_visit_marks_online after insert or update of visit_type, consultation_mode on public.visits
  for each row execute function public.mark_patient_online_from_visit();

drop trigger if exists trg_delivery_marks_courier on public.deliveries;
create trigger trg_delivery_marks_courier after insert or update of patient_id on public.deliveries
  for each row execute function public.mark_patient_courier_from_delivery();

drop trigger if exists trg_online_request_marks_patient on public.online_followup_requests;
create trigger trg_online_request_marks_patient after insert on public.online_followup_requests
  for each row execute function public.mark_patient_from_online_request();

create index if not exists patients_remote_idx on public.patients (is_online, uses_courier) where is_online or uses_courier;

insert into schema_migrations (filename, notes) values
  ('0091_patient_online_courier_flags', 'patients.is_online / uses_courier, set automatically from video visits, deliveries and online follow-up requests (and editable by staff); shown on follow-up calls and patient master')
on conflict (filename) do nothing;
