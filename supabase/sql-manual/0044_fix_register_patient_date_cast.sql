-- ============================================================================
-- YHC-OS — Fix: register_patient_with_visit had a date/text comparison bug
-- that made the "safe atomic registration" path silently unreachable since
-- 29 Jul 2026 (26 Aug 2026)
--
-- Owner Health showed "50 RPC fallback alerts" -- the app was reporting
-- register_patient_with_visit as "missing", telling reception to run a SQL
-- migration that had, in fact, already been run. The real cause: the
-- function's own body compared visits.visit_date (a `date` column) directly
-- against p_visit_date (declared `text`) with no cast:
--
--   WHERE visit_date = p_visit_date AND branch = p_branch
--
-- Postgres has no `date = text` operator, so this raised SQLSTATE 42883
-- (undefined_function) on every single call. The frontend's missing-RPC
-- detector (db.ts createPatientWithVisit) also matches on error code 42883
-- -- reasonable when checking whether a function exists at all, but this
-- error code ALSO covers "function exists, but no matching operator inside
-- it", so a genuine internal bug was being misclassified as "not deployed
-- yet" and silently swallowed into the older, non-atomic two-insert
-- fallback path (still correct, just without the single-transaction
-- guarantee) for every registration since this function was introduced.
--
-- Fix: cast p_visit_date to date at both use sites. No signature change,
-- so this is a safe CREATE OR REPLACE (verified: no duplicate overload,
-- same grants as before).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.register_patient_with_visit(p_name text, p_mobile text, p_age integer, p_gender text, p_blood_group text, p_city text, p_pincode text, p_primary_disease text, p_wa_consent boolean, p_branch text, p_chief_complaint text, p_visit_date text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_patient_code text;
  v_token text;
  v_patient_count int;
  v_visit_count int;
  new_patient_id uuid;
  new_visit_id uuid;
  result jsonb;
BEGIN
  SELECT count(*) INTO v_patient_count FROM patients;
  v_patient_code := 'YHC-' || (1000 + v_patient_count + 1)::text;

  SELECT count(*) INTO v_visit_count FROM visits WHERE visit_date = p_visit_date::date AND branch = p_branch;
  v_token := 'T-' || lpad((v_visit_count + 1)::text, 2, '0');

  INSERT INTO patients (patient_code, name, mobile, age, gender, blood_group, city, pincode, primary_disease, wa_consent, branch, lifetime_visits)
  VALUES (v_patient_code, p_name, p_mobile, p_age, p_gender, p_blood_group, p_city, p_pincode, p_primary_disease, p_wa_consent, p_branch, 1)
  RETURNING id INTO new_patient_id;

  INSERT INTO visits (patient_id, visit_date, visit_type, visit_status, token_number, branch, chief_complaint)
  VALUES (new_patient_id, p_visit_date::date, 'OPD', 'REGISTERED', v_token, p_branch, p_chief_complaint)
  RETURNING id INTO new_visit_id;

  SELECT jsonb_build_object('patient', to_jsonb(p.*), 'visit', to_jsonb(v.*))
  INTO result
  FROM patients p, visits v
  WHERE p.id = new_patient_id AND v.id = new_visit_id;

  RETURN result;
END;
$function$;
