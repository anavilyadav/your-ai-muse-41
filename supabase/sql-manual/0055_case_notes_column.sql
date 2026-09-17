-- 0055 — Split Case-DR notes from the prescribing doctor's notes (SF-09 /
-- RF-07, found during the master production audit, 17 Sep 2026).
--
-- visits.doctor_notes was written by BOTH the Case-DR's structured
-- history (generals/mentals/modalities/etc, via saveCaseNotes) AND the
-- prescribing doctor's own free-text follow-up notes (via
-- submitPrescription / submit_prescription_atomic) — same column, no
-- version check, last write wins. A routine Rx note-save could silently
-- erase real case-taking history. The "Case notes (Case-DR)" box on the
-- Rx-consult screen was also reading this same column, so it could never
-- actually show genuine Case-DR content once the prescribing doctor had
-- saved their own notes once.
--
-- Fix: a separate `case_notes` column, written only by saveCaseNotes
-- (src/lib/db.ts), read-only everywhere else. doctor_notes keeps its
-- existing meaning (the prescribing doctor's own notes) unchanged.
--
-- Not backfilled: existing doctor_notes values already mix both kinds of
-- content from before this fix, with no reliable way to tell which parts
-- came from which flow — leaving them in doctor_notes (where the
-- prescribing-doctor UI already expects to find them) is safer than
-- guessing which historical rows to move.

alter table visits add column if not exists case_notes text;

insert into schema_migrations (filename, notes) values
  ('0055_case_notes_column', 'fixes SF-09/RF-07 — separates Case-DR history from prescribing-doctor notes, found and fixed same session as the master audit')
on conflict (filename) do nothing;
