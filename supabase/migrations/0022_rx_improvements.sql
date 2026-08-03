-- 0022 — Rx Improvements: Autosave, Sequenced Dosing, SLX labelling (03 Aug 2026)
--
-- Backlog items from the 03 Aug 2026 audit ("Rx improvements" B/D/E):
--   B. Rx Autosave                 -> visits.rx_draft (jsonb, cleared on submit)
--   D. Sequenced medicine duration -> prescriptions.start_offset_days
--   E. SLX shows as "SLX" not "SLX (medicine-name)" -> prescriptions.remarks
--      records which medicine an SLX row is paired with instead of stuffing
--      it into medicine_name
-- (Items C and F are settings-table only — no schema change needed.)
--
-- Signature of submit_prescription_atomic is UNCHANGED (still 5 args) —
-- the two new fields travel inside the existing p_rows jsonb array, so no
-- caller elsewhere needs to change how it invokes this function.
--
-- NOTE: run this in Supabase SQL Editor, same as 0001-0021. Safe to re-run.

BEGIN;

ALTER TABLE visits ADD COLUMN IF NOT EXISTS rx_draft jsonb;

ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS start_offset_days integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION submit_prescription_atomic(
  p_visit_id uuid,
  p_patient_id uuid,
  p_rows jsonb,
  p_doctor_notes text,
  p_next_visit_date date
) RETURNS jsonb AS $$
DECLARE
  v_status text;
  r jsonb;
BEGIN
  SELECT visit_status INTO v_status FROM visits WHERE id = p_visit_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Visit not found';
  END IF;
  IF v_status IN ('PAYMENT', 'DONE') THEN
    RAISE EXCEPTION 'Yeh visit already Pharmacy se aage badh chuki hai — prescription dobara submit nahi kar sakte is stage se.';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    INSERT INTO prescriptions (
      visit_id, patient_id, medicine_name, potency, dose, frequency,
      duration_days, is_slx, start_offset_days, remarks
    )
    VALUES (
      p_visit_id, p_patient_id,
      r->>'medicine_name', r->>'potency', r->>'dose', r->>'frequency',
      NULLIF(r->>'duration_days', '')::int, COALESCE((r->>'is_slx')::boolean, false),
      COALESCE(NULLIF(r->>'start_offset_days', '')::int, 0),
      NULLIF(r->>'remarks', '')
    );
  END LOOP;

  UPDATE visits
  SET visit_status = 'PHARMACY',
      doctor_notes = p_doctor_notes,
      next_visit_date = p_next_visit_date,
      case_discussed_at = now(),
      rx_draft = NULL
  WHERE id = p_visit_id;

  UPDATE patients
  SET last_visit_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
  WHERE id = p_patient_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

COMMIT;
