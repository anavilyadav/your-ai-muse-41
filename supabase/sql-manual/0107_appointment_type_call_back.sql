-- 0107 — allow Online Follow-up appointments (29 Oct 2026)
--
-- The app has offered "Online Follow-up" (stored as CALL_BACK, since 25 Sep
-- 2026) on every booking screen, but appointments_appointment_type_check
-- only allowed NEW and FOLLOWUP, so every online follow-up booking failed to
-- save. Found while testing the "Online Consultation -> Done" flow.
alter table public.appointments drop constraint if exists appointments_appointment_type_check;
alter table public.appointments add constraint appointments_appointment_type_check
  check (appointment_type = any (array['NEW'::text, 'FOLLOWUP'::text, 'CALL_BACK'::text]));

insert into schema_migrations (filename, notes) values
  ('0107_appointment_type_call_back', 'appointments.appointment_type also allows CALL_BACK (Online Follow-up)')
on conflict (filename) do nothing;
