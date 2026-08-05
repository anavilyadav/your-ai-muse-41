-- ============================================================================
-- YHC-OS — Security hardening: C-2 + M-2 from the 05 Aug 2026 zero-trust
-- audit. Pure SQL, no app-code changes needed, safe to re-run.
--
-- PART A (audit finding C-2, Critical) — four SECURITY DEFINER functions
-- were callable by the anon role with no login at all, straight through
-- the public REST API (/rest/v1/rpc/<name>).
--
-- REAL BUG CAUGHT MID-FIX, WORTH RECORDING: the first version of this
-- migration only did REVOKE ... FROM anon, then re-checked with
-- information_schema.routine_privileges and saw zero rows for anon —
-- looked fixed. It wasn't. Postgres grants EXECUTE to the PUBLIC
-- pseudo-role by default when a function is created, and anon inherits
-- through PUBLIC regardless of what's revoked from anon specifically.
-- information_schema.routine_privileges doesn't surface PUBLIC-inherited
-- access as a row for anon, so it looked clean when it wasn't.
-- has_function_privilege('anon', ..., 'EXECUTE') — the same check Postgres
-- itself uses at call time — still returned true. That's what caught it.
-- Lesson: when checking effective privilege, use has_function_privilege
-- (or has_table_privilege), not information_schema, which only shows
-- privileges explicitly listed against a named grantee.
--
-- The actual fix is REVOKE ... FROM PUBLIC, then explicit re-GRANTs to
-- authenticated for the three the live app genuinely calls from a
-- logged-in session (confirmed by grepping src/lib/db.ts — not guessed).
-- run_nightly_data_health gets no re-grant at all: it's only ever called
-- by the nightly-data-health Edge Function using the service_role key,
-- confirmed separately still working after this revoke
-- (has_function_privilege('service_role', ...) = true — service_role has
-- its own direct grant, untouched by this migration).
--
-- PART B (audit finding M-2, Medium) — 12 functions had a mutable
-- search_path (WARN-level, standard Postgres hardening). Pinning
-- search_path to public, pg_temp closes that. Exact argument signatures
-- pulled live from pg_proc, not guessed, so this won't create stray
-- overloads.
-- ============================================================================

BEGIN;

-- ---- Part A: lock the four SECURITY DEFINER RPCs down to authenticated
-- (and, for the cron-only one, to service_role alone) ----
REVOKE EXECUTE ON FUNCTION public.check_in_existing_patient_atomic(uuid, text, text, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.collect_payment_atomic(uuid, uuid, numeric, numeric, text, text, text, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dispense_visit_atomic(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.run_nightly_data_health() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.check_in_existing_patient_atomic(uuid, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collect_payment_atomic(uuid, uuid, numeric, numeric, text, text, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispense_visit_atomic(uuid) TO authenticated;
-- run_nightly_data_health: deliberately no GRANT to authenticated or anon —
-- service_role (used by the Edge Function) already has its own direct
-- grant, unaffected by the PUBLIC revoke above.

-- ---- Part B: pin search_path ----
ALTER FUNCTION public.register_patient_with_visit(text, text, integer, text, text, text, text, text, boolean, text, text, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.apply_available_credit(uuid, uuid, numeric) SET search_path = public, pg_temp;
ALTER FUNCTION public.resolve_payment_adjustment(uuid, text, text, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.revert_credit_application(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.next_patient_codes(integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.next_token_for_day(text, date) SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_stock(text, text, text, numeric, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.submit_prescription_atomic(uuid, uuid, jsonb, text, date) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_detect_overpayment() SET search_path = public, pg_temp;
ALTER FUNCTION public.case_funnel_stats() SET search_path = public, pg_temp;
ALTER FUNCTION public.log_wa_consent_change() SET search_path = public, pg_temp;
ALTER FUNCTION public.audit_log_generic() SET search_path = public, pg_temp;

COMMIT;

-- MANUAL STEP (Owner Dashboard, not SQL) — still pending, this file
-- doesn't touch it: Supabase Dashboard -> Authentication -> Settings ->
-- turn ON "Leaked password protection". Low effort, audit finding H-2.

-- VERIFY (use has_function_privilege, NOT information_schema — see note above):
-- select has_function_privilege('anon', 'public.collect_payment_atomic(uuid,uuid,numeric,numeric,text,text,text,numeric,text)', 'EXECUTE');
--   -- expect false
-- select has_function_privilege('authenticated', 'public.collect_payment_atomic(uuid,uuid,numeric,numeric,text,text,text,numeric,text)', 'EXECUTE');
--   -- expect true
