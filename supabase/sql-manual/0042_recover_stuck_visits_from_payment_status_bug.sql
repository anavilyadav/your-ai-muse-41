-- ============================================================================
-- YHC-OS — One-time data repair: 29 real visits stuck DONE by the
-- registration-payment bug fixed in 0041 (13 Aug 2026)
--
-- Between the inline-payment-at-registration feature going live and 0041's
-- fix, every registration where a full payment was collected got its visit
-- marked DONE immediately, before the doctor ever saw the patient. Found via:
--
--   visit_status IN ('DONE','PAYMENT') AND case_discussed_at IS NULL
--   AND no prescription exists for that patient created at/after the visit
--
-- 29 visits matched, all first-time patients (lifetime_visits = 1), all at
-- BAJAJ_NAGAR, dated 19-22 Aug 2026 -- exactly the window this was live.
-- Reset to REGISTERED so they reappear in the doctor's queue. Payment
-- records themselves were never wrong and are untouched by this — only the
-- visit_status side-effect from the bug is being undone.
-- ============================================================================

update visits v
set visit_status = 'REGISTERED'
where v.visit_status in ('DONE','PAYMENT')
  and v.case_discussed_at is null
  and not exists (
    select 1 from prescriptions rx where rx.patient_id = v.patient_id and rx.created_at >= v.created_at
  );
