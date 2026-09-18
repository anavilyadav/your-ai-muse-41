-- Feature request (18 Sep 2026, Dr. Yadav): patient profile currently
-- shows visits + patient_interactions (doctor notes, in-clinic verbal,
-- dose changes) but NOT the separate `interactions` table used by
-- Reception's Follow-up/Lead CRM screens — a patient's pre-visit reminder
-- calls are invisible from their own profile. Kept as two tables (merging
-- them would touch Lead CRM, which needs lead_id and patient_interactions
-- doesn't support), but this migration adds what's actually missing:
-- a proper open/resolved "Complaint / Support Call" workflow, so an acute
-- issue Reception logs mid-treatment has somewhere to live until a Junior
-- Doctor calls back and answers it — today that would just be an
-- untracked CALL/QUERY note with no way to tell "answered" from "still
-- waiting".

alter table patient_interactions drop constraint if exists patient_interactions_type_check;
alter table patient_interactions add constraint patient_interactions_type_check
  check (type = any (array['CALL','WHATSAPP_REPLY','IN_CLINIC_VERBAL','DOSE_CHANGE','QUERY','COMPLAINT']));

alter table patient_interactions add column if not exists status text;
alter table patient_interactions add column if not exists resolved_note text;
alter table patient_interactions add column if not exists resolved_by text;
alter table patient_interactions add column if not exists resolved_at timestamptz;

alter table patient_interactions drop constraint if exists patient_interactions_status_check;
alter table patient_interactions add constraint patient_interactions_status_check
  check (status is null or status in ('OPEN', 'RESOLVED'));

-- Patient DP/photo — optional, non-blocking (see uploadPatientPhoto in
-- db.ts: a failed/skipped upload never blocks registration or any other
-- flow). Stored path resolves through the existing patient-documents
-- bucket + resolveDocUrl(), same as scanned documents.
alter table patients add column if not exists photo_url text;

insert into schema_migrations (filename, notes) values
  ('0059_complaint_calls_and_patient_photo', 'Adds COMPLAINT interaction type + open/resolved workflow columns to patient_interactions; adds patients.photo_url for patient DP')
on conflict (filename) do nothing;
