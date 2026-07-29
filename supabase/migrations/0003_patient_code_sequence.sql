-- ============================================================================
-- YHC-OS — Atomic Patient Code Sequence — Audit P0-3 remainder
-- Run this ONCE in Supabase SQL Editor. Safe to re-run.
--
-- Seeds the sequence to continue right after the highest existing
-- patient_code number, so it can never collide with historic data.
-- ============================================================================

BEGIN;

CREATE SEQUENCE IF NOT EXISTS patient_code_seq;

-- Seed/re-sync to the current max, in case any patients already exist.
SELECT setval(
  'patient_code_seq',
  GREATEST(
    1000,
    (SELECT COALESCE(MAX(NULLIF(regexp_replace(patient_code, '\D', '', 'g'), '')::int), 1000) FROM patients)
  )
);

CREATE OR REPLACE FUNCTION next_patient_codes(p_count int DEFAULT 1) RETURNS text[] AS $$
DECLARE
  v_codes text[] := '{}';
  i int;
BEGIN
  FOR i IN 1..p_count LOOP
    v_codes := array_append(v_codes, 'YHC-' || nextval('patient_code_seq')::text);
  END LOOP;
  RETURN v_codes;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- VERIFY:
-- select next_patient_codes(3);  -- should return 3 new, never-before-used codes
