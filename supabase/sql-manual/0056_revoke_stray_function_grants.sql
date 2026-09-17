-- 0056 — Revoke stray anon/PUBLIC execute grants (RF-14, found during the
-- master production audit, 17 Sep 2026).
--
-- 9 functions had a leftover anon/PUBLIC EXECUTE grant. Each was
-- individually tested live as the real anon role during the audit:
-- audit_log_generic/fn_detect_overpayment/log_wa_consent_change are
-- trigger functions Postgres refuses to call outside trigger context;
-- case_funnel_stats/increment_stock/next_token_for_day/
-- reschedule_followups_atomic/submit_prescription_atomic are SECURITY
-- INVOKER and blocked by the underlying table's RLS regardless of the
-- function grant. Only next_patient_codes was actually callable by anon
-- (sequences aren't governed by table RLS at all) — that specific test
-- advanced the real patient_code_seq by one during the audit, which was
-- corrected live (setval back to the true last-issued value) at the time,
-- but the grant itself was left for this migration to close properly.
-- This migration is the defense-in-depth cleanup for all 9: none of them
-- should ever have been reachable without a real staff login in the
-- first place, and a future change to any of them (e.g. adding a new
-- INVOKER function that touches a sequence) would otherwise silently
-- inherit a live hole the same way next_patient_codes did.

revoke all on function audit_log_generic() from public, anon;
revoke all on function case_funnel_stats() from public, anon;
revoke all on function fn_detect_overpayment() from public, anon;
revoke all on function increment_stock(text, text, text, numeric, text) from public, anon;
revoke all on function log_wa_consent_change() from public, anon;
revoke all on function next_patient_codes(int) from public, anon;
revoke all on function next_token_for_day(text, date) from public, anon;
revoke all on function reschedule_followups_atomic(uuid, uuid, jsonb) from public, anon;
revoke all on function submit_prescription_atomic(uuid, uuid, jsonb, text, date) from public, anon;

insert into schema_migrations (filename, notes) values
  ('0056_revoke_stray_function_grants', 'RF-14 cleanup — defense-in-depth, verified none of the 9 were actually exploitable except next_patient_codes (already closed live during the audit)')
on conflict (filename) do nothing;
