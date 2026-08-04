-- ============================================================================
-- YHC-OS — Atomic follow-up rescheduling — 04 Aug 2026
-- Run ONCE in Supabase SQL Editor for project swekxnhvecrcpiuteqmj. Safe to
-- re-run (CREATE OR REPLACE).
--
-- Problem being solved (Part 3 pending item, carried from the 30 Jul audit):
-- generateFollowupSchedule() in src/lib/db.ts was doing DELETE then INSERT
-- as two separate network round-trips from the client. Two ways that broke:
--   1. The DELETE's error was only console.error'd, never thrown -- if it
--      failed (network blip, etc.) the function carried on to INSERT
--      anyway, so the old PENDING rows stayed AND a fresh set got added on
--      top -> duplicate reminders for the same visit.
--   2. No transaction spanned the two statements, so a crash/refresh
--      between them could leave a visit with old rows deleted and new rows
--      never inserted -> silent loss of follow-up coverage.
--   3. Two concurrent calls for the same visit_id (e.g. a retried
--      payment-collection request) could each delete-then-insert and race
--      each other into duplicate rows, since nothing serialized them.
--
-- Fix: one Postgres function does the delete + insert inside a single
-- transaction (atomic by construction -- either both happen or neither),
-- and locks the visit row first so a second concurrent call waits for the
-- first to finish rather than racing it (same FOR UPDATE pattern already
-- used by submit_prescription_atomic in 0010).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION reschedule_followups_atomic(
  p_patient_id uuid,
  p_visit_id uuid,
  p_rows jsonb
) RETURNS void AS $$
DECLARE
  v_visit_exists uuid;
BEGIN
  -- Locks the visit row for the rest of this transaction. A second call
  -- for the same visit (retry, double-tap, etc.) blocks here until this
  -- one commits, so its own DELETE actually sees and clears what this
  -- call inserted, instead of both inserting on top of each other.
  SELECT id INTO v_visit_exists FROM visits WHERE id = p_visit_id FOR UPDATE;
  IF v_visit_exists IS NULL THEN
    RAISE EXCEPTION 'Visit not found: %', p_visit_id;
  END IF;

  DELETE FROM followups
  WHERE visit_id = p_visit_id
    AND status = 'PENDING';

  INSERT INTO followups (patient_id, visit_id, due_date, followup_type, status)
  SELECT
    p_patient_id,
    p_visit_id,
    (r->>'due_date')::date,
    r->>'followup_type',
    'PENDING'
  FROM jsonb_array_elements(p_rows) AS r;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

COMMIT;
