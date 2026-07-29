-- ============================================================================
-- YHC-OS — Case Discussion Tracking (Online Cases) — Dr. Yadav, 29 Jul 2026
-- Run this ONCE in Supabase SQL Editor. Safe to re-run.
--
-- Problem being solved: online cases pay upfront (₹3700 vs ₹1000 walk-in)
-- and this whole process was tracked on paper — cases sat undiscussed for
-- 10-20 days with no visibility. This adds a real, queryable "has this
-- case been discussed yet" fact instead of relying on a notebook.
-- ============================================================================

BEGIN;

ALTER TABLE visits ADD COLUMN IF NOT EXISTS case_discussed_at timestamptz;

-- Backfill: any visit already past the doctor stage before this column
-- existed WAS already discussed — mark it so historical visits don't
-- falsely show up as "pending" the moment this ships.
UPDATE visits
SET case_discussed_at = COALESCE(case_discussed_at, created_at)
WHERE case_discussed_at IS NULL
  AND (
    visit_status IN ('PHARMACY', 'PAYMENT', 'DONE')
    OR id IN (SELECT DISTINCT visit_id FROM prescriptions)
  );

-- ---------------------------------------------------------------------------
-- Atomic Rx submission (also fixes a long-standing separate issue: this
-- used to be 3 unrelated writes — prescription insert, visit-status
-- update, patient.last_visit_date update — with no transaction, so a
-- crash between them could leave medicine "prescribed" with the visit
-- never reaching Pharmacy.) Sets case_discussed_at the moment Rx is
-- submitted — this is the single source of truth for "discussed".
-- ---------------------------------------------------------------------------
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
    INSERT INTO prescriptions (visit_id, patient_id, medicine_name, potency, dose, frequency, duration_days, is_slx)
    VALUES (
      p_visit_id, p_patient_id,
      r->>'medicine_name', r->>'potency', r->>'dose', r->>'frequency',
      NULLIF(r->>'duration_days', '')::int, COALESCE((r->>'is_slx')::boolean, false)
    );
  END LOOP;

  UPDATE visits
  SET visit_status = 'PHARMACY',
      doctor_notes = p_doctor_notes,
      next_visit_date = p_next_visit_date,
      case_discussed_at = now()
  WHERE id = p_visit_id;

  UPDATE patients
  SET last_visit_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
  WHERE id = p_patient_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Case funnel stats — registered vs discussed, today/week/month/year,
-- split by channel. One query instead of ~30 separate count() calls.
-- Week = Monday-start (Postgres default for date_trunc('week', ...)).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION case_funnel_stats() RETURNS jsonb AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_week_start date := date_trunc('week', v_today)::date;
  v_month_start date := date_trunc('month', v_today)::date;
  v_year_start date := date_trunc('year', v_today)::date;
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'today', jsonb_build_object(
      'total', count(*) FILTER (WHERE visit_date = v_today),
      'discussed', count(*) FILTER (WHERE visit_date = v_today AND case_discussed_at IS NOT NULL),
      'online_total', count(*) FILTER (WHERE visit_date = v_today AND visit_type = 'ONLINE'),
      'online_discussed', count(*) FILTER (WHERE visit_date = v_today AND visit_type = 'ONLINE' AND case_discussed_at IS NOT NULL)
    ),
    'week', jsonb_build_object(
      'total', count(*) FILTER (WHERE visit_date >= v_week_start),
      'discussed', count(*) FILTER (WHERE visit_date >= v_week_start AND case_discussed_at IS NOT NULL),
      'online_total', count(*) FILTER (WHERE visit_date >= v_week_start AND visit_type = 'ONLINE'),
      'online_discussed', count(*) FILTER (WHERE visit_date >= v_week_start AND visit_type = 'ONLINE' AND case_discussed_at IS NOT NULL)
    ),
    'month', jsonb_build_object(
      'total', count(*) FILTER (WHERE visit_date >= v_month_start),
      'discussed', count(*) FILTER (WHERE visit_date >= v_month_start AND case_discussed_at IS NOT NULL),
      'online_total', count(*) FILTER (WHERE visit_date >= v_month_start AND visit_type = 'ONLINE'),
      'online_discussed', count(*) FILTER (WHERE visit_date >= v_month_start AND visit_type = 'ONLINE' AND case_discussed_at IS NOT NULL)
    ),
    'year', jsonb_build_object(
      'total', count(*) FILTER (WHERE visit_date >= v_year_start),
      'discussed', count(*) FILTER (WHERE visit_date >= v_year_start AND case_discussed_at IS NOT NULL),
      'online_total', count(*) FILTER (WHERE visit_date >= v_year_start AND visit_type = 'ONLINE'),
      'online_discussed', count(*) FILTER (WHERE visit_date >= v_year_start AND visit_type = 'ONLINE' AND case_discussed_at IS NOT NULL)
    )
  ) INTO v_result
  FROM visits
  WHERE visit_date >= v_year_start;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

COMMIT;

-- VERIFY:
-- select case_funnel_stats();
-- select id, visit_type, case_discussed_at from visits order by created_at desc limit 5;
