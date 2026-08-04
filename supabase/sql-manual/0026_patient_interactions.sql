-- ============================================================================
-- YHC-OS — Patient Interaction Log (new feature) — 04 Aug 2026
-- Run ONCE in Supabase SQL Editor for project swekxnhvecrcpiuteqmj. Safe to
-- re-run (CREATE TABLE IF NOT EXISTS / IF NOT EXISTS indexes throughout).
--
-- Problem being solved (Operational Manual, Part 6, Feature 2 — "sabse
-- important missing feature"): a patient calls to ask about dosage, or
-- gets verbal advice in-clinic, or a dose gets changed over the phone --
-- none of that is recorded anywhere today. Six months later nobody can
-- answer "why did they call, what did we tell them."
--
-- This is a genuinely new, standalone table (patients can have many
-- interactions with no visit attached at all), not an extension of an
-- existing one. Deliberately NOT added to the generic audit_log trigger
-- (migration 0020) -- that migration's own comment already excludes
-- log-of-an-event tables ("auditing a log is noise"), and this is exactly
-- that class of table.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS patient_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('CALL', 'WHATSAPP_REPLY', 'IN_CLINIC_VERBAL', 'DOSE_CHANGE', 'QUERY')),
  note text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Timeline queries always filter by patient and sort newest-first — this
-- index serves both at once instead of needing a separate sort step.
CREATE INDEX IF NOT EXISTS patient_interactions_patient_timeline_idx
  ON patient_interactions (patient_id, created_at DESC);

COMMIT;
