-- 0070 — Calling/WhatsApp number confirmation flags (23 Sep 2026)
--
-- Owner asked for every patient to always have a confirmed calling
-- number and WhatsApp number — the bulk import brought in ~7000 real
-- patients whose numbers were typed off paper, never actually verified
-- with the patient, and this session's own investigation found real
-- cases of shared/family mobiles and mismatched numbers. Defaults to
-- false for every existing patient (nothing gets to claim "confirmed"
-- just because a bulk import happened to have a number in that column) —
-- staff mark it explicitly, per patient, once they've actually verified
-- it. whatsapp_confirmed only matters when a WhatsApp number distinct
-- from mobile is on file; when whatsapp_number is null ("same as
-- mobile"), confirming the mobile number already covers it.

alter table public.patients
  add column if not exists mobile_confirmed boolean not null default false,
  add column if not exists whatsapp_confirmed boolean not null default false;

insert into schema_migrations (filename, notes) values
  ('0070_patient_number_confirmation', 'Adds patients.mobile_confirmed/whatsapp_confirmed (default false) so staff can explicitly mark a patient''s calling/WhatsApp number as verified, surfaced as a new Data Quality report section')
on conflict (filename) do nothing;
