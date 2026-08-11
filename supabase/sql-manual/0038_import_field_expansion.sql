-- ============================================================================
-- YHC-OS — CSV import field expansion — 10 Aug 2026
-- Run ONCE in Supabase SQL Editor for project swekxnhvecrcpiuteqmj. Safe to
-- re-run (IF NOT EXISTS throughout).
--
-- WHY
-- Dr. Yadav's real daily-entry and master-sheet CSV formats (shared 10 Aug
-- 2026) have several columns the app had nowhere to put: patient email,
-- category, patient type, foreign-patient info on the master/patients side;
-- medicine, duration, slip no., due date, details, reminder call on the
-- daily-entry/visit side.
--
-- import_notes on visits is deliberately a single free-text field, not five
-- narrow structured columns — this is one-time historical record-keeping
-- data, not live clinical/inventory data that anything else in the app
-- reads. In particular, the "due date" from old paper/sheet records is
-- stored here as plain text, NOT written to visits.next_visit_date — that
-- column feeds the live WhatsApp follow-up reminder engine, and writing
-- years-old due dates into it would fire real reminder messages to
-- patients for appointments that are long since resolved one way or
-- another. Historical due dates are for reference only.
-- ============================================================================

alter table public.patients
  add column if not exists email text,
  add column if not exists category text,
  add column if not exists patient_type text,
  add column if not exists foreign_patient_info text;

alter table public.visits
  add column if not exists import_notes text;
